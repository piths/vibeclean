import fs from "node:fs/promises";
import path from "node:path";
import { scanProject } from "./scanner.js";
import { loadConfig, mergeConfig } from "./config.js";
import { analyzeNaming } from "./analyzers/naming.js";
import { analyzePatterns } from "./analyzers/patterns.js";
import { analyzeLeftovers } from "./analyzers/leftovers.js";
import { analyzeSecurity } from "./analyzers/security.js";
import { analyzeDependencies } from "./analyzers/dependencies.js";
import { analyzeDeadCode } from "./analyzers/deadcode.js";
import { analyzeErrorHandling } from "./analyzers/errorhandling.js";
import { analyzeTsQuality } from "./analyzers/tsquality.js";
import { generateRulesFiles } from "./rules-generator.js";
import { parseAstWithMeta } from "./analyzers/utils.js";
import { applySafeFixes } from "./fixers/safe-fixes.js";
import { compareAgainstBaseline, readBaselineSnapshot, resolveBaselinePath } from "./baseline.js";

const SEVERITY_RANK = {
  low: 1,
  medium: 2,
  high: 3
};

async function loadPackageJson(rootDir) {
  const packagePath = path.join(rootDir, "package.json");
  try {
    const raw = await fs.readFile(packagePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function overallMessage(overallScore) {
  if (overallScore >= 85) {
    return "Clean and consistent. Keep the vibe under control.";
  }
  if (overallScore >= 65) {
    return "Some inconsistency debt exists. A cleanup pass is worth it.";
  }
  if (overallScore >= 40) {
    return "Your codebase has visible vibe coding debt and mixed patterns.";
  }
  return "Your codebase has significant vibe coding debt. Time for a cleanup sprint.";
}

function applySeverityFilter(categories, minimumSeverity = "low") {
  const threshold = SEVERITY_RANK[minimumSeverity] || SEVERITY_RANK.low;

  return categories
    .map((category) => {
      const findings = Array.isArray(category.findings) ? category.findings : [];
      const filteredFindings =
        threshold <= SEVERITY_RANK.low
          ? findings
          : findings.filter((finding) => (SEVERITY_RANK[finding.severity] || 1) >= threshold);

      const keepCategory =
        (SEVERITY_RANK[category.severity] || 1) >= threshold || filteredFindings.length > 0;

      if (!keepCategory) {
        return null;
      }

      const hasFindings = filteredFindings.length > 0;
      const totalIssuesAtSeverity = hasFindings ? filteredFindings.length : 0;

      return {
        ...category,
        findings: filteredFindings,
        totalIssues:
          threshold <= SEVERITY_RANK.low ? category.totalIssues : totalIssuesAtSeverity,
        summary:
          threshold <= SEVERITY_RANK.low || hasFindings
            ? category.summary
            : `No ${minimumSeverity}+ findings for this category.`
      };
    })
    .filter(Boolean);
}

function collectParseWarnings(files) {
  const warnings = [];
  let hiddenCount = 0;

  for (const file of files) {
    const result = parseAstWithMeta(file.content);
    if (!result.ast) {
      if (warnings.length < 40) {
        warnings.push(`Skipped AST analysis for ${file.relativePath} (syntax not parseable).`);
      } else {
        hiddenCount += 1;
      }
      continue;
    }

    if (result.usedTypeSyntaxFallback) {
      if (warnings.length < 40) {
        warnings.push(`Parsed ${file.relativePath} with TypeScript syntax fallback.`);
      } else {
        hiddenCount += 1;
      }
    }
  }

  if (hiddenCount > 0) {
    warnings.push(`${hiddenCount} additional parse warnings were suppressed.`);
  }

  return warnings;
}

function collectGateFailures(report, config) {
  const failures = [];

  if (Number.isFinite(config.minScore) && report.overallScore < config.minScore) {
    failures.push(
      `Score gate failed: overall score ${report.overallScore} is below minimum ${config.minScore}.`
    );
  }

  if (Number.isFinite(config.maxIssues) && report.totalIssues > config.maxIssues) {
    failures.push(
      `Issue gate failed: total issues ${report.totalIssues} exceeds maximum ${config.maxIssues}.`
    );
  }

  if (config.failOn) {
    const threshold = SEVERITY_RANK[config.failOn] || SEVERITY_RANK.high;
    let matched = 0;
    for (const category of report.categories) {
      for (const finding of category.findings || []) {
        const findingRank = SEVERITY_RANK[finding.severity] || SEVERITY_RANK.low;
        if (findingRank >= threshold) {
          matched += 1;
        }
      }
    }

    if (matched > 0) {
      failures.push(
        `Severity gate failed: found ${matched} finding(s) at ${config.failOn} severity or higher.`
      );
    }
  }

  return failures;
}

export async function runAudit(targetDir, cliOptions = {}) {
  const startedAt = Date.now();
  const rootDir = path.resolve(targetDir || process.cwd());

  const baseConfig = await loadConfig(rootDir);
  const config = mergeConfig(baseConfig, cliOptions);

  const scanStart = Date.now();
  const scanResult = await scanProject(rootDir, config);
  scanResult.stats.durationMs = Date.now() - scanStart;
  let fixesApplied = {
    filesChanged: 0,
    removedTodoLines: 0,
    removedCommentedCodeLines: 0,
    removedConsoleLines: 0
  };

  if (config.fix) {
    fixesApplied = await applySafeFixes(scanResult.files);
    if (fixesApplied.filesChanged > 0) {
      scanResult.warnings.push(
        `Applied safe fixes to ${fixesApplied.filesChanged} files before scoring.`
      );
    }
  }

  scanResult.warnings.push(...collectParseWarnings(scanResult.files));

  if (scanResult.files.length === 0) {
    const noFilesMessage = config.changedOnly
      ? "No changed JS/TS source files found. Nothing to clean yet."
      : "No JS/TS source files found. Nothing to clean yet.";
    return {
      rootDir,
      config,
      report: {
        version: cliOptions.version || "1.0.0",
        fileCount: 0,
        durationSec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
        categories: [],
        totalIssues: 0,
        overallScore: 100,
        overallMessage: noFilesMessage,
        scanWarnings: scanResult.warnings,
        rulesGenerated: false,
        fixesApplied,
        profile: config.profile || "app",
        gateFailures: [],
        passedGates: true
      },
      generatedRules: []
    };
  }

  const projectPackage = await loadPackageJson(rootDir);
  const context = {
    rootDir,
    packageJson: projectPackage,
    config
  };

  const enabledRules = config.rules || {};
  const categoryResults = [];

  if (enabledRules.naming !== false) {
    categoryResults.push(analyzeNaming(scanResult.files));
  }
  if (enabledRules.patterns !== false) {
    categoryResults.push(analyzePatterns(scanResult.files, context));
  }
  if (enabledRules.leftovers !== false) {
    categoryResults.push(analyzeLeftovers(scanResult.files, context));
  }
  if (enabledRules.security !== false) {
    categoryResults.push(analyzeSecurity(scanResult.files, context));
  }
  if (enabledRules.dependencies !== false) {
    categoryResults.push(await analyzeDependencies(scanResult.files, context));
  }
  if (enabledRules.deadcode !== false) {
    categoryResults.push(analyzeDeadCode(scanResult.files, context));
  }
  if (enabledRules.errorhandling !== false) {
    categoryResults.push(analyzeErrorHandling(scanResult.files, context));
  }
  if (enabledRules.tsquality !== false) {
    categoryResults.push(analyzeTsQuality(scanResult.files, context));
  }

  const filteredCategories = applySeverityFilter(categoryResults, config.severity || "low");

  const averageIssueScore = filteredCategories.length
    ? filteredCategories.reduce((sum, category) => sum + category.score, 0) / filteredCategories.length
    : 0;

  const overallScore = Math.max(0, Math.min(100, Math.round(100 - averageIssueScore * 10)));
  const totalIssues = filteredCategories.reduce((sum, category) => sum + (category.totalIssues || 0), 0);

  const report = {
    version: cliOptions.version || "1.0.0",
    rootDir,
    fileCount: scanResult.files.length,
    durationSec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    categories: filteredCategories,
    totalIssues,
    overallScore,
    overallMessage: overallMessage(overallScore),
    scanWarnings: scanResult.warnings,
    rulesGenerated: false,
    fixesApplied,
    profile: config.profile || "app"
  };

  if (config.baseline) {
    try {
      const baselineData = await readBaselineSnapshot(rootDir, config.baselineFile);
      report.baselineComparison = {
        path: baselineData.path,
        ...compareAgainstBaseline(report, baselineData.snapshot)
      };
    } catch {
      const baselinePath = resolveBaselinePath(rootDir, config.baselineFile);
      report.scanWarnings.push(`Baseline file not found or invalid: ${baselinePath}`);
      report.baselineComparison = {
        path: baselinePath,
        regressions: [],
        missing: true
      };
    }
  }

  report.gateFailures = collectGateFailures(report, config);
  if (
    config.failOnRegression !== false &&
    report.baselineComparison &&
    Array.isArray(report.baselineComparison.regressions) &&
    report.baselineComparison.regressions.length > 0
  ) {
    report.gateFailures.push(...report.baselineComparison.regressions);
  }
  report.passedGates = report.gateFailures.length === 0;

  let generatedRules = [];
  if (cliOptions.rules || cliOptions.cursor || cliOptions.claude) {
    const ruleOutput = await generateRulesFiles(report, {
      rootDir,
      cursor: Boolean(cliOptions.cursor),
      claude: Boolean(cliOptions.claude),
      config
    });
    generatedRules = ruleOutput.generated;
    report.rulesGenerated = generatedRules.length > 0;
  }

  return {
    rootDir,
    config,
    report,
    generatedRules
  };
}
