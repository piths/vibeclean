import { severityFromScore, scoreFromRatio } from "./utils.js";

const TS_EXTENSIONS = new Set([".ts", ".tsx"]);

function countMatches(content, regex) {
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

function styleOfAssertions(content, extension) {
  const asAssertions = countMatches(content, /\bas\s+[A-Za-z_$][A-Za-z0-9_$<>,\s.[\]|&?:]*/g);
  const angleAssertions =
    extension === ".ts"
      ? countMatches(content, /<\s*[A-Za-z_$][A-Za-z0-9_$<>,\s.[\]|&?:]*>\s*[A-Za-z_$][A-Za-z0-9_$]*/g)
      : 0;
  return { asAssertions, angleAssertions };
}

export function analyzeTsQuality(files) {
  const tsFiles = files.filter((file) => TS_EXTENSIONS.has(file.extension));
  if (tsFiles.length === 0) {
    return {
      id: "tsquality",
      title: "TYPESCRIPT QUALITY",
      score: 0,
      severity: "low",
      totalIssues: 0,
      summary: "No TypeScript files detected. TS-specific checks were skipped.",
      metrics: {
        tsFileCount: 0,
        explicitAnyCount: 0,
        suppressionCount: 0,
        asAssertions: 0,
        angleAssertions: 0,
        missingReturnTypeCount: 0,
        nonNullAssertionCount: 0
      },
      recommendations: [
        "Add TypeScript files to enable TS-specific consistency checks."
      ],
      findings: [],
      skipped: true
    };
  }

  let explicitAnyCount = 0;
  let suppressionCount = 0;
  let asAssertions = 0;
  let angleAssertions = 0;
  let missingReturnTypeCount = 0;
  let nonNullAssertionCount = 0;

  const filesWithAny = new Set();
  const filesWithSuppressions = new Set();

  for (const file of tsFiles) {
    const content = file.content;

    const anySignals =
      countMatches(content, /:\s*any\b/g) +
      countMatches(content, /\bas\s+any\b/g) +
      countMatches(content, /<\s*any\s*>/g);
    if (anySignals > 0) {
      explicitAnyCount += anySignals;
      filesWithAny.add(file.relativePath);
    }

    const suppressions = countMatches(content, /\/\/\s*@ts-(?:ignore|expect-error)\b/g);
    if (suppressions > 0) {
      suppressionCount += suppressions;
      filesWithSuppressions.add(file.relativePath);
    }

    const assertions = styleOfAssertions(content, file.extension);
    asAssertions += assertions.asAssertions;
    angleAssertions += assertions.angleAssertions;

    missingReturnTypeCount +=
      countMatches(content, /export\s+(?:async\s+)?function\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\([^)]*\)\s*\{/g) +
      countMatches(content, /export\s+const\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g);

    nonNullAssertionCount += countMatches(content, /\b[A-Za-z_$][A-Za-z0-9_$]*!\b/g);
  }

  const findings = [];

  if (explicitAnyCount > 0) {
    findings.push({
      severity: explicitAnyCount >= 6 ? "high" : "medium",
      message: `${explicitAnyCount} explicit any usages detected across ${filesWithAny.size} TS files.`,
      files: [...filesWithAny].slice(0, 20)
    });
  }

  if (suppressionCount > 0) {
    findings.push({
      severity: suppressionCount >= 4 ? "high" : "medium",
      message: `${suppressionCount} @ts-ignore/@ts-expect-error suppressions found.`,
      files: [...filesWithSuppressions].slice(0, 20)
    });
  }

  if (asAssertions > 0 && angleAssertions > 0) {
    findings.push({
      severity: "medium",
      message: `Mixed type assertion styles detected: "as" (${asAssertions}) and angle-bracket (${angleAssertions}).`
    });
  }

  if (missingReturnTypeCount > 0) {
    findings.push({
      severity: missingReturnTypeCount >= 8 ? "medium" : "low",
      message: `${missingReturnTypeCount} exported TS functions appear to omit explicit return types.`
    });
  }

  if (nonNullAssertionCount > 0) {
    findings.push({
      severity: nonNullAssertionCount >= 10 ? "medium" : "low",
      message: `${nonNullAssertionCount} non-null assertions found ("!").`
    });
  }

  const weightedSignal =
    explicitAnyCount * 1.6 +
    suppressionCount * 1.8 +
    missingReturnTypeCount * 0.7 +
    nonNullAssertionCount * 0.5 +
    (asAssertions > 0 && angleAssertions > 0 ? 3 : 0);
  const score = Math.min(10, scoreFromRatio(weightedSignal / Math.max(tsFiles.length * 2.5, 1), 10));

  return {
    id: "tsquality",
    title: "TYPESCRIPT QUALITY",
    score,
    severity: severityFromScore(score),
    totalIssues: findings.length,
    summary:
      findings.length > 0
        ? "TypeScript consistency and strictness issues detected."
        : "TypeScript quality signals look consistent.",
    metrics: {
      tsFileCount: tsFiles.length,
      explicitAnyCount,
      suppressionCount,
      asAssertions,
      angleAssertions,
      missingReturnTypeCount,
      nonNullAssertionCount
    },
    recommendations: [
      "Replace explicit any with specific types or generics.",
      "Use @ts-ignore/@ts-expect-error only with issue-linked justification.",
      "Keep one type assertion style and prefer explicit return types for exported APIs."
    ],
    findings
  };
}
