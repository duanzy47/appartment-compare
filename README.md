# Seloger Favorites Toolkit

TypeScript + Playwright scripts to capture a Seloger session once and export favorites with structured data, while keeping local secrets out of version control.

## Prerequisites
- Node.js 18+
- npm
- Install Playwright runtime and browser binaries:
  ```bash
  npm install playwright
  npx playwright install chromium
  ```

Optional: copy `.env.example` to `.env` and set `USER_AGENT` if Seloger blocks the default identifier.

## Usage

### 1. Capture login state (manual sign-in)
```bash
npx tsx login-once.ts
```
- Opens a headed Chromium window at `https://www.seloger.com/`
- You have 60 seconds to authenticate manually
- On success stores the session at `./local/state-seloger.json` and prints `STATE_SAVED: ./local/state-seloger.json`

### 2. Scrape favorite listings
```bash
npx tsx scrape-favorites.ts "https://www.seloger.com/mes-recherches/favoris"
```
- Loads every provided favorites URL, performs infinite scroll (1–2s debounce) and deduplicates listing links
- Visits listings with at most 3 concurrent pages, capturing the requested data fields
- Persists results to `./local/output.json` and `./local/output.csv`; errors go to `./local/errors.log`

### Custom output path
```bash
npx tsx scrape-favorites.ts <url> --out ./local/favs.json
```
Also accepts `--delay-min` and `--delay-max` (milliseconds) to tune random delays between requests.

## Safety guards
- `.gitignore` shields `local/`, `.env`, and generated artifacts
- `.husky`/hook: pre-commit blocks any change that tries to commit `local/`, `state-seloger.json`, `output.*`, or `errors.log`

## Development notes
- Scripts auto-detect the repository root (via `.git`) so they always write into `<repoRoot>/local/`, even when launched from subdirectories
- Outputs default to UTF-8 JSON/CSV with headers matching the requested schema
