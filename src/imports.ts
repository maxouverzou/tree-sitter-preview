import type { Entry, RenderedLine } from "./model.js";
interface Trie {
  children: Map<string, Trie>;
  leaves: Entry[];
}
/** Only distinct side-effect paths can share a compact path-list line. */
export function renderImports(entries: Entry[]): RenderedLine[] {
  if (entries.every((entry) => entry.importPaths))
    return renderPathImports(entries);
  const groups = new Map<string, Trie>();
  for (const entry of entries) {
    const info = entry.importInfo;
    if (
      !info ||
      info.keyword !== "import" ||
      info.bindings !== "import" ||
      info.path.includes("\\")
    )
      continue;
    const key = `${info.keyword}\0${info.separator}`;
    let trie: Trie = groups.get(key) ?? { children: new Map(), leaves: [] };
    groups.set(key, trie);
    for (const part of info.path.split(info.separator)) {
      let child: Trie | undefined = trie.children.get(part);
      if (!child) {
        child = { children: new Map(), leaves: [] };
        trie.children.set(part, child);
      }
      trie = child;
    }
    trie.leaves.push(entry);
  }
  const replacements = new Map<Entry, RenderedLine>();
  const consumed = new Set<Entry>();
  function visit(trie: Trie, prefix: string[], separator: string): void {
    const leaves = [...trie.children.values()];
    if (
      prefix.length &&
      !trie.leaves.length &&
      leaves.length > 1 &&
      leaves.every((t) => !t.children.size && t.leaves.length === 1)
    ) {
      const items = leaves.map((t) => t.leaves[0]!);
      // Preserve declaration order within a group; only combine adjacent items.
      items.sort((a, b) => entries.indexOf(a) - entries.indexOf(b));
      const start = entries.indexOf(items[0]!);
      if (items.every((e, i) => entries[start + i] === e)) {
        const base = prefix.join(separator) + separator;
        replacements.set(items[0]!, {
          text: `import paths ${JSON.stringify(base)}: ${items.map((e) => JSON.stringify(e.importInfo!.path.slice(base.length))).join(", ")}`,
          ranges: items.map((e) => e.range),
        });
        for (const item of items.slice(1)) consumed.add(item);
        return;
      }
    }
    for (const [part, child] of trie.children)
      visit(child, [...prefix, part], separator);
  }
  for (const [key, trie] of groups) visit(trie, [], key.split("\0")[1]!);
  return entries
    .filter((e) => !consumed.has(e))
    .map((e) => replacements.get(e) ?? { text: e.text, ranges: [e.range] });
}

interface PathTrie {
  children: Map<string, PathTrie>;
  leaves: Set<Entry>;
}

/** Maki-style dotted Python import trie, with lossless source metadata. */
function renderPathImports(entries: Entry[]): RenderedLine[] {
  const root: PathTrie = { children: new Map(), leaves: new Set() };
  for (const entry of entries) {
    for (const path of entry.importPaths ?? []) {
      let node = root;
      for (const part of path) {
        let child = node.children.get(part);
        if (!child) {
          child = { children: new Map(), leaves: new Set() };
          node.children.set(part, child);
        }
        node = child;
      }
      node.leaves.add(entry);
    }
  }
  type PathLine = { text: string; entries: Set<Entry> };
  const rendered = new Map<PathTrie, PathLine[]>();
  const pending = [{ node: root, segment: "", visited: false }];
  while (pending.length) {
    const item = pending.pop()!;
    const children = [...item.node.children.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    if (!item.visited) {
      pending.push({ ...item, visited: true });
      for (const [segment, node] of children)
        pending.push({ node, segment, visited: false });
      continue;
    }
    const lines = children.flatMap(([, child]) => rendered.get(child)!);
    for (const [, child] of children) rendered.delete(child);
    if (item.node === root) {
      rendered.set(root, lines);
    } else if (item.node.leaves.size) {
      rendered.set(item.node, [
        { text: item.segment, entries: item.node.leaves },
        ...lines.map((line) => ({
          ...line,
          text: `${item.segment}.${line.text}`,
        })),
      ]);
    } else if (lines.length === 1) {
      rendered.set(item.node, [
        { ...lines[0]!, text: `${item.segment}.${lines[0]!.text}` },
      ]);
    } else {
      rendered.set(item.node, [
        {
          text: `${item.segment}.{${lines.map((line) => line.text).join(", ")}}`,
          entries: new Set(lines.flatMap((line) => [...line.entries])),
        },
      ]);
    }
  }
  return rendered.get(root)!.map((line) => ({
    text: line.text,
    ranges: [...line.entries]
      .sort((a, b) => a.range.startLine - b.range.startLine)
      .map((entry) => entry.range),
  }));
}
