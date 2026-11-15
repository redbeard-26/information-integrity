// Refreshes data/raw/navigator.jsonl from the live Information Integrity Navigator.
// The directory renders in the browser, so this script drives headless Chromium.
//
// One-time setup:  npm install --no-save playwright && npx playwright install chromium
// Then:            npm run data:scrape && npm run data:build
//
// The script reads only public pages, waits between records, and writes one JSON
// object per record in the schema documented in docs/DATA.md.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = "https://www.mitzinavigator.com/information-integrity/";
const OUTPUT = path.resolve(process.argv[2] ?? "data/raw/navigator.jsonl");
const DELAY_MS = 400;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm install --no-save playwright && npx playwright install chromium");
  process.exit(1);
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function isoDate(text) {
  const match = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec((text ?? "").trim());
  if (!match) return text ?? null;
  const month = MONTHS[match[2].toLowerCase()];
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "networkidle" });

// Load the whole list.
for (;;) {
  const more = page.getByRole("button", { name: /^Show \d+ more records/ });
  if ((await more.count()) === 0) break;
  await more.first().click();
  await page.waitForTimeout(150);
}
const ids = await page.$$eval('a[href^="#/record/"]', (links) => [
  ...new Set(links.map((link) => link.getAttribute("href").replace("#/record/", ""))),
]);
console.log(`Found ${ids.length} record ids`);

const lines = [];
for (const id of ids) {
  await page.goto(`${BASE}#/record/${id}`);
  await page.waitForSelector("main h1");
  const raw = await page.evaluate(() => {
    const main = document.querySelector("main");
    const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim() || null;
    const sections = {};
    for (const heading of main.querySelectorAll("h2")) {
      const section = heading.parentElement;
      const paragraph = section.querySelector("p");
      const chips = [...section.querySelectorAll(":scope > div > *, :scope > div > span")]
        .filter((el) => el.children.length === 0)
        .map(text)
        .filter(Boolean);
      const links = [...section.querySelectorAll("a[href^='http']")].map((a) => a.href);
      sections[text(heading)] = { paragraph: text(paragraph), chips, links };
    }
    const terms = {};
    for (const dt of main.querySelectorAll("dt")) terms[text(dt)] = text(dt.nextElementSibling);
    const h1 = main.querySelector("h1");
    const header = h1.parentElement;
    const headerBits = [...header.querySelectorAll("div > *")].map(text).filter(Boolean);
    const hq = headerBits.find((bit) => bit.startsWith("Headquarters:"));
    return {
      name: text(h1),
      type: text(header.firstElementChild),
      region: headerBits[0] ?? null,
      hq: hq ? hq.replace("Headquarters:", "").trim() : null,
      duplicate: /duplicate/i.test(header.textContent ?? ""),
      sections,
      terms,
      website: [...main.querySelectorAll("a")].find((a) => /Visit website/.test(a.textContent ?? ""))?.href ?? null,
      verification: (() => {
        const label = [...main.querySelectorAll("*")].find((el) => el.textContent?.trim() === "SOURCE VERIFICATION STATUS");
        return text(label?.nextElementSibling);
      })(),
    };
  });

  const section = (name) => raw.sections[name] ?? { paragraph: null, chips: [], links: [] };
  const row = /row\s+(\d+)/.exec(raw.terms["Source workbook"] ?? "");
  lines.push(
    JSON.stringify({
      id,
      name: raw.name,
      organization_type: raw.type,
      operating_status: raw.terms["Operating status in source"] ?? null,
      geographic_focus: raw.terms["Geographic focus"] ?? raw.region,
      headquarters_country: raw.terms["Headquarters country"] ?? raw.hq,
      mission: section("Mission").paragraph,
      why_included: section("Why included").paragraph,
      focus_areas: section("Information integrity focus").chips,
      methods: section("Methods & activities").chips,
      threat_actors: section("Threat actors / sources studied").chips,
      countries_of_focus: raw.terms["Countries of focus"] ?? null,
      languages: raw.terms["Languages"] ?? null,
      funders: section("Funders reported in source").paragraph,
      website: raw.website,
      source_links: section("Sources & provenance").links,
      verification_status: raw.verification,
      last_verified: isoDate(raw.terms["Last verified, as entered in source"]),
      source_workbook_row: row ? Number(row[1]) : null,
      duplicate_name: raw.duplicate,
      extra: {},
    }),
  );
  await page.waitForTimeout(DELAY_MS);
}

await browser.close();
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${lines.join("\n")}\n`);
console.log(`Wrote ${lines.length} records to ${path.relative(process.cwd(), OUTPUT)}`);
