# Handoff: add a language to tree-sitter-index

## Assignment

Add support for **the language named in your task** to the existing extension at
`packages/tree-sitter-index/`. If no language is specified, ask before implementing.
Do not rebuild the extension from `.scratch/tree-sitter-index-plan.md`: that is an
older implementation plan, not the current language-extension contract.

The tool produces an on-demand outline of one source snapshot, with ranges an
agent can pass to `read`. It is not a repository index or semantic search engine.
Both the Pi tool and standalone CLI must support the new language through the
same implementation.

## Start with Maki research, not generic node mappings

Our extraction behavior is borrowed from **`tontinton/maki`**. Strongly prefer
using **DeepWiki on that repository** to understand how Maki handles the target
language before designing the implementation. Discover the available DeepWiki
tools through tool search; do not assume a particular tool name is available.

Useful questions to ask DeepWiki (substitute the target language):

1. Where is the language's index implementation, and does it use the default
   indexer, supply helper predicates, or completely override extraction?
2. Which declarations are recognized? What is traversed, and what is deliberately
   skipped? How are nested members, wrappers, overloads, and conditional
   declarations handled?
3. How are signatures, imports, documentation, attributes/decorators, constants,
   and tests represented? What are the section order and formatting rules?
4. What ranges are used for declarations, attached documentation, and containers?
   Does a range represent a node or a whole logical section?
5. Which tests and golden examples demonstrate the behavior? What grammar and
   node fields does the implementation rely on?

Ask for concrete source paths and examples. Relevant starting points are:

- `plugins/index/indexer.lua` — shared/default pipeline and formatting.
- `plugins/index/init.lua` — tool entry point and language dispatch.
- `plugins/index/lang/` — language modules; inspect the target module if present.
- `plugins/index/tests/lang/` — language-specific examples and expectations.

DeepWiki is a discovery aid, not authoritative proof of exact output. Where
possible, inspect the current upstream module, helpers, and tests directly;
record the source revision and paths used. Do not invent behavior if the language
has no module. Document that fact and propose a conservative scope, asking for a
decision if materially different approaches remain.

Before coding, summarize the target language's extraction contract, how it differs
from Maki's default path, and how it differs from our existing JS/TS extractor.
Aim for Maki-inspired behavior, not unsupported claims of exact compatibility.
Keep intentional fixes/deviations explicit and covered by tests. Existing Python
support, for example, fixes lossy upstream handling of relative/multiline imports.

## Understand the existing extension

Read the package's `README.md` and `ARCHITECTURE.md`, root `CONTRIBUTING.md`, and
these implementation files:

| File | Role |
| --- | --- |
| `src/languages.ts` | Language union, extension detection, static native grammar imports and mapping |
| `src/parser.ts` | Fresh parser per call, timeout, bounded UTF-16 input callback, code-node ranges |
| `src/profile.ts` | Internal `DeclarationProfile` and `CustomProfile` contracts, empty-outline and error policies |
| `src/profiles.ts` | Exhaustive language-to-profile registry and extraction dispatch |
| `src/extract.ts` | Shared top-level traversal with explicit language recognition and optional documentation predicates |
| `src/typescript.ts` | Dedicated JS/TS profile: JSDoc, grammar recognition, wrappers, signatures, structural recursion |
| `src/python.ts` | Independent Python traversal and recognition |
| `src/markdown.ts` | Independent heading traversal, section ranges, specialized error handling |
| `src/model.ts` | Plain-data entries, sections, ranges, and result details |
| `src/format.ts`, `src/imports.ts`, `src/preview.ts` | Shared formatting, import rendering, bounded previews |
| `src/tool.ts` | File/directory handling, profile-based orchestration, metadata, output limits/artifacts |
| `src/index.ts`, `src/cli.ts` | Thin Pi registration and CLI adaptation |

**“Default” means shared traversal, not a default file language or universal
language recognizer.** Our `extract.ts` requires an explicit `DeclarationProfile`
with language-specific `extractNodes` and an optional `isDocComment` predicate.
JS/TS recognition lives in the dedicated `typescript.ts` profile; its JSDoc rules
are not assumed by shared traversal. A `CustomProfile` supplies a full extraction
override instead. Registering a grammar does not enable extraction: every
supported language needs an explicit entry in `profiles.ts`. Tree-sitter node
types and fields are language-specific, and the desired outline can differ
beyond syntax recognition. Unsupported extensions remain errors.

Current examples show the permitted differences:

- **JS/TS:** top-level traversal, contiguous JSDoc attachment, known export/ambient
  wrappers, structural member recursion, declaration-node ranges.
- **Python:** full extraction replacement; initial module docstrings, uppercase
  constants, classes with direct methods, decorator rules, dotted import grouping.
  It does not reuse JS/TS JSDoc attachment or structural traversal.
- **Markdown:** full extraction replacement; headings inside containers, a flat
  outline, whole-section ranges through the next same-or-shallower heading, and
  a narrowly scoped workaround for the grammar's EOF line-ending diagnostic.

Reuse the plain-data output and orchestration, **not inappropriate language
semantics**. `profiles.ts` provides explicit dispatch through an internal,
exhaustive registry, not a public extension API. A new `src/<language>.ts` profile
can supply recognition helpers for shared traversal or a full extraction override.
JS/JSX/TS/TSX explicitly share `typescriptProfile` while keeping their separately
selected grammars. Do not introduce user-loadable executable profiles,
configuration hooks, or a plugin framework just to add one language.

## Implementation checklist

1. **Prove grammar compatibility first.** The parser is pinned to native
   `tree-sitter` **0.21.1**, not WASM. Check the proposed grammar's peer/ABI
   compatibility, exports, Node 22+ ESM loading, node fields, and prebuild/build
   requirements. Inspect actual parse trees for representative source. Do not
   upgrade all grammars or swap parser backends silently to make a dependency fit.
2. Add the compatible grammar to the package's runtime dependencies and update
   the root npm lockfile through npm. Extend the `Language` union, detection,
   grammar map, and unsupported-extension message in `src/languages.ts`. Decide
   extensions/variants from the task and Maki evidence; preserve case-insensitive
   detection. Current grammar imports are static, not lazy.
3. Implement a dedicated language profile. Choose a `DeclarationProfile` when
   shared top-level traversal and contiguous documentation attachment fit: supply
   `extractNodes` and, if needed, `isDocComment`. Choose a `CustomProfile` with an
   `extract` override when traversal or range semantics differ. Do not silently
   inherit JS/TS recognition or documentation rules. Use AST node types and fields
   for declaration recognition, not whole-file regexes. Keep
   implementation bodies out of signatures and avoid traversing arbitrary bodies
   unless the researched contract explicitly requires it. Use cancellation checks
   in loops and bound recursion; don't accidentally outline local implementation
   details as top-level declarations.
4. Emit serializable `Entry[]`. Use existing sections where semantically correct;
   extend `Section`, section order, and headers only if required. Attach children
   and attributes deliberately. Reuse previews only if their whitespace/literal
   semantics fit the language. Python intentionally compacts all signature
   whitespace; JS/TS preserves literal tokens. Neither policy is universal.
5. Register the profile in the exhaustive mapping in `src/profiles.ts`; do not
   add language-specific extraction branches to `src/tool.ts`. Decide profile
   policies explicitly: `emptyOutline: "empty"` suppresses the code-specific
   fallback message (as Python/Markdown do); omitting it retains that message.
   Omit `hasError` to use the root error flag unless a demonstrated grammar defect
   needs a narrow, tested override (as Markdown does). Retain intact declarations
   from malformed input.
6. Inspect import rendering before reusing it. `importInfo` currently serves
   conservative JS/TS side-effect grouping; `importPaths` serves Python's dotted
   trie. Neither is a universal import model. Preserve aliases, bindings,
   modifiers, and source metadata; extend shared rendering only when necessary
   and verify existing language output remains unchanged.
7. Add language tests and a CLI case. Update the package README with user-facing
   supported syntax, examples, and limitations. Put Maki provenance, grammar
   evidence, extraction decisions, and intentional deviations in the package's
   `ARCHITECTURE.md`, not the user README.

Dependency changes also affect Nix packaging. Follow the **current**
`CONTRIBUTING.md` instructions for refreshing `npmDepsHash` in
`nix/pi-runtime.nix` and verifying native addon loading. Do not leave a fake hash
behind. Report unavailable Nix/CI verification rather than claiming it passed.

## Preserve shared invariants

- Relative paths resolve against the supplied cwd; explicit symlinks remain
  supported. Do not change directory listing or filesystem access policy.
- Read once, parse afresh, and keep a fresh parser per invocation. No new caches,
  startup indexing, watchers, or background jobs.
- Keep the 5 MiB bounded UTF-8 read, one-second native parse timeout, cancellation
  checks, and 1,000-line/32 KiB output limits. No native nodes in tool results.
- The installed Node binding uses **UTF-16 string indices**, not byte offsets.
  Ranges are 1-based and inclusive. `sourceRange()` converts exclusive node ends
  correctly, including ends at column zero. Use alternate logical ranges only
  when the language contract calls for them, as Markdown does.
- Range metadata must stay aligned with rendered lines after truncation. Grouped
  lines can map to multiple non-contiguous source ranges. Full-output artifacts
  must remain readable and still obey language-level preview rules.
- Shared formatting changes must not silently alter existing language snapshots.
  Do not add framework/test-name heuristics unless part of the requested scope.

## Verification and acceptance

Use `tests/python.test.ts` and `tests/markdown.test.ts` as worked examples of
language additions, plus `tests/profiles.test.ts` for explicit profile selection
and shared-versus-override dispatch, and `tests/extract.test.ts`,
`tests/format.test.ts`, `tests/tool.test.ts`, and `tests/cli.test.ts` for shared
behavior.

Cover:

- Real grammar parsing, all supported extensions/variants, and uppercase suffixes.
- At least one golden outline based on Maki's target-language tests, with source
  provenance and explicit expectations for any intentional differences.
- Supported declarations and members, signatures, imports, docs/attributes, and
  exclusions. Assert implementation-only text does not leak into the outline.
- Exact ranges and line metadata, Unicode/non-BMP characters, CRLF, multiline
  declarations, and final-newline/no-final-newline cases.
- Empty/unrecognized source, malformed source with intact usable entries, and
  pre-aborted extraction.
- Integration through `indexPath`: language, entry count, source line count,
  serializable details, warnings, fresh results after a file edit, and truncation
  with aligned metadata and a readable artifact. Clean test-created artifacts up.
- A CLI invocation for the new language and regressions across existing languages.

Run from the repository root (use the Nix shell when needed for native addons):

```sh
npx vitest run packages/tree-sitter-index/tests
npm run check
npm pack --workspace @maxouverzou/pi-extension-tree-sitter-index --dry-run
./packages/tree-sitter-index/bin/tree-sitter-index path/to/new-language-fixture
npx pi --no-extensions --extension ./packages/tree-sitter-index/src/index.ts
```

In Pi, call `index` on a representative file, then `read` a reported range:
`offset = startLine`, `limit = endLine - startLine + 1`. Confirm it returns the
complete intended declaration/section. The old plan mentions a smoke-test script;
that script is not currently present, so use the documented direct loading path.

Keep edits scoped and do not reset unrelated working-tree changes. In your final
handoff, report supported syntax, Maki sources consulted, deviations/limitations,
files changed, tests actually run, and any outstanding blockers. Do not claim
completion if the grammar cannot load or new tests fail.
