# Runbook

## Configuration and secrets

Nothing personal or secret is committed. Every value below comes from the environment:

| Variable | Local | GitHub Actions | Vercel | Used for |
|---|---|---|---|---|
| `CONTACT_EMAIL` | `.env` (git-ignored) | repository secret | env var | bot User-Agent, the site's takedown/contact link |
| `DATABASE_URL` | `.env` | repository secret (writer role) | env var (read-only `web_readonly` role) | Postgres (from Phase 0b) |

Start locally with `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`) and fill it in. Scripts load it with Node's `--env-file-if-exists=.env`. Code reads the address only through `contactEmail()` / `userAgent()` in `packages/core/src/config.ts`, which refuse to run if it is missing or still the `@example.com` placeholder, so no request goes out without a contact address.

The GitHub issue templates contain no address on purpose: GitHub serves them as static files, so they cannot read an environment variable. They point to the site's Takedown page, which is built from `CONTACT_EMAIL`.

## How to change the contact email

1. Local: edit `CONTACT_EMAIL` in `.env`.
2. GitHub Actions: `gh secret set CONTACT_EMAIL --repo <github-owner>/openings-india` and paste the new address when asked (or repository Settings → Secrets and variables → Actions).
3. Vercel (from Phase 1): Project → Settings → Environment Variables → edit `CONTACT_EMAIL` for Production and Preview, then redeploy so the takedown page is rebuilt.
4. Check: `pnpm verify:sources` prints nothing about a missing address, and the site's Takedown page shows the new address after the redeploy.
5. Before committing anything, confirm the old and new addresses appear in no tracked file: `git grep -n -i "<part of the address>"` should print nothing.

## Verifying sources

`pnpm verify:sources` calls every provider for several real companies, rewrites the fixtures in `packages/adapters/test/fixtures/` and the log in `artifacts/verify/results.json`. Update `docs/verified-sources.md` from the log when field names change.

## Keep-alive for scheduled workflows

GitHub disables scheduled workflows in public repositories after 60 days without repository activity. See the plan in `docs/verified-sources.md`. Fallback: once a month, make any small human commit (for example, update a date in this file) and check the Actions tab for disabled workflows; re-enable with `gh workflow enable <file>`.

## Notes to carry forward

- AI on AWS: AWS promotional credits probably do NOT cover Anthropic models on Amazon Bedrock (billed through AWS Marketplace; not verified). Amazon's own models might be covered. Do not build on either until verified. `classifier/ai.ts` stays disabled.
- Vercel Hobby is non-commercial only. Ads, payments or paid features require moving to Pro first.
