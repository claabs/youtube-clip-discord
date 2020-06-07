/* eslint-disable import/prefer-default-export */
import 'source-map-support/register';
import { config } from 'dotenv';
import schedule from 'node-schedule';
import discordjs, { GuildMember, VoiceConnection } from 'discord.js';
import fs from 'fs';
import YouTubeManager from './youtube';
// eslint-disable-next-line import/no-cycle
import { setupTwitch } from './twitch-event';

config();

enum Command {
  PLAY,
  HELP,
  INVITE,
}

interface PlayInfo {
  member: GuildMember;
  duration: number;
}

interface GuildQueue {
  [guildId: string]: PlayInfo[];
}

const client = new discordjs.Client();
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || 'invalid';
const BOT_TOKEN = process.env.BOT_TOKEN || 'missing';
const BOT_COLOR = Number(process.env.BOT_COLOR) || undefined;
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '!play';
const CLIP_DURATION = Number(process.env.CLIP_DURATION) || 10;
const VOLUME = Number(process.env.VOLUME) || 0.5;
const STATUS_TIMEOUT = Number(process.env.STATUS_TIMEOUT) || 60;

const guildQueue: GuildQueue = {};

const { version, author } = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

const youtube = new YouTubeManager(CHANNEL_USERNAME);

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function timeout(sec: number) {
  let timerId: number;
  let endTimer: (reason?: string) => void;
  class TimedPromise extends Promise<string> {
    cancel = (reason?: string): void => {
      endTimer(reason);
      clearTimeout(timerId);
    };
  }
  return new TimedPromise((resolve) => {
    endTimer = resolve;
    timerId = setTimeout(resolve, sec * 1000);
  });
}

let statusTimeoutPromise: ReturnType<typeof timeout> | undefined;

async function setPlaying(title?: string): Promise<void> {
  if (client.user) {
    let timeoutReason = '';
    console.log(`Setting status: ${title || 'no title'}`);
    if (title) {
      if (statusTimeoutPromise) {
        statusTimeoutPromise.cancel('reset');
      }
      client.user.setActivity({
        type: 'PLAYING',
        name: `${title} | ${COMMAND_PREFIX}`,
      });
      statusTimeoutPromise = timeout(STATUS_TIMEOUT);
      timeoutReason = await statusTimeoutPromise;
    }
    if (timeoutReason !== 'reset') {
      client.user.setActivity({
        type: 'PLAYING',
        name: `${youtube.channelTitle} | ${COMMAND_PREFIX}`,
      });
    }
  }
}

async function playAudio(guildId: string, connection?: VoiceConnection): Promise<void> {
  console.log('Handling play event for guildId:', guildId);
  const playQueue = guildQueue[guildId];
  if (!(playQueue && playQueue.length)) {
    console.error('Empty queue for guildId:', guildId);
    if (connection) {
      connection.disconnect();
    }
    return;
  }
  const playInfo = playQueue[0];
  if (!playInfo) {
    await playAudio(guildId);
    return;
  }
  const voiceConnection = await playInfo.member.voice.channel?.join();
  if (!voiceConnection) {
    await playAudio(guildId);
    return;
  }
  const clipData = youtube.returnRandomClip(playInfo.duration);
  setPlaying(clipData.title);
  const dispatcher = voiceConnection.play(clipData.filename, {
    seek: clipData.startTime,
    volume: VOLUME,
  });
  dispatcher.on('start', async () => {
    await timeout(clipData.length);
    dispatcher.destroy();
    playQueue.shift();
    await playAudio(guildId, voiceConnection);
  });
  dispatcher.on('error', async () => {
    dispatcher.destroy();
    playQueue.shift();
    await playAudio(guildId, voiceConnection);
  });
}

export async function queueAudio(member: GuildMember, duration: number): Promise<void> {
  const guildId = member.guild.id;
  const playInfo: PlayInfo = { member, duration };
  if (guildQueue[guildId] && guildQueue[guildId].length) {
    guildQueue[guildId].push(playInfo);
  } else {
    guildQueue[guildId] = [playInfo];
    playAudio(guildId);
  }
}

async function init(): Promise<void> {
  await youtube.updateCache();
  client.login(BOT_TOKEN);
  await setupTwitch(client);
}

function prepareRichEmbed(): discordjs.MessageEmbedOptions {
  const avatarURL = client.user?.avatarURL() || undefined;
  return {
    author: {
      name: client.user?.username,
      iconURL: avatarURL,
    },
    thumbnail: {
      url: avatarURL,
    },
    color: BOT_COLOR,
    footer: {
      text: `${client.user?.username} v${version} by ${author}`,
    },
  };
}

/**
 * Reads a new message and checks if and which command it is.
 * @param message Message to be interpreted as a command
 * @return Command string
 */
function validateMessage(message: discordjs.Message): Command | null {
  const messageText = message.content.toLowerCase();
  const thisPrefix = messageText.substring(0, COMMAND_PREFIX.length);
  if (thisPrefix === COMMAND_PREFIX) {
    const split = messageText.split(' ');
    if (split[0] === COMMAND_PREFIX && split.length === 1) return Command.PLAY;
    if (split[1] === 'help') return Command.HELP;
    if (split[1] === 'invite') return Command.INVITE;
  }
  return null;
}

async function sendMessage(
  message: discordjs.MessageOptions,
  trigger: discordjs.Message
): Promise<void> {
  try {
    await trigger.channel.send(message);
  } catch (err) {
    await trigger.author.send(message);
  }
}

client.on('ready', async () => {
  console.log(`YouTube Clip Bot by ${author}`);
  setPlaying();
});

client.on('message', async (message) => {
  if (message.guild && message.member) {
    const command = validateMessage(message);
    if (command === Command.HELP) {
      console.log('Handling help message');
      const richEm: discordjs.MessageEmbedOptions = {
        ...prepareRichEmbed(),
        description: `A voice bot that plays random audio segments from ${youtube.channelTitle}'s upload catalog.`,
        fields: [
          {
            name: COMMAND_PREFIX,
            value: `Plays a ${CLIP_DURATION} second clip from a random video of ${youtube.channelTitle}'s YouTube channel.`,
            inline: false,
          },
          {
            name: `${COMMAND_PREFIX} help`,
            value: `Displays this help message.`,
            inline: false,
          },
          {
            name: `${COMMAND_PREFIX} invite`,
            value: `Generates a link to invite this bot to a server near you!`,
            inline: false,
          },
        ],
      };
      await sendMessage({ embed: richEm }, message);
    } else if (command === Command.INVITE) {
      console.log('Handling invite message');
      const richEm: discordjs.MessageEmbedOptions = {
        ...prepareRichEmbed(),
        fields: [
          {
            name: 'Invite',
            value: `[Invite ${client.user?.username} to your server](https://discordapp.com/oauth2/authorize?client_id=${client.user?.id}&scope=bot)`,
            inline: false,
          },
        ],
      };
      sendMessage({ embed: richEm }, message);
    } else if (command === Command.PLAY && youtube.ready) {
      console.log('Handling play message');
      queueAudio(message.member, CLIP_DURATION);
      console.log(guildQueue);
    }
  }
});

init();

schedule.scheduleJob('0 4 * * *', async () => youtube.updateCache());
