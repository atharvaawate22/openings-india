# openings-india

A free, no-sign-in, no-ads index of jobs for Indian engineering freshers, taken only from official employer sources (company careers pages and the ATS feeds behind them).

Status: Phase 0a (source verification and company list). See `docs/architecture.md` for the design and `docs/verified-sources.md` for what has been verified.

## Setup (Windows/PowerShell or any shell)

1. Node 24+ and pnpm (`npm i -g pnpm`).
2. `pnpm install`
3. `Copy-Item .env.example .env` and set `CONTACT_EMAIL` (see `docs/runbook.md`).
4. `pnpm verify:sources`
