import { severityFromScore, scoreFromRatio, countMatches, parseAst } from "./utils.js";

function countAwaitStats(fileContent) {
  const ast = parseAst(fileContent);
  if (!ast) {
    return { totalAwait: countMatches(fileContent, /\bawait\b/g), unhandledAwait: 0 };
  }

  const counters = {
    totalAwait: 0,
    unhandledAwait: 0
  };

  function hasCatchChain(node) {
    if (!node || typeof node !== "object") {
      return false;
    }

    if (
      node.type === "CallExpression" &&
      node.callee?.type === "MemberExpression" &&
      !node.callee.computed &&
      node.callee.property?.type === "Identifier" &&
      node.callee.property.name === "catch"
    ) {
      return true;
    }

    if (node.type === "CallExpression" && node.callee?.type === "MemberExpression") {
      return hasCatchChain(node.callee.object);
    }

    return false;
  }

  function visit(node, inTryBlock = false) {
    if (!node || typeof node !== "object") {
      return;
    }

    if (node.type === "AwaitExpression") {
      counters.totalAwait += 1;
      if (!inTryBlock && !hasCatchChain(node.argument)) {
        counters.unhandledAwait += 1;
      }
    }

    if (node.type === "TryStatement") {
      visit(node.block, true);
      if (node.handler) {
        visit(node.handler, false);
      }
      if (node.finalizer) {
        visit(node.finalizer, false);
      }
      return;
    }

    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child?.type) {
            visit(child, inTryBlock);
          }
        }
      } else if (value?.type) {
        visit(value, inTryBlock);
      }
    }
  }

  visit(ast, false);
  return counters;
}

export function analyzeErrorHandling(files) {
  let totalFunctions = 0;
  let tryBlocks = 0;
  let catchBlocks = 0;
  let emptyCatch = 0;
  let catchLogOnly = 0;
  let unhandledAwait = 0;
  let thenChains = 0;
  let catchChains = 0;
  let throwCount = 0;
  let returnNullCount = 0;
  let returnErrorObjectCount = 0;
  let totalAwait = 0;

  for (const file of files) {
    const content = file.content;

    totalFunctions += countMatches(
      content,
      /(?:async\s+)?function\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(|\b[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|\([^)]*\)\s*=>\s*\{/g
    );

    tryBlocks += countMatches(content, /\btry\s*\{/g);
    catchBlocks += countMatches(content, /\bcatch\s*\(/g);

    emptyCatch += countMatches(content, /catch\s*\([^)]*\)\s*\{\s*\}/gs);
    catchLogOnly += countMatches(
      content,
      /catch\s*\([^)]*\)\s*\{\s*console\.(?:log|warn|error|debug)\([^)]*\);?\s*\}/gs
    );

    const awaitStats = countAwaitStats(content);
    totalAwait += awaitStats.totalAwait;
    unhandledAwait += awaitStats.unhandledAwait;

    thenChains += countMatches(content, /\.then\s*\(/g);
    catchChains += countMatches(content, /\.catch\s*\(/g);

    throwCount += countMatches(content, /\bthrow\b/g);
    returnNullCount += countMatches(content, /return\s+null\b/g);
    returnErrorObjectCount += countMatches(content, /return\s+\{\s*error\s*[:}]|return\s+error\b/g);
  }

  const functionsWithTry = Math.min(totalFunctions, tryBlocks);
  const handledRate = totalFunctions ? Math.round((functionsWithTry / totalFunctions) * 100) : 100;
  const promiseWithoutCatch = Math.max(0, thenChains - catchChains);

  const findings = [];
  if (handledRate < 60) {
    findings.push({
      severity: handledRate < 40 ? "high" : "medium",
      message: `Only ${handledRate}% of detected functions use try/catch.`
    });
  }

  if (emptyCatch > 0) {
    findings.push({
      severity: "high",
      message: `${emptyCatch} empty catch blocks found.`
    });
  }

  if (catchLogOnly > 0) {
    findings.push({
      severity: "medium",
      message: `${catchLogOnly} catch blocks only log errors and do not recover or rethrow.`
    });
  }

  if (unhandledAwait > 0) {
    findings.push({
      severity: "high",
      message: `${unhandledAwait} await calls appear to be outside local try/catch context.`
    });
  }

  if (promiseWithoutCatch > 0) {
    findings.push({
      severity: "medium",
      message: `${promiseWithoutCatch} promise chains appear to miss .catch() handling.`
    });
  }

  const mixedPatterns =
    (throwCount > 0 ? 1 : 0) +
    (returnNullCount > 0 ? 1 : 0) +
    (returnErrorObjectCount > 0 ? 1 : 0);

  if (mixedPatterns > 1) {
    findings.push({
      severity: "medium",
      message: "Mixed error return patterns detected (throw, return null, and/or return error objects)."
    });
  }

  const awaitRisk = totalAwait ? (unhandledAwait / totalAwait) * 2 : 0;
  const promiseRisk = thenChains ? (promiseWithoutCatch / thenChains) * 2 : 0;
  const signal =
    (handledRate < 50 ? (50 - handledRate) / 18 : 0) +
    emptyCatch * 1.5 +
    catchLogOnly +
    awaitRisk +
    promiseRisk;

  const score = Math.min(10, scoreFromRatio(signal / Math.max(files.length * 0.8, 1), 10));

  return {
    id: "errorhandling",
    title: "ERROR HANDLING",
    score,
    severity: severityFromScore(score),
    totalIssues: findings.length,
    summary:
      findings.length > 0
        ? "Inconsistent error handling patterns detected in async and promise code paths."
        : "Error handling patterns look reasonably consistent.",
    metrics: {
      totalFunctions,
      functionsWithTry,
      handledRate,
      tryBlocks,
      catchBlocks,
      emptyCatch,
      catchLogOnly,
      totalAwait,
      unhandledAwait,
      promiseWithoutCatch,
      throwCount,
      returnNullCount,
      returnErrorObjectCount
    },
    recommendations: [
      "Wrap async operations in try/catch and surface errors consistently.",
      "Avoid empty catch blocks and catch-and-log-only handlers.",
      "Use one error propagation pattern across the codebase."
    ],
    findings
  };
}

