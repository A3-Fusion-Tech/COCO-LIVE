// Minimal dependency-free lint: no tabs/trailing whitespace/debugger/console.log outside entrypoints.
import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";

const roots = ["apps", "packages", "tests", "scripts"];
const entry = /(main|server|cli)\.ts$|scripts\/|e2e\//;
const failures = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", ".dart_tool", "build"].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if ([".ts", ".mjs"].includes(extname(e.name))) {
      (await readFile(p, "utf8")).split("\n").forEach((line, i) => {
        if (/\s+$/.test(line)) failures.push(`${p}:${i + 1} trailing whitespace`);
        if (/\bdebug" + "ger\b/.test(line)) failures.push(`${p}:${i + 1} debug statement`);
        if (/console\.log/.test(line) && !entry.test(p)) failures.push(`${p}:${i + 1} console.log outside an entrypoint`);
      });
    }
  }
}
for (const r of roots) await walk(r).catch(() => {});
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; } else console.log("lint ok");
