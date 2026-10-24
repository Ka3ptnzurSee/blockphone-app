// Generiert lib/filters.generated.ts aus assets/filters/*/filter.{js,css}
// + youtube/premium-background-playback.js — als exportierte String-Konstanten.
// Lauf mit: node scripts/generate-filters.mjs
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "assets", "filters");
const OUT = join(ROOT, "lib", "filters.generated.ts");

const PLATFORMS = ["youtube", "instagram", "facebook", "x", "reddit"];

function read(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

const parts = [];
parts.push("// AUTOGENERIERT — nicht von Hand editieren. `node scripts/generate-filters.mjs`");
parts.push("// Quellen: assets/filters/ (aus Dull-App extrahiert, uBlock-Stil Feed-Filter).");
parts.push("");

// Nur vorhandene Plattformen einbinden — fehlende Dateien werden übersprungen,
// statt eine filters.generated.ts mit undefinierten Konstanten zu erzeugen.
const generated = {}; // platform -> { key, js, css, bg }
for (const p of PLATFORMS) {
  const dir = join(SRC, p);
  let js = null;
  let css = null;
  let bg = null;
  try {
    if (statSync(dir).isDirectory()) {
      js = read(join(dir, "filter.js"));
      css = read(join(dir, "filter.css"));
      if (p === "youtube") bg = read(join(dir, "premium-background-playback.js"));
    }
  } catch {
    /* Verzeichnis fehlt → Plattform überspringen */
  }
  if (js == null && css == null && bg == null) continue;

  const key = p.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  generated[p] = { key, js: js != null, css: css != null, bg: bg != null };
  if (js != null) parts.push(`export const ${key}_FILTER_JS = ${JSON.stringify(js)};\n`);
  if (css != null) parts.push(`export const ${key}_FILTER_CSS = ${JSON.stringify(css)};\n`);
  if (bg != null) parts.push(`export const YOUTUBE_BG_PLAYBACK_JS = ${JSON.stringify(bg)};\n`);
}

// Komfort-Zugriff: { platform: { js, css } }
parts.push("export type PlatformFilter = { js: string; css: string; bg?: string };");
parts.push("export const PLATFORM_FILTERS: Record<string, PlatformFilter> = {");
for (const [p, g] of Object.entries(generated)) {
  const jsRef = g.js ? `${g.key}_FILTER_JS` : '""';
  const cssRef = g.css ? `${g.key}_FILTER_CSS` : '""';
  const bgRef = g.bg ? ", bg: YOUTUBE_BG_PLAYBACK_JS" : "";
  parts.push(`  ${JSON.stringify(p)}: { js: ${jsRef}, css: ${cssRef}${bgRef} },`);
}
parts.push("};");
parts.push("");

writeFileSync(OUT, parts.join("\n"), "utf8");
console.log("OK ->", OUT, `(${parts.length} Zeilen)`);
