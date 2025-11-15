# Implementation Plan: Headed & Captcha Controls for Seloger Scraper

**Branch**: `001-headed-captcha-controls` | **Date**: 2025-10-29 | **Spec**: specs/001-headed-captcha-controls/spec.md  
**Input**: Feature specification from `/specs/001-headed-captcha-controls/spec.md`

## Summary

Add two user-facing controls to restore scraping when DataDome blocks headless runs:
- `--headed` flag to launch Chromium visibly without code edits.
- Pause-on-captcha workflow: detect 403/DataDome signals, prompt maintainer to solve the challenge in the open browser, then resume on confirmation and log the intervention (timestamps + outcome).

## Technical Context

**Language/Version**: TypeScript (Node.js 22.x via `tsx`)  
**Primary Dependencies**: Playwright (Chromium), local CLI scripts (`login-once.ts`, `scrape-favorites.ts`)  
**Storage**: Local artifacts under `./local/` (session state, JSON/CSV outputs, error logs)  
**Testing**: Manual headed run to validate pause/resume; regression run headless to ensure no regressions  
**Target Platform**: Desktop with GUI available for headed; headless CI/dev remains supported  
**Project Type**: CLI toolkit  
**Performance Goals**: No material change; headed runs likely slower but acceptable for manual unblocks  
**Constraints**: Respect site terms; avoid automated captcha solving; keep secrets local  
**Scale/Scope**: Single-user workflow; dozens to low-hundreds listings per session

## Constitution Check

No enforced project constitution gates found; proceed with standard quality gates (spec completeness, checklist). No violations identified.

## Project Structure

### Documentation (this feature)

```text
specs/001-headed-captcha-controls/
├── spec.md
├── plan.md              # This file
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
login-once.ts
scrape-favorites.ts
local/                # session state + outputs (gitignored)
playwright-mcp/
README.md, tsconfig.json
```

**Structure Decision**: Extend existing CLI scripts in repo root. No new packages or directories.

## Implementation Steps

1) CLI option wiring
- Extend argument parser in `scrape-favorites.ts` to accept `--headed`.
- Default remains headless; `--headed` sets `headless: false` at launch.
- Validate GUI availability: if `--headed` with no display, fail fast with guidance (e.g., use a GUI host or X server).

2) Captcha detection hooks
- Add network listeners on `context`/`page` for responses to:
  - 403 from `consumer-portal/v1/favorites` and related Seloger endpoints.
  - URLs containing `captcha-delivery.com` or DataDome markers.
- Debounce multiple detections to a single prompt window per active pause.

3) Pause-and-resume prompt
- On detection, print clear instructions: “Solve captcha in the browser, then press Enter to resume (or q to abort).”
- Block execution using `readline` until user input received; record start/end timestamps and duration.
- If aborted, exit gracefully with non-zero code and a short summary.

4) Retry/continue strategy
- After resume, continue current workflow; for any page that failed during pause, allow the standard retry path (navigate again if needed).
- Ensure existing infinite-scroll and link collection can proceed after human intervention.

5) Logging & audit trail
- Append a structured line to `local/errors.log` for each pause: reason, URLs involved, start/end ISO timestamps, duration, outcome (RESUMED/ABORTED).
- Echo a concise summary to stdout at end of run with total pauses and cumulative time.

6) Documentation updates
- Update `README.md` Usage section with `--headed` and pause workflow, including guidance for environments without GUI.
- Note that automation stays headless by default and that headed runs may be required to clear DataDome.

7) Validation
- Run a headed session on a GUI-capable machine, confirm prompt on 403/DataDome, solve captcha, resume to collect listings.
- Run one headless regression without `--headed` to ensure no unintended prompts or regressions.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | — | Headless-only flow cannot clear DataDome; human-in-the-loop is the minimal viable path |

