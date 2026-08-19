// Weekly version-bump bot for `aurora-lsp-bundles`.
//
// For each language in `registry.mjs`, queries the upstream source for the latest
// released version and, if it differs from the pinned version, opens a PR that
// bumps just that one language's `version` in `registry.mjs`. The build CI is a
// required check on the PR, so a broken build can't merge. This mirrors the
// Homebrew-formula / mason.nvim bump model: one small, reviewed PR per bump.
//
// Run by .github/workflows/check-updates.yml (weekly) or locally with a
// GITHUB_TOKEN that can open PRs.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY } from "./registry.mjs";

const OPENAI_TOKEN = process.env.GITHUB_TOKEN;

async function latestNpm(pkg) {
  const r = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
  return (await r.json()).version;
}
async function latestGithubTag(repo) {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Authorization: `Bearer ${OPENAI_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  const tag = (await r.json()).tag_name || "";
  return tag.replace(/^v/, "");
}
async function latestGo(module) {
  const r = await fetch(`https://proxy.golang.org/${module}/@latest`);
  return (await r.json()).Version?.replace(/^v/, "");
}

async function latestFor(spec) {
  if (spec.eco === "npm") return latestNpm(spec.package);
  if (spec.eco === "github") return latestGithubTag(spec.repo);
  if (spec.eco === "go") return latestGo(spec.module);
  return null;
}

function bumpRegistry(id, version) {
  const p = join(process.cwd(), "scripts", "registry.mjs");
  let src = readFileSync(p, "utf8");
  const re = new RegExp(`(id: "${id}", version: ")[^"]+(")`);
  if (!re.test(src)) throw new Error(`could not locate ${id} in registry.mjs`);
  src = src.replace(re, `$1${version}$2`);
  writeFileSync(p, src);
}

async function openPr(id, version) {
  const branch = `bump/${id}-${version}`;
  const sh = (c, a) => require("node:child_process").execFileSync(c, a, { stdio: "inherit" });
  sh("git", ["checkout", "-b", branch]);
  sh("git", ["add", "scripts/registry.mjs"]);
  sh("git", ["commit", "-m", `chore: bump ${id} to ${version}`]);
  sh("git", ["push", "-u", "origin", branch]);
  sh("gh", ["pr", "create", "--title", `chore: bump ${id} to ${version}`,
    "--body", `Automated version bump for \`${id}\` -> ${version}. Build CI must pass before merge.`,
    "--repo", "TheShiveshNetwork/aurora-term"]);
}

async function main() {
  for (const spec of REGISTRY) {
    try {
      const latest = await latestFor(spec);
      if (!latest) continue;
      if (latest !== spec.version) {
        console.log(`bump ${spec.id}: ${spec.version} -> ${latest}`);
        bumpRegistry(spec.id, latest);
        await openPr(spec.id, latest);
      }
    } catch (e) {
      console.error(`check ${spec.id} failed:`, e.message);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
