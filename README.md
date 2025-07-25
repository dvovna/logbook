## Description

This is a Slack bot app that allows managing user vacation requests.

## Project setup

```bash
$ yarn install
```

## Compile and run the project

```bash
# development
$ yarn run start

# watch mode
$ yarn run start:dev

# production mode
$ yarn run start:prod
```
## Test the bot installation

# URL to install the app
https://slack.com/oauth/v2/authorize?client_id=...&scope=commands,users:read,users:read.email,channels:read,chat:write&redirect_uri=https://{ngrok_domain}/api/slack/oauth/redirect

