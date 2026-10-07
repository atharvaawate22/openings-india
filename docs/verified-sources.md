# Verified sources

Evidence from live calls made on **8 Oct 2026** by `pnpm verify:sources` (`packages/discovery/src/verify-sources.ts`), sequentially with 1.5 s between requests and a User-Agent built from `CONTACT_EMAIL`. Sanitized samples (max 3 jobs, long text truncated, contact details and recruiter fields removed) are saved under `packages/adapters/test/fixtures/<provider>/`. The full run log is written to `artifacts/verify/results.json` (git-ignored). Code only against the fields listed here; re-run the script before relying on anything older than a few weeks.

## Summary

| Provider | Endpoint | Auth | Verified with (jobs returned) | Unknown token | Status for us |
|---|---|---|---|---|---|
| Greenhouse | `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs` | none | stripe (721), airbnb (161), figma (154), databricks (892), cloudflare (426) | 404 | `automated_api` |
| Lever | `GET https://api.lever.co/v0/postings/{token}?mode=json` | none | palantir (314), spotify (76), cred (8) | 404 | `automated_api` |
| Ashby | `GET https://api.ashbyhq.com/posting-api/job-board/{token}` | none | openai (817), ramp (160), linear (31), notion (133); deel exists with 0 jobs | 404 | `automated_api` |
| Workday | `POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` | none | nvidia.wd5/NVIDIAExternalCareerSite, salesforce.wd12/External_Career_Site, intel.wd1/External, adobe.wd5/external_experienced (20 per page each) | 422 | `automated_best_effort` |
| SmartRecruiters | `GET https://api.smartrecruiters.com/v1/companies/{id}/postings` | none for this call | BoschGroup (4,890 total), ServiceNow, Ubisoft2 (10 per page each) | **200 with 0 jobs** | `automated_best_effort` (see below) |

Corrections to the project plan's starting hypotheses are marked **Correction**.

## Greenhouse

- List (`/jobs`), top level: `jobs`, `meta` (`meta.total`).
- Job fields seen: `id` (number), `internal_job_id`, `title`, `company_name`, `absolute_url`, `location.name`, `first_published` (ISO 8601 with offset), `updated_at`, `requisition_id`, `metadata` (null in all samples), `application_deadline` (present, null in all samples), `language`, `education`, `data_compliance[]`.
- `?content=true` (checked on stripe) adds `content` (HTML-escaped description), `departments[]`, `offices[]`, plus `ai_disclaimer`, `include_ai_disclaimer`, `ai_opt_out_request_url`. The docs confirm: "include the full post description, department, and office of each job post".
- `company_name` is present on every job, so token verification can compare it to the expected company name.
- Dates: use `first_published` as `posted_at`. Never `updated_at`.
- Docs (docs.greenhouse.io/job-board.html): "authentication is not required for any GET endpoints". No rate limits or terms stated. No rate-limit headers in responses.
- **Correction:** Postman returns 404 here, as expected; the token must be discovered per company.

## Lever

- Response is a bare array. Job fields seen: `id` (UUID), `text` (title), `categories.{commitment, department, location, team, allLocations[]}`, `createdAt` (epoch milliseconds), `hostedUrl`, `applyUrl`, `country` (ISO code, e.g. `IN`), `workplaceType` (e.g. `onsite`), `description`, `descriptionPlain`, `descriptionBody`, `descriptionBodyPlain`, `opening`, `openingPlain`, `additional`, `additionalPlain`, `lists[]`.
- `country` and `workplaceType` exist (they had been flagged as the field names most likely to be wrong; they are right).
- Paging: `limit=2&skip=0` and `limit=2&skip=2` returned different, consecutive IDs. Without `limit`, all postings are returned at once (palantir: 314).
- **No company name field.** Token verification must rely on discovery evidence (the company's own careers page linking to `jobs.lever.co/{token}`), not on the response.
- Docs (github.com/lever/postings-api): no auth described for GET; the only stated rate limit is for application POSTs (2/s). Stated purpose: "designed to help you create a job site". No separate API terms.
- **Correction:** plaid and atlassian return 404 on Lever (they use another system or token).

## Ashby

- Top level: `jobs`, `apiVersion` ("1"). Job fields seen: `id`, `title`, `department`, `team`, `employmentType` (e.g. `FullTime`), `location`, `secondaryLocations[]`, `address.postalAddress`, `publishedAt` (ISO 8601), `isListed`, `isRemote` (boolean or null), `workplaceType` (string or null), `jobUrl`, `applyUrl`, `descriptionHtml`, `descriptionPlain`.
- Skip jobs where `isListed` is false (docs: such jobs "should only be available via direct link").
- **No company name field.** Same verification approach as Lever. A real board with no openings returns 200 and `jobs: []` (deel), an unknown board returns 404, so "200 + empty" is still a valid board.
- Docs: optional `includeCompensation=true`; no auth, rate limits or terms stated.

## Workday (best effort)

- List: POST JSON `{ "appliedFacets": {}, "limit": 20, "offset": 0, "searchText": "" }`. Top level: `total`, `jobPostings`, `facets`, `userAuthenticated`.
- List item fields: `title`, `externalPath`, `locationsText` (can be a summary like "4 Locations"), `postedOn` (**relative text**, e.g. "Posted Today"), `bulletFields[]` (requisition ID).
- `limit: 21` returns **400**, so 20 is the maximum page size (confirmed).
- Detail: `GET .../wday/cxs/{tenant}/{site}{externalPath}` returns `jobPostingInfo` with `startDate` (date), `timeType`, `location`, `additionalLocations[]`, `country`, `jobReqId`, `jobDescription`, `externalUrl`, `posted`, `canApply`. Use `startDate` from the detail call as the employer date; the list's `postedOn` is not a date.
- **`total` is capped at 2000 (verified 8 Oct 2026, NVIDIA, `packages/discovery/src/workday-cap-check.ts`):**
  - Page 0 reports `total: 2000`, but single-valued facets (`timeType`, `workerSubType`, `jobFamilyGroup`) each sum to **2,672**, so the real count is higher.
  - Paging at offsets 1960, 1980, 2000, 2020 and 2040 returned 60 distinct jobs out of 100: the pages at 2000 and beyond repeat earlier jobs, so **jobs past position 2000 cannot be reached by paging**.
  - `total` is only reliable on page 0: offsets 1960 and 1980 reported `total: 0`.
  - Facets nest: `locationMainGroup` contains `locationHierarchy2` (location type), `locationHierarchy1` (countries) and `locations` (sites). Filtering with `appliedFacets: { "locationHierarchy1": ["<India id>"] }` returned `total: 247`, matching the facet's own count of 247, so an India-filtered query is complete and well under the cap. Using the parent name (`locationMainGroup`) returns 400.
  - `searchText: "India"` returned 280, a different and looser set (text match), so it is not used for coverage.
  - Facet IDs differ per tenant and must be read from that tenant's `facets`. How capped totals are handled: `docs/architecture.md`, "Workday totals and capped searches".
- Undocumented and unauthenticated. No public terms for this endpoint. Treat as `automated_best_effort` with health checks.

## SmartRecruiters (best effort, needs care)

- **Correction:** the project plan assumed a public unauthenticated posting API could not be confirmed. The list call works without auth: `GET https://api.smartrecruiters.com/v1/companies/{id}/postings` returns `offset`, `limit`, `totalFound`, `content[]`.
- Job fields seen: `id`, `uuid`, `name` (title), `refNumber`, `releasedDate` (ISO 8601), `company.{identifier, name}`, `location.{city, region, country, fullLocation, remote, hybrid, ...}`, `typeOfEmployment.{id,label}`, `experienceLevel.{id,label}`, `function`, `industry`, `department`, `customField[]`, and `creator.name` (a recruiter's name: **never stored**; dropped from fixtures).
- **An unknown company returns 200 with `totalFound: 0`**, exactly like a real company with no openings (`Visa` looked like this). An empty response proves nothing; only accept a token when at least one posting's `company.identifier` matches and `company.name` matches the expected company.
- Docs describe the "Public Posting API" with API-key or OAuth auth and do not say which calls work without credentials. Because the unauthenticated behaviour is undocumented, classify as `automated_best_effort`.

## Company identity per provider

The full rule is in `docs/architecture.md`, "Company identity rule". Only `verified` tokens are polled or shown. What each provider can contribute:

| Provider | Company name in response? | Unknown token | What can verify a token |
|---|---|---|---|
| Greenhouse | yes, `company_name` on every job | 404 | Link on the company's own careers page (plus `company_name` match when jobs exist); or, if probe-found, `company_name` match **and** a content signal from postings |
| Lever | no | 404 | Link on the company's own careers page; or, if probe-found, a content signal (apply/hosted URLs or descriptions naming the company or its domain) |
| Ashby | no | 404 (a real empty board returns 200 with `jobs: []`) | Same as Lever |
| Workday | no (tenant is a host name only) | 422 | Same as Lever; the page link must match tenant, `wd` number and site |
| SmartRecruiters | yes, `company.identifier` and `company.name` per posting | **200 with 0 postings** (same as a real empty board) | Link on the company's careers page **and** at least one posting with matching `company.identifier`/`company.name`; probe-found needs the name match **and** a content signal. Zero postings: always `needs_review` |

A token found only by probing slug guesses stays `needs_review` (coverage status `pending_review`): stored with its evidence, not polled, not shown, until a second signal or my manual approval confirms it.

## Resolved and open unknowns

| Question | Finding | Status |
|---|---|---|
| Greenhouse auth / limits / terms | Docs: no auth for GET. No rate limits or terms stated; no rate-limit headers seen. | Auth verified; terms to review (legal-notes.md) |
| Lever auth / limits / terms | No auth for GET; only application POSTs are limited (2/s). Purpose: building job sites. | Auth verified; terms to review |
| Ashby auth / limits / terms | No auth; nothing on limits or terms. | Auth verified; terms to review |
| Workday | Undocumented internal endpoint, no terms. | Best effort; terms to review |
| SmartRecruiters | List works without auth; docs ambiguous. | Best effort; terms to review |
| Rate limits | No provider returned rate-limit headers during 34 sequential calls. Keep per-host concurrency ≤5 and back off on 429/5xx. | No documented limits found |
| GitHub 60-day rule | Docs: "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days." "Repository activity" is not defined, so whether a workflow-made commit counts is **not stated**. Re-enabling works with `gh workflow enable` or the REST API. | Plan below; still to verify |
| Which companies use which system | Answered by Phase 0b discovery. | Phase 0b |

### Keep-alive plan (to verify in Phase 1)

A scheduled `keepalive.yml` would be disabled at the same moment as the others, so it cannot rescue itself after day 60. Plan: (1) the keep-alive runs weekly and, while it still runs, re-enables every scheduled workflow through the REST API (`PUT /repos/{owner}/{repo}/actions/workflows/{id}/enable`, needs `actions: write`); (2) it reads each workflow's `state` and logs a failure if any is `disabled_inactivity`; (3) the runbook has a monthly manual-commit reminder as the fallback. Whether step (1) resets GitHub's inactivity clock is not documented, so it is treated as unverified until a repository passes 60 days without a human commit.
