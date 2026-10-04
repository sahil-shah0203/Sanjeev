import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Print paths and rule names only. Never echo matched credentials.
const paths = execFileSync(
  "git",
  [
    "-c",
    `safe.directory=${process.cwd().replaceAll("\\", "/")}`,
    "ls-files",
    "-z",
  ],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const findings = [];
for (const path of paths) {
  if (
    /(^|\/)\.env(?!\.example$)|\.(apkg|recall)$|(^|\/)supabase\/\.temp\//.test(
      path,
    )
  )
    findings.push(`${path}: private file`);
  const content = readFileSync(path).toString("utf8");
  if (
    /sb_secret_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}/.test(content)
  )
    findings.push(`${path}: service credential`);
  if (
    /postgres(?:ql)?:\/\/[^\s:]+:(?!password@|YOUR_PASSWORD@|replace_me@)[^\s@]{6,}@/i.test(
      content,
    )
  )
    findings.push(`${path}: database credential`);
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else console.log(`Secret guard passed (${paths.length} tracked files).`);
