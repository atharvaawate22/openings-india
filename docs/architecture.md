# Architecture

Public design notes for openings-india. Evidence for each external source is in `docs/verified-sources.md`.

## Components

- `packages/core`: shared types, configuration (contact address from `CONTACT_EMAIL`), normalization and classification.
- `packages/discovery`: finds each company's careers source and decides whether its ATS token really belongs to that company.
- `packages/adapters`: one adapter per source type (`fetchJobs`, `normalize`, `healthCheck`), tested against fixtures in `packages/adapters/test/fixtures/`.
- `packages/runner` (Phase 1): polls verified sources and writes to Postgres.
- `apps/web` (Phase 1-2): the public site; read-only database role, statically generated.
- `db/migrations`: SQL schema.

## Discovery

For each company:

1. **Find the careers page** on the company's own domain: a link labelled careers/jobs/join us on the home page, then `/careers`, `/jobs`, `/about/careers`, then the sitemap. robots.txt is respected. Every URL tried is recorded in `discovery_evidence`.
2. **Fingerprint the system** from links, embeds, scripts and redirects on that page: Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee, SuccessFactors, Taleo, iCIMS, Oracle recruiting, or custom.
3. **Extract the token** from what the page references (for example `boards.greenhouse.io/{token}`, `jobs.lever.co/{token}`, `jobs.ashbyhq.com/{token}`, `{tenant}.wd{N}.myworkdayjobs.com/.../{site}`, `jobs.smartrecruiters.com/{id}`). Only if the page yields nothing, **probe** slug guesses (company name variants) against the supported APIs.
4. **Apply the company identity rule** below to set `token_status`.
5. **Assign the coverage status** (below) and save `careers_url`, `ats_type`, `ats_token`, `token_*`, `discovery_evidence`, `discovered_at`.
6. Re-run weekly for `unsupported`, `pending_review` and failing companies.

## Company identity rule

Goal: never list a job under the wrong company. Lever and Ashby responses carry no company name, Workday tenants are only host names, and SmartRecruiters answers an unknown company with `200` and zero jobs, so a token that merely responds proves nothing.

A token has one of three states (`companies.token_status`). **Only `verified` tokens are ever polled or shown**; the database enforces that a feed-based coverage status requires a verified token.

### `verified`, by one of three routes (`token_verified_by`)

1. **`page_link`**: the token was found on the company's own careers page. The page must be on the company's registered domain (or reached by a redirect that starts on it), and a link, embed, script or redirect on it must contain the exact token (for Workday: tenant, `wd` number and site). The evidence stores the page URL, the matched snippet and the fetch time. Provider-specific extra checks still apply:
   - Greenhouse: if the board has jobs, `company_name` must match the company (normalized name or known brand). A mismatch makes the token `rejected`.
   - SmartRecruiters: at least one posting's `company.identifier` and `company.name` must match. A board with zero postings stays `needs_review`, because an empty response is identical for unknown companies.
2. **`second_signal`**: the token was found only by probing, and an independent second signal from the postings themselves confirms it. At least 3 sampled postings (or every posting if fewer, minimum 1) must show one of:
   - an apply or hosted URL on the company's own domain (for example Greenhouse `absolute_url` on the company site);
   - a description that names the company (normalized legal name or a known brand) or its domain.
   For Greenhouse and SmartRecruiters the provider's company-name field must also match, but a name match alone is never enough for a probe-found token, because the name field comes from the same response as the guess.
3. **`manual`**: I approve it after reviewing the evidence (approval is recorded with the date in `token_evidence`).

### `needs_review`

Found by probing without a second signal, or a page-linked SmartRecruiters board with no postings. The token is stored with its evidence, shown on `/coverage` as "found, awaiting identity check", and **not polled or shown** until it becomes `verified`.

### `rejected`

A provider name field or the postings name a different company. Kept with the evidence so the same guess is not retried.

### Batch review of `needs_review` tokens

Many companies are expected to end in `needs_review` (careers pages rendered by JavaScript so the link is not in the HTML, apply URLs on the ATS domain rather than the company's). They are reviewed in batches, not one by one in chat:

- **Export:** every discovery run writes `artifacts/discovery/token-review.csv` (also uploaded as a workflow artifact) with one row per candidate token: `company_slug`, `company_name`, `company_domain`, `provider`, `candidate_token`, `found_by` (`page_link` / `probe`), `careers_url`, `api_url`, `job_count`, `provider_company_name` (Greenhouse/SmartRecruiters, else empty), `sample_titles` (up to 3), `sample_job_urls` (up to 3, clickable), `signals_found` (for example `name_match`, `apply_on_domain`, `description_names_company`, each with a count), `snippets` (the exact matched text, at most 3, each under 120 characters), `suggested_decision` (`approve` / `reject` / `unsure`, with a one-line `suggestion_reason`), and an empty `decision` column for me (`approve` / `reject`, blank = skip) plus `note`.
- **Per-token evidence:** the full evidence (URLs fetched, fetch times, matched snippets, raw provider name, sample postings) is kept in `companies.token_evidence`, and the CSV row is enough to decide in seconds: the sample job URLs open the postings, and the snippets show why the suggestion was made.
- **Import:** `pnpm tokens:import-review <file.csv>` applies the filled-in `decision` column. `approve` sets `token_status = 'verified'`, `token_verified_by = 'manual'`, records the reviewer note and date in `token_evidence`, and moves the company to its feed-based coverage status. `reject` sets `rejected`. Blank rows are skipped. The import is a dry run by default and prints what it would change; `--apply` writes. It refuses rows whose `candidate_token` no longer matches the stored token (the token changed since export), and prints a summary of approved, rejected, skipped and refused rows.

### Re-checks

Rediscovery re-applies the rule. If a `page_link` token disappears from the careers page, or a later poll's postings name another company, the token drops to `needs_review` and polling stops until it is confirmed again (the re-baseline rule applies to any new token).

## Phase 0b report: coverage status counts

The Phase 0b report (and every later coverage report) starts with the number of companies in each coverage status, including `pending` and `pending_review`, with the total equal to the number of companies in the approved list, plus the number of tokens in each `token_status` and how many were verified by each route (`page_link`, `second_signal`, `manual`). No company may be missing from these counts.

## Coverage statuses (`companies.coverage_status`)

| Status | Meaning | Polled? |
|---|---|---|
| `pending` | Discovery not run yet | No |
| `pending_review` | ATS token found but `token_status` is `needs_review` | No |
| `automated_api` | Verified token on a documented public feed (Greenhouse, Lever, Ashby) | Yes |
| `automated_best_effort` | Verified token on an undocumented feed (Workday, SmartRecruiters) | Yes, with health checks |
| `automated_page` | Custom careers page with a per-company adapter (Phase 3) | Yes |
| `manual_curated` | Only a drive/program page, or automation forbidden; official link with a hand-updated "last verified" date | No |
| `unsupported` | Login required, robots disallow, anti-bot, or no public listing; reason recorded | No |

## Workday totals and capped searches

Workday's list endpoint reports `total` as at most 2000 and stops serving new jobs past offset 2000 (later pages repeat the last page). See `docs/verified-sources.md`. Therefore:

- Adapters always query with the tenant's India location facet (read from the response's `facets`; on NVIDIA it is `locationHierarchy1`), never the unfiltered list.
- If a query's `total` on page 0 is 2000 or more, the result is **capped**: the adapter splits it by a further facet (city/site, then job family) until every sub-query is under 2000; if it still cannot get under the cap, that fetch is marked incomplete.
- An incomplete fetch never closes jobs (same as the truncation guard).
- Only `total` from offset 0 is used; later pages can report `0`.
- The coverage report shows a capped number as "≥2000 (capped)" and never as an exact count; company-wide sizes, where shown, come from summing a single-valued facet (such as `timeType`) and are labelled "estimated from facet counts".
