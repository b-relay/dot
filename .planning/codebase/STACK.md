# Technology Stack

**Analysis Date:** 2026-01-26

## Languages

**Primary:**
- TypeScript 5.9.3 - Entire codebase, single-file CLI tool at `index.ts`

## Runtime

**Environment:**
- Bun 1.x - JavaScript runtime and test runner (available as optional dependency via Homebrew)
- Node.js types available (`@types/bun`)

**Package Manager:**
- Bun (integrated)
- Lockfile: `bun.lock` (present)

## Frameworks

**Core:**
- None (pure TypeScript/JavaScript with standard Node APIs)

**Testing:**
- Bun Test (`bun:test`) - Built-in test runner
  - Uses `describe`, `expect`, `test` from Bun's test module
  - No external test framework required

**Build/Dev:**
- Bun (compile to binary)
- TypeScript compiler (`tsc` for type checking)

## Key Dependencies

**Production:**
- None (standard library only)

**Development:**
- `@types/bun` 1.3.6 - Type definitions for Bun APIs
- `typescript` 5.9.3 - TypeScript compiler

**Runtime APIs Used:**
- Node.js built-in modules: `fs/promises`, `path`, `util`
- Bun built-in APIs: `$` (shell command runner), `Bun.argv`, `Bun.env`, `Bun.file`

## Configuration

**Environment:**
- `HOME` environment variable required (checked at runtime)
- Configuration created programmatically in `createConfig()` at `index.ts:102-125`
- No external configuration files (config is derived from filesystem)

**Build:**
- `tsconfig.json` - TypeScript compilation settings
- `bun.lock` - Package dependency lock file
- `package.json` - Bun package descriptor with build and deploy scripts

**Build Commands:**
```bash
bun run build           # Compile to standalone binary: bun build --compile index.ts --outfile dot
bun run deploy          # Build and install to ~/.local/bin/dot
bun run typecheck       # Type check: bunx tsc --noEmit
bun run test            # Run tests: bun test
```

## Platform Requirements

**Development:**
- macOS (architecture detection for arm64/x86_64 in `index.ts:445-447`)
- Bun runtime
- TypeScript 5.x

**Production:**
- macOS
- Required dependencies checked by `checkDependencies()` (`index.ts:187-197`):
  - `brew` - Homebrew package manager
  - `starship` - Shell prompt
  - `cargo` - Rust toolchain
  - `fnm` - Node version manager
  - `zoxide` - Smart cd replacement

- Optional recommended dependencies:
  - `fzf` - Fuzzy finder
  - `vivid` - LS_COLORS generator
  - `eza` - Modern ls replacement
  - `bun` - JavaScript runtime

- Font requirement:
  - JetBrains Mono Nerd Font (checked by `checkNerdFont()` at `index.ts:199-217`)

**Deployment Target:**
- macOS system with Homebrew
- Binary deployed to `~/.local/bin/dot`
- Architecture-aware Homebrew path detection (`index.ts:1007`):
  - arm64: `/opt/homebrew`
  - x86_64: `/usr/local`

## External Tool Integration

**Homebrew Integration:**
- Package file parsing at `index.ts:287-333` (`parseBrewfile()`)
- Installed package detection at `index.ts:335-357` (`getInstalledPackages()`)
- Brewfile sync at `index.ts:365-413` (`checkBrewfileSync()`)
- File location: `~/.dotfiles/homebrew/brewfile`

**Claude AI Integration:**
- Calls `claude` CLI tool for analysis in `doctor()` command (`index.ts:1026`)
- Command: `claude -p <prompt> --model haiku`
- Requires Claude CLI to be installed and configured
- Used for intelligent analysis of dotfiles repository state

---

*Stack analysis: 2026-01-26*
