/* eslint-disable import/prefer-default-export */
import 'source-map-support/register';
import 'dotenv/config';
import schedule from 'node-schedule';
import discordjs, { REST, Routes, SlashCommandBuilder } from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnection,
} from '@discordjs/voice';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import os from 'os';
import path from 'path';
import { rm } from 'fs/promises';
import YouTubeManager from './youtube';
// eslint-disable-next-line import/no-cycle
import { setupTwitch } from './twitch-event';

interface ClipInfo {
  duration: number;
  tempFilename: string;
  title: string;
  id: string;
  startTime: number;
}

interface PlayInfo extends ClipInfo {
  member: discordjs.GuildMember;
}

interface GuildQueue {
  [guildId: string]: PlayInfo[];
}

const client = new discordjs.Client<true>({
  intents: [
    discordjs.GatewayIntentBits.Guilds,
    discordjs.GatewayIntentBits.GuildMessages,
    discordjs.GatewayIntentBits.GuildVoiceStates,
  ],
});
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
  let endTimer: (reason: string) => void;
  class TimedPromise extends Promise<string> {
    // eslint-disable-next-line class-methods-use-this
    cancel = (reason: string): void => {
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
        type: discordjs.ActivityType.Playing,
        name: `${title} | ${COMMAND_PREFIX}`,
      });
      statusTimeoutPromise = timeout(STATUS_TIMEOUT);
      timeoutReason = await statusTimeoutPromise;
    }
    if (timeoutReason !== 'reset') {
      client.user.setActivity({
        type: discordjs.ActivityType.Playing,
        name: `${youtube.channelTitle} | ${COMMAND_PREFIX}`,
      });
    }
  }
}

async function playAudio(playInfo: PlayInfo, voiceConnection: VoiceConnection): Promise<void> {
  const audioResource = createAudioResource(playInfo.tempFilename, {});
  const player = createAudioPlayer();
  console.log('subscribing voice connection to player');
  const subscription = voiceConnection.subscribe(player);
  console.log('playing audio resource');
  player.play(audioResource);
  setPlaying(playInfo.title);
  await new Promise((resolve, reject) => {
    player.on('stateChange', async (_oldState, newState) => {
      if (newState.status === AudioPlayerStatus.Idle) {
        console.log('Stopping player and unsubscribing');
        player.stop();
        if (subscription) subscription.unsubscribe();
        resolve(null);
      }
    });
    player.on('error', async (error) => {
      player.stop();
      if (subscription) subscription.unsubscribe();
      reject(error);
    });
  });
}

export async function prepareAudio(duration: number): Promise<ClipInfo> {
  const clipData = youtube.returnRandomClip(duration);
  const tempFilename = path.resolve(
    os.tmpdir(),
    `${clipData.videoId}-${clipData.startTime}-${clipData.length}.ogg`
  );
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input(clipData.filename)
      .seekInput(clipData.startTime)
      .duration(clipData.length)
      .audioFilter(`volume=${VOLUME}`)
      .format('ogg')
      .audioCodec('libopus')
      .pipe(fs.createWriteStream(tempFilename))
      .on('finish', () => {
        resolve(null);
      })
      .on('error', (err) => reject(err));
  });
  return {
    tempFilename,
    duration,
    title: clipData.title,
    id: clipData.videoId,
    startTime: clipData.startTime,
  };
}

async function joinAndPlayQueue(guildId: string) {
  console.log('Handling join function for guildId:', guildId);
  const playQueue = guildQueue[guildId];

  let connectedChannel: discordjs.VoiceBasedChannel | undefined;
  let voiceConnection: VoiceConnection | undefined;
  do {
    const playInfo = playQueue[0];
    const voiceChannel = playInfo.member.voice.channel;
    if (voiceChannel && connectedChannel?.id !== voiceChannel?.id) {
      if (voiceConnection) voiceConnection.destroy();
      console.log('Creating voice connection for channel:', voiceChannel.id);
      voiceConnection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });
      // eslint-disable-next-line no-await-in-loop
      await playAudio(playInfo, voiceConnection);
    }
    try {
      rm(playInfo.tempFilename);
    } catch (err) {
      console.log('Trouble deleting temp file', err);
    }
    playQueue.shift();
  } while (playQueue.length);
  if (voiceConnection) voiceConnection.destroy();
}

export async function queueAudio(member: discordjs.GuildMember, clipInfo: ClipInfo): Promise<void> {
  const guildId = member.guild.id;
  const playInfo: PlayInfo = { member, ...clipInfo };
  if (guildQueue[guildId] && guildQueue[guildId].length) {
    guildQueue[guildId].push(playInfo);
  } else {
    guildQueue[guildId] = [playInfo];
    await joinAndPlayQueue(guildId);
  }
}

async function deployCommands(): Promise<void> {
  const playCommand = new SlashCommandBuilder()
    .setName(COMMAND_PREFIX)
    .setDescription(
      `Plays a ${CLIP_DURATION} second clip from a random video of ${youtube.channelTitle}'s YouTube channel.`
    );
  const helpCommand = new SlashCommandBuilder()
    .setName('help')
    .setDescription(`Displays command and version info for this bot`);
  const commands = [playCommand, helpCommand].map((command) => command.toJSON());
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
}

async function init(): Promise<void> {
  await youtube.updateCache();
  await client.login(BOT_TOKEN);
  await deployCommands();
  const inviteUrl = client.generateInvite({
    scopes: [discordjs.OAuth2Scopes.Bot, discordjs.OAuth2Scopes.ApplicationsCommands],
    permissions: [
      discordjs.PermissionFlagsBits.SendMessages,
      discordjs.PermissionFlagsBits.EmbedLinks,
      discordjs.PermissionFlagsBits.Connect,
      discordjs.PermissionFlagsBits.Speak,
    ],
  });
  console.log('Discord bot invite URL:', inviteUrl);
  await setupTwitch(client);
}

function prepareRichEmbed(
  fields: discordjs.APIEmbedField[],
  description?: string
): discordjs.APIEmbed {
  const avatarURL = client.user.avatarURL();
  return {
    fields,
    description,
    author: {
      name: client.user.username,
      icon_url: avatarURL || undefined,
    },
    thumbnail: avatarURL
      ? {
          url: avatarURL,
        }
      : undefined,
    color: BOT_COLOR,
    footer: {
      text: `${client.user?.username} v${version} by ${author}`,
    },
  };
}

client.on('ready', async () => {
  console.log(`YouTube Clip Bot by ${author}`);
  setPlaying();
});

client.on(discordjs.Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'help') {
    console.log('Handling help message');
    const richEm = prepareRichEmbed(
      [
        {
          name: COMMAND_PREFIX,
          value: `Plays a ${CLIP_DURATION} second clip from a random video of ${youtube.channelTitle}'s YouTube channel.`,
          inline: false,
        },
      ],
      `A voice bot that plays random audio segments from ${youtube.channelTitle}'s upload catalog.`
    );
    await interaction.reply({ embeds: [richEm] });
  } else if (interaction.commandName === COMMAND_PREFIX && youtube.ready) {
    console.log('Handling play message');
    if (!(interaction.member instanceof discordjs.GuildMember)) return;
    const clipInfo = await prepareAudio(CLIP_DURATION);
    const row = new discordjs.ActionRowBuilder<discordjs.ButtonBuilder>().addComponents(
      new discordjs.ButtonBuilder()
        .setLabel('Source')
        .setStyle(discordjs.ButtonStyle.Link)
        .setURL(`https://youtu.be/${clipInfo.id}?t=${clipInfo.startTime}`)
    );
    await interaction.reply({ content: `Playing **${clipInfo.title}**`, components: [row] });
    await queueAudio(interaction.member, clipInfo);
  }
});

init();

schedule.scheduleJob('0 4 * * *', async () => youtube.updateCache());
