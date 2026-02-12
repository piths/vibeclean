import fs from "node:fs/promises";
import path from "node:path";
import { collectImportSpecifiers, packageRoot, severityFromScore, scoreFromRatio } from "./utils.js";

const DUPLICATE_GROUPS = [
  ["lodash", "underscore"],
  ["moment", "dayjs"],
  ["moment", "date-fns"],
  ["express", "koa"],
  ["express", "fastify"],
  ["jest", "vitest"],
  ["jest", "mocha"],
  ["vitest", "mocha"]
];

const OUTDATED_PACKAGES = {
  moment: "Consider migrating to dayjs or date-fns for lighter bundles.",
  request: "request is deprecated. Prefer fetch or undici.",
  lodash: "Consider lodash-es or native methods where possible."
};

const ESTIMATED_MB = {
  lodash: 0.5,
  moment: 0.6,
  request: 0.3,
  axios: 0.2,
  express: 1.0,
  jest: 1.7,
  mocha: 0.8,
  chalk: 0.08,
  uuid: 0.05,
  cors: 0.04,
  dotenv: 0.03
};

const CLI_PACKAGE_ALIASES = {
  jest: "jest",
  vitest: "vitest",
  mocha: "mocha",
  eslint: "eslint",
  prettier: "prettier",
  tsc: "typescript",
  vite: "vite",
  webpack: "webpack",
  rollup: "rollup",
  nodemon: "nodemon",
  ava: "ava",
  nyc: "nyc",
  "ts-node": "ts-node"
};

const CONFIG_FILE_HINTS = {
  tailwindcss: ["tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs"],
  postcss: ["postcss.config.js", "postcss.config.cjs", "postcss.config.mjs"],
  autoprefixer: ["postcss.config.js", "postcss.config.cjs", "postcss.config.mjs"],
  "@babel/core": ["babel.config.js", ".babelrc", ".babelrc.json"],
  eslint: [".eslintrc", ".eslintrc.json", ".eslintrc.js", "eslint.config.js"],
  prettier: [".prettierrc", ".prettierrc.json", "prettier.config.js"],
  jest: ["jest.config.js", "jest.config.cjs", "jest.config.mjs"],
  vitest: ["vitest.config.js", "vitest.config.ts", "vite.config.js", "vite.config.ts"]
};

const SAFE_DEV_TOOLS = new Set([
  "typescript",
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "husky",
  "lint-staged",
  "rimraf",
  "cross-env",
  "npm-run-all",
  "concurrently"
]);

async function exists(rootDir, relativeFile) {
  try {
    await fs.access(path.join(rootDir, relativeFile));
    return true;
  } catch {
    return false;
  }
}

function parseScriptCommands(scripts = {}) {
  const used = new Set();

  for (const script of Object.values(scripts)) {
    const firstCommand = script.split(/&&|\|\||;/)[0].trim();
    const parts = firstCommand.split(/\s+/).filter(Boolean);
    const token = parts[0] || "";
    let normalized = token;

    if (token === "npx") {
      normalized = parts[1] || "";
    } else if ((token === "pnpm" || token === "yarn" || token === "npm") && parts[1] === "run") {
      normalized = parts[2] || "";
    }

    if (CLI_PACKAGE_ALIASES[normalized]) {
      used.add(CLI_PACKAGE_ALIASES[normalized]);
    }
  }

  return used;
}

export async function analyzeDependencies(files, context = {}) {
  const packageJson = context.packageJson;
  const rootDir = context.rootDir;

  if (!packageJson) {
    return {
      id: "dependencies",
      title: "DEPENDENCY ISSUES",
      score: 0,
      severity: "low",
      totalIssues: 0,
      summary: "No package.json found. Dependency analysis was skipped.",
      metrics: {},
      recommendations: ["Add a package.json if you want dependency auditing."],
      findings: [],
      skipped: true
    };
  }

  const dependencies = packageJson.dependencies || {};
  const devDependencies = packageJson.devDependencies || {};
  const allDeps = [...Object.keys(dependencies), ...Object.keys(devDependencies)];

  const importedPackages = new Set();
  for (const file of files) {
    for (const specifier of collectImportSpecifiers(file.content)) {
      const root = packageRoot(specifier);
      if (root) {
        importedPackages.add(root);
      }
    }
  }

  const scriptUsedPackages = parseScriptCommands(packageJson.scripts || {});

  const configHintUsed = new Set();
  for (const [pkg, configFiles] of Object.entries(CONFIG_FILE_HINTS)) {
    for (const configFile of configFiles) {
      if (await exists(rootDir, configFile)) {
        configHintUsed.add(pkg);
        break;
      }
    }
  }

  const unused = [];
  for (const dep of allDeps) {
    const usedByImport = importedPackages.has(dep);
    const usedByScript = scriptUsedPackages.has(dep);
    const usedByConfig = configHintUsed.has(dep);
    const safeTool = SAFE_DEV_TOOLS.has(dep) || dep.startsWith("@types/");

    if (!usedByImport && !usedByScript && !usedByConfig && !safeTool) {
      unused.push(dep);
    }
  }

  const duplicates = [];
  for (const group of DUPLICATE_GROUPS) {
    const present = group.filter((name) => allDeps.includes(name));
    if (present.length > 1) {
      duplicates.push(present);
    }
  }

  const outdated = [];
  for (const dep of allDeps) {
    if (OUTDATED_PACKAGES[dep]) {
      outdated.push({ dep, note: OUTDATED_PACKAGES[dep] });
    }
  }

  const estimatedSavingsMb = unused.reduce((sum, dep) => sum + (ESTIMATED_MB[dep] || 0.05), 0);

  const findings = [];
  if (unused.length) {
    findings.push({
      severity: unused.length >= 5 ? "high" : "medium",
      message: `${unused.length} unused packages detected.`,
      packages: unused.slice(0, 30)
    });
  }

  if (duplicates.length) {
    findings.push({
      severity: "medium",
      message: `${duplicates.length} duplicate functionality groups found.`,
      packages: duplicates
    });
  }

  if (outdated.length) {
    findings.push({
      severity: "medium",
      message: `${outdated.length} outdated or heavy packages detected.`,
      packages: outdated.map((item) => item.dep)
    });
  }

  const score = Math.min(
    10,
    scoreFromRatio(
      (unused.length + duplicates.length * 2 + outdated.length) / Math.max(allDeps.length * 0.5, 1),
      10
    )
  );

  return {
    id: "dependencies",
    title: "DEPENDENCY ISSUES",
    score,
    severity: severityFromScore(score),
    totalIssues: unused.length + duplicates.length + outdated.length,
    summary:
      findings.length > 0
        ? `${findings.length} dependency risk areas found.`
        : "No major dependency bloat or overlap detected.",
    metrics: {
      dependencyCount: Object.keys(dependencies).length,
      devDependencyCount: Object.keys(devDependencies).length,
      unusedCount: unused.length,
      duplicateGroups: duplicates,
      outdated: outdated,
      estimatedSavingsMb: Number(estimatedSavingsMb.toFixed(2))
    },
    recommendations: [
      "Remove unused dependencies to reduce install time and attack surface.",
      "Keep one package per concern where possible (date, test runner, web framework).",
      "Replace deprecated packages with actively maintained alternatives."
    ],
    findings
  };
}

