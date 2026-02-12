function escapePipes(value = "") {
  return String(value).replace(/\|/g, "\\|");
}

function topFindings(categories, limit = 8) {
  const rows = [];
  for (const category of categories || []) {
    for (const finding of category.findings || []) {
      rows.push({
        category: category.id,
        severity: finding.severity || "low",
        message: finding.message || ""
      });
    }
  }

  const severityRank = { high: 3, medium: 2, low: 1 };
  rows.sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0));
  return rows.slice(0, limit);
}

export function renderMarkdownReport(report) {
  const lines = [];
  const gateStatus = report.passedGates ? "PASS" : "FAIL";

  lines.push("# Vibeclean PR Report");
  lines.push("");
  lines.push(`- **Score:** ${report.overallScore}/100`);
  lines.push(`- **Total Issues:** ${report.totalIssues}`);
  lines.push(`- **Files Scanned:** ${report.fileCount}`);
  lines.push(`- **Profile:** ${report.profile || "app"}`);
  lines.push(`- **Quality Gates:** ${gateStatus}`);
  lines.push(`- **Duration:** ${report.durationSec}s`);

  if (report.baselineComparison && !report.baselineComparison.missing) {
    const deltas = report.baselineComparison.deltas || {};
    const scoreDelta = Number.isFinite(deltas.score) ? deltas.score : 0;
    const issueDelta = Number.isFinite(deltas.totalIssues) ? deltas.totalIssues : 0;
    lines.push(
      `- **Baseline:** score ${report.baselineComparison.baselineScore} -> ${report.baselineComparison.currentScore} (${scoreDelta >= 0 ? "+" : ""}${scoreDelta}), issues ${report.baselineComparison.baselineTotalIssues} -> ${report.baselineComparison.currentTotalIssues} (${issueDelta >= 0 ? "+" : ""}${issueDelta})`
    );
  } else if (report.baselineComparison?.missing) {
    lines.push(`- **Baseline:** missing (${report.baselineComparison.path})`);
  }

  lines.push("");
  lines.push("## Category Summary");
  lines.push("");
  lines.push("| Category | Score | Severity | Issues |");
  lines.push("|---|---:|---|---:|");
  for (const category of report.categories || []) {
    lines.push(
      `| ${escapePipes(category.title)} | ${category.score}/10 | ${String(
        category.severity || "low"
      ).toUpperCase()} | ${category.totalIssues || 0} |`
    );
  }

  const findings = topFindings(report.categories);
  if (findings.length > 0) {
    lines.push("");
    lines.push("## Top Findings");
    lines.push("");
    for (const finding of findings) {
      lines.push(
        `- [${String(finding.severity).toUpperCase()}] \`${finding.category}\` ${finding.message}`
      );
    }
  }

  if (report.gateFailures?.length) {
    lines.push("");
    lines.push("## Gate Failures");
    lines.push("");
    for (const failure of report.gateFailures) {
      lines.push(`- ${failure}`);
    }
  }

  if (report.scanWarnings?.length) {
    lines.push("");
    lines.push("## Scan Warnings");
    lines.push("");
    for (const warning of report.scanWarnings.slice(0, 10)) {
      lines.push(`- ${warning}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
