# Legal notes (to review)

Nothing here is legal advice. Get a lawyer's review before any monetization.

## Provider terms still to review

| Provider | What was found (8 Oct 2026) | To review |
|---|---|---|
| Greenhouse Job Board API | Docs say GET data is public and needs no auth. No API terms or rate limits stated. | Greenhouse general Terms of Service and any developer terms for third-party reuse of job board data. |
| Lever Postings API | README says the API "is designed to help you create a job site" and notes that postings "may be scraped by third parties". No separate terms. | Lever Terms of Service; whether aggregating many companies is within intended use. |
| Ashby Public Job Posting API | Docs describe it for a company's own careers page. No terms stated. | Ashby Terms of Service. |
| Workday (`/wday/cxs/` endpoints) | Undocumented internal endpoints, no terms. | Workday terms and each employer's careers-site terms. Highest risk source. |
| SmartRecruiters Posting API | Docs mention API-key/OAuth auth; unauthenticated listing works but is undocumented. | SmartRecruiters API terms. |
| Y Combinator directory | Not used yet. | robots.txt and terms before any bulk use. |
| Custom careers pages (Phase 3) | Not used yet. | robots.txt and terms per company before each adapter. |

## Rules applied in code

- Identify the bot with a User-Agent that includes a contact address (from `CONTACT_EMAIL`).
- No CAPTCHA, login or anti-bot bypass; stop on explicit refusals.
- Store only company, title, locations, dates, a short excerpt (≤1,500 characters) and official URLs. Recruiter names, emails and phone numbers are stripped (SmartRecruiters' `creator` field is never stored).
- Always link to the employer's apply page.
- Google `JobPosting` structured data: not in version 1; policy to verify first.
