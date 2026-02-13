<p align="center">
  <img src="https://raw.githubusercontent.com/piths/vibeclean/main/assets/vibeclean-logo-transparent.png" alt="vibeclean logo" width="280">
</p>

<h1 align="center">vibeclean</h1>

<p align="center">
  Audit your codebase for the mess vibe coding left behind.
</p>

<p align="center">
  AI assistants write great code. They just write it differently every time.<br>
  <strong>vibeclean</strong> finds the inconsistencies.
</p>

## Quick Start

```bash
npx vibeclean
```

One command. Zero config.

PR-focused mode:

```bash
npx vibeclean --changed --base main
```

## What It Detects

- 🔀 Pattern inconsistencies (multiple HTTP clients, mixed async styles, mixed imports)
- 📝 Naming chaos (camelCase + snake_case + mixed file naming)
- 🗑️ AI leftovers (TODO/FIXME, console logs, placeholders, localhost URLs)
- 📦 Dependency bloat (unused packages, duplicate functionality, deprecated libs)
- 💀 Dead code (orphan files, unused exports, stubs)
- ⚠️ Error handling gaps (empty catches, unhandled async, mixed error patterns)

## Example Output

```text
  🧹 vibeclean v1.0.0 — Cleaning up the vibe

  Scanning project... ✓ Found 124 source files in 0.8s

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⚠️  NAMING INCONSISTENCY                         Score: 6/10
     ├─ camelCase: 72%, snake_case: 28%
     ├─ Mixed directories: 4
     └─ Component filename mismatches: 3

  ⚠️  PATTERN INCONSISTENCY                        Score: 8/10
     ├─ HTTP clients: fetch (12), axios (5), got (1)
     ├─ Mixed async: async/await (78%), .then() (22%)
     └─ Module style: import files 25, require files 6

  🚨 AI LEFTOVERS                                  Score: 7/10
     ├─ console.* statements: 23
     ├─ TODO/FIXME markers: 12 (8 AI-like)
     └─ Placeholders/localhost: 9

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  📊 VIBE CLEANLINESS SCORE: 38/100
     Your codebase has significant vibe coding debt.

  🧹 Found 67 issues across 6 categories
  📋 Run vibeclean --rules to generate AI rules file
```

## Vibe Cleanliness Score

Each category gets a score from `0-10` (higher = more inconsistency). `vibeclean` converts this into an overall score out of `100` (higher = cleaner).

- `80-100`: consistent and clean
- `60-79`: manageable debt
- `40-59`: visible inconsistency debt
- `<40`: significant vibe debt

## Generate Rules for AI Assistants

```bash
vibeclean --rules
vibeclean --rules --cursor --claude
```

Generated files:

- `.vibeclean-rules.md`
- `.cursorrules` (optional)
- `CLAUDE.md` (optional)

These encode your dominant project conventions so future AI-assisted code stays consistent.

## CLI Usage

```text
Usage: vibeclean [options] [directory]

Arguments:
  directory                Project directory to scan (default: current directory)

Options:
  -f, --fix               Apply safe autofixes before scoring (TODO/commented code/noisy console)
  --json                  Output results as JSON
  --report <format>       Output format: text, json, markdown (default: text)
  --report-file <path>    Write report output to file
  --profile <name>        Preset profile: app, library, cli (default: app)
  --changed               Scan only changed files in the current git working tree
  --base <ref>            Git base ref to diff against when using --changed (default: HEAD)
  --baseline              Compare against baseline file and detect regressions
  --baseline-file <path>  Baseline file path for compare/write (default: .vibeclean-baseline.json)
  --write-baseline        Write current report to baseline file
  --rules                 Generate .vibeclean-rules.md file
  --cursor                Also generate .cursorrules file
  --claude                Also generate CLAUDE.md file
  --min-severity <level>  Minimum severity: low, medium, high (default: low)
  --fail-on <level>       Fail if findings hit this severity: low, medium, high
  --max-issues <n>        Fail if total issues exceed this number
  --min-score <n>         Fail if overall score is below this threshold (0-100)
  --ignore <patterns>     Additional ignore patterns (comma-separated)
  --max-files <n>         Maximum files to scan (default: 500)
  -q, --quiet             Summary output only
  -v, --version           Show version
  -h, --help              Show help
```

## CI / PR Quality Gates

```bash
# Fail CI on high-severity findings in changed files only
vibeclean --changed --base main --fail-on high

# Fail if quality drifts too far
vibeclean --min-score 75 --max-issues 20
```

When a gate fails, vibeclean exits with status code `1`.

## Profiles

```bash
# Default
vibeclean --profile app

# Libraries: ignores common example/benchmark folders
vibeclean --profile library

# CLI projects: reduces test/bin leftovers noise
vibeclean --profile cli
```

Profiles apply sensible defaults, but you can still override with `.vibecleanrc` and `--ignore`.

## Baseline Compare

```bash
# Create baseline snapshot
vibeclean --write-baseline --baseline-file .vibeclean-baseline.json

# Compare current branch against baseline (fails on regressions by default)
vibeclean --baseline --baseline-file .vibeclean-baseline.json
```

Baseline compare tracks:
- overall score drift
- issue count drift
- high-severity finding drift
- category-level score regressions

## Markdown PR Report

```bash
# Print markdown to stdout
vibeclean --report markdown

# Write markdown report to file for PR comments/artifacts
vibeclean --report markdown --report-file vibeclean-report.md
```

## Autofix Mode

```bash
vibeclean --fix
```

Safe autofix currently removes:
- TODO/FIXME/HACK/XXX comment lines
- obvious commented-out code blocks
- standalone `console.log/debug/trace` lines

After fixes are applied, vibeclean re-scores the project and reports what changed.

## Configuration

Create `.vibecleanrc` or `.vibecleanrc.json` in project root:

```json
{
  "maxFiles": 500,
  "changedOnly": false,
  "changedBase": "main",
  "profile": "app",
  "baseline": false,
  "baselineFile": ".vibeclean-baseline.json",
  "failOnRegression": true,
  "reportFormat": "text",
  "ignore": ["scripts/", "*.test.js", "*.spec.js"],
  "severity": "medium",
  "failOn": "high",
  "maxIssues": 30,
  "minScore": 70,
  "rules": {
    "naming": true,
    "patterns": true,
    "leftovers": true,
    "dependencies": true,
    "deadcode": true,
    "errorhandling": true
  },
  "allowedPatterns": {
    "httpClient": "fetch",
    "asyncStyle": "async-await",
    "stateManagement": "zustand"
  }
}
```

## Why vibeclean?

ESLint checks syntax and style. SonarQube checks quality and vulnerabilities.

`vibeclean` checks the specific mess that AI coding creates: pattern inconsistency across sessions.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Development

```bash
npm install
npm test
node bin/vibeclean.js .
```

## License

MIT — see [`LICENSE`](LICENSE).
