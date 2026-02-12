import {
  collectImportSpecifiers,
  packageRoot,
  severityFromScore,
  scoreFromRatio,
  countMatches,
  parseAst
} from "./utils.js";

const HTTP_CLIENT_PACKAGES = new Set([
  "axios",
  "got",
  "node-fetch",
  "ky",
  "superagent",
  "undici"
]);
const HTTP_CLIENT_IDENTIFIERS = new Set(["axios", "got", "ky", "superagent"]);

const STATE_LIBS = [
  "redux",
  "@reduxjs/toolkit",
  "zustand",
  "jotai",
  "recoil",
  "mobx"
];

const DATA_FETCHING_LIBS = [
  "swr",
  "react-query",
  "@tanstack/react-query",
  "@trpc/client",
  "@trpc/react-query"
];

const STYLING_LIBS = [
  "styled-components",
  "@emotion/react",
  "@emotion/styled",
  "tailwindcss"
];

function mapToObject(map) {
  const output = {};
  for (const [key, value] of map.entries()) {
    output[key] = value;
  }
  return output;
}

function dominantKey(usageMap) {
  const entries = [...usageMap.entries()].sort((a, b) => b[1].size - a[1].size);
  if (!entries.length) {
    return null;
  }
  return entries[0][0];
}

function addUsage(usageMap, key, filePath) {
  if (!usageMap.has(key)) {
    usageMap.set(key, new Set());
  }
  usageMap.get(key).add(filePath);
}

function detectHttpCalls(content) {
  const ast = parseAst(content);
  const used = new Set();

  if (!ast) {
    if (/\bfetch\s*\(/.test(content)) {
      used.add("fetch");
    }
    return used;
  }

  function visit(node) {
    if (!node || typeof node !== "object") {
      return;
    }

    if (node.type === "CallExpression") {
      const callee = node.callee;
      if (callee?.type === "Identifier") {
        if (callee.name === "fetch") {
          used.add("fetch");
        }
        if (HTTP_CLIENT_IDENTIFIERS.has(callee.name)) {
          used.add(callee.name);
        }
      } else if (
        callee?.type === "MemberExpression" &&
        !callee.computed &&
        callee.object?.type === "Identifier"
      ) {
        if (HTTP_CLIENT_IDENTIFIERS.has(callee.object.name)) {
          used.add(callee.object.name);
        }
        if (callee.object.name === "undici") {
          used.add("undici");
        }
      }
    }

    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child?.type) {
            visit(child);
          }
        }
      } else if (value?.type) {
        visit(value);
      }
    }
  }

  visit(ast);
  return used;
}

function extractImportStyles(content) {
  const importLines = content.match(/import\s+[^;\n]+/g) || [];
  const libraryStyles = new Map();

  for (const line of importLines) {
    const fromMatch = line.match(/from\s+["'`]([^"'`]+)["'`]/);
    if (!fromMatch) {
      continue;
    }

    const lib = fromMatch[1];
    const style = /\{[^}]+\}/.test(line)
      ? "named"
      : /^import\s+[\w$]+\s+from/.test(line)
        ? "default"
        : "other";

    if (!libraryStyles.has(lib)) {
      libraryStyles.set(lib, new Set());
    }
    libraryStyles.get(lib).add(style);
  }

  const mixedLibs = [];
  for (const [lib, styles] of libraryStyles.entries()) {
    if (styles.size > 1) {
      mixedLibs.push(lib);
    }
  }

  return mixedLibs;
}

export function analyzePatterns(files, context = {}) {
  const httpUsage = new Map();
  const stateUsage = new Map();
  const dataFetchingUsage = new Map();
  const stylingUsage = new Map();

  let asyncAwaitOps = 0;
  let thenChains = 0;
  let callbackStyle = 0;
  let filesUsingImport = 0;
  let filesUsingRequire = 0;
  const importStyleMixedLibs = new Set();

  for (const file of files) {
    const content = file.content;
    const imports = collectImportSpecifiers(content);
    const importedPackages = new Set();

    for (const spec of imports) {
      const pkg = packageRoot(spec);
      if (!pkg) {
        continue;
      }

      importedPackages.add(pkg);
      if (HTTP_CLIENT_PACKAGES.has(pkg)) {
        addUsage(httpUsage, pkg, file.relativePath);
      }

      if (STATE_LIBS.includes(pkg)) {
        addUsage(stateUsage, pkg, file.relativePath);
      }

      if (DATA_FETCHING_LIBS.includes(pkg)) {
        addUsage(dataFetchingUsage, pkg, file.relativePath);
      }

      if (STYLING_LIBS.includes(pkg)) {
        addUsage(stylingUsage, pkg, file.relativePath);
      }
    }

    const httpCalls = detectHttpCalls(content);
    const fetchIsPolyfilled =
      importedPackages.has("node-fetch") || importedPackages.has("undici");
    for (const client of httpCalls) {
      if (client === "fetch" && fetchIsPolyfilled) {
        continue;
      }
      addUsage(httpUsage, client, file.relativePath);
    }

    if (/\buseState\s*\(/.test(content)) {
      addUsage(stateUsage, "useState", file.relativePath);
    }

    if (/\buseReducer\s*\(/.test(content)) {
      addUsage(stateUsage, "useReducer", file.relativePath);
    }

    if (/\bcreateContext\s*\(/.test(content) || /\buseContext\s*\(/.test(content)) {
      addUsage(stateUsage, "context", file.relativePath);
    }

    if (/\bfetch\s*\(/.test(content)) {
      addUsage(dataFetchingUsage, "raw-fetch", file.relativePath);
    }

    if (/style\s*=\s*\{\{/.test(content)) {
      addUsage(stylingUsage, "inline-styles", file.relativePath);
    }

    if (/\.module\.(css|scss|sass|less)["'`]/.test(content)) {
      addUsage(stylingUsage, "css-modules", file.relativePath);
    }

    if (/class(Name)?\s*=\s*["'`][^"'`]*(?:text-|bg-|flex|grid|px-|py-|mx-|my-)/.test(content)) {
      addUsage(stylingUsage, "tailwind-utility-classes", file.relativePath);
    }

    asyncAwaitOps += countMatches(content, /\bawait\b/g);
    thenChains += countMatches(content, /\.then\s*\(/g);
    callbackStyle += countMatches(content, /\bfunction\s*\([^)]*(?:err|error)[^)]*\)/g);

    if (/\bimport\s+/.test(content)) {
      filesUsingImport += 1;
    }
    if (/\brequire\s*\(/.test(content)) {
      filesUsingRequire += 1;
    }

    for (const lib of extractImportStyles(content)) {
      importStyleMixedLibs.add(lib);
    }
  }

  const packageJson = context.packageJson || {};
  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {})
  };

  const installedStateLibs = STATE_LIBS.filter((lib) => lib in deps);
  for (const lib of installedStateLibs) {
    if (!stateUsage.has(lib)) {
      stateUsage.set(lib, new Set());
    }
  }

  const installedStylingLibs = STYLING_LIBS.filter((lib) => lib in deps);
  for (const lib of installedStylingLibs) {
    if (!stylingUsage.has(lib)) {
      stylingUsage.set(lib, new Set());
    }
  }

  const findings = [];

  if (httpUsage.size > 1) {
    const detail = [...httpUsage.entries()]
      .map(([name, fileSet]) => `${name} (${fileSet.size} files)`)
      .join(", ");
    findings.push({
      severity: "high",
      message: `Multiple HTTP clients detected: ${detail}`,
      files: [...new Set([...httpUsage.values()].flatMap((set) => [...set]))].slice(0, 20)
    });
  }

  if (stateUsage.size > 2) {
    findings.push({
      severity: "medium",
      message: `State management patterns are mixed across ${stateUsage.size} approaches.`,
      files: [...new Set([...stateUsage.values()].flatMap((set) => [...set]))].slice(0, 20)
    });
  }

  const asyncTotal = asyncAwaitOps + thenChains + callbackStyle;
  if (thenChains > 0 && asyncAwaitOps > 0) {
    findings.push({
      severity: "medium",
      message: `Mixed async styles: async/await (${asyncAwaitOps}) and .then() chains (${thenChains}).`
    });
  }

  if (filesUsingImport > 0 && filesUsingRequire > 0) {
    findings.push({
      severity: "medium",
      message: `Mixed module systems: ES modules in ${filesUsingImport} files and require() in ${filesUsingRequire} files.`
    });
  }

  if (importStyleMixedLibs.size > 0) {
    findings.push({
      severity: "low",
      message: `${importStyleMixedLibs.size} libraries are imported with both default and named styles.`
    });
  }

  if (stylingUsage.size > 2) {
    findings.push({
      severity: "medium",
      message: `Multiple styling approaches detected (${stylingUsage.size} patterns).`
    });
  }

  if (dataFetchingUsage.size > 1) {
    findings.push({
      severity: "medium",
      message: `Data fetching is split across ${dataFetchingUsage.size} patterns.`
    });
  }

  const inconsistencySignals =
    Math.max(0, httpUsage.size - 1) +
    Math.max(0, stateUsage.size - 2) +
    Math.max(0, stylingUsage.size - 2) +
    (filesUsingImport > 0 && filesUsingRequire > 0 ? 1 : 0) +
    (thenChains > 0 && asyncAwaitOps > 0 ? 1 : 0) +
    Math.max(0, dataFetchingUsage.size - 1);

  const score = Math.min(10, scoreFromRatio(inconsistencySignals / 8 + (asyncTotal ? thenChains / asyncTotal : 0), 10));

  const dominantHttpClient = dominantKey(httpUsage);
  const preferredHttpClient = dominantHttpClient || "fetch";
  const asyncStyle = asyncAwaitOps >= thenChains ? "async-await" : "then-chains";

  return {
    id: "patterns",
    title: "PATTERN INCONSISTENCY",
    score,
    severity: severityFromScore(score),
    totalIssues: findings.length,
    summary:
      findings.length > 0
        ? `Detected ${findings.length} pattern inconsistency signals across the codebase.`
        : "No major pattern inconsistencies detected.",
    metrics: {
      httpClients: mapToObject(new Map([...httpUsage.entries()].map(([k, v]) => [k, v.size]))),
      stateManagement: mapToObject(new Map([...stateUsage.entries()].map(([k, v]) => [k, v.size]))),
      dataFetching: mapToObject(new Map([...dataFetchingUsage.entries()].map(([k, v]) => [k, v.size]))),
      styling: mapToObject(new Map([...stylingUsage.entries()].map(([k, v]) => [k, v.size]))),
      asyncAwaitOps,
      thenChains,
      callbackStyle,
      filesUsingImport,
      filesUsingRequire
    },
    recommendations: [
      dominantHttpClient
        ? `Standardize HTTP requests on ${dominantHttpClient}.`
        : "No explicit HTTP client detected. Keep one client choice once network calls are added.",
      `Prefer ${asyncStyle === "async-await" ? "async/await" : ".then() chains"} for async consistency.`,
      "Use one module system (ES modules recommended).",
      "Reduce mixed styling and data-fetching patterns."
    ],
    findings,
    preferences: {
      httpClient: preferredHttpClient,
      asyncStyle,
      importStyle: filesUsingImport >= filesUsingRequire ? "esm" : "cjs"
    }
  };
}

