# Programmatic configuration for `dot`

**Status:** Design research  
**Question:** Should `dot` keep a programmatic configuration capability, and if so, where should that code run?

## Recommendation

Use a versioned, schema-validated YAML manifest as the only input to normal `dot plan` and `dot apply` operations. Do not evaluate `dot.config.ts` while loading configuration.

Preserve a path to programmability, but make it an explicit **manifest-generation step**, not an alternate apply-time configuration loader:

1. A person may author the YAML manifest directly. Layered profiles should cover the initial composition needs (`base` plus OS, architecture, and host).
2. Later, if real repositories need more computation, a separately invoked generator may produce the same manifest data model.
3. `dot` validates the generated result and writes a reviewable YAML artifact. Normal planning and applying consume that artifact without executing the generator.

This keeps the portable, standalone CLI and the safety of a data file while leaving TypeScript, CUE, Dhall, or another generator available to advanced users. It also avoids choosing a second configuration language before a concrete use case exceeds declarative profile composition.

## Why `dot.config.ts` exists today

The historical design decision was simply to support JSON and TypeScript as a user's choice. The accompanying research immediately identified the incompatibility: JSON would be primary because it works in a compiled binary, while TypeScript would require running through Bun. It did not identify a concrete use case that required computation. See the historical [phase context](https://github.com/b-relay/dot/blob/2970e0aeadced184e18846e893c926bc7aa495cb/.planning/phases/06-decouple-dot-cli/06-CONTEXT.md#config-format--location) and [phase research](https://github.com/b-relay/dot/blob/2970e0aeadced184e18846e893c926bc7aa495cb/.planning/phases/06-decouple-dot-cli/06-RESEARCH.md).

The implementation followed that compromise: JSON takes precedence, the compiled CLI declines to load TypeScript, and only the Bun runtime dynamically imports it ([commit `77428a7`](https://github.com/b-relay/dot/commit/77428a771a2eff15c5a99d5914d319299b294fa5)). The current configuration UI still writes JSON and warns that it will supersede TypeScript ([`src/config-ui.ts`](../../src/config-ui.ts)).

So TypeScript was an optional authoring format, not a capability grounded in a demonstrated requirement. Its main theoretical benefits were never exercised by the original schema, which was only a small object containing links and `autoCommit`.

## What programmability is actually useful for

Programmatic configuration earns its cost when it provides one or more of these:

- reusable functions and defaults across a large configuration;
- conditional values derived from explicit machine facts;
- generating repeated resources from a smaller inventory;
- composing independently maintained modules;
- validating relationships that are awkward to express as field-level schema rules.

Comparable tools show that these needs are real:

- **chezmoi** uses Go templates for machine-dependent file contents and exposes OS/architecture data, user data, conditionals, functions, and reusable templates ([templating guide](https://www.chezmoi.io/user-guide/templating/)). It also demonstrates a useful boundary: a `.chezmoi.toml.tmpl` can generate the ordinary TOML configuration during initialization ([setup guide](https://www.chezmoi.io/user-guide/setup/#create-a-config-file-on-a-new-machine-automatically)).
- **Home Manager** uses Nix to make packages, files, and program settings composable and reproducible across hosts ([Home Manager introduction](https://nix-community.github.io/home-manager/introduction.html)). A Home Manager configuration is a Nix module and can use functions and package values ([configuration example](https://nix-community.github.io/home-manager/usage/configuration.html)).
- **CUE** combines data and constraints in an order-independent way and supports validation, templating, and code generation ([CUE introduction](https://cuelang.org/docs/introduction/)). It can validate YAML as a preflight step or export computed CUE values back to YAML ([CUE and YAML](https://cuelang.org/docs/concept/how-cue-works-with-yaml/)).

For `dot`, layered profiles directly address the first likely need—cross-machine composition—without requiring general-purpose code. Loops or generators become compelling only if the desired-state model grows large enough that declarative repetition becomes a maintenance problem.

## Costs of evaluating TypeScript during plan or apply

### The trust boundary becomes invisible

Importing a TypeScript module executes it. Under Bun, that module can write or delete files and execute commands; these are ordinary documented runtime capabilities ([Bun file I/O](https://bun.com/docs/runtime/file-io), [Bun Shell](https://bun.com/docs/runtime/shell)). Validating the exported object with Zod checks the result **after** this code has already run.

That creates a particularly bad property for a state manager: a supposedly read-only `plan` can change the machine merely by loading configuration. A cloned dotfiles repository must therefore be treated as executable code even before `apply`.

chezmoi illustrates the same tradeoff in a constrained template system: its `exec` template function runs a command every time the template is evaluated and leaves idempotency and performance to the user ([`exec` function](https://www.chezmoi.io/reference/templates/functions/exec/)).

### Reproducibility depends on hidden inputs

General TypeScript can read the clock, environment, network, filesystem, installed packages, or arbitrary process output. Two evaluations of the same Git revision can therefore produce different desired state. Reproduction requires separately pinning the runtime, dependencies, environment, network inputs, and any invoked commands.

Nix shows the opposite design. Its language is declarative and pure: dependencies are established through data, and functions return the same output when inputs do not change ([Nix language reference](https://nix.dev/manual/nix/latest/language)). Nix documentation also warns that impure expressions such as lookup paths and `currentSystem` break reproducibility and recommends explicit, pinned inputs ([Nix language basics](https://nix.dev/tutorials/nix-language.html#impurities)). These guarantees are valuable, but adopting Nix would also bring a language and runtime much larger than `dot` needs.

### Standalone distribution stops being standalone

The present repository already encountered this: external TypeScript works only when the user has Bun and runs the source form, not the compiled executable. Keeping in-process TypeScript support would require shipping an evaluator/transpiler, requiring Bun, or maintaining two behavior paths. A generated YAML artifact avoids all three: generation can use any user-selected tool, while the compiled `dot` binary only parses data.

### Editing and diagnostics get harder

A CLI can safely add a resource to a data document because the document directly represents resources. It cannot generally rewrite arbitrary TypeScript while preserving semantics, local abstractions, imports, and formatting. The UI must either refuse edits, generate a second higher-priority file—as it does today—or implement a language-aware refactoring tool.

Errors also split into at least three layers: module resolution/evaluation, exported-value validation, and state reconciliation. With a generated artifact, generation errors are separate from deterministic manifest validation and planning errors.

## Safer programmable configuration languages

General-purpose TypeScript is not the only option:

- **Dhall** is a total, typed configuration language. A type-correct expression terminates, and it has no arbitrary effects; its outside interactions are limited to importing files, URLs, and environment variables ([safety guarantees](https://docs.dhall-lang.org/discussions/Safety-guarantees.html)). Remote imports can be protected by semantic hashes, so changed content is rejected ([language tour](https://docs.dhall-lang.org/tutorials/Language-Tour.html#installing-packages)).
- **CUE** is not a general-purpose language. Its constraint model is designed for merging configuration, validating it, and exporting concrete JSON/YAML/TOML ([CUE introduction](https://cuelang.org/docs/introduction/), [`cue export`](https://cuelang.org/docs/reference/command/cue-export/)).

Either is much safer and more reproducible than evaluating arbitrary TypeScript during `plan`. Both impose a new language, runtime, packaging burden, editor/tooling story, and learning curve on every repository that uses them. They are better treated as optional external generators than as required first-release dependencies.

## What deliberately declarative tools demonstrate

Dotbot uses YAML or JSON task lists for links, directory creation, cleanup, and shell commands. It recommends idempotent bootstrap configurations and explicitly defines ordering at the task-list level ([Dotbot configuration](https://github.com/anishathalye/dotbot#configuration)). This model is simple and portable, but its `shell` directive and plugin system show that a declarative envelope does not automatically make every resource safe. `dot` should keep arbitrary shell execution outside its initial resource model or make that risk conspicuous and separately authorized.

The lesson is to distinguish:

- **declarative representation:** resources can be validated, diffed, planned, journaled, and rolled back according to known semantics;
- **imperative escape hatch:** arbitrary effects prevent `dot` from providing those guarantees unless it understands a resource-specific contract.

## YAML, comments, ordering, and validation

Choosing YAML does not by itself preserve human formatting. YAML 1.2.2 defines comments as presentation details not associated with nodes, and mappings as unordered key/value pairs ([comments](https://yaml.org/spec/1.2.2/#3233-comments), [mapping model](https://yaml.org/spec/1.2.2/#321-representation-graph)). A parser that converts YAML to plain JavaScript objects and serializes them again may legally discard comments, scalar styles, and key order.

TOML has the same fundamental issue: it supports comments, but its data model maps to hash tables and table key/value pairs have no guaranteed order ([TOML 1.0 specification](https://toml.io/en/v1.0.0#table)). Format preservation is a parser/editor feature, not a format guarantee.

Therefore:

- pin the accepted YAML version and schema behavior;
- reject duplicate keys and unsupported/custom tags;
- validate the parsed value with the versioned `dot` schema before planning;
- publish the schema for editor completion and offline validation;
- if `dot` edits hand-authored YAML, use a concrete-syntax-tree/round-trip API and golden-test comments, ordering, quoting, and line endings;
- keep generated files clearly marked and regenerate them wholesale instead of pretending to preserve hand edits.

Zod remains suitable for runtime validation: its parser returns typed data and reports granular validation issues ([Zod basic usage](https://zod.dev/basics)). A published JSON Schema could additionally support editors and other tooling, but schema validation and in-process validation should be generated from one authoritative model to avoid drift.

## Proposed generator contract

Do not settle the final subcommand name until the CLI discussion is complete, but preserve this behavioral boundary:

1. Generation is an explicit command, never an implicit side effect of `plan`, `apply`, status, completion, or help.
2. The generator emits manifest-shaped JSON or YAML through a documented protocol.
3. `dot` validates the complete output and refuses to replace the last valid artifact on failure.
4. The artifact records its schema version and a digest of generator sources and declared inputs, allowing `dot` to report that it is stale.
5. The artifact contains desired state, not secrets. Secret references remain references and are resolved only by a resource provider with an explicit contract.
6. Normal planning and applying read only the artifact. They do not require the generator language or its dependencies.
7. Generated manifests are reviewable in Git; repositories that do not want generated files committed can generate them in CI/bootstrap, but reproducibility then depends on pinning the generator and inputs.

This is the same broad separation demonstrated by CUE exporting concrete YAML and chezmoi generating a normal TOML configuration from a template, while preserving `dot`'s ability to remain a portable compiled CLI.

## Decision trigger

Ship YAML plus profile composition first. Add the generator protocol when at least one real dotfiles repository demonstrates a requirement that cannot be expressed cleanly through:

- layered profiles;
- declarative defaults and overrides;
- named roots and machine facts supplied by `dot`;
- reusable manifest fragments with deterministic merge rules.

At that point, use the actual requirement to decide whether a language-neutral generator protocol is enough or whether `dot` should officially support one safer configuration language. Do not restore implicit `dot.config.ts` evaluation as the default solution.
