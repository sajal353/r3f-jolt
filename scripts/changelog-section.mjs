import { readFileSync } from "node:fs";

const version = process.argv[2] ?? JSON.parse(readFileSync("package.json", "utf8")).version;

const lines = readFileSync("CHANGELOG.md", "utf8").split("\n");
const heading = new RegExp(`^##\\s+v?${version.replace(/\./g, "\\.")}(\\s|$)`);

const start = lines.findIndex((line) => heading.test(line));

if (start === -1) {
  process.stderr.write(
    `CHANGELOG.md has no "## ${version}" section. Add one before releasing.\n`,
  );
  process.exit(1);
}

const rest = lines.slice(start + 1);
const end = rest.findIndex((line) => line.startsWith("## "));

const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();

if (body === "") {
  process.stderr.write(`The "## ${version}" section in CHANGELOG.md is empty.\n`);
  process.exit(1);
}

process.stdout.write(`${body}\n`);
