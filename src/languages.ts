import { extname } from "node:path";
import JavaScriptGrammar from "tree-sitter-javascript";
import TypeScriptGrammars from "tree-sitter-typescript";
import MarkdownGrammar from "@tree-sitter-grammars/tree-sitter-markdown";
import PythonGrammar from "tree-sitter-python";
import GoGrammar from "tree-sitter-go";

export type Language =
  "javascript" | "jsx" | "typescript" | "tsx" | "markdown" | "python" | "go";
export function detectLanguage(path: string): Language {
  const ext = extname(path).toLowerCase();
  if ([".js", ".mjs", ".cjs"].includes(ext)) return "javascript";
  if (ext === ".jsx") return "jsx";
  if ([".ts", ".mts", ".cts"].includes(ext)) return "typescript";
  if (ext === ".tsx") return "tsx";
  if ([".md", ".markdown"].includes(ext)) return "markdown";
  if ([".py", ".pyi"].includes(ext)) return "python";
  if (ext === ".go") return "go";
  throw new Error(
    `Unsupported extension ${ext || "(none)"}; use JS, JSX, TS, TSX, Markdown (.md, .markdown), Python (.py, .pyi), or Go (.go).`,
  );
}
const grammars: Record<Language, unknown> = {
  javascript: JavaScriptGrammar,
  jsx: JavaScriptGrammar,
  typescript: TypeScriptGrammars.typescript,
  tsx: TypeScriptGrammars.tsx,
  markdown: MarkdownGrammar,
  python: PythonGrammar,
  go: GoGrammar,
};

export function loadGrammar(language: Language): unknown {
  return grammars[language];
}
