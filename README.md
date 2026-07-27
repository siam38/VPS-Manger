<div align="center">

# VPS Manager

**A self-hosted control panel for managing a Linux VPS from the browser.**

System monitoring · file management · web terminal · process control · PM2 orchestration · Git sync

[![License: MIT](https://img.shields.io/badge/License-MIT-14b8a6.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933.svg)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6.svg)](https://www.typescriptlang.org)

</div>

---

## Table of contents

- [Overview](#overview)
- [Screenshots](#screenshots)
- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running in production](#running-in-production)
- [Security model](#security-model)
- [API reference](#api-reference)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Overview

VPS Manager is a single-tenant web control panel for a Linux server. It replaces the
common loop of *SSH in → run `htop` → `cd` around → `pm2 list` → `git pull`* with one
authenticated interface.

It is deliberately **single-user**: one password, one operator. There are no user
accounts, roles, or teams. That keeps the security surface small and the UI honest —
every control on screen acts on the machine immediately.

**Design principles**

| Principle | What it means in practice |
|---|---|
| Colour carries meaning | The teal accent marks interaction only. Red/amber/green are reserved for state — never decoration. |
| Machine data is monospaced | Hostnames, IPs, load averages and byte counts use tabular figures so columns align. |
| Destructive actions look destructive | Service restarts and process kills are visually separated from read-only lookups. |
| Accessible by default | WCAG 2.1 AA contrast, visible keyboard focus, `prefers-reduced-motion` respected. |
| Responsive, not "mobile-adapted" | Every view is verified at 390 px and 1440 px. |

---

## Screenshots

### Dashboard

Live CPU, memory, disk and load metrics over a WebSocket. Metric tiles stay neutral
until a threshold is crossed (70 % warning, 90 % critical), so an idle server is calm
and a struggling one is obvious. Charts auto-scale to the observed data window rather
than a fixed 0–100 range.

![Dashboard](docs/screenshots/Dashboard.png)

### File manager

Browse, edit, upload, download, rename, copy and delete. Directory downloads are
streamed as ZIP archives. Every file type gets its own icon and hue — a `.json`
does not look like a `.js`, and `package.json` does not look like any other JSON
file — so a directory is scannable at a glance. The address bar works like Windows
Explorer: click the breadcrumb (or press `Ctrl+L`) to type or paste a path directly.

![File manager](docs/screenshots/Files.png)

On a phone the same list folds size and modified time into a secondary line, since
there is no room for columns, and the toolbar collapses to New / Upload with
everything else behind an overflow sheet.

![File manager on mobile](docs/screenshots/Files-mobile.png)

### Code editor

CodeMirror 6 with on-demand grammars for ~40 languages, find and replace, code
folding, bracket matching, autocomplete, adjustable font size, word wrap and
optional auto-save. `Ctrl+S` (or `Cmd+S`) saves; `Ctrl+Enter` also works, because it
is easier to reach on a phone.

![Code editor](docs/screenshots/Editor.png)

The editor is genuinely usable on mobile, which was the point of moving off Monaco.
CodeMirror is `contenteditable`-based, so the OS provides native selection handles,
caret dragging and IME instead of fighting a hidden textarea. The key bar along the
bottom supplies the characters a phone keyboard hides — tab, braces, brackets,
pipe, `$`, backtick — plus undo and redo.

![Code editor on mobile](docs/screenshots/Editor-mobile.png)

### Terminal

Full PTY-backed terminal via `node-pty` and CodeMirror-era xterm.js, rebuilt for
phones as well as desktops: multiple sessions, split panes, scrollback search,
and a mobile key bar for the keys a virtual keyboard cannot produce.

![Terminal](docs/screenshots/Terminal.png)

On mobile, sticky `Ctrl`/`Alt` modifiers apply to the phone's own keyboard as
well as the bar's buttons, so `Ctrl`+`C` actually interrupts a running process.
The bar tracks the visual viewport, so it stays above the on-screen keyboard
instead of being pushed underneath it.

![Terminal on mobile](docs/screenshots/Terminal-mobile.png)

### Processes

Sortable live process table with CPU/memory thresholds and signal-aware process
termination.

![Processes](docs/screenshots/Processes.png)

### PM2

Start, stop, restart, reload, delete and inspect PM2 applications. Streams logs over
WebSocket, and supports saving, restoring and boot-persisting the process list.

![PM2](docs/screenshots/PM2.png)

### Git sync

Manage repositories on disk: stage, commit, pull, push, branch, tag, stash and resolve
merges. Connects to GitHub over a generated deploy key and can auto-restart PM2 apps
when code updates.

![Git sync](docs/screenshots/GitSync.png)

### Mobile

Every section is a first-class mobile view — no horizontal scrolling at 390 px.

<p align="center">
  <img src="docs/screenshots/Files-mobile.png" width="30%" alt="Files on mobile" />
  <img src="docs/screenshots/Editor-mobile.png" width="30%" alt="Code editor on mobile" />
  <img src="docs/screenshots/Dashboard-mobile.png" width="30%" alt="Dashboard on mobile" />
</p>

---

## Features

<details open>
<summary><strong>System monitoring</strong></summary>

- Live CPU, memory, disk and network throughput pushed over Socket.IO
- Rolling 60-sample history with auto-scaled sparklines
- Load average shown against core count, flagged when sustained
- Grouped system actions: **Inspect** (read-only), **Maintain** (safe), **Restart services** (interrupting)

</details>

<details open>
<summary><strong>File management</strong></summary>

- Path-jailed browsing across allow-listed roots
- List and grid views, sortable by name, size, type or modified time
- **Per-type file icons** with distinct glyph *and* hue for every language family,
  plus exact-filename overrides (`package.json`, `Dockerfile`, `.gitignore`, lock files)
- **Editable address bar** — click the breadcrumb or press `Ctrl+L` to type or paste a path
- **OpenClaw workspace auto-detection** — scans the allowed roots for `.openclaw`
  installs and ranks them by content, instead of hard-coding one user's home
- CodeMirror 6 editing with on-demand grammars for ~40 languages
- Mobile-first editor: native selection, key bar, adjustable font, word wrap,
  optional auto-save, find and replace
- Inline preview for images (zoom/rotate), audio, video and PDF
- Multi-file upload (100 MB per file) with real progress, plus drag and drop
- ZIP directory download
- Copy, move, rename, delete, create file/folder, hidden-file toggle
- Range select with shift-click; keyboard shortcuts for copy, cut, paste, delete,
  select-all, filter and refresh

</details>

<details open>
<summary><strong>Terminal</strong></summary>

- Real PTY sessions with multiple concurrent tabs and desktop split panes
- Sessions spawn in the effective user's real home directory
- Shell environment is isolated from the panel's own config, so `PASSWORD`,
  `JWT_SECRET` and `PORT` never leak into a session
- Mobile key bar: `Ctrl`, `Alt`, `Esc`, `Tab`, arrows, `^C`/`^D`/`^L` and shell
  punctuation, on a 44px touch grid
- Sticky modifiers shared with the device keyboard, so `Ctrl`+`C` works when the
  letter is typed on the phone rather than tapped in the bar
- Keyboard-aware layout via the VisualViewport API
- Scrollback search, adjustable text size, quick-command palette
- WebGL rendering with automatic canvas fallback
- Live tab titles from the shell's own OSC title, plus reconnect/exit states
- Automatic fit/resize propagation to the server
- Web-link detection

</details>

<details open>
<summary><strong>Process control</strong></summary>

- Live `ps`-backed table, sortable on PID, CPU, memory and command
- Threshold colouring for CPU/memory pressure
- Signal selection when terminating

</details>

<details open>
<summary><strong>PM2 orchestration</strong></summary>

- Full lifecycle: start, stop, restart, reload, delete, flush, reset
- Guided "new app" wizard with directory browsing
- Live log streaming with search and filtering
- Per-app metrics, `save` / `startup` / `resurrect` support

</details>

<details open>
<summary><strong>Git synchronisation</strong></summary>

- Repository discovery with status, branch and commit history
- Stage, commit, pull, push, discard, checkout
- Branch and tag create/delete, stash push/pop
- Merge with conflict status and abort
- GitHub setup via generated SSH deploy key
- Background sync daemon with per-repo enable/disable

</details>

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│  React 18 · TypeScript · Tailwind · Vite                     │
│  Route-level code splitting (React.lazy)                     │
└───────────────┬──────────────────────────┬───────────────────┘
                │ REST (JWT bearer)        │ Socket.IO (JWT handshake)
┌───────────────▼──────────────────────────▼───────────────────┐
│  Express server  (server/index.cjs)                          │
│  helmet · rate limiting · path jail · audit log              │
├──────────────────────────────────────────────────────────────┤
│  node-pty      │  PM2 CLI   │  git CLI   │  fs / os          │
└──────────────────────────────────────────────────────────────┘
```

**Stack**

| Layer | Technology |
|---|---|
| UI | React 18, React Router 7, Tailwind CSS 3 |
| Editor / terminal | CodeMirror 6, xterm.js 5 |
| Build | Vite 6, TypeScript 5.6 |
| Server | Express 4, Socket.IO 4 |
| Process/PTY | node-pty, PM2 |
| Security | helmet, express-rate-limit, jsonwebtoken |

**Frontend layout**

```
src/
├── components/     Layout shell, Git-sync wizard,
│                   CodeEditor / FileEditor / FilePreview, files/FileRow
├── lib/            api.ts (fetch + auth), socket.ts, utils.ts, toast.tsx,
│                   fileTypes.ts, editorTheme.ts, editorLanguages.ts
├── pages/          Dashboard, FileManager, Terminal, Processes,
│                   PM2Manager, GitSync, Login
├── index.css       Design tokens + component primitives
└── App.tsx         Auth gate, error boundary, toast provider, lazy routes
```

Pages are lazy-loaded, so xterm and the heavier managers are fetched only when their
route is visited. The editor is split out again below the route: browsing a folder
costs ~53 KB, and CodeMirror is only downloaded when you actually open a file.
Language grammars load individually on demand, so editing a `.sh` file never fetches
the TypeScript parser.

---

## Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | ≥ 18 (22 LTS recommended) | Required by `node-pty` and `archiver` |
| npm | ≥ 9 | |
| PM2 | latest | `npm install -g pm2` — needed for the PM2 section |
| Git | ≥ 2.30 | Needed for the Git Sync section |
| Build toolchain | `build-essential`, `python3` | `node-pty` compiles native bindings |

On Debian/Ubuntu:

```bash
sudo apt update && sudo apt install -y build-essential python3 git
npm install -g pm2
```

---

## Installation

**1 — Clone**

```bash
git clone https://github.com/siam38/VPS-Manger.git
cd VPS-Manger
```

**2 — Install dependencies**

```bash
npm install
```

> **Note**
> If `NODE_ENV=production` is exported in your shell, npm will silently skip
> devDependencies and the build will fail with `vite: not found`. Install with:
> ```bash
> NODE_ENV=development npm install --include=dev
> ```

**3 — Configure** — create `.env` in the project root (see [Configuration](#configuration)).

**4 — Build the frontend**

```bash
npm run build
```

**5 — Start**

```bash
npm start
```

Open `http://<server-ip>:48292` and sign in with your `PASSWORD`.

---

## Configuration

Create `.env` in the project root:

```env
PORT=48292
PASSWORD=change_this_to_a_long_random_password
JWT_SECRET=change_this_to_a_long_random_secret
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | no | `48292` | Listening port |
| `PASSWORD` | **yes** | — | Sign-in password. The server refuses to start without it. |
| `JWT_SECRET` | **yes** | — | Signing key for session tokens. Rotating it invalidates all sessions. |

Generate strong values:

```bash
openssl rand -base64 32   # PASSWORD
openssl rand -hex 48      # JWT_SECRET
```

**Filesystem access** is restricted to an allow-list defined in `server/index.cjs`:

```js
const ALLOWED_BASES = ['/root', '/var/www', '/home', '/opt', '/tmp'];
```

Every path is resolved and verified against these roots, so `../` traversal outside them
is rejected. Edit this list to widen or tighten access.

---

## Running in production

### With PM2

```bash
pm2 start server/index.cjs --name vps-manager
pm2 save
pm2 startup          # run the printed command to persist across reboots
```

### Behind Nginx with TLS

The panel speaks plain HTTP and ships no certificates by design. **Terminate TLS in
front of it.** WebSocket upgrade headers are required or the terminal and live metrics
will not connect.

```nginx
server {
    listen 443 ssl http2;
    server_name panel.example.com;

    ssl_certificate     /etc/letsencrypt/live/panel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/panel.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:48292;
        proxy_http_version 1.1;

        # Required for Socket.IO
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 86400;   # keep long-lived terminals alive
    }
}
```

Then close the raw port:

```bash
sudo ufw deny 48292
sudo ufw allow 443/tcp
```

A tunnel (Cloudflare Tunnel, Tailscale) works equally well and avoids exposing a public
port at all.

---

## Security model

**What is implemented**

- **Password authentication** with timing-safe comparison
- **JWT sessions**, verified on every REST request and on the Socket.IO handshake
- **Login rate limiting** plus per-IP lockout after repeated failures, with automatic expiry
- **Path jail** — all filesystem operations resolve against `ALLOWED_BASES`
- **`helmet`** security headers
- **Audit log** (`server/audit.log`) recording auth attempts, file operations and system actions
- **No credentials in URLs** — downloads authenticate via the `Authorization` header, so tokens never reach access logs or `Referer`

**What you must provide**

| Risk | Mitigation |
|---|---|
| Plain HTTP exposes the password and token | Terminate TLS in a reverse proxy or tunnel |
| Panel reachable from the internet | Firewall the port; expose only through the proxy |
| Full shell access by design | Treat the password as root-equivalent; use a long random value |
| Token stored in `localStorage` | Vulnerable to XSS. Do not run untrusted third-party scripts on this origin. |

> **Warning**
> This panel grants terminal access to the host. Anyone who obtains the password
> effectively has the privileges of the user running the server. Never expose it
> directly to the public internet without TLS and network restrictions.

**Dependency status.** `npm audit` reports 2 high advisories, both in
`react-router`'s RSC server mode, which this SPA does not use — they are not reachable
here. Every version at or below 7.17.0 carries a *reachable* open-redirect/XSS pair
instead, so 7.18.1 is the safest available target. Running `npm audit fix --force` will
downgrade you into the exploitable versions — don't.

The `archiver` transitive chain is patched through pinned `overrides` in `package.json`
(`brace-expansion`, `minimatch`, `glob`) rather than a major bump, because `archiver` 8
is ESM-only and the server is CommonJS.

---

## API reference

All routes require `Authorization: Bearer <token>` except `POST /api/login`.

<details>
<summary><strong>Auth</strong></summary>

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/login` | Exchange password for a JWT |
| `GET` | `/api/verify` | Validate the current token |
| `POST` | `/api/refresh` | Issue a fresh token |

</details>

<details>
<summary><strong>System</strong></summary>

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/system/info` | Host, platform, CPU model, uptime, IP |
| `GET` | `/api/system/stats` | Point-in-time CPU/memory/disk/network |
| `POST` | `/api/system/action/:action` | Run a maintenance or restart action |
| `GET` | `/api/audit/logs` | Read the audit trail |

</details>

<details>
<summary><strong>Files</strong></summary>

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/files/list` | Directory listing |
| `GET` | `/api/files/content` | Read a file |
| `GET` | `/api/files/download` | Download file, or directory as ZIP |
| `POST` | `/api/files/save` | Write a file |
| `POST` | `/api/files/upload` | Multipart upload |
| `POST` | `/api/files/mkdir` · `/rename` · `/copy` | Create, rename, copy |
| `DELETE` | `/api/files/delete` | Delete |

</details>

<details>
<summary><strong>Processes &amp; PM2</strong></summary>

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/processes/list` | Running processes |
| `POST` | `/api/processes/kill` | Send a signal |
| `GET` | `/api/pm2/list` | PM2 applications |
| `GET` | `/api/pm2/app-detail/:name` · `/logs/:name` · `/monit/:name` | Inspect |
| `POST` | `/api/pm2/restart` · `/reload` · `/delete` · `/flush` · `/reset` | Lifecycle |
| `GET` | `/api/pm2/browse-dirs` | Directory picker for the new-app wizard |

</details>

<details>
<summary><strong>Git</strong></summary>

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/git/repos` · `/status` · `/info` · `/log` · `/diff` | Inspect |
| `POST` | `/api/git/stage` · `/commit` · `/pull` · `/push` · `/discard` · `/checkout` | Core workflow |
| `GET`/`POST` | `/api/git/branches` · `/branch/create` · `/branch/checkout` · `/branch/delete` | Branches |
| `GET`/`POST`/`DELETE` | `/api/git/tags` · `/tag/create` · `/tag` | Tags |
| `GET`/`POST` | `/api/git/stash/list` · `/stash` · `/stash/pop` | Stashes |
| `GET`/`POST` | `/api/git/merge/status` · `/merge` · `/merge/abort` | Merges |
| `GET`/`POST` | `/api/git/github/*` | Deploy-key setup, connection test, clone |
| `GET`/`POST`/`DELETE` | `/api/git/sync/config` · `/sync/status` | Sync daemon |

</details>

<details>
<summary><strong>WebSocket events</strong></summary>

| Event | Direction | Purpose |
|---|---|---|
| `stats:subscribe` / `stats:unsubscribe` | client → server | Toggle the live metric stream |
| `stats:update` | server → client | Metric payload |
| `terminal:create` / `input` / `resize` / `destroy` | client → server | PTY lifecycle |
| `terminal:data` | server → client | PTY output |
| `pm2:logs:subscribe` / `unsubscribe` | client → server | Toggle log streaming |

</details>

---

## Development

```bash
NODE_ENV=development npm install --include=dev

npm run server     # API + WebSocket on :48292
npm run dev        # Vite dev server with HMR, proxied to the API
```

Vite proxies `/api` and `/socket.io` to port 48292, so both run side by side.

| Script | Purpose |
|---|---|
| `npm run dev` | Frontend dev server with hot reload |
| `npm run server` | Backend only |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |

**Type checking.** Vite does not type-check during build, so run it explicitly:

```bash
npx tsc --noEmit
```

**Design tokens.** Colours, type scale and radii live in `tailwind.config.js`;
component primitives (`.card`, `.btn`, `.pill`, `.row`, `.field`, `.empty`) live in
`src/index.css`. Prefer these over ad-hoc utility strings so restyling stays global.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `vite: not found` during build | `NODE_ENV=production` made npm skip devDependencies | `NODE_ENV=development npm install --include=dev` |
| Server exits with `PASSWORD environment variable is required` | Missing or unreadable `.env` | Create `.env` in the project root |
| Terminal never connects | Proxy is dropping the WebSocket upgrade | Add `Upgrade` / `Connection` headers to the proxy config |
| Metrics frozen after re-login | Stale socket from the previous session | Fixed in current versions; hard-refresh if it recurs |
| `node-pty` fails to install | Missing native build toolchain | `apt install build-essential python3` |
| PM2 section empty | PM2 not installed for the server's user | `npm install -g pm2` and confirm `pm2 list` works as that user |
| Locked out after failed logins | Per-IP lockout triggered | Wait for expiry, or restart the server to clear it |

---

## License

MIT — see [LICENSE](./LICENSE).

<div align="center">
<sub>Built by <a href="https://github.com/siam38">Siam</a></sub>
</div>
