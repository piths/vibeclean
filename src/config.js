import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG = {
  maxFiles: 500,
  maxFileSizeKb: 100,
  ignore: [],
  severity: "low",
  changedOnly: false,
  changedBase: "HEAD",
  failOn: null,
  maxIssues: null,
  minScore: null,
  rules: {
    naming: true,
    patterns: true,
    leftovers: true,
    dependencies: true,
    deadcode: true,
    errorhandling: true
  },
  allowedPatterns: {
    httpClient: null,
    asyncStyle: null,
    stateManagement: null
  }
};
const VALID_SEVERITIES = new Set(["low", "medium", "high"]);

function deepMerge(base, override) {
  const merged = { ...base };

  for (const [key, value] of Object.entries(override || {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function loadConfig(rootDir) {
  const candidates = [".vibecleanrc", ".vibecleanrc.json"];
  let fileConfig = {};

  for (const candidate of candidates) {
    const fullPath = path.join(rootDir, candidate);
    try {
      const stats = await fs.stat(fullPath);
      if (!stats.isFile()) {
        continue;
      }
      fileConfig = await readJson(fullPath);
      break;
    } catch {
      // Missing file or invalid stats: try next config candidate.
    }
  }

  return deepMerge(DEFAULT_CONFIG, fileConfig);
}

export function mergeConfig(base, overrides) {
  const safeOverrides = { ...overrides };
  if (safeOverrides.ignore && typeof safeOverrides.ignore === "string") {
    safeOverrides.ignore = safeOverrides.ignore
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof safeOverrides.maxFiles === "string") {
    safeOverrides.maxFiles = Number.parseInt(safeOverrides.maxFiles, 10);
  }

  if (typeof safeOverrides.maxIssues === "string") {
    safeOverrides.maxIssues = Number.parseInt(safeOverrides.maxIssues, 10);
  }

  if (typeof safeOverrides.minScore === "string") {
    safeOverrides.minScore = Number.parseInt(safeOverrides.minScore, 10);
  }

  if (typeof safeOverrides.minSeverity === "string") {
    safeOverrides.severity = safeOverrides.minSeverity.toLowerCase();
  }

  if (typeof safeOverrides.severity === "string") {
    safeOverrides.severity = safeOverrides.severity.toLowerCase();
    if (!VALID_SEVERITIES.has(safeOverrides.severity)) {
      safeOverrides.severity = base.severity || DEFAULT_CONFIG.severity;
    }
  }

  if (!Number.isFinite(safeOverrides.maxFiles) || safeOverrides.maxFiles <= 0) {
    delete safeOverrides.maxFiles;
  }

  if (!Number.isFinite(safeOverrides.maxIssues) || safeOverrides.maxIssues < 0) {
    delete safeOverrides.maxIssues;
  }

  if (!Number.isFinite(safeOverrides.minScore)) {
    delete safeOverrides.minScore;
  } else {
    safeOverrides.minScore = Math.max(0, Math.min(100, Math.round(safeOverrides.minScore)));
  }

  if (typeof safeOverrides.failOn === "string") {
    safeOverrides.failOn = safeOverrides.failOn.toLowerCase();
    if (!VALID_SEVERITIES.has(safeOverrides.failOn)) {
      safeOverrides.failOn = null;
    }
  } else if (safeOverrides.failOn != null) {
    safeOverrides.failOn = null;
  }

  return deepMerge(base, safeOverrides);
}

export { DEFAULT_CONFIG };

