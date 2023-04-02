########
# DEPS
########
FROM node:18-alpine as deps
WORKDIR /usr/src/bot

COPY package*.json ./
# Install build tools for erlpack, sodium, zlib-sync then install npm deps
RUN apk add --no-cache \
    libtool \
    autoconf \
    automake \
    python3 \
    make \
    gcc \
    g++

RUN npm ci --omit=dev

########
# BUILD
########
FROM deps as build

# Add dev deps (don't `npm ci` as it would delete node_modules)
RUN npm i
# Copy all *.json, *.js, *.ts
COPY . .

RUN npm run build

########
# DEPLOY
########
FROM node:18-alpine
WORKDIR /usr/src/bot

ENV NODE_ENV=production
ENV NPM_CONFIG_LOGLEVEL warn

VOLUME [ "/usr/src/bot/config" ]

RUN apk add --no-cache \
    ca-certificates \
    ffmpeg

# Steal node_modules from build image
COPY --from=deps /usr/src/bot/node_modules ./node_modules/

# Steal compiled code from build image
COPY --from=build /usr/src/bot/dist ./

# Copy package.json for version number
COPY package*.json ./

USER node

CMD [ "node", "index.js" ]