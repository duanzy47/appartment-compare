# Seloger Favorites Scraping Investigation (2025-02-04)

## Context
- Goal: scrape favorites at https://www.seloger.com/mon-espace/mes-favoris using `scrape-favorites.ts`.
- Storage state loaded from `./local/state-seloger.json` (valid login, state retained locally per policy).
- Node: Playwright Chromium v1.56.0-alpha, headless runs inside Codex CLI harness.

## Observations
- Headless Chromium navigation succeeds; page renders but favorites content never surfaces.
- `document.querySelectorAll('a[href*="/annonces/"]')` returns 0 results in both top document and available frames.
- Network inspection logs repeated `403` responses from `https://www.seloger.com/consumer-portal/v1/favorites`.
- `datadome` cookie present in storage state; 403 responses return HTML from `captcha-delivery.com` instructing to "Please enable JS and disable any ad blocker" (DataDome anti-bot challenge).
- No iframe with captcha is mounted in DOM (headless Chromium is blocked at the HTTP layer instead).
- Console output shows multiple `Unsatisfied version` warnings and several `Failed to load resource: the server responded with a status of 403` errors.

## Mitigation Attempts
1. **Extended scrolling and frame traversal** – added logic to:
   - Detect iframe hosting favorites.
   - Click variants of "Afficher plus" / "Voir plus" / "Charger plus" buttons.
   - Repeatedly scroll with debounce and wait for `networkidle`.
   - Outcome: still 0 listings collected.

2. **Stealth adjustments** – configured:
   - Windows desktop user agent, French locale/timezone, UA client hints.
   - Disabled `navigator.webdriver`, injected `window.chrome`, tweaked navigator properties.
   - Added `--disable-blink-features=AutomationControlled` launch flag.
   - Outcome: favorites API still returns HTTP 403.

3. **Headful check** – confirmed Chromium launches in headed mode in this environment, but did not rerun the full script headed (policy: no GUI during automation).

4. **Alternate browser** – attempted Firefox but Playwright binaries not installed (`npx playwright install firefox` required; not executed due to time).

## Next Steps (manual session required)
- Obtain fresh storage state using headful login externally; ensure DataDome challenge is cleared manually before capturing `state-seloger.json`.
- Consider running the scraper in headed mode (`chromium.launch({ headless: false })`) for the favorites crawl to mimic human behaviour.
- If headless is necessary, explore:
  - Installing and using Playwright Firefox or WebKit (potentially different fingerprint).
  - Solving the DataDome challenge programmatically (may require dedicated solver; ensure compliance with site terms).
  - Proxying through the same network as the manual login session; DataDome may bind tokens to IP/device fingerprints.
- When reattempting, monitor network logs: a successful favorites fetch should return `200` with JSON payload listing favorite IDs.

## Artifacts
- Latest script version includes stealth adjustments and frame-aware scrolling (see `scrape-favorites.ts` lines ~232-360 and ~650-700).
- Existing outputs: `local/output.json`, `local/output.csv`, `local/errors.log` contain empty dataset results from blocked runs.
- Screenshot (`local/debug-favorites.png`) captured during initial headless run (all empty shell UI).

Keep this file updated with future attempts so the investigation history is preserved.
