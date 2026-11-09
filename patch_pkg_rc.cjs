const fs = require("fs");
const path = "/opt/apps/internetblocker/package.json";
const pkg = JSON.parse(fs.readFileSync(path, "utf8"));
const old = pkg.scripts.test;
const suffix = " lib/revenuecat.test.ts";
if (old.includes("revenuecat.test.ts")) {
  console.log("already present");
} else {
  pkg.scripts.test = old + suffix;
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  console.log("updated");
}
console.log(pkg.scripts.test);

