import 'source-map-support/register';
import { config } from 'dotenv';

import discordjs from 'discord.js';
import { getChannelVideos, returnRandomStream } from './youtube';

config();

const client = new discordjs.Client();
const channelId = process.env.CHANNEL_USERNAME || 'invalid';
const botToken = process.env.BOT_TOKEN || 'missing';

getChannelVideos(channelId);

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

client.login(botToken);

client.on('message', async (message) => {
  const voiceConnection = await message.member?.voice.channel?.join();
  if (voiceConnection) {
    const clipStream = returnRandomStream(10);
    const dispatcher = voiceConnection.play(clipStream.stream);
    dispatcher.on('start', async () => {
      await timeout(clipStream.length * 1000);
      voiceConnection.disconnect();
      clipStream.stream.destroy();
    });
  }
});
