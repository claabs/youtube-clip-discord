import 'source-map-support/register';
import { config } from 'dotenv';
import schedule from 'node-schedule';
import discordjs from 'discord.js';
import fs from 'fs';
import YouTubeManager from './youtube';

config();

const client = new discordjs.Client();
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || 'invalid';
const BOT_TOKEN = process.env.BOT_TOKEN || 'missing';
const BOT_COLOR = Number(process.env.BOT_COLOR) || undefined;
const COMMAND_PREFIX = process.env.COMMAND_PREFIX || '!play';
const CLIP_DURATION = Number(process.env.CLIP_DURATION) || 10;
const VOLUME = Number(process.env.VOLUME) || 0.5;

enum Command {
  PLAY,
  HELP,
  INVITE,
}

const { version, author } = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

const youtube = new YouTubeManager(CHANNEL_USERNAME);

function timeout(sec: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, sec * 1000));
}

async function init(): Promise<void> {
  await youtube.updateCache();
  client.login(BOT_TOKEN);
}

async function setPlaying(title?: string): Promise<void> {
  if (client.user) {
    console.log(`Setting status: ${title || 'no title'}`);
    if (title) {
      client.user.setActivity({
        type: 'PLAYING',
        name: `${title} | ${COMMAND_PREFIX}`,
      });
      await timeout(300);
    }
    client.user.setActivity({
      type: 'PLAYING',
      name: `${youtube.channelTitle} | ${COMMAND_PREFIX}`,
    });
  }
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
  if (message.guild) {
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
      const voiceConnection = await message.member?.voice.channel?.join();
      if (voiceConnection) {
        const clipData = youtube.returnRandomClip(CLIP_DURATION);
        setPlaying(clipData.title);
        const dispatcher = voiceConnection.play(clipData.filename, {
          seek: clipData.startTime,
          volume: VOLUME,
        });
        dispatcher.on('start', async () => {
          await timeout(clipData.length);
          voiceConnection.disconnect();
          dispatcher.destroy();
        });
      }
    }
  }
});

init();

schedule.scheduleJob('0 4 * * *', async () => youtube.updateCache());
