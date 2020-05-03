import 'source-map-support/register';
import { config } from 'dotenv';
import schedule from 'node-schedule';
import discordjs from 'discord.js';
import YouTubeManager from './youtube';

config();

const client = new discordjs.Client();
const channelUsername = process.env.CHANNEL_USERNAME || 'invalid';
const botToken = process.env.BOT_TOKEN || 'missing';
const CLIP_DURATION = 10;

const youtube = new YouTubeManager(channelUsername);

async function init(): Promise<void> {
  await youtube.updateCache();
  client.login(botToken);
}

init();

function timeout(sec: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, sec * 1000));
}

client.on('message', async (message) => {
  const voiceConnection = await message.member?.voice.channel?.join();
  if (voiceConnection && youtube.ready) {
    const clipStream = youtube.returnRandomClip(CLIP_DURATION);
    const dispatcher = voiceConnection.play(clipStream.filename, { seek: clipStream.startTime });
    dispatcher.on('start', async () => {
      await timeout(clipStream.length);
      voiceConnection.disconnect();
      dispatcher.destroy();
    });
  }
});

schedule.scheduleJob('0 4 * * *', async () => youtube.updateCache());
