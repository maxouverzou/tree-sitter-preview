export type Section =
  | "imports"
  | "modules"
  | "constants"
  | "types"
  | "variables"
  | "functions"
  | "implementations"
  | "headings"
  | "classes"
  | "moduleDoc";
export interface SourceRange {
  startLine: number;
  endLine: number;
}
export interface Entry {
  section: Section;
  kind: string;
  text: string;
  range: SourceRange;
  attributes?: string[];
  children?: Entry[];
  importPaths?: string[][];
  importInfo?: {
    keyword: string;
    path: string;
    separator: string;
    bindings?: string;
  };
}
export interface RenderedLine {
  text: string;
  ranges: SourceRange[];
}
export interface OutlineDetails {
  kind: "file" | "directory";
  path: string;
  language?: string;
  sourceLineCount?: number;
  entryCount: number;
  parseError: boolean;
  lines: { outputLine: number; ranges: SourceRange[] }[];
  truncated: boolean;
  omittedLines: number;
  omittedEntries: number;
  fullOutputPath?: string;
}
