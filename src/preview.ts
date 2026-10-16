import type Parser from "tree-sitter";

/** Compact layout whitespace, but never whitespace inside literal tokens. */
export function compactSource(
  node: Parser.SyntaxNode,
  source: string,
  end = node.endIndex,
): string {
  const literals: Parser.SyntaxNode[] = [];
  const pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.startIndex >= end) continue;
    if (["string", "template_string", "regex"].includes(current.type)) {
      literals.push(current);
    } else {
      const children = current.namedChildren;
      for (let index = children.length - 1; index >= 0; index--)
        pending.push(children[index]!);
    }
  }
  let cursor = node.startIndex;
  let result = "";
  for (const literal of literals) {
    result += source.slice(cursor, literal.startIndex).replace(/\s+/g, " ");
    result += source.slice(literal.startIndex, Math.min(literal.endIndex, end));
    cursor = Math.min(literal.endIndex, end);
  }
  return (result + source.slice(cursor, end).replace(/\s+/g, " ")).trim();
}

/** Maki-style bounded previews; count code points so Unicode stays intact. */
export function preview(text: string, max: number): string {
  const characters = Array.from(text);
  if (characters.length <= max) return text;
  const cut = characters.slice(0, Math.max(0, max - 11)).join("");
  return cut + (cut.includes("\n") ? "\n" : "") + "[truncated]";
}
