// Phase 0a: call each candidate ATS endpoint for real companies, record the
// verified response shape, and save sanitized fixtures. Run from the repo root:
//   pnpm verify:sources
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { userAgent } from "@openings/core";

const ROOT = join(import.meta.dirname, "../../..");
const FIXTURES = join(ROOT, "packages/adapters/test/fixtures");
const ARTIFACTS = join(ROOT, "artifacts/verify");
const DELAY_MS = 1500;
const SAMPLE_JOBS = 3;

type Probe = {
  provider: string;
  token: string;
  label: string;
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  /** Where the job array lives in the response. */
  jobs: (data: any) => unknown[] | undefined;
  /** Keep this probe's sample as a fixture. */
  fixture?: boolean;
};

const gh = (token: string, query = ""): Probe => ({
  provider: "greenhouse",
  token,
  label: query ? `jobs${query}` : "jobs",
  url: `https://boards-api.greenhouse.io/v1/boards/${token}/jobs${query}`,
  jobs: (d) => d?.jobs,
  fixture: true,
});
const lever = (token: string, query = "?mode=json"): Probe => ({
  provider: "lever",
  token,
  label: `postings${query}`,
  url: `https://api.lever.co/v0/postings/${token}${query}`,
  jobs: (d) => (Array.isArray(d) ? d : undefined),
  fixture: query === "?mode=json",
});
const ashby = (token: string): Probe => ({
  provider: "ashby",
  token,
  label: "job-board",
  url: `https://api.ashbyhq.com/posting-api/job-board/${token}`,
  jobs: (d) => d?.jobs,
  fixture: true,
});
const workday = (tenant: string, wd: number, site: string, limit = 20): Probe => ({
  provider: "workday",
  token: `${tenant}.wd${wd}/${site}`,
  label: `jobs limit=${limit}`,
  url: `https://${tenant}.wd${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`,
  method: "POST",
  body: { appliedFacets: {}, limit, offset: 0, searchText: "" },
  jobs: (d) => d?.jobPostings,
  fixture: limit === 20,
});
const smart = (token: string): Probe => ({
  provider: "smartrecruiters",
  token,
  label: "postings",
  url: `https://api.smartrecruiters.com/v1/companies/${token}/postings?limit=10`,
  jobs: (d) => d?.content,
  fixture: true,
});

// Candidate tokens are guesses from memory; the run decides which are real.
const PROBES: Probe[] = [
  ...["stripe", "airbnb", "figma", "databricks", "cloudflare", "postman"].map((t) => gh(t)),
  { ...gh("stripe", "?content=true"), fixture: false },
  ...["palantir", "spotify", "plaid", "atlassian", "cred"].map((t) => lever(t)),
  { ...lever("palantir", "?mode=json&limit=2&skip=0") },
  { ...lever("palantir", "?mode=json&limit=2&skip=2") },
  ...["openai", "ramp", "linear", "notion", "deel"].map(ashby),
  workday("nvidia", 5, "NVIDIAExternalCareerSite"),
  workday("salesforce", 12, "External_Career_Site"),
  workday("intel", 1, "External"),
  workday("adobe", 5, "external_experienced"),
  { ...workday("nvidia", 5, "NVIDIAExternalCareerSite", 21) },
  ...["Visa", "BoschGroup", "ServiceNow", "Ubisoft2"].map(smart),
  // Tokens that cannot exist: how does each provider answer an unknown company?
  { ...gh("zz-openings-nonexistent-test"), fixture: false },
  { ...lever("zz-openings-nonexistent-test"), fixture: false },
  { ...ashby("zz-openings-nonexistent-test"), fixture: false },
  { ...workday("zz-openings-nonexistent-test", 5, "External"), fixture: false },
  { ...smart("zz-openings-nonexistent-test"), fixture: false },
];

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Phone-like runs inside free text only: 10-13 digits with at least one separator.
const PHONE_CANDIDATE = /(?<![\w/-])\+?\d[\d\s().-]{8,}\d(?![\w/-])/g;
/** Keys never kept in fixtures: people's names and contact details. */
const DROP_KEYS = /^(creator|hiringManager|recruiter|contact|email|phone)$/i;
/** Free-text fields where contact details could appear. */
const TEXT_KEYS = /(description|content|opening|additional|lists|text|plain|html|body)/i;

function redactText(text: string): string {
  return text.replace(EMAIL, "[email removed]").replace(PHONE_CANDIDATE, (m) => {
    const digits = m.replace(/\D/g, "").length;
    return digits >= 10 && digits <= 13 && /[\s().-]/.test(m) ? "[phone removed]" : m;
  });
}

function sanitize(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    const clean = TEXT_KEYS.test(key) ? redactText(value) : value.replace(EMAIL, "[email removed]");
    return clean.length > 300 ? `${clean.slice(0, 300)}…[truncated ${clean.length - 300} chars]` : clean;
  }
  if (Array.isArray(value)) return value.map((v) => sanitize(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !DROP_KEYS.test(k))
        .map(([k, v]) => [k, sanitize(v, k)]),
    );
  }
  return value;
}

/** Field name -> set of JSON types seen, one level of nesting for objects. */
function shape(items: unknown[]): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  const add = (key: string, v: unknown) => {
    const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    (out[key] ??= new Set()).add(t);
  };
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    for (const [k, v] of Object.entries(item)) {
      add(k, v);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v)) add(`${k}.${k2}`, v2);
      }
    }
  }
  return Object.fromEntries(Object.entries(out).sort().map(([k, s]) => [k, [...s].sort()]));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(probe: Probe) {
  const started = new Date().toISOString();
  try {
    const res = await fetch(probe.url, {
      method: probe.method ?? "GET",
      headers: {
        "User-Agent": userAgent(),
        Accept: "application/json",
        ...(probe.body ? { "Content-Type": "application/json" } : {}),
      },
      body: probe.body ? JSON.stringify(probe.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined;
    }
    const jobs = data === undefined ? undefined : probe.jobs(data);
    const topLevel = data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [];
    const result = {
      ...probe,
      jobs: undefined,
      fetchedAt: started,
      status: res.status,
      contentType: res.headers.get("content-type"),
      rateLimitHeaders: Object.fromEntries(
        [...res.headers].filter(([k]) => /rate|retry-after/i.test(k)),
      ),
      topLevelKeys: topLevel,
      jobCount: jobs?.length ?? null,
      jobFields: jobs ? shape(jobs) : null,
      ids: jobs?.slice(0, SAMPLE_JOBS).map((j: any) => j?.id ?? j?.externalPath ?? null),
      bodyPreview: data === undefined ? text.slice(0, 200) : undefined,
    };
    if (probe.fixture && res.ok && jobs) {
      const sample = Array.isArray(data)
        ? jobs.slice(0, SAMPLE_JOBS)
        : { ...data, [Object.keys(data).find((k) => data[k] === jobs)!]: jobs.slice(0, SAMPLE_JOBS) };
      const file = join(FIXTURES, probe.provider, `${probe.token.replace(/[^\w.-]/g, "_")}.json`);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify(
          { source: { url: probe.url, method: probe.method ?? "GET", fetchedAt: started, status: res.status, totalJobs: jobs.length }, sample: sanitize(sample) },
          null,
          2,
        ) + "\n",
      );
    }
    return result;
  } catch (err) {
    return { ...probe, jobs: undefined, fetchedAt: started, status: null, error: String(err) };
  }
}

const results = [];
for (const probe of PROBES) {
  const r = await run(probe);
  results.push(r);
  console.log(`${r.provider.padEnd(16)} ${r.token.padEnd(40)} ${r.label.padEnd(30)} ${r.status ?? "ERR"} jobs=${"jobCount" in r ? r.jobCount : "-"}`);
  await sleep(DELAY_MS);
}
// Workday list items carry only a relative "postedOn"; check what the detail endpoint adds.
const nvidia = results.find((r) => r.provider === "workday" && r.token.startsWith("nvidia") && r.status === 200);
const firstPath = nvidia && "ids" in nvidia ? nvidia.ids?.[0] : undefined;
if (typeof firstPath === "string") {
  const detail = await run({
    provider: "workday",
    token: "nvidia.wd5/NVIDIAExternalCareerSite",
    label: "job detail",
    url: `https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite${firstPath}`,
    jobs: (d) => (d?.jobPostingInfo ? [d.jobPostingInfo] : undefined),
  });
  results.push(detail);
  console.log(`workday detail ${detail.status}`);
}
await mkdir(ARTIFACTS, { recursive: true });
await writeFile(join(ARTIFACTS, "results.json"), JSON.stringify(results, null, 2) + "\n");
console.log(`\nWrote ${join(ARTIFACTS, "results.json")}`);
