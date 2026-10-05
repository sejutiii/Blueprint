// Structural signal extraction with Tree-sitter (SRS 3.2.3). Parses the post-change file and
// keeps the imports and declarations whose header line was added in the diff — so a new
// method inside an existing class is reported, but the unchanged class around it is not.
import * as path from "path";

// web-tree-sitter is loaded lazily and kept external to the bundle: it locates its own
// tree-sitter.wasm relative to its module file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TSParser = any;

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python",
  ".java": "java",
  ".go": "go",
  ".cs": "c_sharp",
  ".rs": "rust",
};

const JS_IMPORTS = ["import_statement"];
const JS_DECLS   = [
  "class_declaration", "abstract_class_declaration", "function_declaration",
  "generator_function_declaration", "method_definition", "interface_declaration",
  "type_alias_declaration", "enum_declaration",
];

const NODE_TYPES: Record<string, { imports: string[]; decls: string[] }> = {
  typescript: { imports: JS_IMPORTS, decls: JS_DECLS },
  tsx:        { imports: JS_IMPORTS, decls: JS_DECLS },
  javascript: { imports: JS_IMPORTS, decls: JS_DECLS },
  python:     { imports: ["import_statement", "import_from_statement"], decls: ["class_definition", "function_definition"] },
  java:       { imports: ["import_declaration"], decls: ["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "method_declaration"] },
  go:         { imports: ["import_spec"], decls: ["function_declaration", "method_declaration", "type_spec"] },
  c_sharp:    { imports: ["using_directive"], decls: ["class_declaration", "interface_declaration", "struct_declaration", "record_declaration", "enum_declaration", "method_declaration"] },
  rust:       { imports: ["use_declaration"], decls: ["function_item", "struct_item", "enum_item", "trait_item", "impl_item", "mod_item"] },
};

export interface ExtractedSignals {
  imports: string[];
  signatures: string[];
}

export function languageForFile(file: string): string | null {
  return LANGUAGE_BY_EXT[path.extname(file).toLowerCase()] ?? null;
}

let grammarDir: string | null = null;
let initPromise: Promise<TSParser | null> | null = null;
const languages = new Map<string, Promise<unknown | null>>();

/** Point the extractor at the grammar .wasm files (called on activation with the extension's path). */
export function configureGrammarDir(dir: string): void {
  grammarDir = dir;
}

function resolveGrammarDir(): string {
  if (grammarDir) { return grammarDir; }
  try {
    return path.join(path.dirname(require.resolve("tree-sitter-wasms/package.json")), "out");
  } catch {
    return path.join(process.cwd(), "node_modules", "tree-sitter-wasms", "out");
  }
}

async function getParserModule(): Promise<TSParser | null> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Parser = require("web-tree-sitter");
        await Parser.init();
        return Parser;
      } catch (err) {
        console.error("BluePrint: Tree-sitter unavailable, using regex diff parsing.", err);
        return null;
      }
    })();
  }
  return initPromise;
}

async function getLanguage(Parser: TSParser, name: string): Promise<unknown | null> {
  if (!languages.has(name)) {
    languages.set(name, Parser.Language.load(path.join(resolveGrammarDir(), `tree-sitter-${name}.wasm`))
      .catch((err: unknown) => {
        console.error(`BluePrint: could not load Tree-sitter grammar "${name}".`, err);
        return null;
      }));
  }
  return languages.get(name)!;
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, 120);

// The module an import comes from is the architectural signal, so a long `{ A, B, C, … }`
// list is collapsed rather than letting truncation cut off the `from "module"` part.
function importLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? oneLine(flat.replace(/\{[^}]*\}/, "{…}")) : flat;
}

// Declaration header: up to the body opener, so "class Foo extends Bar {" → "class Foo extends Bar".
function header(text: string): string {
  const first = text.split(/\r?\n/)[0];
  return oneLine(first.replace(/\s*[{:]\s*$/, "").replace(/\s*\{.*$/, ""));
}

/**
 * Returns null when the file's language is unsupported or Tree-sitter can't be loaded,
 * so the caller can fall back to regex extraction for that file.
 * `addedLines` are 1-based; pass null to treat every line as added (a brand-new file).
 */
export async function extractSignals(
  file: string,
  source: string,
  addedLines: Set<number> | null,
  options: { topLevelOnly?: boolean } = {}
): Promise<ExtractedSignals | null> {
  const langName = languageForFile(file);
  if (!langName) { return null; }

  const Parser = await getParserModule();
  if (!Parser) { return null; }
  const language = await getLanguage(Parser, langName);
  if (!language) { return null; }

  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  const types = NODE_TYPES[langName];
  const isAdded = (row: number) => !addedLines || addedLines.has(row + 1);

  const imports: string[] = [];
  const signatures: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visit = (node: any, depth: number): void => {
    if (depth > 12) { return; }
    if (types.imports.includes(node.type)) {
      if (isAdded(node.startPosition.row)) { imports.push(importLine(node.text)); }
      return;
    }
    if (isRequireCall(langName, node) && isAdded(node.startPosition.row)) {
      // `const x = require("y")`: report the whole declaration, not just the call.
      imports.push(oneLine(node.parent?.type === "variable_declarator" ? node.parent.parent.text : node.text));
    }
    const isDecl = types.decls.includes(node.type);
    if (isDecl && isAdded(node.startPosition.row)) {
      // Keep the "export" keyword when the declaration is wrapped in an export statement.
      const target = node.parent?.type === "export_statement" ? node.parent : node;
      const text = header(target.text);
      // `type X = A | B | C` — the name is the signal; the union is noise.
      signatures.push(node.type === "type_alias_declaration" ? text.replace(/\s*=.*$/, "") : text);
    } else if (isArrowConst(langName, node) && isAdded(node.startPosition.row)) {
      const target = node.parent?.type === "export_statement" ? node.parent : node;
      signatures.push(header(target.text).replace(/\s*=>.*$/, " =>"));
    }
    // Top-level mode (codebase overview): don't descend into declarations, so class members
    // and nested functions are skipped. Go's type_spec sits inside type_declaration, so allow it.
    if (options.topLevelOnly && (isDecl || isArrowConst(langName, node))) { return; }
    for (const child of node.namedChildren) { visit(child, depth + 1); }
  };
  visit(tree.rootNode, 0);
  tree.delete();
  parser.delete();

  return { imports: [...new Set(imports)], signatures: [...new Set(signatures)] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRequireCall(lang: string, node: any): boolean {
  return (lang === "javascript" || lang === "typescript" || lang === "tsx")
    && node.type === "call_expression"
    && node.childForFieldName("function")?.text === "require";
}

// `const handler = async (req) => {...}` — a function in all but name.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isArrowConst(lang: string, node: any): boolean {
  if (!(lang === "javascript" || lang === "typescript" || lang === "tsx")) { return false; }
  if (node.type !== "lexical_declaration") { return false; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return node.namedChildren.some((d: any) => {
    const value = d.childForFieldName?.("value");
    return value && (value.type === "arrow_function" || value.type === "function_expression" || value.type === "function");
  });
}
