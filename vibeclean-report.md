# Vibeclean PR Report

- **Score:** 86/100
- **Total Issues:** 31
- **Files Scanned:** 20
- **Profile:** cli
- **Quality Gates:** FAIL
- **Duration:** 0.23s
- **Baseline:** score 86 -> 86 (+0), issues 31 -> 31 (+0)

## Category Summary

| Category | Score | Severity | Issues |
|---|---:|---|---:|
| NAMING INCONSISTENCY | 2/10 | LOW | 20 |
| PATTERN INCONSISTENCY | 4/10 | MEDIUM | 2 |
| AI LEFTOVERS | 1/10 | LOW | 2 |
| SECURITY EXPOSURE | 0/10 | LOW | 0 |
| FRAMEWORK ANTI-PATTERNS | 0/10 | LOW | 0 |
| DEPENDENCY ISSUES | 0/10 | LOW | 0 |
| DEAD CODE | 3/10 | LOW | 3 |
| ERROR HANDLING | 3/10 | LOW | 4 |
| TYPESCRIPT QUALITY | 0/10 | LOW | 0 |

## Top Findings

- [HIGH] `leftovers` 0 localhost URLs and 1 placeholder values found in code.
- [HIGH] `errorhandling` Only 12% of detected functions use try/catch.
- [HIGH] `errorhandling` 30 await calls appear to be outside local try/catch context.
- [MEDIUM] `naming` 20 files use a minority naming convention instead of camelCase.
- [MEDIUM] `patterns` Mixed async styles: async/await (63) and .then() chains (10).
- [MEDIUM] `patterns` Mixed module systems: ES modules in 19 files and require() in 2 files.
- [MEDIUM] `deadcode` 3 exports are never imported.
- [MEDIUM] `errorhandling` 9 promise chains appear to miss .catch() handling.

## Gate Failures

- Severity gate failed: found 3 finding(s) at high severity or higher.
