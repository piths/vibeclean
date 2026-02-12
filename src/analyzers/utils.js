import * as acorn from "acorn";
import jsx from "acorn-jsx";
import * as walk from "acorn-walk";

const AcornWithJsx = acorn.Parser.extend(jsx());

const IMPORT_RE = /import\s+[^"'`]*?from\s+["'`]([^"'`]+)["'`]|import\s+["'`]([^"'`]+)["'`]/g;
const REQUIRE_RE = /require\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

function stripTypeOnlySyntax(content) {
  return content
    .replace(/\bimport\s+type\s+/g, "import ")
    .replace(/\bexport\s+type\s+\{[^}]*\}\s+from\s+["'`][^"'`]+["'`];?/g, "")
    .replace(/\b(?:export\s+)?interface\s+[A-Za-z_$][A-Za-z0-9_$]*[\s\S]*?\}\s*/g, "")
    .replace(/\b(?:export\s+)?type\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*[^;]+;/g, "")
    .replace(/\s+as\s+const\b/g, "");
}

function tryParse(content, sourceType) {
  try {
    return {
      ast: AcornWithJsx.parse(content, {
        ecmaVersion: "latest",
        sourceType,
        allowHashBang: true
      }),
      error: null
    };
  } catch (error) {
    return { ast: null, error };
  }
}

export function parseAstWithMeta(content) {
  const moduleResult = tryParse(content, "module");
  if (moduleResult.ast) {
    return { ast: moduleResult.ast, parseError: null, usedTypeSyntaxFallback: false };
  }

  const scriptResult = tryParse(content, "script");
  if (scriptResult.ast) {
    return { ast: scriptResult.ast, parseError: null, usedTypeSyntaxFallback: false };
  }

  const stripped = stripTypeOnlySyntax(content);
  if (stripped !== content) {
    const moduleStripped = tryParse(stripped, "module");
    if (moduleStripped.ast) {
      return { ast: moduleStripped.ast, parseError: moduleResult.error, usedTypeSyntaxFallback: true };
    }

    const scriptStripped = tryParse(stripped, "script");
    if (scriptStripped.ast) {
      return { ast: scriptStripped.ast, parseError: moduleResult.error, usedTypeSyntaxFallback: true };
    }
  }

  return { ast: null, parseError: moduleResult.error || scriptResult.error, usedTypeSyntaxFallback: false };
}

export function parseAst(content) {
  const result = parseAstWithMeta(content);
  return result.ast;
}

function collectIdentifiersFallback(content) {
  const names = new Set();
  const reserved = new Set([
    "if",
    "for",
    "while",
    "switch",
    "catch",
    "return",
    "function",
    "class",
    "const",
    "let",
    "var",
    "import",
    "export",
    "default",
    "new",
    "typeof"
  ]);
  const patterns = [
    /\b(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/g
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const value = match[1];
      if (!reserved.has(value)) {
        names.add(value);
      }
    }
  }

  return [...names];
}

export function traverseAst(node, onNode) {
  if (!node || typeof node !== "object") {
    return;
  }

  onNode(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (!value) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === "string") {
          traverseAst(child, onNode);
        }
      }
    } else if (value && typeof value.type === "string") {
      traverseAst(value, onNode);
    }
  }
}

export function collectIdentifiers(content) {
  const ast = parseAst(content);
  if (!ast) {
    return collectIdentifiersFallback(content);
  }

  const names = [];
  // Use acorn-walk when possible, then fall back to generic traversal for JSX-heavy files.
  try {
    walk.full(ast, (node) => {
      if (node.type === "Identifier" && typeof node.name === "string") {
        names.push(node.name);
      }
    });
  } catch {
    traverseAst(ast, (node) => {
      if (node.type === "Identifier" && typeof node.name === "string") {
        names.push(node.name);
      }
    });
  }

  return names;
}

export function collectImportSpecifiers(content) {
  const imports = new Set();

  for (const match of content.matchAll(IMPORT_RE)) {
    const spec = match[1] || match[2];
    if (spec) {
      imports.add(spec);
    }
  }

  for (const match of content.matchAll(REQUIRE_RE)) {
    if (match[1]) {
      imports.add(match[1]);
    }
  }

  return [...imports];
}

export function packageRoot(specifier) {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/")) {
    return null;
  }

  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }

  return specifier.split("/")[0];
}

export function countMatches(content, regex) {
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

export function severityFromScore(score) {
  if (score >= 7) {
    return "high";
  }
  if (score >= 4) {
    return "medium";
  }
  return "low";
}

export function scoreFromRatio(ratio, weight = 10) {
  const bounded = Math.min(1, Math.max(0, ratio));
  return Math.round(bounded * weight);
}

