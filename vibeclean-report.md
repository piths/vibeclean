# Vibeclean PR Report

- **Score:** 75/100
- **Total Issues:** 28
- **Files Scanned:** 16
- **Profile:** cli
- **Quality Gates:** FAIL
- **Duration:** 0.15s
- **Baseline:** score 75 -> 75 (+0), issues 28 -> 28 (+0)

## Category Summary

| Category | Score | Severity | Issues |
|---|---:|---|---:|
| NAMING INCONSISTENCY | 2/10 | LOW | 16 |
| PATTERN INCONSISTENCY | 4/10 | MEDIUM | 2 |
| AI LEFTOVERS | 0/10 | LOW | 1 |
| DEPENDENCY ISSUES | 0/10 | LOW | 0 |
| DEAD CODE | 5/10 | MEDIUM | 5 |
| ERROR HANDLING | 4/10 | MEDIUM | 4 |

## Top Findings

- [HIGH] `errorhandling` Only 12% of detected functions use try/catch.
- [HIGH] `errorhandling` 18 await calls appear to be outside local try/catch context.
- [MEDIUM] `naming` 16 files use a minority naming convention instead of camelCase.
- [MEDIUM] `patterns` Mixed async styles: async/await (45) and .then() chains (10).
- [MEDIUM] `patterns` Mixed module systems: ES modules in 15 files and require() in 1 files.
- [MEDIUM] `deadcode` 5 exports are never imported.
- [MEDIUM] `errorhandling` 9 promise chains appear to miss .catch() handling.
- [MEDIUM] `errorhandling` Mixed error return patterns detected (throw, return null, and/or return error objects).

## Gate Failures

- Severity gate failed: found 2 finding(s) at high severity or higher.
