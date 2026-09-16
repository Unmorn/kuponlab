import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? jsFiles(path) : entry.name.endsWith(".js") ? [path] : [];
  });
}

const files = ["worker.js", ...jsFiles("api"), ...jsFiles("lib"), "public/kuponlab-nesine.user.js"];
for (const file of files) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });

for (const file of ["public/index.html", "public/nesine-bridge.html"]) {
  const html = readFileSync(file, "utf8");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  scripts.forEach((source, index) => new vm.Script(source, { filename: `${file}#inline-${index + 1}` }));
}

console.log(`Syntax OK: ${files.length} JavaScript files and 2 HTML entry points.`);

