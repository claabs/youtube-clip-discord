########
# BUILD
########
FROM keymetrics/pm2:16-alpine as build
WORKDIR /usr/src/bot

COPY package*.json ./
# Install build tools for erlpack, then install prod deps only, then remove build tools
RUN apk add --no-cache \
    ca-certificates \
    libtool \
    autoconf \
    automake \
    git \
    python \
    make \
    gcc \
    g++ \
    && npm ci --only=production && \
    apk del make gcc g++ python

# Copy all *.json, *.js, *.ts
COPY . .
# Prod deps already installed, add dev deps
RUN npm i

RUN npm run build

########
# DEPLOY
########
FROM keymetrics/pm2:16-alpine
WORKDIR /usr/src/bot

VOLUME [ "/usr/src/bot/config" ]

RUN apk update && \
    apk upgrade && \
    apk add ca-certificates \
    ffmpeg

ENV NPM_CONFIG_LOGLEVEL warn

# Steal node_modules from build image
COPY --from=build /usr/src/bot/node_modules ./node_modules/

# Steal compiled code from build image
COPY --from=build /usr/src/bot/dist ./

# Copy package.json for version number
COPY package*.json ./

# Copy PM2 config
COPY ecosystem.config.js .

CMD [ "pm2-runtime", "start", "ecosystem.config.js" ]