import { severityFromScore, scoreFromRatio } from "./utils.js";

const MAX_LOCATIONS = 12;

function hasImport(content, pattern) {
  return pattern.test(content);
}

function lineNumberAtIndex(content, index) {
  return content.slice(0, index).split("\n").length;
}

function lineSnippet(content, lineNumber) {
  return (content.split("\n")[lineNumber - 1] || "").trim().slice(0, 160);
}

function collectMatches(file, regex, limit = MAX_LOCATIONS) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const probe = new RegExp(regex.source, flags);
  const locations = [];
  const seen = new Set();
  let count = 0;

  for (const match of file.content.matchAll(probe)) {
    count += 1;
    if (locations.length >= limit) {
      continue;
    }

    const index = typeof match.index === "number" ? match.index : 0;
    const line = lineNumberAtIndex(file.content, index);
    const key = `${file.relativePath}:${line}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    locations.push({
      file: file.relativePath,
      line,
      snippet: lineSnippet(file.content, line)
    });
  }

  return { count, locations };
}

function addFinding(findings, severity, message, locations = []) {
  findings.push({
    severity,
    message,
    locations: locations.slice(0, MAX_LOCATIONS)
  });
}

function detectFrameworks(files, packageJson = {}) {
  const deps = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {})
  };

  let react = "react" in deps || "react-dom" in deps;
  let next = "next" in deps;
  let express = "express" in deps;

  for (const file of files) {
    const content = file.content;
    if (
      !react &&
      hasImport(content, /from\s+["'`]react["'`]|require\(\s*["'`]react["'`]\s*\)/)
    ) {
      react = true;
    }
    if (
      !next &&
      hasImport(content, /from\s+["'`]next(?:\/[^"'`]+)?["'`]|require\(\s*["'`]next(?:\/[^"'`]+)?["'`]\s*\)/)
    ) {
      next = true;
    }
    if (
      !express &&
      hasImport(content, /from\s+["'`]express["'`]|require\(\s*["'`]express["'`]\s*\)/)
    ) {
      express = true;
    }
  }

  return {
    react,
    next,
    express
  };
}

export function analyzeFrameworks(files, context = {}) {
  const frameworkUse = detectFrameworks(files, context.packageJson || {});
  const findings = [];

  let reactDangerousHtmlCount = 0;
  let reactAsyncUseEffectCount = 0;
  let reactIndexKeyCount = 0;
  let nextLegacyDataCount = 0;
  let nextRouterInAppDirCount = 0;
  let expressWildcardCorsCount = 0;
  let expressErrorLeakCount = 0;
  let expressSyncFsInRouteCount = 0;

  const reactDangerousLocations = [];
  const reactAsyncEffectLocations = [];
  const reactIndexKeyLocations = [];
  const nextLegacyLocations = [];
  const nextRouterAppLocations = [];
  const expressCorsLocations = [];
  const expressErrorLeakLocations = [];
  const expressSyncFsLocations = [];

  for (const file of files) {
    const { content, relativePath } = file;
    const inAppDir = relativePath.startsWith("app/");

    if (frameworkUse.react) {
      const dangerous = collectMatches(file, /dangerouslySetInnerHTML\s*=\s*\{\s*\{/g);
      reactDangerousHtmlCount += dangerous.count;
      reactDangerousLocations.push(...dangerous.locations);

      const asyncEffect = collectMatches(file, /useEffect\s*\(\s*async\s*\(/g);
      reactAsyncUseEffectCount += asyncEffect.count;
      reactAsyncEffectLocations.push(...asyncEffect.locations);

      const indexKey = collectMatches(file, /\bkey\s*=\s*\{?\s*index\s*\}?/g);
      reactIndexKeyCount += indexKey.count;
      reactIndexKeyLocations.push(...indexKey.locations);
    }

    if (frameworkUse.next) {
      const legacyData = collectMatches(file, /\bgetInitialProps\b/g);
      nextLegacyDataCount += legacyData.count;
      nextLegacyLocations.push(...legacyData.locations);

      if (inAppDir) {
        const routerImport = collectMatches(file, /from\s+["'`]next\/router["'`]/g);
        nextRouterInAppDirCount += routerImport.count;
        nextRouterAppLocations.push(...routerImport.locations);
      }
    }

    if (frameworkUse.express) {
      const corsWildcard = collectMatches(file, /\bapp\.use\s*\(\s*cors\s*\(\s*\)\s*\)/g);
      expressWildcardCorsCount += corsWildcard.count;
      expressCorsLocations.push(...corsWildcard.locations);

      const errorLeak = collectMatches(file, /\bres\.(?:send|json)\s*\(\s*err(?:or)?\s*\)/g);
      expressErrorLeakCount += errorLeak.count;
      expressErrorLeakLocations.push(...errorLeak.locations);

      if (/(?:app|router)\.(?:get|post|put|patch|delete)\s*\(/.test(content)) {
        const syncFs = collectMatches(file, /\bfs\.(?:readFileSync|writeFileSync)\s*\(/g);
        expressSyncFsInRouteCount += syncFs.count;
        expressSyncFsLocations.push(...syncFs.locations);
      }
    }
  }

  if (reactDangerousHtmlCount > 0) {
    addFinding(
      findings,
      "high",
      `${reactDangerousHtmlCount} React dangerouslySetInnerHTML usage(s) found.`,
      reactDangerousLocations
    );
  }
  if (reactAsyncUseEffectCount > 0) {
    addFinding(
      findings,
      "medium",
      `${reactAsyncUseEffectCount} async useEffect callback pattern(s) found.`,
      reactAsyncEffectLocations
    );
  }
  if (reactIndexKeyCount > 0) {
    addFinding(
      findings,
      reactIndexKeyCount >= 8 ? "medium" : "low",
      `${reactIndexKeyCount} React list key(s) appear to use array index.`,
      reactIndexKeyLocations
    );
  }
  if (nextLegacyDataCount > 0) {
    addFinding(
      findings,
      "medium",
      `${nextLegacyDataCount} Next.js getInitialProps usage(s) found (legacy API).`,
      nextLegacyLocations
    );
  }
  if (nextRouterInAppDirCount > 0) {
    addFinding(
      findings,
      "medium",
      `${nextRouterInAppDirCount} next/router import(s) found under app/ directory.`,
      nextRouterAppLocations
    );
  }
  if (expressWildcardCorsCount > 0) {
    addFinding(
      findings,
      "medium",
      `${expressWildcardCorsCount} Express cors() middleware usage(s) with default wildcard policy found.`,
      expressCorsLocations
    );
  }
  if (expressErrorLeakCount > 0) {
    addFinding(
      findings,
      "high",
      `${expressErrorLeakCount} Express response(s) appear to directly return error objects.`,
      expressErrorLeakLocations
    );
  }
  if (expressSyncFsInRouteCount > 0) {
    addFinding(
      findings,
      "medium",
      `${expressSyncFsInRouteCount} synchronous fs call(s) found inside Express route files.`,
      expressSyncFsLocations
    );
  }

  const detectedFrameworks = Object.entries(frameworkUse)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  const weightedSignals =
    reactDangerousHtmlCount * 2 +
    reactAsyncUseEffectCount +
    reactIndexKeyCount * 0.5 +
    nextLegacyDataCount +
    nextRouterInAppDirCount +
    expressWildcardCorsCount +
    expressErrorLeakCount * 2 +
    expressSyncFsInRouteCount * 1.2;
  const score = Math.min(10, scoreFromRatio(weightedSignals / Math.max(files.length * 0.7, 1), 10));

  const noFrameworkDetected = detectedFrameworks.length === 0;
  return {
    id: "frameworks",
    title: "FRAMEWORK ANTI-PATTERNS",
    score: noFrameworkDetected ? 0 : score,
    severity: noFrameworkDetected ? "low" : severityFromScore(score),
    totalIssues: findings.length,
    summary: noFrameworkDetected
      ? "No supported frameworks detected (React, Next.js, Express)."
      : findings.length > 0
        ? `Detected ${findings.length} framework-specific anti-pattern signals.`
        : "No major framework-specific anti-patterns detected.",
    metrics: {
      detectedFrameworks,
      reactDangerousHtmlCount,
      reactAsyncUseEffectCount,
      reactIndexKeyCount,
      nextLegacyDataCount,
      nextRouterInAppDirCount,
      expressWildcardCorsCount,
      expressErrorLeakCount,
      expressSyncFsInRouteCount
    },
    recommendations: [
      "Apply framework-specific best practices and avoid legacy APIs.",
      "Use explicit sanitization for HTML injection and avoid returning raw errors.",
      "Avoid synchronous I/O in request/response paths."
    ],
    findings,
    skipped: noFrameworkDetected
  };
}
