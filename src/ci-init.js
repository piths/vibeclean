import fs from "node:fs/promises";
import path from "node:path";

function workflowTemplate(options = {}) {
  const profile = options.profile || "app";
  const baselineFile = options.baselineFile || ".vibeclean-baseline.json";
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 70;
  const maxIssues = Number.isFinite(options.maxIssues) ? options.maxIssues : 35;
  const failOn = options.failOn || "high";
  const baseRef = options.baseRef || "origin/main";

  return `name: vibeclean

on:
  pull_request:
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install deps
        run: npm ci

      - name: Run vibeclean
        id: vibeclean
        run: |
          npx vibeclean . \\
            --profile ${profile} \\
            --changed --base ${baseRef} \\
            --baseline --baseline-file ${baselineFile} \\
            --fail-on ${failOn} --min-score ${minScore} --max-issues ${maxIssues} \\
            --report markdown --report-file vibeclean-report.md

      - name: Write job summary
        if: always()
        run: |
          if [ -f vibeclean-report.md ]; then
            cat vibeclean-report.md >> "$GITHUB_STEP_SUMMARY"
          fi

      - name: Comment on PR
        if: always() && github.event_name == 'pull_request'
        continue-on-error: true
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require("fs");
            if (!fs.existsSync("vibeclean-report.md")) return;
            const body = fs.readFileSync("vibeclean-report.md", "utf8");
            const marker = "<!-- vibeclean-report -->";
            const fullBody = marker + "\\n" + body;
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
            });
            const existing = comments.find((c) => c.body?.includes(marker));
            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body: fullBody,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body: fullBody,
              });
            }

      - name: Upload report artifact
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: vibeclean-report
          path: vibeclean-report.md
`;
}

export async function generateCiWorkflow(rootDir, options = {}) {
  const workflowPath = path.join(rootDir, ".github", "workflows", "vibeclean.yml");
  await fs.mkdir(path.dirname(workflowPath), { recursive: true });

  if (!options.force) {
    try {
      await fs.stat(workflowPath);
      return {
        path: workflowPath,
        created: false,
        skipped: true
      };
    } catch {
      // File does not exist: proceed.
    }
  }

  await fs.writeFile(workflowPath, workflowTemplate(options), "utf8");
  return {
    path: workflowPath,
    created: true,
    skipped: false
  };
}
