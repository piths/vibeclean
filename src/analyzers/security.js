import { severityFromScore, scoreFromRatio } from "./utils.js";

const MAX_LOCATIONS = 12;

const SECURITY_PATTERNS = [
  {
    id: "privateKey",
    severity: "high",
    label: "private key material",
    regex: /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/g
  },
  {
    id: "awsAccessKey",
    severity: "high",
    label: "AWS access keys",
    regex: /\bAKIA[0-9A-Z]{16}\b/g
  },
  {
    id: "npmToken",
    severity: "high",
    label: "npm tokens",
    regex: /\bnpm_[A-Za-z0-9]{36}\b/g
  },
  {
    id: "githubPat",
    severity: "high",
    label: "GitHub personal access tokens",
    regex: /\bghp_[A-Za-z0-9]{36}\b/g
  },
  {
    id: "dbCredentialsUrl",
    severity: "high",
    label: "database URLs with inline credentials",
    regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s]+:[^@\s]+@/gi
  },
  {
    id: "slackWebhook",
    severity: "high",
    label: "Slack webhook URLs",
    regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g
  },
  {
    id: "jwtLike",
    severity: "medium",
    label: "JWT-like tokens",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
  },
  {
    id: "genericSecretAssignment",
    severity: "medium",
    label: "hardcoded credential assignments",
    regex: /\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["'`][^"'`\n]{8,}["'`]/gi
  }
];

function lineNumberAtIndex(content, index) {
  return content.slice(0, index).split("\n").length;
}

function lineSnippet(content, lineNumber) {
  return (content.split("\n")[lineNumber - 1] || "").trim().slice(0, 160);
}

function isDetectorDefinitionLine(content, index) {
  const lineNumber = lineNumberAtIndex(content, index);
  const line = (content.split("\n")[lineNumber - 1] || "").trim();
  const prevLine = (content.split("\n")[lineNumber - 2] || "").trim();

  if (/^const\s+[A-Z_]+(?:_RE|_PATTERN)\s*=/.test(line) && /\/.+\/[gimsuy]*;?$/.test(line)) {
    return true;
  }
  if (/^\/.+\/[gimsuy]*;?$/.test(line) && /^const\s+[A-Z_]+(?:_RE|_PATTERN)\s*=\s*$/.test(prevLine)) {
    return true;
  }
  return false;
}

function shannonEntropy(value) {
  if (!value) {
    return 0;
  }

  const map = new Map();
  for (const char of value) {
    map.set(char, (map.get(char) || 0) + 1);
  }

  let entropy = 0;
  for (const count of map.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function collectPatternHits(file, pattern, remainingCapacity) {
  const flags = pattern.regex.flags.includes("g") ? pattern.regex.flags : `${pattern.regex.flags}g`;
  const probe = new RegExp(pattern.regex.source, flags);
  const locations = [];
  const seen = new Set();
  let count = 0;

  for (const match of file.content.matchAll(probe)) {
    const index = typeof match.index === "number" ? match.index : 0;
    const raw = match[0] || "";
    if (isDetectorDefinitionLine(file.content, index)) {
      continue;
    }

    if (
      pattern.id === "genericSecretAssignment" &&
      /\b(example|dummy|replace_me|your-|test|localhost)\b/i.test(raw)
    ) {
      continue;
    }

    count += 1;
    if (locations.length >= remainingCapacity) {
      continue;
    }

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

function detectHighEntropyStrings(file, remainingCapacity) {
  const regex = /["'`]([A-Za-z0-9+/=_-]{24,})["'`]/g;
  let count = 0;
  const seen = new Set();
  const locations = [];

  for (const match of file.content.matchAll(regex)) {
    const candidate = match[1] || "";
    if (
      /^(?:[a-f0-9]{32,}|[0-9a-f]{8}-[0-9a-f-]{27,}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(candidate)
    ) {
      continue;
    }

    const entropy = shannonEntropy(candidate);
    if (entropy < 3.8) {
      continue;
    }

    const index = typeof match.index === "number" ? match.index : 0;
    if (isDetectorDefinitionLine(file.content, index)) {
      continue;
    }

    count += 1;
    if (locations.length >= remainingCapacity) {
      continue;
    }

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

export function analyzeSecurity(files) {
  const findings = [];
  let highCount = 0;
  let mediumCount = 0;
  let entropyCount = 0;
  const filesWithSignals = new Set();

  for (const pattern of SECURITY_PATTERNS) {
    let count = 0;
    const locations = [];

    for (const file of files) {
      const hit = collectPatternHits(file, pattern, MAX_LOCATIONS - locations.length);
      if (hit.count > 0) {
        filesWithSignals.add(file.relativePath);
      }
      count += hit.count;
      locations.push(...hit.locations);
    }

    if (count === 0) {
      continue;
    }

    if (pattern.severity === "high") {
      highCount += count;
    } else {
      mediumCount += count;
    }

    findings.push({
      severity: pattern.severity,
      message: `${count} potential ${pattern.label} detected.`,
      locations
    });
  }

  const entropyLocations = [];
  for (const file of files) {
    const entropyHits = detectHighEntropyStrings(file, MAX_LOCATIONS - entropyLocations.length);
    entropyCount += entropyHits.count;
    if (entropyHits.count > 0) {
      filesWithSignals.add(file.relativePath);
      entropyLocations.push(...entropyHits.locations);
    }
  }
  if (entropyCount > 0) {
    mediumCount += entropyCount;
    findings.push({
      severity: "medium",
      message: `${entropyCount} high-entropy hardcoded strings found (review for secrets).`,
      locations: entropyLocations
    });
  }

  const weightedSignal = highCount * 2 + mediumCount;
  const score = Math.min(10, scoreFromRatio(weightedSignal / Math.max(files.length * 0.8, 1), 10));

  return {
    id: "security",
    title: "SECURITY EXPOSURE",
    score,
    severity: severityFromScore(score),
    totalIssues: highCount + mediumCount,
    summary:
      highCount + mediumCount > 0
        ? `${highCount + mediumCount} potential secret exposure signals detected.`
        : "No obvious hardcoded secret exposure detected.",
    metrics: {
      highSeveritySignals: highCount,
      mediumSeveritySignals: mediumCount,
      entropySignals: entropyCount,
      filesWithSignals: filesWithSignals.size
    },
    recommendations: [
      "Move secrets into environment variables or secret managers.",
      "Rotate exposed credentials immediately and revoke compromised tokens.",
      "Use runtime configuration injection instead of hardcoding credentials."
    ],
    findings
  };
}
