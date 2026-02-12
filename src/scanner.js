import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { glob } from "glob";
import ignore from "ignore";

const SUPPORTED_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte"
]);

const BUILTIN_IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.cache/**",
  "**/coverage/**",
  "**/__pycache__/**",
  "**/*.lock",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/*.min.js",
  "**/*.bundle.js",
  "**/*.png",
  "**/*.jpg",
  "**/*.jpeg",
  "**/*.gif",
  "**/*.webp",
  "**/*.svg",
  "**/*.ico",
  "**/*.woff",
  "**/*.woff2",
  "**/*.ttf",
  "**/*.eot",
  "**/*.otf",
  "**/.env",
  "**/.env.*"
];

const execFileAsync = promisify(execFile);

function isTextContent(content) {
  return !content.includes("\u0000");
}

async function readFileTextStream(filePath) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    const stream = createReadStream(filePath, { encoding: "utf8" });

    stream.on("data", (chunk) => {
      chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      resolve(chunks.join(""));
    });
  });
}

async function readGitignore(rootDir) {
  const gitignorePath = path.join(rootDir, ".gitignore");
  try {
    return await fs.readFile(gitignorePath, "utf8");
  } catch {
    return "";
  }
}

function splitLines(raw = "") {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function listGitChangedPaths(rootDir, baseRef, warnings) {
  try {
    await execFileAsync("git", ["-C", rootDir, "rev-parse", "--is-inside-work-tree"]);
  } catch {
    warnings.push("`--changed` requested, but this directory is not a git repository. Scanning full project.");
    return null;
  }

  let changedFromBase = [];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", rootDir, "diff", "--name-only", "--diff-filter=ACMRTUXB", baseRef],
      { maxBuffer: 4 * 1024 * 1024 }
    );
    changedFromBase = splitLines(stdout);
  } catch {
    warnings.push(
      `Could not resolve git base ref "${baseRef}" for --changed. Scanning full project instead.`
    );
    return null;
  }

  let untracked = [];
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", rootDir, "ls-files", "--others", "--exclude-standard"],
      { maxBuffer: 2 * 1024 * 1024 }
    );
    untracked = splitLines(stdout);
  } catch {
    // Ignore untracked-file probe errors and keep changed-file scan usable.
  }

  return [...new Set([...changedFromBase, ...untracked])];
}

export async function scanProject(rootDir, options = {}) {
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : 500;
  const maxFileSizeBytes =
    (Number.isFinite(options.maxFileSizeKb) ? options.maxFileSizeKb : 100) * 1024;
  const changedOnly = Boolean(options.changedOnly);
  const changedBase =
    typeof options.changedBase === "string" && options.changedBase.trim()
      ? options.changedBase.trim()
      : "HEAD";
  const warnings = [];

  const ig = ignore();
  const gitignoreRaw = await readGitignore(rootDir);
  if (gitignoreRaw.trim()) {
    ig.add(gitignoreRaw);
  }
  if (Array.isArray(options.ignore) && options.ignore.length > 0) {
    ig.add(options.ignore);
  }

  let candidates = [];
  let hasChangedSelection = false;
  if (changedOnly) {
    const changedPaths = await listGitChangedPaths(rootDir, changedBase, warnings);
    if (Array.isArray(changedPaths)) {
      hasChangedSelection = true;
      candidates = changedPaths;
      if (candidates.length === 0) {
        warnings.push(`No changed files found relative to "${changedBase}".`);
      }
    }
  }

  if (!hasChangedSelection) {
    candidates = await glob("**/*", {
      cwd: rootDir,
      nodir: true,
      dot: false,
      absolute: false,
      ignore: BUILTIN_IGNORE_GLOBS
    });
  }

  const filtered = [];
  for (const relativePath of candidates) {
    if (ig.ignores(relativePath)) {
      continue;
    }

    const ext = path.extname(relativePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      continue;
    }

    filtered.push(relativePath);
  }

  filtered.sort();

  const limited = filtered.slice(0, maxFiles);
  if (filtered.length > maxFiles) {
    warnings.push(
      `Scan capped at ${maxFiles} files. ${filtered.length - maxFiles} files were not analyzed.`
    );
  }

  const files = [];
  for (const relativePath of limited) {
    const absolutePath = path.join(rootDir, relativePath);

    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isFile()) {
        continue;
      }

      if (stats.size > maxFileSizeBytes) {
        warnings.push(`Skipped large file: ${relativePath} (${Math.ceil(stats.size / 1024)}KB)`);
        continue;
      }

      const content = await readFileTextStream(absolutePath);
      if (!isTextContent(content)) {
        warnings.push(`Skipped binary-like file: ${relativePath}`);
        continue;
      }

      files.push({
        path: absolutePath,
        relativePath,
        content,
        extension: path.extname(relativePath).toLowerCase(),
        size: stats.size
      });
    } catch {
      warnings.push(`Could not read file: ${relativePath}`);
    }
  }

  return {
    files,
    warnings,
    stats: {
      scanned: files.length,
      matched: filtered.length,
      durationMs: 0
    }
  };
}

export { SUPPORTED_EXTENSIONS, BUILTIN_IGNORE_GLOBS };

