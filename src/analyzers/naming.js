import path from "node:path";
import {
  collectIdentifiers,
  parseAst,
  severityFromScore,
  traverseAst,
  scoreFromRatio
} from "./utils.js";

const IDENTIFIER_STYLES = {
  camelCase: /^[a-z][a-zA-Z0-9]*$/,
  snake_case: /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/,
  PascalCase: /^[A-Z][a-zA-Z0-9]*$/,
  SCREAMING_SNAKE: /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/
};

const FILE_STYLES = {
  "kebab-case": /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  snake_case: /^[a-z0-9]+(?:_[a-z0-9]+)*$/,
  camelCase: /^[a-z][a-zA-Z0-9]*$/,
  PascalCase: /^[A-Z][a-zA-Z0-9]*$/
};

function styleOf(value, map) {
  for (const [name, regex] of Object.entries(map)) {
    if (regex.test(value)) {
      return name;
    }
  }
  return null;
}

function dominantFromCounts(counts) {
  const entries = Object.entries(counts);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (!total) {
    return { name: null, total: 0, ratio: 0, entries: [] };
  }

  const sorted = entries.sort((a, b) => b[1] - a[1]);
  const [dominantName, dominantCount] = sorted[0];

  return {
    name: dominantName,
    total,
    ratio: dominantCount / total,
    entries: sorted
  };
}

function extractExportedComponentNames(content) {
  const ast = parseAst(content);
  const names = new Set();

  if (!ast) {
    const fallback = content.matchAll(
      /export\s+(?:default\s+)?(?:function|class|const)\s+([A-Z][A-Za-z0-9_]*)/g
    );
    for (const match of fallback) {
      names.add(match[1]);
    }
    return [...names];
  }

  traverseAst(ast, (node) => {
    if (node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration") {
      const declaration = node.declaration;
      if (!declaration) {
        return;
      }

      if (
        (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") &&
        declaration.id?.name?.[0] === declaration.id?.name?.[0]?.toUpperCase()
      ) {
        names.add(declaration.id.name);
      }

      if (declaration.type === "VariableDeclaration") {
        for (const item of declaration.declarations || []) {
          if (item.id?.type === "Identifier") {
            const name = item.id.name;
            if (name[0] === name[0].toUpperCase()) {
              names.add(name);
            }
          }
        }
      }
    }
  });

  return [...names];
}

function normalizeName(input) {
  return input.replace(/[-_]/g, "").toLowerCase();
}

export function analyzeNaming(files) {
  const identifierCounts = {
    camelCase: 0,
    snake_case: 0,
    PascalCase: 0,
    SCREAMING_SNAKE: 0
  };

  const identifierFilesByStyle = {
    camelCase: new Set(),
    snake_case: new Set(),
    PascalCase: new Set(),
    SCREAMING_SNAKE: new Set()
  };

  const directoryFileStyles = new Map();
  const componentMismatches = [];

  for (const file of files) {
    const identifiers = collectIdentifiers(file.content);
    for (const identifier of identifiers) {
      const style = styleOf(identifier, IDENTIFIER_STYLES);
      if (!style) {
        continue;
      }

      identifierCounts[style] += 1;
      identifierFilesByStyle[style].add(file.relativePath);
    }

    const baseName = path.basename(file.relativePath, file.extension);
    const fileStyle = styleOf(baseName, FILE_STYLES);
    const dirName = path.dirname(file.relativePath);
    if (!directoryFileStyles.has(dirName)) {
      directoryFileStyles.set(dirName, new Map());
    }
    const styleMap = directoryFileStyles.get(dirName);
    styleMap.set(fileStyle || "other", (styleMap.get(fileStyle || "other") || 0) + 1);

    if ([".jsx", ".tsx", ".vue", ".svelte"].includes(file.extension)) {
      const componentNames = extractExportedComponentNames(file.content);
      for (const componentName of componentNames) {
        if (normalizeName(componentName) !== normalizeName(baseName)) {
          componentMismatches.push({
            file: file.relativePath,
            component: componentName
          });
        }
      }
    }
  }

  const dominant = dominantFromCounts(identifierCounts);
  const dominantStyle = dominant.name;

  const stylePercentages = dominant.entries.map(([style, count]) => ({
    style,
    count,
    percent: dominant.total ? Math.round((count / dominant.total) * 100) : 0,
    files: identifierFilesByStyle[style].size
  }));

  const minorityFiles = new Set();
  for (const [style, filesForStyle] of Object.entries(identifierFilesByStyle)) {
    if (!dominantStyle || style === dominantStyle) {
      continue;
    }

    for (const file of filesForStyle) {
      minorityFiles.add(file);
    }
  }

  const mixedDirectories = [];
  for (const [dirName, styleMap] of directoryFileStyles.entries()) {
    if (styleMap.size > 1) {
      mixedDirectories.push({
        directory: dirName,
        styles: [...styleMap.entries()].map(([style, count]) => `${style} (${count})`)
      });
    }
  }

  const imbalanceRatio = dominant.total ? 1 - dominant.ratio : 0;
  const issueCount =
    minorityFiles.size + mixedDirectories.length + componentMismatches.length;
  const score = Math.min(10, scoreFromRatio(imbalanceRatio + issueCount / 120, 10));

  const findings = [];
  if (minorityFiles.size > 0 && dominantStyle) {
    findings.push({
      severity: score >= 7 ? "high" : "medium",
      message: `${minorityFiles.size} files use a minority naming convention instead of ${dominantStyle}.`,
      files: [...minorityFiles].slice(0, 15)
    });
  }

  if (mixedDirectories.length > 0) {
    findings.push({
      severity: "medium",
      message: `${mixedDirectories.length} directories mix filename conventions.`,
      files: mixedDirectories.map((item) => item.directory).slice(0, 15)
    });
  }

  if (componentMismatches.length > 0) {
    findings.push({
      severity: "medium",
      message: `${componentMismatches.length} components do not match filename conventions.`,
      files: componentMismatches.map((item) => item.file).slice(0, 15)
    });
  }

  return {
    id: "naming",
    title: "NAMING INCONSISTENCY",
    score,
    severity: severityFromScore(score),
    totalIssues: issueCount,
    summary:
      dominantStyle && dominant.total
        ? `${dominantStyle} is dominant (${Math.round(dominant.ratio * 100)}%), but naming conventions are mixed.`
        : "Not enough identifiers found to determine a dominant naming convention.",
    metrics: {
      identifierStyles: stylePercentages,
      dominantIdentifierStyle: dominantStyle,
      mixedDirectoryCount: mixedDirectories.length,
      componentMismatchCount: componentMismatches.length
    },
    recommendations: [
      dominantStyle
        ? `Standardize function and variable names on ${dominantStyle}.`
        : "Pick one naming convention and enforce it consistently.",
      "Keep one filename style per directory (kebab-case recommended for files).",
      "Make component names match their filenames."
    ],
    findings,
    details: {
      minorityFiles: [...minorityFiles].slice(0, 50),
      mixedDirectories: mixedDirectories.slice(0, 25),
      componentMismatches: componentMismatches.slice(0, 25)
    },
    preferences: {
      namingStyle: dominantStyle || "camelCase",
      fileNamingStyle: mixedDirectories.length ? "kebab-case" : null
    }
  };
}

