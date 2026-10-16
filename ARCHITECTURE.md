# Tree-sitter index architecture

## Pipeline

The standalone CLI uses `tsx` to load the shared TypeScript implementation;
it does not require a Pi session.

`index.ts` registers only the tool, using the installed `@earendil-works/pi-coding-agent` contract and `typebox`. `tool.ts` resolves paths, reads one bounded UTF-8 snapshot, handles directories, checks cancellation, and adapts results. `languages.ts` maps extensions to statically imported native grammar modules; no syntax trees or source content are cached.

`parser.ts` creates a fresh native parser per invocation. Plain records in `model.ts` are the only values returned to Pi.

## Language profiles

There is no default file language or generic syntax recognizer. `profiles.ts` explicitly maps every supported language to a bundled profile; adding an extension/grammar to `languages.ts` also requires a profile registry entry. Unknown extensions still fail rather than falling back to JavaScript/TypeScript.

`profile.ts` distinguishes two internal contracts:

- `DeclarationProfile`: shared top-level traversal in `extract.ts`, with required language-specific `extractNodes` recognition and an optional `isDocComment` predicate. Contiguous documentation attachment and cancellation belong to traversal; no documentation syntax is assumed.
- `CustomProfile`: a full extraction override for languages with different traversal or range semantics. Python and Markdown use this path.

`typescript.ts` is the dedicated JavaScript/JSX/TypeScript/TSX recognition profile, including JSDoc and export/ambient wrapper handling. These languages share recognition but retain their separately selected grammars. Only named structural containers recurse (maximum depth 8); arbitrary function bodies and expression statements are never searched. Full declaration ranges survive body elision.

Profiles can also select an empty outline instead of the code-specific fallback message, and override parse-error classification (Markdown's EOF handling). `tool.ts` dispatches through the selected profile while retaining shared I/O, parsing, formatting, metadata, and output limits. Python-specific import rendering and language-specific sections remain in the shared plain-data formatter.

This follows Maki's architectural distinction between shared default traversal with language helpers and full extraction overrides—not an exact implementation of its helper API. The contracts are internal only: no user-loadable hooks, configuration, or automatic generic fallback. Future languages should supply recognition for shared traversal or a full override, and add dedicated fixtures/tests; they must not silently inherit JS/TS rules.

`python.ts` follows Maki's `plugins/index/lang/python.lua`: top-level functions, classes with direct methods, uppercase/underscore-only assignments (including annotated assignments with their annotations omitted), and initial triple-double-quoted module docstrings. Decorated top-level definitions use the wrapper range; class method signatures use the inner function range and show decorator attributes. Signatures deliberately use Maki's whole-text whitespace compaction. Class fields, bases, nested declarations, and declarations under control-flow nodes are not traversed. Module-doc entries count toward `entryCount` and render as a range-only header.

Python imports use AST names to populate `Entry.importPaths`, then a separate iterative dotted trie renderer in `imports.ts` merges/sorts paths and preserves per-declaration metadata, including duplicate paths. This follows Maki's output for ordinary imports but intentionally fixes its raw-text handling of relative dots, comma-separated imports, parentheses, and multiline imports. JavaScript/TypeScript keep their conservative side-effect-only grouping behavior. Python and Markdown empty outlines bypass the code fallback message. Golden tests mirror Maki's all-sections Python fixture and cover decorators, stubs, Unicode/CRLF, imports/metadata, module docs, constant previews, error recovery, cancellation, truncation, and the CLI.

`go.ts` is a full Go-specific extraction override, based on Maki's `plugins/index/lang/go.lua` and `plugins/index/tests/lang/go.lua` at upstream revision `54a15291d372b09f1721327ab6d37566f886192f`. Maki recognizes import declarations, const/var specs, struct and interface types, aliases, functions, and methods; struct fields and interface methods/type elements are nested children. It elides bodies, omits import aliases, compacts signatures, and attaches contiguous comments to the first declaration range. Its golden covers grouped imports and constants, a global variable, struct/interface, alias, method, and function. This implementation follows that scope, but retains Go variables in a dedicated `vars:` section and uses source-node ranges with the shared UTF-16 inclusive range conversion. Imports use Go path segments and preserve multiple source ranges through shared import rendering. Local declarations and declarations under arbitrary wrappers are not searched.

The native Go grammar is pinned to `tree-sitter-go` 0.21.2, whose peer range is `tree-sitter ^0.21.0`, compatible with the package's 0.21.1 runtime. Its CommonJS export loads as a default ESM import under Node 24; its native grammar parses Go declarations and exposes fields such as `name`, `type`, `parameters`, and `result` (confirmed with an actual parse tree).

`markdown.ts` uses the Markdown block grammar's `atx_heading` and `setext_heading` nodes with `heading_content` fields, matching Maki's `plugins/index/lang/markdown.lua`. An iterative traversal includes headings in quotes/lists without mistaking fenced/indented code or HTML for headings. A reverse monotonic stack computes section ends in linear time: next same-or-shallower heading minus one, otherwise root end row plus one. This deliberately includes the trailing empty line when present. Markdown ranges differ from code ranges: they cover whole sections rather than declaration nodes. Empty Markdown outlines bypass the code-specific fallback message.

The 0.3.2 block grammar marks valid headings without a final newline as missing `_line_ending` at EOF. Extraction retains intact heading content, and `markdownHasError` suppresses only that EOF diagnostic; other syntax errors still trigger the shared warning. Heading indentation is handled before counting `#` markers rather than reproducing Maki's zero-level heading behavior on leading spaces. Golden tests cover Maki's ATX/Setext/no-final-newline cases, CRLF, Unicode, containers, code exclusion, cancellation, metadata, truncation, and the CLI. Only the block grammar is used; inline markup is emitted as source text, not parsed for additional symbols.

`imports.ts` partitions by keyword/separator into a path trie. Compression is intentionally restricted to adjacent, distinct, side-effect-only leaves under a common parent. Every other form falls back to its original declaration. `format.ts` emits Maki-style section labels, sorted imports with a shared header range, and trailing declaration ranges. Import headers and lines retain individual declaration ranges in metadata. Multiline preview lines all map to their containing declaration. Grouped imports can have multiple non-contiguous ranges. `preview.ts` compacts layout while preserving literal tokens and bounds initializer/type-alias previews by Unicode code points. Type-alias previews retain raw source layout, including comments.

`tool.ts` truncates at rendered-line boundaries, writes the complete formatted outline to a retained private temporary artifact, and creates metadata only after truncation. `omittedLines` counts formatting truncation; `omittedEntries` counts unlisted directory children (not unsupported AST forms). `entryCount` includes nested extracted members for files and all observed children for directories. File line count is zero for empty input, otherwise the number of LF-delimited lines including a trailing empty line. Listing memory is bounded; exact sorted first-N results and omission counts require scanning every directory entry.

Structured tool details map each output line to zero or more source ranges and
report truncation, directory omissions, entry counts, language, and parse warnings.

## Verified runtime facts

Native dependencies are pinned: `tree-sitter` 0.21.1, JavaScript 0.21.4,
TypeScript 0.21.2, Python 0.21.0, and
`@tree-sitter-grammars/tree-sitter-markdown` 0.3.2. JavaScript's bundled grammar
also accepts JSX; TypeScript and TSX use distinct grammars.

Selected versions have compatible peers (`tree-sitter-javascript`: `^0.21.1`; `tree-sitter-typescript`: `^0.21.0`; Markdown 0.3.2: `^0.21.1`; Python 0.21.0: `^0.21.0`). The TypeScript CommonJS module exports `typescript` and `tsx`. Native loading/parsing was exercised on Node 22.23.3 and 24.21.0, ESM and Pi's TypeScript loader. Tests exercise actual node fields, queries, cursors, error flags, Unicode, and CRLF.

DeepWiki was consulted for `tree-sitter/node-tree-sitter` and `tontinton/maki`. Its answer ambiguously described indices as byte offsets; the installed binding and Unicode tests demonstrate **UTF-16 code units** for JavaScript `startIndex`/`endIndex` and columns. Source slicing therefore uses JavaScript string indices, not UTF-8 Buffer offsets. Rows are zero-based; end positions are exclusive. For code declarations, an end at column zero belongs to the preceding inclusive source line; Markdown section ranges instead use Maki's document-end convention.

The 0.21 binding supports `setTimeoutMicros` in microseconds. A one-second timeout limits native work; failure may throw an `Invalid argument` binding error rather than return null. It has no WASM-style `delete()` lifecycle API: native objects are garbage-collected. Trees and nodes never escape orchestration. Default string parsing rejects sufficiently large input chunks in this version; a UTF-16 callback returning at most 16 Ki code units fixes that and is covered by a 1,500-function test.

Installation used npm's `node-gyp-build` prebuild path on Linux x64. The pinned parser and grammars include Linux x64, Darwin x64/arm64, and Windows x64 prebuild directories. Platforms without prebuilds need Python/make/C++. The Nix shell now uses `mkShell` (compiler), Python and make, plus Linux `LD_LIBRARY_PATH` for prebuilt C++ addons. Pi initially failed outside the shell with missing `libstdc++.so.6`; supplying the Nix compiler runtime library directory resolved native loading. CI's existing Node 22/24 matrix installs native dependencies with `npm ci` and runs the grammar tests; CI execution itself remains a remote verification step.

## Intentional boundaries

Formatting follows Maki's `plugins/index/indexer.lua` and `plugins/index/lang/typescript.lua`: section labels/order, sorted imports, trailing ranges, function keyword omission, visible defaults, and 60/80-character initializer/type-alias previews. The supplied `volume-pool.ts` example matches Maki's text. Recognition remains broader than Maki's TypeScript extractor; this is not exact source-level compatibility. Import grouping remains deliberately conservative rather than reproducing Maki's trie behavior.

Constants retain names/annotations without the `const` keyword, with bounded initializer previews; `let`/`var` declarations remain visible under `vars:`. Parameter defaults are retained, but nested function bodies are elided. Direct arrow/function initializers retain callable signatures; arbitrary expressions are not inferred. JSDoc affects range starts, not skeleton text. Ordinary comments interrupt attachment. The JavaScript/TypeScript profile exposes no module documentation, decorators/attribute inference, tests, executable user profiles, or query configuration; Python's explicit module-doc/decorator behavior is described above. Unsupported structural forms (for example mapped type members) are omitted. Type aliases show bounded raw value previews rather than recursive member outlines. Classes, interfaces, and nested object-typed members keep structured outlines. Local preview truncation is marked in text only; `details.truncated` and full artifacts describe output/directory limits, not omitted source text. Future recognition profiles can extend these seams without changing plain-data formatting.

A synchronous parse or extraction batch cannot receive an event-loop-delivered abort while running; strict interruptible deadlines require workers. Checks before/after I/O and between AST nodes honor already-delivered cancellation. No startup tasks, watchers, background workers, or persistent indexes exist. Temporary full outlines intentionally persist until user/OS cleanup so later read calls work.
