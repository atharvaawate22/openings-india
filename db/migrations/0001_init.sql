-- 0001_init: schema from the project plan (see docs/architecture.md). Applied from Phase 0b (needs DATABASE_URL).

CREATE TABLE companies (
  id                 bigserial PRIMARY KEY,
  name               text NOT NULL,
  slug               text NOT NULL UNIQUE,
  domain             text,
  website            text,
  category           text NOT NULL CHECK (category IN (
                       'mass_recruiter','it_services','faang_big_tech','big4_consulting','product_mnc',
                       'semiconductor_electronics','indian_unicorn','startup','bank_fintech',
                       'core_engineering','psu','other')),
  needs_review       boolean NOT NULL DEFAULT true,
  careers_url        text,
  ats_type           text,
  ats_token          text,
  -- Company identity of the ATS token (docs/architecture.md, "Company identity rule").
  -- Only 'verified' tokens are ever polled or shown.
  token_status       text CHECK (token_status IN ('verified','needs_review','rejected')),
  token_evidence     jsonb,
  token_verified_at  timestamptz,
  token_verified_by  text CHECK (token_verified_by IN ('page_link','second_signal','manual')),
  coverage_status    text NOT NULL DEFAULT 'pending' CHECK (coverage_status IN (
                       'pending','pending_review','automated_api','automated_best_effort',
                       'automated_page','manual_curated','unsupported')),
  unsupported_reason text,
  discovery_evidence jsonb,
  discovered_at      timestamptz,
  priority_tier      smallint NOT NULL DEFAULT 2,
  active             boolean NOT NULL DEFAULT true,
  last_discovered_at timestamptz,
  CHECK (coverage_status <> 'unsupported' OR unsupported_reason IS NOT NULL),
  -- A feed-based coverage status requires a verified token.
  CHECK (coverage_status NOT IN ('automated_api','automated_best_effort') OR token_status = 'verified'),
  CHECK (token_status <> 'verified' OR (token_verified_at IS NOT NULL AND token_verified_by IS NOT NULL))
);
-- Dedupe by normalized domain (name dedupe uses slug).
CREATE UNIQUE INDEX companies_domain_key ON companies (lower(domain)) WHERE domain IS NOT NULL;

CREATE TABLE blocked_companies (
  id           bigserial PRIMARY KEY,
  company_id   bigint REFERENCES companies(id),
  domain       text,
  reason       text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  CHECK (company_id IS NOT NULL OR domain IS NOT NULL)
);

CREATE TABLE sources_health (
  company_id           bigint PRIMARY KEY REFERENCES companies(id),
  last_attempt_at      timestamptz,
  last_success_at      timestamptz,
  last_status          text,
  last_error           text,
  jobs_found           integer,
  consecutive_failures integer NOT NULL DEFAULT 0
);

CREATE TABLE jobs (
  id                  bigserial PRIMARY KEY,
  company_id          bigint NOT NULL REFERENCES companies(id),
  external_id         text NOT NULL,
  title               text NOT NULL,
  excerpt             text CHECK (char_length(excerpt) <= 1500),
  description_hash    text,
  locations           text[] NOT NULL DEFAULT '{}',
  is_india            boolean NOT NULL DEFAULT false,
  remote_type         text,
  employment_type     text NOT NULL DEFAULT 'unknown'
                        CHECK (employment_type IN ('full_time','internship','contract','unknown')),
  department_raw      text,
  role_category       text,
  experience_min      numeric(4,1),
  experience_max      numeric(4,1),
  experience_source   text NOT NULL DEFAULT 'unknown'
                        CHECK (experience_source IN ('stated','inferred','unknown')),
  fresher_label       text NOT NULL DEFAULT 'unclear'
                        CHECK (fresher_label IN ('fresher','early_career','internship','unclear','experienced')),
  label_rule          text,
  label_evidence      jsonb,
  quality_score       real,
  flags               text[] NOT NULL DEFAULT '{}',
  posted_at           timestamptz,
  posted_at_source    text NOT NULL DEFAULT 'unknown' CHECK (posted_at_source IN ('employer','unknown')),
  is_baseline         boolean NOT NULL DEFAULT false,
  eligible_grad_years integer[] NOT NULL DEFAULT '{}',
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz,
  apply_url           text NOT NULL,
  source_url          text NOT NULL,
  source_type         text NOT NULL,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  UNIQUE (company_id, external_id)
);
CREATE INDEX jobs_feed_idx ON jobs (status, is_india, fresher_label, first_seen_at DESC);
CREATE INDEX jobs_grad_years_idx ON jobs USING gin (eligible_grad_years);

-- Phase 4; created now so the schema matches the project plan.
CREATE TABLE opportunities (
  id               bigserial PRIMARY KEY,
  type             text NOT NULL CHECK (type IN ('drive','contest','program')),
  organizer        text NOT NULL,
  eligibility      text,
  graduation_years integer[] NOT NULL DEFAULT '{}',
  deadline_at      timestamptz,
  event_at         timestamptz,
  official_url     text NOT NULL,
  verified_at      timestamptz,
  verified_by      text,
  status           text NOT NULL DEFAULT 'active'
);

CREATE TABLE poll_runs (
  id               bigserial PRIMARY KEY,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  companies_polled integer NOT NULL DEFAULT 0,
  jobs_seen        integer NOT NULL DEFAULT 0,
  jobs_new         integer NOT NULL DEFAULT 0,
  jobs_closed      integer NOT NULL DEFAULT 0,
  errors           jsonb NOT NULL DEFAULT '[]'
);

-- Read-only role for the web app (see docs/architecture.md). Password is set outside the repo.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_readonly') THEN
    CREATE ROLE web_readonly NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO web_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO web_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO web_readonly;
