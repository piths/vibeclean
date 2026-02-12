#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { runAudit } from "../src/index.js";
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
    .option("--changed", "Scan only changed files in the current git working tree")
    .option("--base <ref>", "Git base ref to diff against when using --changed", "HEAD")
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
          changedOnly: Boolean(options.changed),
          changedBase: options.base,
          minSeverity: options.minSeverity,
          failOn: options.failOn,
          version
        });

        spinner.stop();

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                report: result.report,
                generatedRules: result.generatedRules
              },
              null,
              2
            )
          );
          if (result.report.gateFailures?.length) {
            process.exitCode = 1;
          }
          return;
        }


        if (result.generatedRules?.length) {
          for (const item of result.generatedRules) {
          }
        }

        if (result.report.gateFailures?.length) {
          for (const failure of result.report.gateFailures) {
          }
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

