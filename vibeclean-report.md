# Vibeclean PR Report

- **Score:** 52/100
- **Total Issues:** 59
- **Files Scanned:** 17
- **Profile:** app
- **Quality Gates:** PASS
- **Duration:** 0.15s

## Category Summary

| Category | Score | Severity | Issues |
|---|---:|---|---:|
| NAMING INCONSISTENCY | 2/10 | LOW | 17 |
| PATTERN INCONSISTENCY | 4/10 | MEDIUM | 2 |
| AI LEFTOVERS | 10/10 | HIGH | 27 |
| DEPENDENCY ISSUES | 0/10 | LOW | 0 |
| DEAD CODE | 9/10 | HIGH | 9 |
| ERROR HANDLING | 4/10 | MEDIUM | 4 |

## Top Findings

- [HIGH] `leftovers` 19 console statements found across 2 files.
- [HIGH] `leftovers` 3 localhost URLs and 2 placeholder values found in code.
- [HIGH] `errorhandling` Only 11% of detected functions use try/catch.
- [HIGH] `errorhandling` 56 await calls appear to be outside local try/catch context.
- [MEDIUM] `naming` 17 files use a minority naming convention instead of camelCase.
- [MEDIUM] `patterns` Mixed async styles: async/await (84) and .then() chains (12).
- [MEDIUM] `patterns` Mixed module systems: ES modules in 16 files and require() in 1 files.
- [MEDIUM] `leftovers` 2 TODO/FIXME/HACK markers found (0 look AI-generated).
