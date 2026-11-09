const fs = require("fs");
const path = "/opt/apps/internetblocker/App.tsx";
const repl = [{"old":"import ScreenTimeLockIn from \"./components/ScreenTimeLockIn\";","new":"import ScreenTimeLockIn from \"./components/ScreenTimeLockIn\";\nimport Paywall from \"./components/Paywall\";"},{"old":"  const [mehrSub, setMehrSub] = useState<\"commitment\" | \"schedule\" | \"guides\">(\"commitment\");","new":"  const [mehrSub, setMehrSub] = useState<\"commitment\" | \"schedule\" | \"guides\" | \"lifetime\">(\"commitment\");"},{"old":"                [\"guides\", \"GUIDES\"],","new":"                [\"guides\", \"GUIDES\"],\n                [\"lifetime\", \"LIFETIME\"],"},{"old":"          ) : mehrSub === \"schedule\" ? (\n            <ScheduleSettings />\n          ) : (\n            <View style={styles.guidesWrap}>\n              <HandoffGuide />\n              <ScreenTimeLockIn />\n            </View>\n          )}","new":"          ) : mehrSub === \"schedule\" ? (\n            <ScheduleSettings />\n          ) : mehrSub === \"lifetime\" ? (\n            <Paywall />\n          ) : (\n            <View style={styles.guidesWrap}>\n              <HandoffGuide />\n              <ScreenTimeLockIn />\n            </View>\n          )}"}];
let src = fs.readFileSync(path, "utf8");
let applied = 0;
for (const r of repl) {
  if (src.indexOf(r.old) === -1) {
    console.error("NOT FOUND: " + r.old.slice(0, 60).replace(/\n/g, " "));
    continue;
  }
  src = src.replace(r.old, r.new);
  applied++;
}
fs.writeFileSync(path, src);
console.log("OK: " + applied + " replacements");

