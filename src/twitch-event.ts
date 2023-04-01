/* eslint-disable import/prefer-default-export */
import { PubSubClient, PubSubRedemptionMessage } from '@twurple/pubsub';
import { AccessToken, RefreshingAuthProvider } from '@twurple/auth';
import express from 'express';
import passport from 'passport';
import fs from 'fs';

import session from 'express-session';
import FileStore from 'session-file-store';
import { VerifyCallback } from 'passport-oauth2';
import { Strategy as TwitchStrategy, TwitchProfile } from 'passport-twitch-latest';
import { Client } from 'discord.js';
// eslint-disable-next-line import/no-cycle
import { queueAudio, prepareAudio } from '.';

type SessionUser = TwitchProfile & AccessToken;

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
  const authProvider = new RefreshingAuthProvider(
    {
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      onRefresh: (newTokenData) => {
        userData = {
          ...userData,
          ...newTokenData,
        };
        fs.writeFileSync(`./config/${TWITCH_USER}.json`, JSON.stringify(userData), 'utf8');
      },
    },
    {
      expiresIn: userData.expiresIn,
      obtainmentTimestamp: userData.obtainmentTimestamp,
      refreshToken: userData.refreshToken,
      accessToken: userData.accessToken,
      scope: [SCOPE],
    }
  );
  const twitchUser = userData.id;

  const pubSubClient = new PubSubClient();
  console.log('Registering listener');
  await pubSubClient.registerUserListener(authProvider, twitchUser);

  await pubSubClient.onRedemption(twitchUser, async (message: PubSubRedemptionMessage) => {
    console.log(`Channel point event: ${JSON.stringify(message)}`);
    if (message.rewardTitle.toLowerCase().includes(REDEMPTION_EVENT_MATCH)) {
      console.log('Its a Croint event!');
      const guild = client.guilds.cache.get(PRIMARY_GUILD_ID);
      const member = guild?.members.cache.get(STREAMER_DISCORD_ID);
      if (!member) {
        console.error('Could not find streamer user in guild');
        return;
      }
      const clipInfo = await prepareAudio(TWITCH_DURATION);
      queueAudio(member, clipInfo);
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
    done(null, user as Express.User);
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
        const user: SessionUser = {
          ...profile,
          accessToken,
          refreshToken,
          obtainmentTimestamp: Date.now(),
          expiresIn: 15 * 60,
          scope: [SCOPE],
        };
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
