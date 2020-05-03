/* eslint-disable no-console */
import 'source-map-support/register';
import { config } from 'dotenv';
import ffmpeg from 'fluent-ffmpeg';
import { google } from 'googleapis';
import ytdl from 'ytdl-core';
import duration from 'iso8601-duration';
import fs from 'fs';

config();

interface VideoSnippetInfoPartial {
  videoId?: string | null;
  publishedAt?: string | null;
}

interface VideoSnippetInfo {
  videoId: string;
  publishedAt: string;
}

interface VideoDetails {
  id: string;
  duration: string;
}

interface FullVideoDetails extends VideoDetails {
  publishedAt?: string;
}

interface VideoAccum extends VideoDetails {
  durationSec: number;
  accumTime: number;
}

interface VideoClip extends VideoAccum {
  clipStartTime: number;
  clipLenth: number;
}

interface ClipData {
  filename: string;
  length: number;
  startTime: number;
}

const DOWNLOAD_DIR = 'config';
const youtubeApiKey = process.env.YOUTUBE_API_KEY || 'missing';

async function downloadPromise(videoId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const filename = `${DOWNLOAD_DIR}/${videoId}.opus`;
    if (fs.existsSync(filename)) {
      console.log(`Already have video ${videoId}`);
      resolve();
    } else {
      console.log(`Downloading video ${videoId}`);
      const inputStream = ytdl(videoId, {
        filter: 'audioonly',
        quality: 'highestaudio',
      });
      ffmpeg()
        .input(inputStream)
        .format('ogg')
        .audioCodec('libopus')
        .pipe(fs.createWriteStream(filename))
        .on('finish', () => {
          console.log(`Finished downloading ${videoId}`);
          resolve();
        })
        .on('error', (err) => reject(err));
    }
  });
}

export default class YouTubeManager {
  private channelUsername: string;

  private channelVideos: FullVideoDetails[] = [];

  public ready = false;

  constructor(channelUsername: string) {
    this.channelUsername = channelUsername;
  }

  private async getChannelVideos(): Promise<FullVideoDetails[]> {
    const youtube = google.youtube('v3');
    const channel = await youtube.channels.list({
      auth: youtubeApiKey,
      forUsername: this.channelUsername,
      part: 'contentDetails',
    });
    console.log('channel', channel);
    const uploadsPlaylists = channel.data.items?.map(
      (content) => content.contentDetails?.relatedPlaylists?.uploads
    );
    if (!uploadsPlaylists || !uploadsPlaylists[0]) throw new Error('Missing upload playlist');
    const playlistId = uploadsPlaylists[0];
    console.log('playlistId', playlistId);
    const videosResp = await youtube.playlistItems.list({
      auth: youtubeApiKey,
      playlistId,
      maxResults: 50,
      part: 'snippet',
    });
    console.log('videosResp', videosResp);
    if (!videosResp.data.items) throw new Error('No playlist video items');
    const playlistVideos: VideoSnippetInfoPartial[] = videosResp.data.items.map((item) => {
      return { videoId: item.snippet?.resourceId?.videoId, publishedAt: item.snippet?.publishedAt };
    });
    if (!playlistVideos) throw new Error('Missing playlist videos');
    const filteredVideos = playlistVideos.filter((item): item is VideoSnippetInfo => {
      return (
        item.publishedAt !== null &&
        item.publishedAt !== undefined &&
        item.videoId !== null &&
        item.videoId !== undefined
      );
    });

    const videoDetailsResp = await youtube.videos.list({
      auth: youtubeApiKey,
      id: filteredVideos.map((item) => item.videoId).join(','),
      part: 'contentDetails',
    });
    console.log('videoDetailsResp', videoDetailsResp);

    if (!videoDetailsResp.data.items) throw new Error('Missing video detail items');
    const videoDetails: VideoDetails[] = videoDetailsResp.data.items
      .map((item) => {
        return {
          id: item.id,
          duration: item.contentDetails?.duration,
        };
      })
      .filter((item): item is VideoDetails => {
        return (
          item.id !== null &&
          item.id !== undefined &&
          item.duration !== null &&
          item.duration !== undefined
        );
      });
    this.channelVideos = videoDetails.map((video) => {
      return {
        ...video,
        publishedAt: filteredVideos.find((vid) => vid.videoId === video.id)?.publishedAt,
      };
    });

    return this.channelVideos;
  }

  private selectRandomVideoClip(desiredClipLength: number): VideoClip {
    let timeAccum = 0;
    const accumVideos: VideoAccum[] = this.channelVideos.map((video) => {
      const durationSec = duration.toSeconds(duration.parse(video.duration));
      const clip = {
        ...video,
        durationSec,
        accumTime: timeAccum,
      };
      timeAccum += durationSec;
      return clip;
    });
    console.log('accumVideos', accumVideos);
    const totalDuration = timeAccum;
    console.log('totalDuration', totalDuration);
    const randomTime = Math.floor(Math.random() * Math.floor(totalDuration));
    console.log('randomTime', randomTime);
    const selectedVideo = accumVideos.reverse().find((video) => randomTime >= video.accumTime);
    if (!selectedVideo) throw new Error('Failed to select a video');
    let clipStartPoint = randomTime - selectedVideo.accumTime;
    let actualClipLength = selectedVideo.durationSec - clipStartPoint;
    if (actualClipLength < desiredClipLength) {
      // If the clip starts shortly before the video ends, roll it back
      clipStartPoint = selectedVideo.durationSec - desiredClipLength;
      // It if it rolled back before the beginning of the video, make it the start
      if (clipStartPoint < 0) {
        clipStartPoint = 0;
        actualClipLength = selectedVideo.durationSec;
      }
    }
    return {
      ...selectedVideo,
      clipStartTime: clipStartPoint,
      clipLenth: actualClipLength,
    };
  }

  public returnRandomClip(desiredClipLength: number): ClipData {
    const clip = this.selectRandomVideoClip(desiredClipLength);
    const filename = `${DOWNLOAD_DIR}/${clip.id}.opus`;
    console.log(
      `Reading video ${clip.id} at start point ${clip.clipStartTime} with length ${clip.clipLenth}. The total video length is ${clip.durationSec}`
    );
    return {
      filename,
      length: desiredClipLength,
      startTime: clip.clipStartTime,
    };
  }

  private async cacheChannelVideos(): Promise<void> {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR);
    }
    const downloadPromises = this.channelVideos.map((video) => downloadPromise(video.id));
    await Promise.all(downloadPromises);
    console.log('Finished downloading all videos');
  }

  public async updateCache(): Promise<void> {
    this.ready = false;
    await this.getChannelVideos();
    await this.cacheChannelVideos();
    this.ready = true;
  }
}
