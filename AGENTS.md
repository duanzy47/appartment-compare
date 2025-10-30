# appartement-compare Development Guidelines

Auto-generated from all feature plans. Last updated: 2025-10-29

## Active Technologies

- TypeScript (Node.js 22.x runtime via `tsx`) + Playwright (Chromium focus), local CLI scripts (`login-once.ts`, `scrape-favorites.ts`) (001-audit-seloger-scraper)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript (Node.js 22.x runtime via `tsx`): Follow standard conventions

## Recent Changes

- 001-audit-seloger-scraper: Added TypeScript (Node.js 22.x runtime via `tsx`) + Playwright (Chromium focus), local CLI scripts (`login-once.ts`, `scrape-favorites.ts`)

<!-- MANUAL ADDITIONS START -->
## Spec-Driven Development (Speckit)

- Always use a spec-first workflow for any change ("U codes" included). Do not implement code changes unless the feature spec and plan exist and are aligned.
- Branch naming: `###-feature-name` (e.g., `001-headed-captcha-controls`) and keep artifacts under `specs/###-feature-name/`.
- Primary docs to maintain per feature: `spec.md`, `plan.md`, `checklists/requirements.md`; keep `research.md`, `data-model.md`, `quickstart.md` current when applicable.

### Speckit commands/scripts
- Initialize or select feature:
  - `SPECIFY_FEATURE=001-headed-captcha-controls` (optional) to target a feature without switching branches.
  - `.specify/scripts/bash/create-new-feature.sh` to scaffold a new `specs/###-...` directory.
- Plan scaffolding:
  - `.specify/scripts/bash/setup-plan.sh` to generate or refresh `plan.md` for the current feature branch.
- Validation during implementation:
  - `.specify/scripts/bash/check-prerequisites.sh --json` to verify required docs exist; add `--require-tasks --include-tasks` if tasks are used.

### Implementation policy
- Code changes MUST reference an active feature spec and follow `plan.md` steps.
- Update the checklist (`specs/###/checklists/requirements.md`) when acceptance/criteria evolve.
- Keep outputs and state under `local/` (gitignored) as documented in `README.md`.
- Before handoff: run `npm test && npm run lint` and sync plan notes if scope changed.

### Context7 MCP for Speckit docs
- Use Context7 MCP to fetch Spec Kit documentation when needed.
- Library: `/github/spec-kit` (via Context7). Example topics: `plan`, `tasks`, `workflow`.
- If unavailable, install/enable the Context7 MCP in your environment; this project assumes it is present for doc access.
<!-- MANUAL ADDITIONS END -->
