<!--
Sync Impact Report
Version change: 0.0.0 → 1.0.0
Modified principles:
- N/A → Test-Driven & Green-to-Commit
- N/A → Minimalist Implementation
Added sections:
- State & Artifact Discipline
- Delivery Workflow
Removed sections:
- Principle III placeholder
- Principle IV placeholder
- Principle V placeholder
Templates requiring updates:
- ✅ .specify/templates/plan-template.md
- ✅ .specify/templates/tasks-template.md
Follow-up TODOs: None
-->
# Seloger Favorites Toolkit Constitution

## Core Principles

### Test-Driven & Green-to-Commit

- MUST author failing automated tests before writing production code for any change.
- MUST block merges until the full local test suite and continuous integration both pass.
- MUST treat flaky or intermittently failing tests as hard failures and stabilize them before merge approval.
Rationale: A disciplined red-green-refactor loop keeps the Playwright automation reliable and protects the
  data export flows from regressions.

### Minimalist Implementation

- MUST deliver the smallest slice of functionality that satisfies the current specification.
- MUST avoid adding dependencies without explicit justification tied to an active requirement.
- MUST delete dead code, unused scripts, and obsolete configuration as soon as they lose purpose.
Rationale: The toolkit stays maintainable when every module earns its keep and the code surface remains
  small.

## State & Artifact Discipline

- Session state, scraped outputs, and other runtime artifacts MUST remain in `local/` or other gitignored
  paths; repository history MAY NOT include sensitive or transient data.
- Developers MUST document any new generated artifact paths alongside `.gitignore` updates before merging.
- Secrets, tokens, and third-party credentials MUST NOT leave the developer's machine; reference examples
  belong in `.env.example` only.

## Delivery Workflow

- Pull requests MUST demonstrate the failing test first, then the passing implementation commit(s), unless
  a single commit preserves a clear red-green narrative.
- Behavior changes MUST update or add tests that capture the new contract within the same pull request.
- Code review MUST confirm that newly added code paths have direct test coverage and that complexity is
  justified under the Minimalist Implementation principle.

## Governance

- Amendments require consensus from active maintainers via pull request referencing the proposed version
  and rationale; merges without consensus are invalid.
- Versioning follows semantic rules: MAJOR for principle or governance reversals, MINOR for new principles
  or sections, PATCH for clarifications.
- Compliance reviews occur at least once per quarter to audit adherence to the principles, with findings
  documented in the repository.

**Version**: 1.0.0 | **Ratified**: 2025-10-22 | **Last Amended**: 2025-10-22
