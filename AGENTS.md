# AGENTS.md

dublagame: a self-hosted Bun web app that turns a YouTube video into a karaoke dubbing game. It downloads the video and
subtitles with `yt-dlp`, splits the lines by character, records each player in the browser, scores the takes and mixes
the final MP4 with `ffmpeg`. User-facing text is pt-BR.

## Stack

- Bun (`bun:sqlite` for the database), TypeScript with `"type": "module"`; the frontend is plain HTML/JS in `public/`
- External binaries on `PATH`: `yt-dlp` (download) and `ffmpeg` (mix and cut)
- Optional LLM labelling through an OpenAI-compatible gateway (`OPENAI_*`)
- Docker image `oven/bun:1.2-debian`, runs as the `app` user (UID 10001), `HEALTHCHECK` on `/healthz`

## Commands

```sh
bun install                    # lockfile: bun.lock (Docker uses --frozen-lockfile)
cp .env.example .env           # PowerShell: Copy-Item .env.example .env
bun run dev                    # http://localhost:3000 with reload
bun run start                  # same server without watch
bun test                       # unit tests: subtitle parsers, cast detection, YouTube ids (no network)
node test/smoke.mjs http://localhost:3000   # E2E: real match with a fake mic; needs a running server, Node, Playwright/Chromium and network
docker build -t dublagame .
```

## Structure

- `src/index.ts`: HTTP server and routes (`/healthz`, the API in the README)
- `src/config.ts`: every environment variable, with its default, read from `process.env`
- `src/pipeline.ts`: ingest (`yt-dlp` metadata, video, subtitles)
- `src/subs.ts`: subtitle parsing (`json3` and VTT/SRT), speech segmentation
- `src/characters.ts`: cast detection (speaker prefixes, optional LLM, heuristic)
- `src/render.ts`: builds the `ffmpeg -filter_complex` for the final MP4
- `src/db.ts`: SQLite schema and queries
- `public/`: `home.js`, `play.html`, `game.js` (karaoke, recording, scoring), `app.css`
- `test/`: unit tests (`*.test.ts`) and `smoke.mjs`
- `docs/readme/`: README images (the banner is a mockup with fictitious data)

## Conventions

- User-facing text is pt-BR: UI, API error messages and README. Code and identifiers are English.
- The README documents configuration, routes and the scoring formula; update it with any change to them.
- Configuration goes through `src/config.ts`. Add a variable there and in `.env.example` (name and comment only).
- Keep parsers and scoring pure and unit-tested; the network and `ffmpeg` calls stay in `pipeline.ts` and `render.ts`.
- Owner rules (kept from the previous file):
  - **Size limit:** max 150 lines per file.
  - **Clean logic:** separation of concerns across all layers.
  - **Validation:** every change requires successful tests and linting.
  - **Security:** sensitive data must be excluded from context.
  - **Process:** follow the Plan -> Act -> Validate cycle for every task.
- Personas for the work (kept from the previous file):
  - **Jules-Architect (System Architect):** core architecture and orchestration; scalability, process integrity, high-level design.
  - **Spark-Frontend (UI/UX Expert):** visual identity and interactions; aesthetics, responsiveness, accessibility.
  - **Bolt-Automation (DevOps):** CI/CD, scripts and automation; build pipelines, testing, deployment.

## Gotchas

- Secrets: `OPENAI_API_KEY` and `YTDLP_COOKIES` (YouTube cookies for the bot check) are credentials. Never print, log, commit or
  put them in fixtures. `.env` is gitignored.
- The microphone (`getUserMedia`) works only on `localhost` or HTTPS.
- The Dockerfile downloads the latest `yt-dlp` release at build time, so the image is not reproducible on its own.
- Data lives under `DATA_DIR` (`/data` in Docker): SQLite, videos, takes and renders. Back it up before changing the schema.
- The smoke test needs a real YouTube URL and network access; it cannot run in CI as a unit test.
- `MAX_DURATION_SEC` caps accepted video length (default 900 s).


<!-- base-actions-main-policy -->
## GitHub Actions — padrão obrigatório (@main)

- Referencie as actions internas sempre pelo branch, nunca por SHA:
  - `uses: juninmd/base-actions/<action>@main`
  - `uses: juninmd/base-actions/.github/workflows/<arquivo>.yml@main`
- Não fixe `@<sha>` em `juninmd/base-actions`: a atualização é centralizada no
  `main` e passa a valer no próximo run.
- PRs cujos checks não iniciam por billing/spending limit são mesclados pelo bot central
  `juninmd/base-actions/.github/workflows/auto-merge-billing-blocked.yml`.
  Para impedir o merge automático de um PR, aplique a label `do-not-merge`.