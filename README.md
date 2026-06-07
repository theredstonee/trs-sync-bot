# TRS Sync Bot

Ein modularer Discord-Bot (discord.js v14 + TypeScript + better-sqlite3), der eine
**Kategorie inkl. aller Channels zwischen zwei Servern** synchronisiert.

- **Struktur-Sync (A → B):** Channel-Erstellung, -Löschung, -Umbenennung, Reihenfolge,
  Typ (Text/Voice/Forum/Announcement), Topic, Slowmode.
- **Nachrichten-Sync (A ↔ B):** Bidirektional über Webhooks, mit Original-Name/Avatar,
  Attachments, Embeds, Edits & Deletes. Inklusive Loop-Prevention.
- **Custom Names:** Channels auf B können per UI/Befehl umbenannt und „gelockt“ werden;
  die Kategorie auf B ist gegen UI-Umbenennung geschützt (nur per Befehl).

## Slash-Commands

| Command | Wo | Funktion |
|---|---|---|
| `/sync setup [category]` | Server A | Legt Sync an, gibt **Sync-ID** zurück |
| `/sync activate [sync-id]` | Server B | Spiegelt Kategorie + Channels, startet Sync |
| `/sync status` | beide | Zeigt verbundene Server/Kategorien |
| `/sync rename-channel [channel] [new_name]` | Server B | Channel umbenennen + lock |
| `/sync rename-category [new_name]` | Server B | Einzige erlaubte Kategorie-Umbenennung |
| `/sync remove [sync-id?]` | beide | Trennt Sync, löscht DB-Einträge + Webhooks (Channels bleiben) |

## Datenbank-Schema (better-sqlite3)

- `sync_pairs` – die Verbindung A↔B inkl. Kategorie-Infos und Aktiv-Status
- `channel_mappings` – Source-Channel ↔ Target-Channel + beide Webhooks
- `message_mappings` – Origin-Message ↔ Mirror-Message (für Edits/Deletes)
- `custom_names` – gelockte Channel-Namen auf B

## Voraussetzungen

- Node.js **22**
- Der Bot muss **Mitglied beider Server** sein.
- Bot-Permissions: `Manage Channels`, `Manage Webhooks`, `View Channels`,
  `Send Messages`, `Read Message History`.
- Im **Developer Portal** → Bot → **Privileged Gateway Intents**:
  **MESSAGE CONTENT INTENT** aktivieren (Pflicht, sonst bleiben Nachrichten leer).

## Lokales Setup

```bash
cp .env.example .env      # Token + Client-ID eintragen
npm install
npm run dev               # ts-node --esm src/index.ts
```

## Pterodactyl-Setup (Node.js 22, tsc-Build)

Der Egg-Startup installiert Deps, **kompiliert mit `tsc -p`** und startet die
fertige JS-Datei:

```
... npm install ; npx tsc -p /home/container ; node /home/container/dist/dist/index.js
```

Damit `node dist/dist/index.js` existiert, ist `outDir` in `tsconfig.json` auf
**`dist/dist`** gesetzt (rootDir `src`). Das ist bereits konfiguriert.

### ⚠️ WICHTIG: Node-Version & node_modules

`better-sqlite3` ist ein **natives Modul** und braucht ein Binary, das zur Node-Version
(ABI) passt.

1. **Node-Version im Egg auf 20 oder 22 stellen.** Node **18 wird nicht unterstützt**
   (`better-sqlite3@11` benötigt Node ≥ 20). Im Pterodactyl-Egg die Node-/Docker-Image-
   Version entsprechend setzen.
2. **Niemals `node_modules` hochladen.** Lade nur den Quellcode hoch (`node_modules` ist in
   `.gitignore`). Liegt ein hochgeladenes/altes `node_modules` im Container, sagt
   `npm install` nur „up to date" und lädt das passende SQLite-Binary **nie** nach →
   `Could not locate the bindings file`. In dem Fall einmalig löschen:
   ```bash
   rm -rf /home/container/node_modules
   ```
   Beim nächsten Start zieht `npm install` `better-sqlite3` frisch inkl. Prebuild.

### Ablauf

1. Quellcode hochladen (oder per Git deployen) — **ohne** `node_modules`.
2. **Environment-Variablen** im Panel setzen:
   - `DISCORD_TOKEN`, `CLIENT_ID`, optional `DATABASE_PATH` (Standard: `./data/sync.db`)
   - `JS_FILE` = `dist/index.js`  → der Egg startet `node /home/container/dist/${JS_FILE}`,
     also `/home/container/dist/dist/index.js` (passt zu `outDir: dist/dist`)
3. Starten — der Egg führt automatisch aus:
   - `npm install` → installiert inkl. Prebuild von `better-sqlite3` (Linux/Node 20+)
   - `npx tsc -p /home/container` → erzeugt `dist/dist/**/*.js`
   - `node /home/container/dist/dist/index.js` → startet den Bot

> Hinweis: `DATABASE_PATH` am besten auf einen persistenten Pfad legen (z. B.
> `./data/sync.db`), damit die DB einen Neustart/Rebuild übersteht.

## Ablauf (typische Nutzung)

1. Auf **Server A**: `/sync setup category:<Kategorie>` → kopiere die Sync-ID.
2. Auf **Server B**: `/sync activate sync-id:<ID>` → Kategorie + Channels werden erstellt.
3. Fertig — Nachrichten syncen bidirektional, Struktur fließt A → B.

## Architektur

```
src/
  index.ts                 # Client + Intents + Event-Wiring
  config.ts                # Env-Variablen
  deploy-commands.ts       # (optional) globale Command-Registrierung
  database/db.ts           # Schema + Repository-Funktionen
  commands/
    index.ts               # Command-Registry
    sync.ts                # /sync mit allen Subcommands
  events/
    ready.ts               # Command-Registrierung + State laden
    interactionCreate.ts   # Command-Dispatch
    messages.ts            # messageCreate/Update/Delete
    channels.ts            # channelCreate/Update/Delete
  sync/
    state.ts               # Loop-Prevention + Suppress-Set für eigene Updates
    ids.ts                 # Sync-ID-Generator
    channels.ts            # Channel-Helper, Webhook-Erstellung
    messages.ts            # Nachrichten spiegeln (send/edit/delete)
    structure.ts           # Struktur-Sync + Custom-Name-Logik + Positionen
    setup.ts               # Aktivierung (Kategorie + Channels nachbauen)
  util/logger.ts
```

## Hinweise / Grenzen

- **Loop-Prevention:** Eingehende Nachrichten von eigenen, gemanagten Webhooks werden
  per ID ignoriert. Bots & fremde Webhooks werden gespiegelt.
- **Eigene Channel-Updates** (durch den Bot) werden per In-Memory-`Set` markiert, damit
  sie nicht fälschlich als Custom Name in die DB geschrieben werden.
- **Nachrichten-Sync** läuft für **Text- und Announcement-Channels**. Voice/Forum werden
  strukturell gespiegelt, aber (Forum-Threads/Voice) nicht als Nachrichten-Stream.
- Cross-Server-Mentions werden beim Spiegeln **nicht** gepingt (`allowedMentions: parse: []`).
```
