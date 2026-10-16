import type Parser from "tree-sitter";
import type { Entry } from "./model.js";

type Node = Parser.SyntaxNode;

interface ProfileOptions {
  /** Suppress the code-specific fallback message for an empty outline. */
  emptyOutline?: "empty";
  hasError?: (root: Node, signal?: AbortSignal) => boolean;
}

/** Shared traversal still requires explicit, language-specific recognition. */
export interface DeclarationProfile extends ProfileOptions {
  kind: "declarations";
  extractNodes: (node: Node, source: string, signal?: AbortSignal) => Entry[];
  isDocComment?: (node: Node, source: string) => boolean;
}

/** Languages with different traversal/range semantics replace extraction. */
export interface CustomProfile extends ProfileOptions {
  kind: "custom";
  extract: (root: Node, source: string, signal?: AbortSignal) => Entry[];
}

export type LanguageProfile = DeclarationProfile | CustomProfile;
