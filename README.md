<h1 align="center">
  <a href="https://wirdak.app/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
      <img src="docs/assets/logo.svg" alt="Wirdak · وِردك" width="340">
    </picture>
  </a>
</h1>

<p align="center" dir="rtl"><b>ختمة جماعية للقرآن الكريم مع العائلة والأصدقاء والزملاء.</b><br>
بسيطة بما يكفي لطفل في العاشرة ولجدٍّ في الثمانين.</p>

<p align="center"><b>A shared Quran khatma for family, friends, and colleagues.</b><br>
Simple enough for a 10-year-old and an 80-year-old.</p>

<p align="center">
  <a href="https://wirdak.app/"><img src="https://img.shields.io/website?url=https%3A%2F%2Fwirdak.app&label=wirdak.app&up_message=live&up_color=1f5a45" alt="wirdak.app"></a>
  <a href="https://stg.wirdak.app/"><img src="https://img.shields.io/website?url=https%3A%2F%2Fstg.wirdak.app&label=staging&up_message=live&up_color=c98a1e" alt="Staging"></a>
  <a href="https://github.com/alilibx/wirdak/releases"><img src="https://img.shields.io/github/v/release/alilibx/wirdak?label=release&color=1f5a45" alt="Latest release"></a>
  <a href="https://github.com/alilibx/wirdak/actions/workflows/main.yml"><img src="https://img.shields.io/github/actions/workflow/status/alilibx/wirdak/main.yml?branch=main&label=build" alt="Build and deploy"></a>
  <br>
  <img src="https://img.shields.io/badge/Arabic-RTL-c98a1e" alt="Arabic, right to left">
  <img src="https://img.shields.io/badge/PWA-installable-555?logo=pwa&logoColor=white" alt="Installable web app">
  <img src="https://img.shields.io/badge/TypeScript-6-555?logo=typescript&logoColor=white" alt="TypeScript 6">
  <img src="https://img.shields.io/badge/React-19-555?logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/Convex-backend-555" alt="Convex backend">
  <img src="https://img.shields.io/badge/Vite-8-555?logo=vite&logoColor=white" alt="Vite 8">
  <img src="https://img.shields.io/badge/Tailwind%20CSS-4-555?logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4">
  <img src="https://img.shields.io/badge/Bun-1.4-555?logo=bun&logoColor=white" alt="Bun 1.4">
  <br>
  <a href="https://www.conventionalcommits.org/"><img src="https://img.shields.io/badge/commits-conventional-555" alt="Conventional Commits"></a>
  <a href="https://github.com/googleapis/release-please"><img src="https://img.shields.io/badge/releases-release--please-555" alt="Released with release-please"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-1f5a45" alt="Pull requests welcome"></a>
</p>

<p align="center">
  <a href="https://wirdak.app/"><b>Open the app</b></a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/deploy.md">Deploy</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="https://github.com/alilibx/wirdak/issues/new?template=report-a-bug.yml">Report a bug</a>
</p>

<p dir="rtl">ادعُ من تحب، وخذ جزءاً واحداً في كل مرة، وعندما تكتمل الأجزاء الثلاثون نختم معاً وتبدأ الختمة التالية.</p>

Families and friends run group khatmas today in WhatsApp groups: someone posts a numbered list of the 30 ajza', people
reply with their names, and one person ends up chasing everyone. Wirdak replaces that list with a khatma that runs
itself. Invite the people you love, take one juz' at a time, and when all 30 are done the group completes the khatma
together and the next round begins.

Wirdak is in Arabic, right to left. It's a fast, mobile-first website that installs as an app,
with no app store and no password.

## Contents

- [How it works](#how-it-works) · [Features](#features) · [Tech stack](#tech-stack) · [Repository layout](#repository-layout)
- [Quick start](#quick-start) · [Development](#development) · [Testing](#testing) · [Deploy and releases](#deploy-and-releases)
- [Sessions](#sessions) · [Contributing, conduct and security](#contributing-conduct-and-security) · [Licence and credits](#licence-and-credits)

## How it works

1. **Start a khatma.** Give it a name or a date and a repeating schedule. You verify your phone number by sending a
   ready-made WhatsApp message, so there's no password.
2. **Invite people.** Share the link. It opens the website instantly, and anyone with it can see the khatma.
3. **Take a juz'.** Each person holds one juz' at a time and is offered ones they haven't read recently.
4. **Finish it, or hand it back.** Mark it done, undo a mistake, or release it for someone else. A juz' that runs past
   its time gets a grace period, then opens for others to help.
5. **Complete it together.** When all 30 are done, everyone sees the celebration with the khatm dua, and the next round
   starts on its schedule.

## Features

- **The whole pool at a glance:** which ajza' are open, being read (and by whom), and done.
- **Gentle nudges:** reminders through Web Push and in-app notes, plus WhatsApp share buttons and opt-in WhatsApp
  notifications.
- **Organizer controls** and link previews that show the khatma's name when the invite is shared.
- **Several khatmas per person,** with a bottom bar and quick switching between them on mobile.
- **Help from inside the app:** a help button that sends a request, with the context attached, to the admin inbox.
- **An admin app** with a dashboard, stats, milestones, a help inbox, an audit log, and live settings (announcement
  banner, maintenance mode, minimum client version) that reach every open screen within seconds.

## Tech stack

| Part                     | What it uses                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Website (`apps/web`)     | React 19, React Router, Vite, Tailwind CSS 4, a service worker for push and install  |
| Admin app (`apps/admin`) | React 19, Vite, Tailwind CSS 4                                                       |
| Backend (`convex/`)      | [Convex](https://convex.dev) queries, mutations, scheduled jobs, and HTTP actions    |
| Messaging                | WhatsApp Business (verification, templates, notifications), Web Push with VAPID keys |
| Hosting                  | Vercel for both apps, Convex cloud (EU West, Ireland) for the backend                |
| Tooling                  | Bun workspaces, TypeScript, ESLint, Prettier, Vitest, Playwright, release-please     |

## Repository layout

```text
apps/web/     the website at wirdak.app
apps/admin/   the admin app at admin.wirdak.app
convex/       the backend: schema, functions, scheduled jobs, WhatsApp and push
e2e/          Playwright smoke tests
scripts/      image rendering for the icons and link preview
docs/         deploy guide, design specs, and implementation plans
```

## Quick start

Requirements: Node 22+ (`.nvmrc`) and Bun 1.4+ ([bun.sh](https://bun.sh)). Bun installs packages and runs the
scripts; the tools themselves (Vite, Vitest, Convex) run on Node.

```sh
git clone https://github.com/alilibx/wirdak && cd wirdak
bun install
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
CONVEX_AGENT_MODE=anonymous bun run dev   # local Convex backend + website + admin app
```

Then open `http://localhost:5173`. No Convex account or cloud project is needed.

## Development

```sh
bun run typecheck
bun run lint
bun run test
bun run e2e
```

- `bun run dev` runs `convex dev` against a local anonymous backend (`http://127.0.0.1:3210`), the website on
  `http://localhost:5173`, and the admin app on `http://localhost:5174`. On first run Convex writes the deployment
  settings to `.env.local`, which is git-ignored.
- Mark the local backend as dev once with `bun run convex env set WIRDAK_ENV dev`. A backend set up before the rename
  has the old `SILSILA_ENV`, which no longer counts; remove it with `bun run convex env remove SILSILA_ENV`.
- In dev (`WIRDAK_ENV=dev`), simulate an incoming WhatsApp message with
  `bun run convex run dev:simulateIncoming '{"from":"971500000001","text":"<the ready-made message>"}'`.
- `bun run convex run dev:forceGraceEnd '{"inviteCode":"<code>","juz":5}'` ends the grace period of that juz' right
  now, as the scheduled job would, so you can see it open for help without waiting. It refuses unless `WIRDAK_ENV` is
  `dev`.
- Real pushes need the VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; see
  [docs/deploy.md](docs/deploy.md)). Without them the dev backend logs `push skipped (no VAPID)`, and the in-app notes
  still appear.
- Regenerate the app icons and the link preview image with `bun run tsx scripts/render-images.ts`, and the README
  logo with `bun run tsx scripts/render-logo.ts <ArefRuqaa-Bold.ttf> <ReadexPro.ttf>` (needs HarfBuzz's `hb-view`).

Design specs and implementation plans live in [`docs/superpowers/`](docs/superpowers/).

## Testing

- **Unit and integration tests** run with Vitest: `convex/**` in the `edge-runtime` environment (required by
  `convex-test`), and `apps/web/**` in `jsdom`.
- **End to end:** `bun run e2e` runs the Playwright suite against a local backend and a production build of the
  website (`vite build`, then `vite preview`), which it starts and stops itself, with no cloud project and no real
  WhatsApp. It plays two people through verifying, creating a khatma, taking, finishing, and joining by invite, and
  covers a grace period ending and a release from the organizer's side. Every spec runs on nine projects: two iPhones,
  two Android phones, an iPad, desktop Chrome, Firefox and Safari, and `slow-android`, a cheap Android phone on a slow
  mobile network that also checks the first load against a time budget. `bun run e2e --project=iphone-se` runs one
  project. Stop `bun run dev` first (the ports must be free), and run
  `bun run playwright install chromium webkit firefox` once. State lives in `.convex/local`, shared with
  `bun run dev`. The `E2E` workflow runs the same suite on every pull request.
- **Real phones:** Playwright's WebKit is close to Safari but not the same. Safe-area insets, the on-screen keyboard,
  and the collapsing toolbar only show on a real iPhone or in the iOS Simulator, and WhatsApp's in-app browser and
  Samsung Internet only on a real phone. Check those by hand before a release.

## Deploy and releases

| Environment | Website                | Admin                        | Ships from              |
| ----------- | ---------------------- | ---------------------------- | ----------------------- |
| Staging     | https://stg.wirdak.app | https://stg-admin.wirdak.app | every push to `main`    |
| Production  | https://wirdak.app     | https://admin.wirdak.app     | release tags (`vX.Y.Z`) |

GitHub Actions does every deploy. `ci.yml` runs install, typecheck, lint, test, and the web build on Node 22 for every
pull request. On `main`, `main.yml` runs the same checks, deploys to staging, and lets release-please cut versioned
releases that deploy to production. The cloud Convex project is `manzilo:wirdak` (EU West, Ireland), with the
deployments `staging` and `production`.

[docs/deploy.md](docs/deploy.md) covers environment variables, WhatsApp, Web Push keys, the Vercel projects, rollbacks,
and data retention. [CHANGELOG.md](CHANGELOG.md) and the [releases](https://github.com/alilibx/wirdak/releases) list what
shipped in each version.

## Sessions

After WhatsApp verification the backend issues a random session token, and the website keeps it in `localStorage` (key
`wirdak.session`), falling back to memory when storage is blocked. An HttpOnly cookie is impractical because the website
(Vercel) and the backend (Convex) are on different domains. Only the token's SHA-256 hash is stored on the server, and
every device can be signed out from the settings page or, when the admin setting leaves it on, from the WhatsApp
sign-in alert.

## Contributing, conduct and security

- **Want to change something?** Read [CONTRIBUTING.md](CONTRIBUTING.md) first. The
  [PR template](.github/pull_request_template.md) lists the checks every change needs.
- **Found a bug?** [Report it](https://github.com/alilibx/wirdak/issues/new?template=report-a-bug.yml).
  **Have an idea?** [Suggest it](https://github.com/alilibx/wirdak/issues/new?template=suggest-an-idea.yml).
- Everyone here follows the [code of conduct](CODE_OF_CONDUCT.md). Report security issues privately, as
  [SECURITY.md](SECURITY.md) describes.

[![Contributors](https://contrib.rocks/image?repo=alilibx/wirdak)](https://github.com/alilibx/wirdak/graphs/contributors)

## Licence and credits

- **Code:** no licence has been chosen yet, so the code is all rights reserved. You can read it and open issues and
  pull requests, but not reuse it elsewhere.
- **Quran text:** the celebration duas (Quran 2:127 and 2:201) are copied verbatim from the Tanzil Quran Text
  (Uthmani, Version 1.1) of the [Tanzil Project](https://tanzil.net), used under its licence, which asks for the source
  and a link.
- **Fonts:** [Readex Pro](https://fonts.google.com/specimen/Readex+Pro),
  [Aref Ruqaa](https://fonts.google.com/specimen/Aref+Ruqaa), and
  [Amiri Quran](https://fonts.google.com/specimen/Amiri+Quran), all under the SIL Open Font License. The logo outlines
  Aref Ruqaa and Readex Pro.
