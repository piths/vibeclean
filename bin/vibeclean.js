#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { runAudit } from "../src/index.js";
import { writeBaselineSnapshot } from "../src/baseline.js";
import { renderMarkdownReport } from "../src/markdown-report.js";
import { renderReport } from "../src/reporter.js";

async function readToolVersion() {
  const currentFile = fileURLToPath(import.meta.url);
  const rootDir = path.resolve(path.dirname(currentFile), "..");
  try {
    const raw = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed.version || "1.0.0";
  } catch {
    return "1.0.0";
  }
}

async function main() {
  const version = await readToolVersion();

  const program = new Command();
  program
    .name("vibeclean")
    .description("Audit your codebase for the mess vibe coding left behind.")
    .version(version, "-v, --version", "Show version")
    .argument("[directory]", "Project directory to scan", process.cwd())
    .option("-f, --fix", "Apply safe autofixes before scoring (TODO/commented code/noisy console)")
    .option("--json", "Output results as JSON")
    .option("--report <format>", "Output format: text, json, markdown", "text")
    .option("--report-file <path>", "Write report output to file")
    .option("--profile <name>", "Preset profile: app, library, cli", "app")
    .option("--changed", "Scan only changed files in the current git working tree")
    .option("--base <ref>", "Git base ref to diff against when using --changed", "HEAD")
    .option("--baseline", "Compare current report against a baseline snapshot file")
    .option("--baseline-file <path>", "Baseline file path for compare/write", ".vibeclean-baseline.json")
    .option("--write-baseline", "Write current report to the baseline snapshot file")
    .option("--rules", "Generate .vibeclean-rules.md file")
    .option("--cursor", "Also generate .cursorrules file")
    .option("--claude", "Also generate CLAUDE.md file")
    .option("--min-severity <level>", "Minimum severity to report: low, medium, high", "low")
    .option("--fail-on <level>", "Fail with exit code 1 if findings reach this severity: low, medium, high")
    .option("--max-issues <n>", "Fail with exit code 1 if total issues exceed this number")
    .option("--min-score <n>", "Fail with exit code 1 if overall score falls below this threshold (0-100)")
    .option("--ignore <patterns>", "Additional patterns to ignore (comma-separated)")
    .option("--max-files <n>", "Maximum files to scan", "500")
    .option("-q, --quiet", "Only show summary, not individual issues")
    .action(async (directory, options) => {
      const spinner = ora("Running vibeclean diagnostics...").start();

      try {
        const result = await runAudit(directory, {
          ...options,
          maxFiles: Number.parseInt(options.maxFiles, 10),
          maxIssues: Number.parseInt(options.maxIssues, 10),
          minScore: Number.parseInt(options.minScore, 10),
          profile: options.profile,
          baseline: Boolean(options.baseline),
          baselineFile: options.baselineFile,
          reportFormat: options.report,
          reportFile: options.reportFile || null,
          changedOnly: Boolean(options.changed),
          changedBase: options.base,
          minSeverity: options.minSeverity,
          failOn: options.failOn,
          version
        });

        spinner.stop();

        let baselineWriteResult = null;
        if (options.writeBaseline) {
          baselineWriteResult = await writeBaselineSnapshot(
            result.rootDir,
            options.baselineFile,
            result.report
          );
        }

        const reportFormat = options.json
          ? "json"
          : String(result.config?.reportFormat || options.report || "text").toLowerCase();
        const payload = {
          report: result.report,
          generatedRules: result.generatedRules
        };

        if (reportFormat === "json") {
          const jsonOutput = JSON.stringify(payload, null, 2);
          if (options.reportFile) {
            await fs.writeFile(options.reportFile, `${jsonOutput}\n`, "utf8");
            console.log(chalk.green(`Saved JSON report to ${options.reportFile}`));
          } else {
            console.log(jsonOutput);
          }
        } else if (reportFormat === "markdown") {
          const markdownOutput = renderMarkdownReport(result.report);
          if (options.reportFile) {
            await fs.writeFile(options.reportFile, markdownOutput, "utf8");
            console.log(chalk.green(`Saved Markdown report to ${options.reportFile}`));
          } else {
            console.log(markdownOutput);
          }
        } else {
          console.log(renderReport(result.report, { quiet: Boolean(options.quiet) }));

          if (result.generatedRules?.length) {
            console.log("");
            console.log(chalk.green.bold("  📋 Generated rule files"));
            for (const item of result.generatedRules) {
              console.log(`  ${chalk.green("✓")} ${item.path}`);
            }
          }

          if (baselineWriteResult) {
            console.log("");
            console.log(chalk.green.bold("  📌 Baseline updated"));
            console.log(`  ${chalk.green("✓")} ${baselineWriteResult.path}`);
          }

          if (result.report.gateFailures?.length) {
            console.log("");
            console.log(chalk.red.bold("  ⛔ Quality gates failed"));
            for (const failure of result.report.gateFailures) {
              console.log(`  ${chalk.red("•")} ${failure}`);
            }
          }
        }

        if (baselineWriteResult && reportFormat !== "text") {
          console.log(chalk.green(`Baseline updated: ${baselineWriteResult.path}`));
        }

        if (result.report.gateFailures?.length) {
          process.exitCode = 1;
        }
      } catch (error) {
        spinner.fail("vibeclean failed");
        console.error(chalk.red(error?.message || "Unknown error"));
        process.exitCode = 1;
      }
    });

  await program.parseAsync(process.argv);
}

main();
