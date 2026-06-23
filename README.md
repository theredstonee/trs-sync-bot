# TRS Sync Bot

> Mirror an entire Discord category — channels, messages and reactions — between two servers. Free, open source, built in Germany. Part of the **TheRedStonee** universe.

![License](https://img.shields.io/badge/License-MIT-e11d2a?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square)
![Node](https://img.shields.io/badge/Node-22-339933?style=flat-square)
[![Docs](https://img.shields.io/badge/Docs-redst.de-e11d2a?style=flat-square)](https://docs.redst.de/en/sync-bot/ueberblick)

---

## What it does

Keeps a category in sync across two Discord servers. The **structure** flows from Server A → B, while **messages and reactions travel both ways** through webhooks — with the original display name and avatar, real pings, attachments and embeds.

## Features

- **Structure** — create, delete, rename and reorder channels (A → B); type, topic, slowmode and NSFW are carried over.
- **Messages** — bidirectional via webhooks; edits, single deletes and bulk deletes (purge) are mirrored. Bots and third-party webhooks too.
- **Reactions** — emojis mirrored 1:1 (add / remove).
- **Names** — channels follow Server A unless locked with `/sync rename-channel`; the category is renamed only via `/sync rename-category`.
- **Loop-safe** — the bot's own webhook messages are detected and never re-mirrored.

## Commands

| Command | Where | Function |
| --- | --- | --- |
| `/sync setup [category]` | Server A | Register a category, get a Sync ID |
| `/sync activate [sync-id]` | Server B | Recreate channels, set up webhooks, start the sync |
| `/sync status` | both | Show the syncs connected to this server |
| `/sync rename-channel` | Server B | Rename and lock a mirrored channel |
| `/sync rename-category` | Server B | Rename the mirrored category |
| `/sync remove` | both | Disconnect and clear the database entries |

## Setup

Requires **Node 22**, the bot on **both servers**, and the **Message Content Intent** enabled.

```bash
cp .env.example .env   # DISCORD_TOKEN + CLIENT_ID
npm install
npm run dev
```

Full setup, hosting (Pterodactyl) and troubleshooting → **[docs.redst.de](https://docs.redst.de/en/sync-bot/ueberblick)**

## License

MIT © TheRedStonee
