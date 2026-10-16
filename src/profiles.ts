import type Parser from "tree-sitter";
import type { Language } from "./languages.js";
import type { LanguageProfile } from "./profile.js";
import { extract } from "./extract.js";
import { typescriptProfile } from "./typescript.js";
import { pythonProfile } from "./python.js";
import { markdownProfile } from "./markdown.js";
import { goProfile } from "./go.js";

/** Exhaustive registry: adding a grammar never implicitly enables extraction. */
const profiles: Record<Language, LanguageProfile> = {
  javascript: typescriptProfile,
  jsx: typescriptProfile,
  typescript: typescriptProfile,
  tsx: typescriptProfile,
  python: pythonProfile,
  markdown: markdownProfile,
  go: goProfile,
};

export function profileFor(language: Language): LanguageProfile {
  return profiles[language];
}

export function extractWithProfile(
  profile: LanguageProfile,
  root: Parser.SyntaxNode,
  source: string,
  signal?: AbortSignal,
) {
  return profile.kind === "custom"
    ? profile.extract(root, source, signal)
    : extract(root, source, profile, signal);
}
