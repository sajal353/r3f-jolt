import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const { name, version } = JSON.parse(readFileSync("package.json", "utf8"));
const base = version.split("-")[0];

const publishedVersions = () => {
  try {
    const raw = execFileSync("npm", ["view", name, "versions", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
};

const pattern = new RegExp(`^${base.replace(/\./g, "\\.")}-next\\.(\\d+)$`);

const highest = publishedVersions().reduce((max, entry) => {
  const match = pattern.exec(entry);
  return match ? Math.max(max, Number(match[1])) : max;
}, 0);

process.stdout.write(`${base}-next.${highest + 1}\n`);
