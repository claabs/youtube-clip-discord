# youtube-clip-discord

A Discord bot that plays mid-video, fixed length audio segments in a voice channel.

Also has an optional feature to play on a Twitch channel point redemption event.

## Docker Congifuration

### Environment Variables

| Variable               | Example                            | Default | Description                                                                                                              |
|------------------------|------------------------------------|---------|--------------------------------------------------------------------------------------------------------------------------|
| BOT_TOKEN              | `k5NzE2NDg1MTIwMjcUxhiH`           |         | Bot token. See [bot applications](https://discordapp.com/developers/applications/)                                       |
| CHANNEL_USERNAME       | `charlocharlieL`                   |         | Username for the YouTube account, typically in the URL                                                                   |
| YOUTUBE_API_KEY        | `psHi6lEseHEa6XACYv_7bXeb-edv6mwG` |         | Server-to-server API key for the [YouTube Data V3 API](https://developers.google.com/youtube/registering_an_application) |
| COMMAND_PREFIX         | `play`                             | `play`  | The slash command trigger phrase                                                                                         |
| BOT_COLOR              | `1234`                             | none    | A hex color converted to decimal                                                                                         |
| CLIP_DURATION          | `5`                                | `10`    | Duration in seconds that the clip will run for                                                                           |
| VOLUME                 | `0.7`                              | `0.5`   | A value between 0 and 2 for volume. 1 is normal                                                                          |
| STATUS_TIMEOUT         | `120`                              | `60`    | How a new video's title shows in the bot's status before resetting to the channel name                                   |
| TZ                     | `America/Chicago`                  | `UTC`   | (Optional) [TZ name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)                                       |
| CLIENT_ID              | `abc123abc123`                     |         | (Optional) Twitch application client ID                                                                                  |
| CLIENT_SECRET          | `xyz789xyz789`                     |         | (Optional) Twitch application client secret                                                                              |
| TWITCH_USER            | `ninja`                            |         | (Optional) Twitch user to listen for channel point redemptions on                                                        |
| PRIMARY_GUILD_ID       | `00000000000000`                   |         | (Optional) Discord guild ID of the server where the streamer is in voice                                                 |
| STREAMER_DISCORD_ID    | `00000000000000`                   |         | (Optional) Discord user ID of the streamer                                                                               |
| REDEMPTION_EVENT_MATCH | `music`                            |         | (Optional) A case-insensitive string to match with a channel point event name                                            |
| BASE_URL               | `https://twitch.example.com`       |         | (Optional) Base URL where the bot is hosted                                                                              |
| TWITCH_DURATION        | `5`                                | 10      | (Optional) How long a sound clip invoked from a channel point event should last                                          |

### Volumes

| Host location   | Container location    | Mode | Description                        |
|-----------------|-----------------------|------|------------------------------------|
| `/my/host/dir/` | `/usr/src/bot/config` | `rw` | Location of the cached audio files |

### Ports

| Host   | Container | Description                               |
|--------|-----------|-------------------------------------------|
| choose | 3000      | Port that the Twitch server is exposed on |
