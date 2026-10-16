import Parser from "tree-sitter";
import { loadGrammar, type Language } from "./languages.js";
import type { SourceRange } from "./model.js";
export function parseSource(source: string, language: Language): Parser.Tree {
  const parser = new Parser();
  parser.setLanguage(loadGrammar(language));
  parser.setTimeoutMicros(1_000_000);
  // 0.21's default string buffer rejects long chunks; a bounded UTF-16
  // callback also avoids allocating a second full native input buffer.
  const tree = parser.parse((index) => source.slice(index, index + 16 * 1024));
  if (!tree) throw new Error("Parsing exceeded the one-second native timeout.");
  return tree;
}
export function sourceRange(
  node: Pick<Parser.SyntaxNode, "startPosition" | "endPosition">,
): SourceRange {
  return {
    startLine: node.startPosition.row + 1,
    endLine: Math.max(
      node.startPosition.row + 1,
      node.endPosition.row + (node.endPosition.column === 0 ? 0 : 1),
    ),
  };
}
