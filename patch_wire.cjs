const fs = require("fs");

// --- App.tsx ---
const app = "/opt/apps/internetblocker/App.tsx";
let src = fs.readFileSync(app, "utf8");
const repls = [
  {
    old: 'import Paywall from "./components/Paywall";',
    new: 'import Paywall from "./components/Paywall";\nimport Leaderboard from "./components/Leaderboard";',
  },
  {
    old: 'useState<"commitment" | "schedule" | "guides" | "lifetime">("commitment");',
    new: 'useState<"commitment" | "schedule" | "guides" | "lifetime" | "friends">("commitment");',
  },
  {
    old: [
      '                ["commitment", "COMMITMENT"],',
      '                ["schedule", "ZEITFENSTER"],',
      '                ["guides", "GUIDES"],',
      '                ["lifetime", "LIFETIME"],',
    ].join("\n"),
    new: [
      '                ["commitment", "COMMIT"],',
      '                ["schedule", "ZEIT"],',
      '                ["guides", "GUIDES"],',
      '                ["lifetime", "LIFE"],',
      '                ["friends", "FRIENDS"],',
    ].join("\n"),
  },
  {
    old: [
      '          ) : mehrSub === "lifetime" ? (',
      '            <Paywall />',
      '          ) : (',
    ].join("\n"),
    new: [
      '          ) : mehrSub === "lifetime" ? (',
      '            <Paywall />',
      '          ) : mehrSub === "friends" ? (',
      '            <Leaderboard />',
      '          ) : (',
    ].join("\n"),
  },
];
let ok = 0;
for (const r of repls) {
  if (src.indexOf(r.old) === -1) { console.error("APP NOT FOUND: " + r.old.slice(0, 50).replace(/\n/g, " ")); continue; }
  src = src.replace(r.old, r.new);
  ok++;
}
fs.writeFileSync(app, src);
console.log("App.tsx: " + ok + "/" + repls.length);

// --- tsconfig.json ---
const tcPath = "/opt/apps/internetblocker/tsconfig.json";
const tc = JSON.parse(fs.readFileSync(tcPath, "utf8"));
if (!tc.exclude.includes("convex")) { tc.exclude.push("convex"); fs.writeFileSync(tcPath, JSON.stringify(tc, null, 2) + "\n"); console.log("tsconfig: convex excluded"); }
else console.log("tsconfig: already excluded");

// --- package.json ---
const pjPath = "/opt/apps/internetblocker/package.json";
const pj = JSON.parse(fs.readFileSync(pjPath, "utf8"));
if (!pj.scripts.test.includes("leaderboard.test.ts")) {
  pj.scripts.test += " lib/leaderboard.test.ts";
  fs.writeFileSync(pjPath, JSON.stringify(pj, null, 2) + "\n");
  console.log("package.json: test updated");
} else console.log("package.json: already present");

