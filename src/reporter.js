import chalk from "chalk";

function colorForScore(score) {
  if (score >= 7) {
    return chalk.red;
  }
  if (score >= 4) {
    return chalk.yellow;
  }
  return chalk.green;
}

function iconForScore(score) {
  if (score >= 7) {
    return "🚨";
  }
  if (score >= 1) {
    return "⚠️";
  }
  return "✅";
}

function divider() {
  return chalk.gray("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

function renderFindings(category) {
  const findings = Array.isArray(category.findings) ? category.findings.slice(0, 2) : [];
  const lines = [];

  for (const finding of findings) {
    lines.push(
      `   ${chalk.gray("•")} ${chalk.bold(
        `[${(finding.severity || "low").toUpperCase()}]`
      )} ${finding.message}`
    );

    const locations = Array.isArray(finding.locations) ? finding.locations.slice(0, 2) : [];
    for (const location of locations) {
      const snippet = location.snippet ? ` ${chalk.gray(`— ${location.snippet}`)}` : "";
      lines.push(`     ${chalk.gray("↳")} ${location.file}:${location.line}${snippet}`);
    }
  }

  return lines;
}

function categoryDetailLines(category) {
  const metrics = category.metrics || {};

  switch (category.id) {
    case "naming": {
      const styles = metrics.identifierStyles || [];
      const top = styles
        .slice(0, 2)
        .map((item) => `${item.style}: ${item.percent}% (${item.count})`)
        .join(", ");
      return [
        top ? `├─ ${top}` : "├─ Not enough identifier samples",
        `├─ Mixed directories: ${metrics.mixedDirectoryCount || 0}`,
        `└─ Component filename mismatches: ${metrics.componentMismatchCount || 0}`
      ];
    }

    case "patterns": {
      const httpClients = metrics.httpClients || {};
      const httpText = Object.entries(httpClients)
        .map(([name, count]) => `${name} (${count})`)
        .join(", ");
      const asyncTotal = (metrics.asyncAwaitOps || 0) + (metrics.thenChains || 0);
      const asyncAwaitPct = asyncTotal
        ? Math.round(((metrics.asyncAwaitOps || 0) / asyncTotal) * 100)
        : 100;
      const thenPct = asyncTotal ? 100 - asyncAwaitPct : 0;
      return [
        `├─ HTTP clients: ${httpText || "none detected"}`,
        `├─ Mixed async: async/await (${asyncAwaitPct}%), .then() (${thenPct}%)`,
        `└─ Module style: import files ${metrics.filesUsingImport || 0}, require files ${metrics.filesUsingRequire || 0}`
      ];
    }

    case "leftovers":
      return [
        `├─ console.* statements: ${metrics.consoleCount || 0}`,
        `├─ TODO/FIXME markers: ${metrics.todoCount || 0} (${metrics.aiTodoCount || 0} AI-like)`,
        `└─ Placeholders/localhost: ${(metrics.placeholderCount || 0) + (metrics.localhostCount || 0)}`
      ];

    case "dependencies":
      return [
        `├─ Unused packages: ${metrics.unusedCount || 0}`,
        `├─ Duplicate groups: ${(metrics.duplicateGroups || []).length}`,
        `└─ Estimated savings: ~${metrics.estimatedSavingsMb || 0}MB`
      ];

    case "deadcode":
      return [
        `├─ Orphan files: ${(metrics.orphanFiles || []).length}`,
        `├─ Unused exports: ${(metrics.unusedExports || []).length}`,
        `└─ Stub files: ${(metrics.stubFiles || []).length}`
      ];

    case "errorhandling":
      return [
        `├─ Functions with try/catch: ${metrics.handledRate || 0}%`,
        `├─ Empty catch blocks: ${metrics.emptyCatch || 0}`,
        `└─ Unhandled await signals: ${metrics.unhandledAwait || 0}`
      ];

    default:
      return ["└─ No details available"];
  }
}

function renderCategory(category, options = {}) {
  const color = colorForScore(category.score);
  const scoreText = color(`Score: ${category.score}/10`);

  const header = `${iconForScore(category.score)}  ${chalk.bold(category.title.padEnd(42))} ${scoreText}`;

  if (options.quiet) {
    return `${header}\n${chalk.gray(`   ${category.summary}`)}`;
  }

  const detailLines = categoryDetailLines(category);
  const findingLines = renderFindings(category);
  const recommendation = category.recommendations?.[0]
    ? `   ${chalk.cyan(`Recommendation: ${category.recommendations[0]}`)}`
    : "";

  return [header, ...detailLines.map((line) => `   ${line}`), ...findingLines, recommendation]
    .filter(Boolean)
    .join("\n");
}

export function renderReport(report, options = {}) {
  const lines = [];

  lines.push(`  🧹 ${chalk.bold(`vibeclean v${report.version}`)} ${chalk.gray("— Cleaning up the vibe")}`);
  lines.push("");
  lines.push(
    `  Scanning project... ${chalk.green("✓")} Found ${chalk.bold(report.fileCount)} source files in ${chalk.bold(`${report.durationSec}s`)}`
  );

  if (report.scanWarnings?.length) {
    for (const warning of report.scanWarnings.slice(0, 6)) {
      lines.push(`  ${chalk.yellow("•")} ${chalk.yellow(warning)}`);
    }
    if (report.scanWarnings.length > 6) {
      lines.push(`  ${chalk.yellow("•")} ${chalk.yellow(`+${report.scanWarnings.length - 6} more warnings`)}`);
    }
  }

  lines.push("");
  lines.push(`  ${divider()}`);
  lines.push("");

  for (const category of report.categories) {
    lines.push(`  ${renderCategory(category, options)}`);
    lines.push("");
  }

  lines.push(`  ${divider()}`);
  lines.push("");

  const overallColor =
    report.overallScore >= 80
      ? chalk.green
      : report.overallScore >= 60
        ? chalk.yellow
        : chalk.red;

  lines.push(`  📊 ${chalk.bold("VIBE CLEANLINESS SCORE")}: ${overallColor.bold(`${report.overallScore}/100`)}`);
  lines.push(`     ${overallColor(report.overallMessage)}`);
  lines.push("");
  lines.push(`  🧹 Found ${chalk.bold(report.totalIssues)} issues across ${chalk.bold(report.categories.length)} categories`);

  if (report.fixesApplied?.filesChanged > 0) {
    const fixStats = report.fixesApplied;
    lines.push(
      `  🛠️  Applied safe fixes in ${chalk.bold(fixStats.filesChanged)} files (${fixStats.removedTodoLines} TODO/comments, ${fixStats.removedConsoleLines} console lines, ${fixStats.removedCommentedCodeLines} commented code lines)`
    );
  }

  if (!report.rulesGenerated) {
    lines.push(`  📋 Run ${chalk.bold("vibeclean --rules")} to generate AI rules file`);
  }

  return lines.join("\n");
}

