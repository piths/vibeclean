import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG = {
  maxFiles: 500,
  maxFileSizeKb: 100,
  ignore: [],
  severity: "low",
  profile: "app",
  changedOnly: false,
  changedBase: "HEAD",
  failOn: null,
  maxIssues: null,
  minScore: null,
  baseline: false,
  baselineFile: ".vibeclean-baseline.json",
  writeBaseline: false,
  failOnRegression: true,
  reportFormat: "text",
  reportFile: null,
  leftovers: {
    allowConsolePaths: [],
    ignoreTodoPaths: []
  },
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
const VALID_REPORT_FORMATS = new Set(["text", "json", "markdown"]);

const PROFILE_PRESETS = {
  app: {
    ignore: []
  },
  library: {
    ignore: ["examples/**", "example/**", "benchmarks/**", "benchmark/**", "playground/**"]
  },
  cli: {
    ignore: ["test/**", "**/*.test.js", "**/*.spec.js"],
    leftovers: {
      allowConsolePaths: ["bin/", "scripts/", "test/"],
      ignoreTodoPaths: ["test/"]
    }
  }
};
const VALID_PROFILES = new Set(Object.keys(PROFILE_PRESETS));

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

function uniqueArray(input) {
  return [...new Set((Array.isArray(input) ? input : []).filter(Boolean))];
}

function applyProfile(baseConfig, profileName) {
  const normalized = typeof profileName === "string" ? profileName.toLowerCase() : "";
  const selectedProfile = VALID_PROFILES.has(normalized) ? normalized : DEFAULT_CONFIG.profile;
  const profilePreset = PROFILE_PRESETS[selectedProfile] || {};
  const profiled = deepMerge(baseConfig, profilePreset);
  profiled.profile = selectedProfile;
  profiled.ignore = uniqueArray([...(baseConfig.ignore || []), ...(profilePreset.ignore || [])]);
  return profiled;
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
  const extraIgnore = [];
  if (safeOverrides.ignore && typeof safeOverrides.ignore === "string") {
    extraIgnore.push(
      ...safeOverrides.ignore
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    );
    delete safeOverrides.ignore;
  } else if (Array.isArray(safeOverrides.ignore)) {
    extraIgnore.push(...safeOverrides.ignore.filter(Boolean));
    delete safeOverrides.ignore;
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

  if (typeof safeOverrides.profile === "string") {
    safeOverrides.profile = safeOverrides.profile.toLowerCase();
    if (!VALID_PROFILES.has(safeOverrides.profile)) {
      delete safeOverrides.profile;
    }
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

  if (typeof safeOverrides.reportFormat === "string") {
    safeOverrides.reportFormat = safeOverrides.reportFormat.toLowerCase();
    if (!VALID_REPORT_FORMATS.has(safeOverrides.reportFormat)) {
      safeOverrides.reportFormat = base.reportFormat || DEFAULT_CONFIG.reportFormat;
    }
  }

  if (typeof safeOverrides.baselineFile === "string") {
    safeOverrides.baselineFile = safeOverrides.baselineFile.trim() || DEFAULT_CONFIG.baselineFile;
  }

  const selectedProfile = safeOverrides.profile || base.profile || DEFAULT_CONFIG.profile;
  const profiledBase = applyProfile(base, selectedProfile);
  const merged = deepMerge(profiledBase, safeOverrides);
  merged.ignore = uniqueArray([...(profiledBase.ignore || []), ...extraIgnore]);

  return merged;
}

export { DEFAULT_CONFIG, PROFILE_PRESETS };
