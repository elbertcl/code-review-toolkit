import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const ROOT_INSTRUCTIONS = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"];
const STACK_INDICATORS = [
  "go.mod", "package.json", "pyproject.toml", "requirements.txt", "Cargo.toml",
  "Gemfile", "pom.xml", "build.gradle", "build.gradle.kts", "composer.json",
];

async function existingFiles(root, candidates) {
  const found = [];
  for (const candidate of candidates) {
    try {
      if ((await stat(path.join(root, candidate))).isFile()) found.push(candidate);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return found;
}

async function markdownFiles(root, directory, nested = false) {
  const absolute = path.join(root, directory);
  try {
    const entries = await readdir(absolute, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => `${directory}/${entry.name}`);
    if (!nested) return files.sort();
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const child = `${directory}/${entry.name}`;
      const children = await readdir(path.join(root, child), { withFileTypes: true });
      files.push(...children.filter((item) => item.isFile() && item.name.endsWith(".md"))
        .map((item) => `${child}/${item.name}`));
    }
    return files.sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function workflowProposals(root) {
  const directory = ".github/workflows";
  let entries;
  try {
    entries = await readdir(path.join(root, directory), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const proposals = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".yml")).sort((a, b) => a.name.localeCompare(b.name))) {
    const workflowPath = `${directory}/${entry.name}`;
    const content = await readFile(path.join(root, workflowPath), "utf8");
    const name = content.match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim();
    if (name) proposals.push({ name, path: workflowPath, confirmed: false });
  }
  return proposals;
}

async function workflowFiles(root) {
  try {
    return (await readdir(path.join(root, ".github/workflows"), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
      .map((entry) => `.github/workflows/${entry.name}`)
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function domains(root) {
  const directory = "internal/domain";
  try {
    return (await readdir(path.join(root, directory), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, sourcePaths: [`${directory}/${entry.name}/**`] }))
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function discoverReviewContext(root) {
  return {
    instructions: await existingFiles(root, ROOT_INSTRUCTIONS),
    architecture: await markdownFiles(root, "docs/architecture"),
    invariants: await markdownFiles(root, "docs/invariants"),
    testspecs: await markdownFiles(root, "docs/testspecs", true),
    conventions: await markdownFiles(root, "docs/conventions"),
    workflows: await workflowFiles(root),
    stackIndicators: await existingFiles(root, STACK_INDICATORS),
    workflowProposals: await workflowProposals(root),
    domains: await domains(root),
  };
}
