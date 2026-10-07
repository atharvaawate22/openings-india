// Is Workday's `total` capped at 2000? Pages past offset 2000 and compares
// faceted totals with the unfaceted one. Polite: sequential, 2 s apart.
//   node --env-file-if-exists=.env packages/discovery/src/workday-cap-check.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { userAgent } from "@openings/core";

const ROOT = join(import.meta.dirname, "../../..");
const BASE = "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function query(label: string, body: Record<string, unknown>) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "User-Agent": userAgent(), Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: "", ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  const data: any = await res.json().catch(() => undefined);
  const row = {
    label,
    body,
    status: res.status,
    total: data?.total ?? null,
    returned: data?.jobPostings?.length ?? null,
    firstPath: data?.jobPostings?.[0]?.externalPath ?? null,
  };
  console.log(`${label.padEnd(44)} ${res.status} total=${row.total} returned=${row.returned}`);
  await sleep(2000);
  return { row, data };
}

const rows = [];
const first = await query("offset 0", {});
rows.push(first.row);

// Facets: name -> values with counts. Look for a country/location facet containing India.
const facets: any[] = first.data?.facets ?? [];
// Facets can nest (locationMainGroup -> locationHierarchy1 -> values); keep the innermost parameter name.
const flat = (f: any): any[] => (f.values ?? []).flatMap((v: any) => (v.values ? flat(v) : [{ ...v, parent: f.facetParameter }]));
const facetSummary = facets.map((f) => {
  const values = flat(f);
  return {
    facetParameter: f.facetParameter,
    descriptor: f.descriptor,
    values: values.length,
    sumCount: values.reduce((s, v) => s + (v.count ?? 0), 0),
    india: values.filter((v) => /india/i.test(v.descriptor ?? "")).map((v) => ({ id: v.id, descriptor: v.descriptor, count: v.count, parent: v.parent })),
  };
});
for (const f of facetSummary) console.log(`facet ${f.facetParameter}: ${f.values} values, sum of counts ${f.sumCount}, India values ${JSON.stringify(f.india)}`);

// Pages around the 2000 mark: are they new jobs or repeats?
const seen = new Map<string, number>();
let repeats = 0;
for (const offset of [1960, 1980, 2000, 2020, 2040]) {
  const r = await query(`offset ${offset}`, { offset });
  for (const j of r.data?.jobPostings ?? []) {
    if (seen.has(j.externalPath)) repeats++;
    seen.set(j.externalPath, offset);
  }
  rows.push(r.row);
}
console.log(`pages 1960-2040: ${seen.size} distinct jobs, ${repeats} repeats`);
rows.push({ label: "pages 1960-2040 distinct", distinct: seen.size, repeats });

const india = facetSummary.flatMap((f) => f.india.map((v: any) => ({ param: v.parent ?? f.facetParameter, ...v })));
for (const v of india.filter((x: any) => x.descriptor === "India").slice(0, 1)) {
  const r = await query(`facet ${v.param}=${v.descriptor}`, { appliedFacets: { [v.param]: [v.id] } });
  rows.push({ ...r.row, facetCount: v.count });
}
rows.push((await query(`searchText "India"`, { searchText: "India" })).row);

await mkdir(join(ROOT, "artifacts/verify"), { recursive: true });
await writeFile(join(ROOT, "artifacts/verify/workday-cap.json"), JSON.stringify({ checkedAt: new Date().toISOString(), rows, facetSummary }, null, 2) + "\n");
