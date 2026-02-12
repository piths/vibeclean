import path from "node:path";
import { severityFromScore, scoreFromRatio } from "./utils.js";

const EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte"];

function resolveRelativeImport(fromFile, specifier, existingFiles) {
  const baseDir = path.dirname(fromFile);
  const direct = path.normalize(path.join(baseDir, specifier));

  if (existingFiles.has(direct)) {
    return direct;
  }

  for (const ext of EXTENSIONS) {
    if (existingFiles.has(`${direct}${ext}`)) {
      return `${direct}${ext}`;
    }
  }

  for (const ext of EXTENSIONS) {
    if (existingFiles.has(path.join(direct, `index${ext}`))) {
      return path.join(direct, `index${ext}`);
    }
  }

  return null;
}

function extractRelativeImports(content) {
  const imports = [];

  for (const match of content.matchAll(/import\s+[^"'`]*?from\s+["'`]([^"'`]+)["'`]/g)) {
    imports.push(match[1]);
  }
  for (const match of content.matchAll(/import\s+["'`]([^"'`]+)["'`]/g)) {
    imports.push(match[1]);
  }
  for (const match of content.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    imports.push(match[1]);
  }

  return imports.filter((item) => item.startsWith("."));
}

function extractImportUsage(content) {
  const imports = [];

  for (const match of content.matchAll(/import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,\s*\{([^}]+)\})?\s+from\s+["'`]([^"'`]+)["'`]/g)) {
    const names = (match[2] || "")
      .split(",")
      .map((item) => item.trim().split(/\s+as\s+/i)[0])
      .filter(Boolean);
    imports.push({ specifier: match[3], names, defaultImport: true, namespaceImport: false });
  }

  for (const match of content.matchAll(/import\s+\{([^}]+)\}\s+from\s+["'`]([^"'`]+)["'`]/g)) {
    const names = match[1]
      .split(",")
      .map((item) => item.trim().split(/\s+as\s+/i)[0])
      .filter(Boolean);
    imports.push({ specifier: match[2], names, defaultImport: false, namespaceImport: false });
  }

  for (const match of content.matchAll(/import\s+\*\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*\s+from\s+["'`]([^"'`]+)["'`]/g)) {
    imports.push({ specifier: match[1], names: [], defaultImport: false, namespaceImport: true });
  }

  for (const match of content.matchAll(/const\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    imports.push({ specifier: match[1], names: [], defaultImport: true, namespaceImport: false });
  }

  for (const match of content.matchAll(/const\s+\{([^}]+)\}\s*=\s*require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    const names = match[1]
      .split(",")
      .map((item) => item.trim().split(/\s*:\s*/)[0])
      .filter(Boolean);
    imports.push({ specifier: match[2], names, defaultImport: false, namespaceImport: false });
  }

  return imports;
}

function extractExports(content) {
  const names = new Set();
  let hasDefault = /\bexport\s+default\b/.test(content);

  for (const match of content.matchAll(/export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    names.add(match[1]);
  }

  for (const match of content.matchAll(/export\s*\{([^}]+)\}/g)) {
    const parts = match[1]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    for (const part of parts) {
      const aliasMatch = part.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/i);
      if (!aliasMatch) {
        continue;
      }

      const localName = aliasMatch[1];
      const exportedName = aliasMatch[2] || localName;
      if (exportedName === "default") {
        hasDefault = true;
      } else {
        names.add(localName);
      }
    }
  }

  return {
    named: [...names],
    hasDefault
  };
}

function isEntrypoint(relativePath) {
  return (
    /(^|\/)(index|main|app)\.(js|jsx|ts|tsx|mjs|cjs)$/.test(relativePath) ||
    /(^|\/)(pages|routes)\//.test(relativePath)
  );
}

function codeLineCount(content) {
  const lines = content.split("\n");
  let count = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed === "{" || trimmed === "}") {
      continue;
    }
    count += 1;
  }

  return count;
}

function isReexportOnly(content) {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return false;
  }

  return lines.every((line) => /^export\s+(\*|\{)/.test(line));
}

export function analyzeDeadCode(files) {
  const existingFiles = new Set(files.map((file) => file.relativePath));
  const incomingRefs = new Map();
  const exportsByFile = new Map();
  const importUsageByFile = new Map();

  for (const file of files) {
    incomingRefs.set(file.relativePath, new Set());
  }

  for (const file of files) {
    const imports = extractRelativeImports(file.content);
    for (const specifier of imports) {
      const resolved = resolveRelativeImport(file.relativePath, specifier, existingFiles);
      if (!resolved || !incomingRefs.has(resolved)) {
        continue;
      }

      incomingRefs.get(resolved).add(file.relativePath);
    }

    exportsByFile.set(file.relativePath, extractExports(file.content));

    for (const importInfo of extractImportUsage(file.content)) {
      const resolved = importInfo.specifier.startsWith(".")
        ? resolveRelativeImport(file.relativePath, importInfo.specifier, existingFiles)
        : null;

      if (!resolved) {
        continue;
      }

      if (!importUsageByFile.has(resolved)) {
        importUsageByFile.set(resolved, {
          named: new Set(),
          defaultImport: false,
          namespaceImport: false
        });
      }

      const usage = importUsageByFile.get(resolved);
      usage.defaultImport = usage.defaultImport || Boolean(importInfo.defaultImport);
      usage.namespaceImport = usage.namespaceImport || Boolean(importInfo.namespaceImport);
      for (const name of importInfo.names) {
        usage.named.add(name);
      }
    }
  }

  const orphanFiles = [];
  for (const file of files) {
    const refs = incomingRefs.get(file.relativePath);
    const inSrc = file.relativePath.startsWith("src/");

    if (inSrc && refs && refs.size === 0 && !isEntrypoint(file.relativePath)) {
      orphanFiles.push(file.relativePath);
    }
  }

  const unusedExports = [];
  for (const [filePath, exportInfo] of exportsByFile.entries()) {
    if (!exportInfo.named.length && !exportInfo.hasDefault) {
      continue;
    }

    const used = importUsageByFile.get(filePath) || {
      named: new Set(),
      defaultImport: false,
      namespaceImport: false
    };

    for (const exportName of exportInfo.named) {
      if (!used.named.has(exportName) && !used.namespaceImport && !isEntrypoint(filePath)) {
        unusedExports.push({ file: filePath, name: exportName });
      }
    }

    if (exportInfo.hasDefault && !used.defaultImport && !used.namespaceImport && !isEntrypoint(filePath)) {
      unusedExports.push({ file: filePath, name: "default" });
    }
  }

  const stubFiles = [];
  for (const file of files) {
    const lines = codeLineCount(file.content);
    if (lines < 5 || isReexportOnly(file.content)) {
      stubFiles.push({ file: file.relativePath, lines });
    }
  }

  const findings = [];
  if (orphanFiles.length) {
    findings.push({
      severity: orphanFiles.length > 5 ? "high" : "medium",
      message: `${orphanFiles.length} orphan files are not imported anywhere.`,
      files: orphanFiles.slice(0, 25)
    });
  }

  if (unusedExports.length) {
    findings.push({
      severity: "medium",
      message: `${unusedExports.length} exports are never imported.`,
      files: unusedExports.map((item) => item.file).slice(0, 25)
    });
  }

  if (stubFiles.length) {
    findings.push({
      severity: "low",
      message: `${stubFiles.length} files look like stubs or thin re-export shells.`,
      files: stubFiles.map((item) => item.file).slice(0, 25)
    });
  }

  const signal = orphanFiles.length * 2 + unusedExports.length + stubFiles.length;
  const score = Math.min(10, scoreFromRatio(signal / Math.max(files.length * 0.6, 1), 10));

  return {
    id: "deadcode",
    title: "DEAD CODE",
    score,
    severity: severityFromScore(score),
    totalIssues: orphanFiles.length + unusedExports.length + stubFiles.length,
    summary:
      findings.length > 0
        ? `${findings.length} dead-code signals found.`
        : "No major dead-code hotspots detected.",
    metrics: {
      orphanFiles,
      unusedExports,
      stubFiles
    },
    recommendations: [
      "Delete or wire orphan files into active code paths.",
      "Remove unused exports or consume them where needed.",
      "Consolidate stub/re-export files where they do not add structure."
    ],
    findings
  };
}

