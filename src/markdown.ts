import type Parser from "tree-sitter";
import type { Entry } from "./model.js";
import type { CustomProfile } from "./profile.js";

export const markdownProfile: CustomProfile = {
  kind: "custom",
  emptyOutline: "empty",
  hasError: markdownHasError,
  extract: (root, _source, signal) => extractMarkdown(root, signal),
};
import { checkAbort } from "./limits.js";

/** Match Maki's flat heading outline, with ranges covering whole sections. */
export function extractMarkdown(
  root: Parser.SyntaxNode,
  signal?: AbortSignal,
): Entry[] {
  const headings: { level: number; entry: Entry }[] = [];
  const pending = [root];
  while (pending.length) {
    checkAbort(signal);
    const node = pending.pop()!;
    if (node.type === "atx_heading" || node.type === "setext_heading") {
      const content = node.childForFieldName("heading_content");
      if (content && !content.hasError && !node.isMissing) {
        const level =
          node.type === "atx_heading"
            ? (node.text.trimStart().match(/^#+/)?.[0].length ?? 0)
            : /=+\s*$/.test(node.text)
              ? 1
              : 2;
        headings.push({
          level,
          entry: {
            section: "headings",
            kind: node.type,
            text: `${"#".repeat(level)} ${content.text.trim()}`.replace(
              /\s+/g,
              " ",
            ),
            range: {
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
            },
          },
        });
      }
    }
    // Descend into containers (quotes/lists), but code and HTML blocks contain
    // no heading nodes. The block grammar handles those exclusions for us.
    const children = node.namedChildren;
    for (let index = children.length - 1; index >= 0; index--)
      pending.push(children[index]!);
  }

  // Next same-or-shallower heading ends the section. Maki includes the final
  // empty line when the document ends with a newline (root end row + 1).
  // A reverse monotonic stack avoids a quadratic scan on heading-heavy files.
  const following: typeof headings = [];
  for (let index = headings.length - 1; index >= 0; index--) {
    checkAbort(signal);
    const current = headings[index]!;
    while (following.length && following.at(-1)!.level > current.level)
      following.pop();
    current.entry.range.endLine = following.length
      ? following.at(-1)!.entry.range.startLine - 1
      : root.endPosition.row + 1;
    following.push(current);
  }
  return headings.map(({ entry }) => entry);
}

/** The block grammar reports a missing line ending at EOF for valid Markdown. */
export function markdownHasError(
  root: Parser.SyntaxNode,
  signal?: AbortSignal,
): boolean {
  const pending = [root];
  while (pending.length) {
    checkAbort(signal);
    const node = pending.pop()!;
    if (node.isError) return true;
    if (node.isMissing) {
      if (node.type === "_line_ending" && node.startIndex === root.endIndex)
        continue;
      return true;
    }
    if (node.hasError) for (const child of node.children) pending.push(child);
  }
  return false;
}
