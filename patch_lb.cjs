const fs = require("fs");
const path = "/opt/apps/internetblocker/lib/leaderboard.ts";
let src = fs.readFileSync(path, "utf8");
const old = `  if (typeof r.userId !== "string" || typeof r.name !== "string") return null;`;
const neu = `  if (typeof r.userId !== "string" || typeof r.name !== "string") return null;
  if (r.userId.length === 0 || r.name.trim().length === 0) return null;`;
if (src.indexOf(old) === -1) { console.error("NOT FOUND"); process.exit(1); }
src = src.replace(old, neu);
fs.writeFileSync(path, src);
console.log("OK");

