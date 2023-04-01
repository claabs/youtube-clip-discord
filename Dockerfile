########
# BUILD
########
FROM node:18-alpine as build
WORKDIR /usr/src/bot

COPY package*.json ./
# Install build tools for erlpack, then install prod deps only, then remove build tools
RUN apk add --no-cache \
    ca-certificates \
    libtool \
    autoconf \
    automake \
    git \
    python3 \
    make \
    gcc \
    g++ \
    && npm ci --omit=dev && \
    apk del make gcc g++ python3

# Copy all *.json, *.js, *.ts
COPY . .
# Prod deps already installed, add dev deps
RUN npm i

RUN npm run build

########
# DEPLOY
########
FROM node:18-alpine
WORKDIR /usr/src/bot

ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL warn

VOLUME [ "/usr/src/bot/config" ]

RUN apk update && \
    apk upgrade && \
    apk add ca-certificates \
    ffmpeg

# Steal node_modules from build image
COPY --from=build /usr/src/bot/node_modules ./node_modules/

# Steal compiled code from build image
COPY --from=build /usr/src/bot/dist ./

# Copy package.json for version number
COPY package*.json ./

USER node

CMD [ "node", "index.js" ]