import fs from "node:fs/promises";
import path from "node:path";

function countFindingsBySeverity(categories = []) {
  const counts = {
    low: 0,
    medium: 0,
    high: 0
  };

  for (const category of categories) {
    for (const finding of category.findings || []) {
      const severity = finding.severity || "low";
      if (severity in counts) {
        counts[severity] += 1;
      } else {
        counts.low += 1;
      }
    }
  }

  return counts;
}

function categorySnapshot(categories = []) {
  const map = {};
  for (const category of categories) {
    map[category.id] = {
      score: category.score,
      totalIssues: category.totalIssues,
      severity: category.severity
    };
  }
  return map;
}

export function resolveBaselinePath(rootDir, baselineFile = ".vibeclean-baseline.json") {
  if (path.isAbsolute(baselineFile)) {
    return baselineFile;
  }
  return path.join(rootDir, baselineFile);
}

export function buildBaselineSnapshot(report) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    overallScore: report.overallScore,
    totalIssues: report.totalIssues,
    findingCounts: countFindingsBySeverity(report.categories),
    categories: categorySnapshot(report.categories)
  };
}

export async function readBaselineSnapshot(rootDir, baselineFile) {
  const fullPath = resolveBaselinePath(rootDir, baselineFile);
  const raw = await fs.readFile(fullPath, "utf8");
  return {
    path: fullPath,
    snapshot: JSON.parse(raw)
  };
}

export async function writeBaselineSnapshot(rootDir, baselineFile, report) {
  const fullPath = resolveBaselinePath(rootDir, baselineFile);
  const snapshot = buildBaselineSnapshot(report);
  await fs.writeFile(fullPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return {
    path: fullPath,
    snapshot
  };
}

export function compareAgainstBaseline(report, baselineSnapshot) {
  const currentFindingCounts = countFindingsBySeverity(report.categories);
  const baselineFindingCounts = baselineSnapshot.findingCounts || {
    low: 0,
    medium: 0,
    high: 0
  };

  const deltas = {
    score: report.overallScore - (baselineSnapshot.overallScore || 0),
    totalIssues: report.totalIssues - (baselineSnapshot.totalIssues || 0),
    highFindings: currentFindingCounts.high - (baselineFindingCounts.high || 0),
    mediumFindings: currentFindingCounts.medium - (baselineFindingCounts.medium || 0)
  };

  const regressions = [];
  if (deltas.score < 0) {
    regressions.push(
      `Baseline regression: overall score dropped by ${Math.abs(deltas.score)} (from ${baselineSnapshot.overallScore} to ${report.overallScore}).`
    );
  }
  if (deltas.totalIssues > 0) {
    regressions.push(
      `Baseline regression: total issues increased by ${deltas.totalIssues} (from ${baselineSnapshot.totalIssues} to ${report.totalIssues}).`
    );
  }
  if (deltas.highFindings > 0) {
    regressions.push(
      `Baseline regression: high-severity findings increased by ${deltas.highFindings}.`
    );
  }

  const baselineCategoryMap = baselineSnapshot.categories || {};
  const worsenedCategories = [];
  for (const category of report.categories) {
    const previous = baselineCategoryMap[category.id];
    if (!previous) {
      continue;
    }
    const scoreDelta = category.score - (previous.score || 0);
    if (scoreDelta > 0) {
      worsenedCategories.push(`${category.id} (+${scoreDelta})`);
    }
  }

  if (worsenedCategories.length > 0) {
    regressions.push(
      `Baseline regression: category scores worsened in ${worsenedCategories.join(", ")}.`
    );
  }

  return {
    baselineGeneratedAt: baselineSnapshot.generatedAt || null,
    baselineScore: baselineSnapshot.overallScore ?? null,
    baselineTotalIssues: baselineSnapshot.totalIssues ?? null,
    currentScore: report.overallScore,
    currentTotalIssues: report.totalIssues,
    deltas,
    regressions
  };
}
