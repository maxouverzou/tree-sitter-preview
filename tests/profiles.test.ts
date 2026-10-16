import { describe, expect, it, vi } from "vitest";
import { extract } from "../src/extract.js";
import { parseSource } from "../src/parser.js";
import { profileFor, extractWithProfile } from "../src/profiles.js";
import { typescriptProfile } from "../src/typescript.js";
import { pythonProfile } from "../src/python.js";
import { markdownProfile } from "../src/markdown.js";
import type { DeclarationProfile, CustomProfile } from "../src/profile.js";
import type { Entry } from "../src/model.js";

const entry = (): Entry => ({
  section: "functions",
  kind: "example",
  text: "example()",
  range: { startLine: 2, endLine: 2 },
});

describe("explicit language profiles", () => {
  it.each(["javascript", "jsx", "typescript", "tsx"] as const)(
    "%s explicitly selects JS/TS recognition",
    (language) => expect(profileFor(language)).toBe(typescriptProfile),
  );

  it("selects independent overrides for Python and Markdown", () => {
    expect(profileFor("python")).toBe(pythonProfile);
    expect(profileFor("markdown")).toBe(markdownProfile);
    expect(pythonProfile.kind).toBe("custom");
    expect(markdownProfile.kind).toBe("custom");
  });

  it("shared traversal uses only the supplied recognition and doc predicates", () => {
    const source = "// language-specific docs\nconst x = 1;";
    const root = parseSource(source, "javascript").rootNode;
    const extractNodes = vi.fn(() => [entry()]);
    const profile: DeclarationProfile = {
      kind: "declarations",
      isDocComment: (node) => node.type === "comment",
      extractNodes,
    };
    const controller = new AbortController();
    const entries = extract(root, source, profile, controller.signal);
    expect(entries).toEqual([
      { ...entry(), range: { startLine: 1, endLine: 2 } },
    ]);
    expect(extractNodes).toHaveBeenCalledExactlyOnceWith(
      root.namedChildren[1],
      source,
      controller.signal,
    );
    // A declaration is not recognized merely because JS/TS would recognize it.
    expect(
      extract(root, source, {
        kind: "declarations",
        extractNodes: () => [],
      }),
    ).toEqual([]);
  });

  it("does not assume JSDoc or any other documentation convention", () => {
    const source = "/** not implicitly attached */\nconst x = 1;";
    const root = parseSource(source, "javascript").rootNode;
    const entries = extract(root, source, {
      kind: "declarations",
      extractNodes: (node) =>
        node.type === "lexical_declaration" ? [entry()] : [],
    });
    expect(entries[0]!.range.startLine).toBe(2);
  });

  it("dispatches full overrides without shared traversal", () => {
    const source = "const x = 1;";
    const root = parseSource(source, "javascript").rootNode;
    const entries = [entry()];
    const override = vi.fn(() => entries);
    const profile: CustomProfile = { kind: "custom", extract: override };
    const signal = new AbortController().signal;
    expect(extractWithProfile(profile, root, source, signal)).toBe(entries);
    expect(override).toHaveBeenCalledExactlyOnceWith(root, source, signal);
  });

  it("checks pre-aborted shared extraction even for an empty root", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      extractWithProfile(
        typescriptProfile,
        parseSource("", "typescript").rootNode,
        "",
        controller.signal,
      ),
    ).toThrow();
  });
});
