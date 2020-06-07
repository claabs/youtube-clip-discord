/* eslint-disable import/prefer-default-export */
/* eslint-disable @typescript-eslint/camelcase */
import PubSubClient, { PubSubRedemptionMessage } from 'twitch-pubsub-client';
import TwitchClient from 'twitch';
import express from 'express';
import passport from 'passport';
import fs from 'fs';

import session from 'express-session';
import FileStore from 'session-file-store';
import { VerifyCallback } from 'passport-oauth2';
import { Strategy as TwitchStrategy, TwitchProfile } from 'passport-twitch-latest';
import { Client } from 'discord.js';
// eslint-disable-next-line import/no-cycle
import { queueAudio } from '.';

interface SessionUser extends TwitchProfile {
  accessToken: string;
  refreshToken: string;
}

const SCOPE = 'channel:read:redemptions';
const TWITCH_DURATION = Number(process.env.TWITCH_DURATION) || 10;

async function setupPubSub(client: Client): Promise<void> {
  const {
    TWITCH_USER,
    CLIENT_ID,
    CLIENT_SECRET,
    STREAMER_DISCORD_ID,
    PRIMARY_GUILD_ID,
    REDEMPTION_EVENT_MATCH,
  } = process.env;

  if (
    !TWITCH_USER ||
    !CLIENT_ID ||
    !CLIENT_SECRET ||
    !STREAMER_DISCORD_ID ||
    !PRIMARY_GUILD_ID ||
    !REDEMPTION_EVENT_MATCH
  ) {
    console.warn('Missing variables for Twitch config. Ignoring Twitch events.');
    return;
  }
  let userData: SessionUser;
  try {
    userData = JSON.parse(fs.readFileSync(`./config/${TWITCH_USER}.json`, 'utf8'));
  } catch (err) {
    console.log('No user sessions');
    return;
  }
  const twitchClient = TwitchClient.withCredentials(CLIENT_ID, userData.accessToken, [SCOPE], {
    clientSecret: CLIENT_SECRET,
    refreshToken: userData.refreshToken,
  });
  const twitchUser = userData.id;

  const pubSubClient = new PubSubClient();
  console.log('Registering listener');
  await pubSubClient.registerUserListener(twitchClient, twitchUser);

  await pubSubClient.onRedemption(twitchUser, async (message: PubSubRedemptionMessage) => {
    console.log(`Channel point event: ${JSON.stringify(message)}`);
    if (message.rewardName.toLowerCase().includes(REDEMPTION_EVENT_MATCH)) {
      console.log('Its a Croint event!');
      const guild = client.guilds.cache.get(PRIMARY_GUILD_ID);
      const member = guild?.members.cache.get(STREAMER_DISCORD_ID);
      if (!member) {
        console.error('Could not find streamer user in guild');
        return;
      }
      await queueAudio(member, TWITCH_DURATION);
    }
  });
}

export async function setupTwitch(client: Client): Promise<void> {
  const { CLIENT_ID, CLIENT_SECRET, BASE_URL, TWITCH_USER } = process.env;
  if (!(CLIENT_ID && CLIENT_SECRET && BASE_URL && TWITCH_USER)) {
    console.log('Missing env vars, not setting up Twitch');
    return;
  }

  setupPubSub(client);

  const baseUrl = BASE_URL || 'http://localhost:3000';

  console.log('discovered');

  const app = express();

  const SessionStore = FileStore(session);

  app.use(
    session({
      store: new SessionStore({
        path: './config/sessions',
        retries: 1,
      }),
      secret: 'hey now, youre an allstar',
      resave: false,
      saveUninitialized: true,
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user, done) => {
    done(null, user);
  });

  passport.deserializeUser((user, done) => {
    done(null, user);
  });

  passport.use(
    new TwitchStrategy(
      {
        clientID: CLIENT_ID || 'missing',
        clientSecret: CLIENT_SECRET || 'missing',
        callbackURL: `${baseUrl}/auth/callback`,
      },
      (
        accessToken: string,
        refreshToken: string,
        profile: TwitchProfile,
        verified: VerifyCallback
      ) => {
        console.log('ACCESS TOKEN:', accessToken);
        console.log('REFRESH TOKEN:', refreshToken);
        // console.log('PROFILE:', profile);
        const user: SessionUser = { ...profile, accessToken, refreshToken };
        fs.writeFileSync(`./config/${TWITCH_USER}.json`, JSON.stringify(user), 'utf8');
        verified(null, user);
      }
    )
  );

  app.get('/auth', (req, res, next) => {
    console.log('authstart');
    passport.authenticate('twitch', { scope: SCOPE })(req, res, next);
  });

  app.get('/success', (req, res, next) => {
    console.log('success');
    setupPubSub(client);
    res.status(200);
    next();
  });

  app.get('/failure', (req, res, next) => {
    console.log('failure');
    res.status(200);
    next();
  });

  app.get(
    '/auth',
    passport.authenticate('twitch', {
      scope: SCOPE,
    })
  );
  app.get(
    '/auth/callback',
    passport.authenticate('twitch', { failWithError: true, successRedirect: '/success' })
  );

  app.listen(3000);
}
