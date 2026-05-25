/**
 * Lighthouse runner — Phase B5 sign-off.
 *
 * Usage:
 *   npm run lighthouse                      # default: mobile against coach.tamasdemeter.com
 *   npm run lighthouse -- --url=https://... # different target
 *   npm run lighthouse -- --desktop         # desktop emulation
 *
 * Outputs HTML + JSON reports to docs/lighthouse/ with ISO-stamped filenames.
 * Prints score summary + Core Web Vitals to stdout.
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs() {
  const args = process.argv.slice(2);
  const url =
    args.find((a) => a.startsWith("--url="))?.slice(6) ??
    "https://coach.tamasdemeter.com";
  const desktop = args.includes("--desktop");
  return { url, desktop };
}

async function main() {
  const { url, desktop } = parseArgs();
  const formFactor = desktop ? "desktop" : "mobile";

  console.log(`[lighthouse] launching headless Chrome…`);
  const chrome = await chromeLauncher.launch({
    chromeFlags: ["--headless=new", "--no-sandbox"],
  });

  try {
    console.log(`[lighthouse] auditing ${url} (${formFactor})…`);
    const result = await lighthouse(url, {
      port: chrome.port,
      output: ["html", "json"],
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      formFactor,
      screenEmulation:
        formFactor === "desktop"
          ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }
          : { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
    });

    if (!result) throw new Error("lighthouse returned no result");

    const lhr = result.lhr;
    const outDir = path.join(ROOT, "docs/lighthouse");
    await fs.mkdir(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const baseName = `${stamp}-${formFactor}`;
    await fs.writeFile(path.join(outDir, `${baseName}.html`), result.report[0]);
    await fs.writeFile(path.join(outDir, `${baseName}.json`), result.report[1]);

    const cats = lhr.categories;
    const audits = lhr.audits;
    const fmt = (s) => (s == null ? "—" : `${Math.round(s * 100)}/100`);

    console.log("");
    console.log(`=== Category scores (${formFactor}) ===`);
    for (const [k, v] of Object.entries(cats)) console.log(`  ${k.padEnd(20)} ${fmt(v.score)}`);
    console.log("");
    console.log("=== Core Web Vitals ===");
    for (const m of [
      "largest-contentful-paint",
      "cumulative-layout-shift",
      "total-blocking-time",
      "first-contentful-paint",
      "speed-index",
      "interactive",
    ]) {
      const a = audits[m];
      if (a) console.log(`  ${m.padEnd(30)} ${a.displayValue ?? "—"}  (score: ${fmt(a.score)})`);
    }
    console.log("");
    console.log(`[lighthouse] reports written to docs/lighthouse/${baseName}.{html,json}`);
  } finally {
    await chrome.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
