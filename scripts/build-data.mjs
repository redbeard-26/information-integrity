// Builds src/data/organizations.json from collected JSONL record files.
// Usage: node scripts/build-data.mjs [inputDir=data/raw] [--collected-at YYYY-MM-DD]
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const COLLECTION_ONLY_KEYS = ["duplicate_other_record_outside_global_slice"];

const args = process.argv.slice(2);
const flag = args.indexOf("--collected-at");
const collectedAt = flag >= 0 ? args[flag + 1] : new Date().toISOString().slice(0, 10);
const inputDir = path.resolve(args.find((arg, i) => !arg.startsWith("--") && i !== flag + 1) ?? "data/raw");
const outputPath = path.resolve("src/data/organizations.json");

const STRING_FIELDS = [
  "organization_type",
  "operating_status",
  "geographic_focus",
  "headquarters_country",
  "mission",
  "why_included",
  "countries_of_focus",
  "languages",
  "funders",
  "website",
  "verification_status",
  "last_verified",
];
const LIST_FIELDS = ["focus_areas", "methods", "threat_actors", "source_links"];
const MISSING = /^not provided in source$/i;

function clean(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && !MISSING.test(trimmed) ? trimmed : null;
}

function normalizeName(name) {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function toRecord(raw, where) {
  const id = clean(raw.id)?.toUpperCase();
  const name = clean(raw.name);
  if (!id || !/^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(id)) throw new Error(`${where}: bad id ${raw.id}`);
  if (!name) throw new Error(`${where}: missing name for ${id}`);
  const record = { id, name };
  for (const field of STRING_FIELDS) record[field] = clean(raw[field]);
  for (const field of LIST_FIELDS) {
    record[field] = Array.isArray(raw[field]) ? [...new Set(raw[field].map(clean).filter(Boolean))] : [];
  }
  for (const url of [record.website, ...record.source_links].filter(Boolean)) {
    if (!/^https?:\/\//i.test(url)) throw new Error(`${where}: ${id} has a non-http link ${url}`);
  }
  if (record.last_verified && !/^\d{4}-\d{2}-\d{2}$/.test(record.last_verified)) {
    throw new Error(`${where}: ${id} last_verified must be YYYY-MM-DD, got ${record.last_verified}`);
  }
  record.source_workbook_row = Number.isInteger(raw.source_workbook_row) ? raw.source_workbook_row : null;
  record.duplicate_name = raw.duplicate_name === true;
  record.extra = raw.extra && typeof raw.extra === "object" && !Array.isArray(raw.extra) ? { ...raw.extra } : {};
  // Collection bookkeeping, not source data.
  for (const key of COLLECTION_ONLY_KEYS) delete record.extra[key];
  return record;
}

const files = (await readdir(inputDir)).filter((file) => file.endsWith(".jsonl")).sort();
if (files.length === 0) throw new Error(`No .jsonl files in ${inputDir}`);

const byId = new Map();
for (const file of files) {
  const lines = (await readFile(path.join(inputDir, file), "utf8")).split("\n");
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const where = `${file}:${index + 1}`;
    const record = toRecord(JSON.parse(line), where);
    const existing = byId.get(record.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
      // The same record can appear under more than one region filter; keep the fuller copy.
      const size = (r) => JSON.stringify(r).length;
      if (size(record) > size(existing)) byId.set(record.id, record);
      console.warn(`${where}: ${record.id} seen twice with different content; kept the fuller copy`);
    } else {
      byId.set(record.id, record);
    }
  });
}

const records = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
const groups = new Map();
for (const record of records) {
  const key = normalizeName(record.name);
  groups.set(key, (groups.get(key) ?? 0) + 1);
}
for (const record of records) {
  if (groups.get(normalizeName(record.name)) > 1) record.duplicate_name = true;
}

const dataset = {
  source: {
    name: "Information Integrity Navigator",
    url: "https://www.mitzinavigator.com/information-integrity/",
    publisher: "Mitzi Perdue's Navigators",
    workbook: "Navigator Export.xlsx",
    collected_at: collectedAt,
    notes: [
      "Every record is marked 'Internet Research Only' in the source.",
      "Descriptions, classifications, funding statements and operating statuses are source claims.",
      "Ten organization names appear twice in the source with differing details; both records are kept.",
    ],
  },
  counts: {
    records: records.length,
    distinct_names: groups.size,
    duplicate_name_groups: [...groups.values()].filter((count) => count > 1).length,
  },
  records,
};

await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(
  `Wrote ${records.length} records (${dataset.counts.distinct_names} names, ${dataset.counts.duplicate_name_groups} duplicate groups) to ${path.relative(process.cwd(), outputPath)}`,
);
