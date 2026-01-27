# Technology Stack for Interactive CLI Setup Wizard

**Project:** dot CLI - Interactive Setup Wizard
**Researched:** 2026-01-27
**Confidence:** HIGH

## Executive Summary

For adding interactive setup wizard capabilities to the existing Bun/TypeScript dotfiles CLI, the recommended stack prioritizes:
1. **Modern, lightweight libraries** optimized for performance
2. **Native Bun features** where available (YAML/TOML/JSON parsing)
3. **Type-safe, developer-friendly APIs** for maintainability
4. **Proven stability** with active maintenance in 2026

## Recommended Stack

### Interactive Prompts

| Library | Version | Purpose | Rationale |
|---------|---------|---------|-----------|
| **@clack/prompts** | ^0.11.0 | Interactive CLI prompts & wizards | Modern, beautiful UI with straightforward API. Growing adoption (3,117+ projects). Better UX than inquirer with consistent styling. Weekly downloads: 2.5M+ |

**Why @clack/prompts over alternatives:**
- **vs inquirer**: More modern design, cleaner API, better visual polish, consistent styling across prompt types
- **vs prompts**: Better TypeScript support, more comprehensive prompt types out of the box
- **Trade-off**: Smaller community than inquirer (28M downloads), but rapidly growing and actively maintained

**Confidence:** HIGH - Verified from npm registry data (v0.11.0, published 8 months ago as of Jan 2026)

### Visual Feedback

| Library | Version | Purpose | Rationale |
|---------|---------|---------|-----------|
| **ora** | ^9.0.0 | Loading spinners | Industry standard (36K+ projects, 28M+ weekly downloads). Simple API, extensive customization. Version 9.0.0 released 4 months ago shows active maintenance |
| **picocolors** | ^1.x | Terminal colors | 14x smaller and 2x faster than chalk. Loading time: 0.466ms vs chalk's 6.167ms. Zero dependencies. Modern CLI projects are migrating to picocolors |

**Why picocolors over chalk:**
- **Performance**: 2-3x faster in benchmarks, 14x smaller package size (7 kB vs 101 kB)
- **Loading speed**: 0.466ms vs 6.167ms for chalk
- **Simplicity**: Focused API with essential color/style functions
- **Trade-off**: Chalk has larger community, but picocolors is the modern choice (see npm trends showing rapid adoption)

**Confidence:** HIGH - Verified from npm registry and performance benchmarks (2026)

### Config File Handling

| Library | Version | Purpose | Rationale |
|---------|---------|---------|-----------|
| **Bun native** | built-in | YAML/TOML/JSON parsing | Bun provides first-class support for all three formats. YAML parser passes 90%+ of official test suite. Written in Zig for optimal performance. Zero external dependencies |

**Native Bun capabilities:**
```typescript
// YAML
import config from "./config.yaml"
const parsed = YAML.parse(text)
const serialized = YAML.stringify(data)

// TOML
import config from "./config.toml"

// JSON
import config from "./config.json"
```

**Why native Bun over external libraries:**
- **Performance**: Native Zig implementation is faster than JS alternatives
- **Zero dependencies**: No need for yaml, toml, or additional packages
- **Automatic hot reloading**: `bun --hot` detects changes to config files
- **Type safety**: Create `.d.ts` files for typed imports
- **Trade-off**: None - this is pure advantage

**Confidence:** HIGH - Verified from official Bun documentation (bun.com/docs)

### Template Engine

| Library | Version | Purpose | Rationale |
|---------|---------|---------|-----------|
| **Eta** | ^3.x | Config file generation from templates | Fastest JS template engine (faster than EJS, Handlebars, Pug). Written in TypeScript with full type support. Lightweight, async support, works with Bun/Node/Deno. Better error messages than EJS |

**Why Eta over alternatives:**
- **vs EJS**: Faster, better whitespace control, multiline comments, plugin architecture, TypeScript types
- **vs Handlebars**: Much faster (benchmarks show significant performance gap), allows JavaScript expressions in templates
- **vs Mustache**: More powerful, async support, better for complex config generation
- **Trade-off**: Smaller community than EJS/Handlebars, but superior technical characteristics for CLI use

**Use case for setup wizard:**
```typescript
import * as eta from "eta"

const template = `
brew "<%= it.brewPackage %>"
# <%= it.description %>
`

const result = eta.render(template, {
  brewPackage: "starship",
  description: "Shell prompt"
})
```

**Confidence:** MEDIUM - Based on comparison articles and Eta official docs (eta.js.org)

### System Detection

| Library | Version | Purpose | Rationale |
|---------|---------|---------|-----------|
| **Node.js os module** | built-in | Basic OS detection (platform, release) | Built-in to Node/Bun, zero dependencies, sufficient for Mac platform detection (darwin) and architecture (arm64/x64) |
| **systeminformation** | ^5.30.5 | Advanced system info (optional) | Most actively maintained (updated 2 days ago in 2026). 19K+ lines of code, 15M monthly downloads. TypeScript rewrite (v6) in beta. Use only if wizard needs detailed hardware detection |

**Recommendation:** Start with built-in `os` module. Only add `systeminformation` if wizard needs:
- Detailed CPU/memory information
- Shell detection
- Hardware capabilities
- Installed software enumeration

**Basic detection (recommended):**
```typescript
import { platform, arch, release } from "node:os"

const isMac = platform() === "darwin"
const isAppleSilicon = arch() === "arm64"
const osVersion = release()
```

**Confidence:** HIGH - Verified from Node.js official docs and npm registry

### CLI Argument Parsing

| Library | Status | Recommendation |
|---------|--------|----------------|
| **util.parseArgs** | Already in use | Keep using native Node.js parseArgs (already in codebase). Works well with Bun. Zero dependencies |

**Rationale:** Current implementation already uses `util.parseArgs` for install command flags. No need to add commander/yargs for simple flag parsing. Only consider upgrading if wizard needs complex subcommands.

**Confidence:** HIGH - Already validated in existing code

## Alternatives Considered

### Interactive Prompts

| Alternative | Why Not Recommended |
|-------------|---------------------|
| **inquirer** (28M+ downloads) | Older API design, heavier package, less polished visual output. Still solid choice if team prefers established libraries |
| **prompts** (21M+ downloads) | Good minimalist option, but @clack/prompts offers better TypeScript support and more prompt types |
| **enquirer** | Less actively maintained, smaller community |

### Template Engines

| Alternative | Why Not Recommended |
|-------------|---------------------|
| **Handlebars** | Slower in benchmarks, logic-less philosophy doesn't fit config generation well |
| **EJS** | Slower than Eta, worse error messages, no native TypeScript support |
| **Mustache** | Too simple for complex config generation with conditionals |

### Colors

| Alternative | Why Not Recommended |
|-------------|---------------------|
| **chalk** | 2-3x slower, 14x larger, longer load time. Still most popular, but picocolors is technically superior |
| **ansis** | Newer alternative, good performance, but smaller community than picocolors |
| **kolorist** | Similar to picocolors, but less adoption |

## Installation

```bash
# Core interactive wizard stack
bun add @clack/prompts ora picocolors eta

# Optional: advanced system detection (if needed)
bun add systeminformation

# Dev dependencies (if not already present)
bun add -D @types/bun typescript
```

## Architecture Integration

### How Stack Fits Existing Code

Current `dot/index.ts` structure:
```typescript
// Existing: Config type, createConfig(), symlink helpers
// Existing: Dependency checking, brewfile sync

// NEW: Setup wizard command
import * as clack from '@clack/prompts'
import ora from 'ora'
import { render } from 'eta'

async function setup(config: Config) {
  clack.intro('Welcome to dot setup')

  // Detect current state
  const spinner = ora('Detecting system configuration...').start()
  // ... detection logic
  spinner.succeed('System detected')

  // Interactive prompts
  const answers = await clack.group({
    dotfilesPath: () => clack.text({
      message: 'Where should dotfiles be cloned?',
      initialValue: config.dotfiles
    }),
    // ... more prompts
  })

  // Generate configs from templates
  const brewfile = render(brewfileTemplate, answers)

  clack.outro('Setup complete!')
}
```

**No conflicts** with existing code. Additive changes only.

## What NOT to Use

### Avoid These Patterns

1. **Full CLI frameworks (oclif, caporal, commander for this use case)**
   - **Why:** Overkill for adding one setup command to existing CLI
   - **Overkill factor:** 100+ dependencies, complex boilerplate
   - **Current approach:** Simple switch statement in index.ts works fine

2. **Heavy template engines (nunjucks, pug)**
   - **Why:** Config files are simple text generation, don't need HTML-focused engines
   - **Weight:** 10x+ larger than Eta, unnecessary features

3. **Readline/readline-sync for prompts**
   - **Why:** Low-level, requires building UI from scratch
   - **Modern alternative:** @clack/prompts handles all UX concerns

4. **External YAML/TOML libraries (js-yaml, @iarna/toml)**
   - **Why:** Bun has native support
   - **Waste:** Unnecessary dependencies, slower than native

5. **Inquirer + Chalk**
   - **Why:** Not bad, but @clack/prompts + picocolors is more modern
   - **Old stack:** Inquirer (2015) + Chalk (2013)
   - **New stack:** Clack (2023) + Picocolors (2021)

## Tech Stack Summary

```typescript
// Interactive wizard stack (2026)
import * as clack from '@clack/prompts'  // v0.11.0 - Prompts
import ora from 'ora'                     // v9.0.0 - Spinners
import { render } from 'eta'              // v3.x - Templates
import pc from 'picocolors'               // v1.x - Colors

// Native capabilities (zero deps)
import { platform, arch } from 'node:os'  // System detection
import { parseArgs } from 'util'          // Already in use
// YAML/TOML/JSON via Bun.file() and imports
```

## Confidence Assessment

| Technology | Confidence | Source |
|------------|------------|--------|
| @clack/prompts | HIGH | npm registry (v0.11.0, 2.5M weekly downloads, 3K+ projects) |
| ora | HIGH | npm registry (v9.0.0, 28M weekly downloads, 36K+ projects) |
| picocolors | HIGH | Performance benchmarks, npm trends, GitHub (alexeyraspopov/picocolors) |
| Bun native YAML/TOML | HIGH | Official Bun docs (bun.com/docs/runtime/yaml) |
| Eta | MEDIUM | Comparison articles, official docs, but less real-world verification |
| systeminformation | HIGH | npm registry (v5.30.5, updated 2 days ago, 15M monthly downloads) |

## Version Currency Verification

All versions checked against:
- npm registry data (January 2026)
- Official documentation
- Recent web search results (2026)
- Package publication dates

**Last verified:** 2026-01-27

## Sources

### Interactive Prompts
- [Elevate Your CLI Tools with @clack/prompts](https://www.blacksrc.com/blog/elevate-your-cli-tools-with-clack-prompts)
- [npm trends comparison: inquirer vs prompts vs @clack/prompts](https://npmtrends.com/chalk-vs-commander-vs-enquirer-vs-inquirer-vs-prompt-vs-prompts)
- [@clack/prompts on npm](https://www.npmjs.com/package/@clack/prompts)
- [Building CLI apps with TypeScript in 2026](https://dev.to/hongminhee/building-cli-apps-with-typescript-in-2026-5c9d)

### Visual Feedback (Spinners & Colors)
- [ora npm package](https://www.npmjs.com/package/ora)
- [picocolors GitHub](https://github.com/alexeyraspopov/picocolors)
- [Comparison of Node.js libraries to colorize text](https://dev.to/webdiscus/comparison-of-nodejs-libraries-to-colorize-text-in-terminal-4j3a)
- [npm trends: chalk vs picocolors](https://npmtrends.com/chalk-vs-picocolors)

### Template Engines
- [Eta template engine](https://eta.js.org/)
- [Handlebars vs EJS vs Eta performance comparison](https://javascript.plainenglish.io/handlebars-eta-ejs-1623a6140e56)
- [Top Template Engines in 2025](https://beyondthestack.hashnode.dev/top-10-template-engines)

### Config File Handling
- [Bun YAML documentation](https://bun.com/docs/runtime/yaml)
- [JSON vs YAML vs TOML in 2026](https://dev.to/jsontoall_tools/json-vs-yaml-vs-toml-which-configuration-format-should-you-use-in-2026-1hlb)

### System Detection
- [Node.js OS module documentation](https://nodejs.org/api/os.html)
- [systeminformation npm package](https://www.npmjs.com/package/systeminformation)

### CLI Best Practices
- [How To Build CLI Using TypeScript and Bun](https://pmbanugo.me/blog/build-cli-typescript-bun)
- [Building a Powerful CLI Tool in TypeScript](https://medium.com/@WC_/building-a-powerful-command-line-interface-cli-tool-in-typescript-a-step-by-step-guide-3eac3837e190)
