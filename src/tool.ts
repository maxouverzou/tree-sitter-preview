import { open, stat, opendir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { detectLanguage } from "./languages.js";
import { parseSource } from "./parser.js";
import { profileFor, extractWithProfile } from "./profiles.js";
import { formatEntries, countEntries } from "./format.js";
import {
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_OUTPUT_LINES,
  MAX_DIRECTORY_ENTRIES,
  checkAbort,
} from "./limits.js";
import type { OutlineDetails, RenderedLine } from "./model.js";
async function snapshot(path: string, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Path is not a regular file.");
    if (info.size > MAX_INPUT_BYTES)
      throw new Error("File exceeds the 5 MiB input limit.");
    const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      checkAbort(signal);
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      checkAbort(signal);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_INPUT_BYTES)
      throw new Error("File exceeds the 5 MiB input limit.");
    const bytes = buffer.subarray(0, length);
    if (bytes.includes(0)) throw new Error("Likely binary input (NUL byte).");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("Input is not valid UTF-8 text.");
    }
  } finally {
    await handle.close();
  }
}
async function finish(
  lines: RenderedLine[],
  details: OutlineDetails,
  signal?: AbortSignal,
) {
  checkAbort(signal);
  // Reserve room for an artifact path and omission notice within both caps.
  const selected: RenderedLine[] = [];
  let bytes = 0;
  for (const line of lines) {
    const size = Buffer.byteLength(line.text) + 1;
    if (
      selected.length >= MAX_OUTPUT_LINES - 1 ||
      bytes + size > MAX_OUTPUT_BYTES - 1024
    )
      break;
    selected.push(line);
    bytes += size;
  }
  details.omittedLines = lines.length - selected.length;
  details.truncated = details.omittedLines > 0 || details.omittedEntries > 0;
  if (details.omittedLines) {
    const dir = await mkdtemp(join(tmpdir(), "pi-index-"));
    const path = join(dir, "outline.txt");
    await writeFile(path, lines.map((l) => l.text).join("\n"), { mode: 0o600 });
    details.fullOutputPath = path;
    selected.push({
      text: `Omitted ${details.omittedLines} lines. Full outline: ${path}`,
      ranges: [],
    });
  }
  checkAbort(signal);
  details.lines = selected.map((line, index) => ({
    outputLine: index + 1,
    ranges: line.ranges,
  }));
  return {
    content: [
      { type: "text" as const, text: selected.map((l) => l.text).join("\n") },
    ],
    details,
  };
}
export async function indexPath(
  path: string,
  cwd: string,
  signal?: AbortSignal,
) {
  checkAbort(signal);
  const resolved = resolve(cwd, path);
  const info = await stat(resolved);
  checkAbort(signal);
  const details: OutlineDetails = {
    kind: info.isDirectory() ? "directory" : "file",
    path: resolved,
    entryCount: 0,
    parseError: false,
    lines: [],
    truncated: false,
    omittedLines: 0,
    omittedEntries: 0,
  };
  if (info.isDirectory()) {
    const directory = await opendir(resolved);
    const items: string[] = [];
    // Keep only the lexicographically first N entries; memory is bounded even
    // on huge directories, but scanning is required for exact omitted counts.
    let total = 0;
    for await (const entry of directory) {
      checkAbort(signal);
      total++;
      const name =
        JSON.stringify(entry.name) +
        (entry.isSymbolicLink()
          ? " (symlink)"
          : entry.isDirectory()
            ? "/"
            : entry.isFile()
              ? ""
              : " (special)");
      items.push(name);
      items.sort();
      if (items.length > MAX_DIRECTORY_ENTRIES) items.pop();
    }
    details.entryCount = total;
    details.omittedEntries = total - items.length;
    const lines = items.map((text) => ({ text, ranges: [] }));
    if (!lines.length) lines.push({ text: "Empty directory.", ranges: [] });
    if (details.omittedEntries)
      lines.push({
        text: `Omitted ${details.omittedEntries} directory entries.`,
        ranges: [],
      });
    return finish(lines, details, signal);
  }
  if (!info.isFile())
    throw new Error("Path is not a regular file or directory.");
  const language = detectLanguage(resolved);
  const source = await snapshot(resolved, signal);
  checkAbort(signal);
  const tree = parseSource(source, language);
  checkAbort(signal);
  const profile = profileFor(language);
  const entries = extractWithProfile(profile, tree.rootNode, source, signal);
  details.language = language;
  details.sourceLineCount = source.length ? source.split("\n").length : 0;
  details.entryCount = countEntries(entries);
  details.parseError = profile.hasError
    ? profile.hasError(tree.rootNode, signal)
    : tree.rootNode.hasError;
  const lines =
    profile.emptyOutline === "empty" && !entries.length
      ? []
      : formatEntries(entries);
  if (details.parseError)
    lines.unshift({
      text: `Warning: syntax errors; only intact recognized ${language === "markdown" ? "headings" : "declarations"} are shown.`,
      ranges: [],
    });
  return finish(lines, details, signal);
}
