# Contributing to vibeclean

## Setup

1. Install Node.js 18+
2. Install dependencies:

```bash
npm install
```

3. Run locally:

```bash
node ./bin/vibeclean.js
```

## Development Guidelines

- Keep dependencies minimal and lightweight.
- Maintain ESM (`"type": "module"`) style.
- Keep analyzers resilient: parse failures should warn, not crash.
- Prefer actionable output over noisy output.

## Project Structure

- `bin/vibeclean.js`: CLI entry point
- `src/scanner.js`: file scanning and ignore handling
- `src/analyzers/*`: rule analyzers
- `src/reporter.js`: terminal output formatting
- `src/rules-generator.js`: AI rules file generation
- `src/config.js`: `.vibecleanrc` loading and merge

## Pull Requests

- Include a clear problem statement and scope.
- Include before/after CLI output when behavior changes.
- Keep changes focused and avoid unrelated refactors.

## Code of Conduct

Be respectful and constructive. We are here to make AI-assisted coding cleaner for everyone.
