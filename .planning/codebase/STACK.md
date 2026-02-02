# Technology Stack

**Analysis Date:** 2026-01-25

## Languages

**Primary:**
- **TypeScript** 5.9+ - CLI tool implementation (`dot/index.ts`)
- **JavaScript** - Browser/Node-compatible runtime targets
- **Zsh** - Shell scripting for terminal configuration
- **TOML** - Configuration files (starship.toml, jj/config.toml)
- **JSON** - Configuration and data serialization

**Secondary:**
- **Go** - Optional tool (installed via Homebrew)
- **Rust** - Optional tool (installed via Homebrew)
- **Python** 3.10 - Optional tool (installed via Homebrew)
- **OCaml** - Optional tool via opam package manager
- **Shell Script (Bash/Sh)** - Git hooks and system scripts

## Runtime

**Environment:**
- **Bun** 1.3.6+ - JavaScript runtime, package manager, and transpiler
- **Node.js** (via fnm) - Node version manager available; can switch versions on directory change
- **macOS** - Darwin platform required (homebrew, osxkeychain, Apple-specific paths)

**Package Manager:**
- **Bun** - Primary package manager for dot CLI project
  - Lockfile: `dot/bun.lock` (v1 format)
- **Homebrew** - System package management for macOS
  - Manifest: `homebrew/brewfile` (Brewfile format)

## Frameworks

**Core:**
- **Bun** - Used for build, testing, and compilation to standalone binary
  - Build target: `dot/index.ts` → `dot` binary via `bun build --compile`

**Testing:**
- **Bun's native test runner** - `bun:test` module
  - Test files: `dot/tests/index.test.ts`, `dot/tests/integration.test.ts`
  - Config: No separate config file; inline with `describe`/`test` pattern

**Build/Dev:**
- **TypeScript** - Type checking and JSDoc/TSDoc support
  - Compiler config: `dot/tsconfig.json`
  - Strict mode enabled with comprehensive type checking
- **Bun CLI** - Build and compile commands
  - `bun build --compile` - Produces standalone binary
  - `bun test` - Test runner
  - `bun run {script}` - Script execution

## Key Dependencies

**Direct Dependencies:**

- **Node.js fs/promises** (`node:fs/promises`) - File system operations (symlink, mkdir, readlink, stat, etc.)
- **Node.js path** (`node:path`) - Path utilities (dirname, resolve, isAbsolute)
- **Bun global APIs** - `Bun.env`, `Bun.file()`, `Bun.write()`, `Bun.argv`
- **Bun shell** (`bun:shell`) - Shell command execution via `$` template strings

**DevDependencies:**

- `@types/bun` 1.3.6 - Type definitions for Bun runtime
- `@types/node` 25.0.10 - Type definitions for Node.js globals and modules
- `typescript` 5.9.3 - TypeScript compiler and language server

**No External Package Dependencies** - The core CLI has zero npm dependencies beyond dev-only types.

## Configuration

**Environment:**

- **HOME** - Required; used to determine dotfiles and config directories
- **Bun runtime** - Uses Bun.env to access HOME and shell environment variables
- **No .env file** - Configuration is file-based and CLI-driven

**Build:**

- `dot/tsconfig.json` - TypeScript compilation configuration (strict mode enabled)
- `dot/package.json` - Bun package manifest with build and test scripts
- `dot/bun.lock` - Dependency lock file (managed automatically by Bun)

**Scripts:**
```bash
bun run build      # Compile TypeScript to standalone binary
bun run deploy     # Build, mkdir ~/.local/bin, copy binary, chmod +x
bun run test       # Run all tests
bun run typecheck  # TypeScript type checking without emitting
```

## Platform Requirements

**Development:**

- macOS (Darwin) system with Homebrew
- Bun 1.3.6 or later
- TypeScript 5+ compiler
- Node.js (optional; fnm manages versions)
- SSH keys for Git signing

**Production:**

- macOS system
- Compiled `dot` binary in PATH (typically `~/.local/bin/dot`)
- System `brew` command for `sync` subcommand
- System `git` for repository operations
- System `claude` CLI tool for `doctor` subcommand (external dependency)

## External Tools & Integrations

**Required at Runtime:**

- **Claude CLI** (`claude` command) - Used by `dot doctor` command to analyze system state
  - Called via shell: `claude -p {prompt} --model haiku`
  - Not bundled; must be installed separately

**Homebrew Managed Tools:**

- `git` - Version control operations
- `jj` - Jujutsu VCS (alternative version control)
- `fnm` - Node.js version manager
- `fzf` - Fuzzy finder
- `zoxide` - Smart cd replacement
- `starship` - Cross-shell prompt
- `tmux` - Terminal multiplexer
- `vivid` - LS_COLORS generator
- `bat` - Syntax-highlighted cat
- `eza` - Modern ls replacement
- `gh` - GitHub CLI

---

*Stack analysis: 2026-01-25*
