import type Parser from "tree-sitter";
import type { Entry } from "./model.js";
import type { DeclarationProfile } from "./profile.js";
import { checkAbort } from "./limits.js";
export function extract(
  root: Parser.SyntaxNode,
  source: string,
  profile: DeclarationProfile,
  signal?: AbortSignal,
): Entry[] {
  checkAbort(signal);
  const entries: Entry[] = [];
  let pending: Parser.SyntaxNode | undefined;
  let previous: Parser.SyntaxNode | undefined;
  for (const node of root.namedChildren) {
    checkAbort(signal);
    const gap = previous
      ? source.slice(previous.endIndex, node.startIndex)
      : "";
    if (/\n\s*\n/.test(gap)) pending = undefined;
    if (profile.isDocComment?.(node, source)) {
      pending ??= node;
    } else {
      const found = profile.extractNodes(node, source, signal);
      if (pending && found[0])
        found[0].range.startLine = pending.startPosition.row + 1;
      entries.push(...found);
      pending = undefined;
    }
    previous = node;
  }
  return entries;
}
