# Phase 6: Decouple dot CLI - Research

**Researched:** 2026-01-31
**Domain:** CLI tool architecture, config loading, interactive prompts, standalone binaries
**Confidence:** HIGH

## Summary

This phase decouples the `dot` CLI from hardcoded paths and the current dotfiles repo structure, making it a standalone tool that works with any dotfiles setup. The research covers four key areas: (1) standalone binary compilation with `bun build --compile`, (2) config file loading supporting both JSON and TypeScript formats, (3) interactive CLI prompting for wizards and user input, and (4) self-update mechanisms for the standalone binary.

Bun's native TypeScript support and compilation capabilities make it well-suited for this use case. The main technical challenge is that compiled Bun binaries cannot dynamically import external TypeScript files at runtime - they must either be embedded at compile time or loaded as JSON. This means TypeScript configs will need to be transpiled/evaluated differently than JSON configs.

**Primary recommendation:** Use JSON as the primary config format with Zod validation; support TypeScript configs by having users run the non-compiled `bun dot` for TS config evaluation, or document that TS configs require Bun installed separately.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun | 1.2+ | Runtime and compiler | Already used, native TS support, `--compile` for binaries |
| Zod | 3.x | Config schema validation | 30M+ weekly downloads, TS-first, type inference |
| bun-promptx | latest | Interactive prompts | Native Bun FFI-based, works in compiled binaries |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:readline | built-in | Simple text input | Basic prompts without selection UI |
| node:fs/promises | built-in | File operations | Already used in current codebase |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| bun-promptx | @inquirer/prompts | inquirer has known Bun compatibility issues with raw mode |
| Zod | TypeBox | Zod has better ecosystem adoption and documentation |
| JSON config | TOML/YAML | JSON is simpler, no parser dependency, Bun has native JSON support |

**Installation:**
```bash
bun add zod bun-promptx
```

## Architecture Patterns

### Recommended Project Structure
```
dot/
  index.ts              # CLI entry point and command router
  lib/
    config.ts           # Config loading and validation
    state.ts            # State file management (~/.config/dot/state.json)
    init.ts             # Init wizard logic
    track.ts            # Track command logic
    update.ts           # Self-update logic
    prompts.ts          # Prompt helpers wrapping bun-promptx
  types/
    config.ts           # Config schema and types (Zod)
```

### Pattern 1: Config Resolution Chain
**What:** Resolve config location through priority chain: CLI flag > env var > state file > search
**When to use:** Every command that needs dotfiles location
**Example:**
```typescript
// Source: Best practice for CLI config resolution
async function resolveConfig(): Promise<ResolvedConfig> {
  // 1. CLI flag takes highest priority
  const cliPath = parseArgs().dotfiles;
  if (cliPath) return loadConfigFrom(cliPath);

  // 2. Environment variable
  const envPath = process.env.DOT_HOME;
  if (envPath) return loadConfigFrom(envPath);

  // 3. State file (persisted from previous run)
  const state = await loadState();
  if (state?.dotfilesPath) return loadConfigFrom(state.dotfilesPath);

  // 4. Search common locations
  const found = await searchForDotfiles();
  if (found) return loadConfigFrom(found);

  // 5. No config found - trigger init wizard
  return null;
}
```

### Pattern 2: Config Schema with Defaults
**What:** Define config schema with sensible defaults, validate at load time
**When to use:** Loading user config files
**Example:**
```typescript
// Source: Zod documentation (https://zod.dev/)
import { z } from 'zod';

const LinkSchema = z.object({
  source: z.string(),
  target: z.string(),
});

const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  links: z.array(LinkSchema).default([]),
  autoCommit: z.boolean().default(true),
  gitInit: z.boolean().default(true),
});

type DotConfig = z.infer<typeof ConfigSchema>;

async function loadConfig(configPath: string): Promise<DotConfig> {
  const raw = await Bun.file(configPath).json();
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    console.error("Invalid config:", result.error.flatten());
    process.exit(1);
  }
  return result.data;
}
```

### Pattern 3: Interactive Selection
**What:** Use bun-promptx for selection prompts
**When to use:** Wizard flows, choosing from options
**Example:**
```typescript
// Source: bun-promptx (https://github.com/wobsoriano/bun-promptx)
import { createSelection, createPrompt } from 'bun-promptx';

async function selectDestinationFolder(folders: string[]): Promise<string> {
  const items = [
    ...folders.map(f => ({ text: f, description: `Existing folder` })),
    { text: '[Create new folder]', description: 'Add a new category' },
  ];

  const result = createSelection(items, {
    headerText: 'Where should this file go?',
  });

  if (result.error) throw result.error;
  if (result.selectedIndex === folders.length) {
    // Create new folder
    const { value } = createPrompt('Folder name: ');
    return value;
  }
  return folders[result.selectedIndex];
}
```

### Pattern 4: State Persistence
**What:** Store mutable state (dotfiles location) separately from config
**When to use:** Remembering user choices across runs
**Example:**
```typescript
// Source: XDG Base Directory Specification pattern
const STATE_PATH = `${process.env.HOME}/.config/dot/state.json`;

const StateSchema = z.object({
  dotfilesPath: z.string().optional(),
  lastUpdate: z.string().optional(),
});

type DotState = z.infer<typeof StateSchema>;

async function loadState(): Promise<DotState> {
  try {
    const raw = await Bun.file(STATE_PATH).json();
    return StateSchema.parse(raw);
  } catch {
    return {};
  }
}

async function saveState(state: DotState): Promise<void> {
  await Bun.write(STATE_PATH, JSON.stringify(state, null, 2));
}
```

### Anti-Patterns to Avoid
- **Hardcoded paths in source:** Use config or state files instead of `~/.dotfiles`
- **Mixing config and state:** Config (what to link) is user-controlled; state (where dotfiles live) is runtime-discovered
- **Blocking prompts in non-TTY:** Check `process.stdin.isTTY` before interactive prompts
- **Compiling with TS config support:** Bun binaries cannot dynamically import external TS files

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config validation | Manual type guards | Zod schemas | Runtime validation + type inference + clear errors |
| Interactive selection | Raw stdin handling | bun-promptx | Arrow keys, pagination, proper terminal handling |
| Path expansion | Manual ~ replacement | `path.resolve()` with HOME | Edge cases with relative paths, normalization |
| GitHub API calls | Raw fetch + parsing | Built-in fetch + typed responses | Already have fetch, just need proper typing |
| Symlink target resolution | Manual readlink | Existing `resolveSymlinkTarget()` | Already implemented correctly in codebase |

**Key insight:** The current codebase already has well-tested symlink handling. Reuse `resolveSymlinkTarget()`, `linksToExpectedResolved()`, and `pathExists()` from the existing implementation.

## Common Pitfalls

### Pitfall 1: TypeScript Config in Compiled Binary
**What goes wrong:** User creates `dot.config.ts`, compiled binary cannot import it
**Why it happens:** `bun build --compile` bundles all code; dynamic imports of external TS files fail
**How to avoid:**
  - Recommend JSON as primary format for compiled binary users
  - Document that TS configs require running via `bun dot` (not compiled binary)
  - Alternatively, require TS configs to be at fixed location and embed at compile time
**Warning signs:** "Cannot find module" errors when running compiled binary with TS config

### Pitfall 2: State File Permissions
**What goes wrong:** State file created with wrong permissions, or parent directory missing
**Why it happens:** First run, no `~/.config/dot/` directory exists
**How to avoid:** Use `mkdir -p` equivalent before writing state file
**Warning signs:** ENOENT errors on state file operations

### Pitfall 3: Self-Update Binary Replacement
**What goes wrong:** Cannot replace running binary on some systems
**Why it happens:** macOS/Linux may lock executing binaries differently
**How to avoid:**
  - Download to temp location first
  - Replace binary atomically (rename, not write-in-place)
  - On failure, leave temp file with instructions
**Warning signs:** ETXTBSY or permission errors during update

### Pitfall 4: Interactive Prompts in Non-TTY
**What goes wrong:** Prompts hang or crash when stdin is not a terminal
**Why it happens:** CI/CD, piped input, cron jobs
**How to avoid:** Check `process.stdin.isTTY` before prompts, fail with clear error or use defaults
**Warning signs:** Hanging processes, readline errors

### Pitfall 5: Symlink Source vs Target Confusion
**What goes wrong:** Config has source/target reversed, creating backwards symlinks
**Why it happens:** Inconsistent terminology (source/dest, from/to, src/tgt)
**How to avoid:** Use clear naming: `source` = file in dotfiles repo, `target` = location in home
**Warning signs:** Symlinks pointing from repo into home instead of home into repo

### Pitfall 6: Path Normalization in Config
**What goes wrong:** Config with `~/...` paths not expanded, or relative paths resolved incorrectly
**Why it happens:** JSON stores literal strings, needs expansion at load time
**How to avoid:** Normalize all paths immediately after loading config
**Warning signs:** "File not found" with paths containing `~`

## Code Examples

Verified patterns from official sources:

### Bun Compile with Embedded Files
```typescript
// Source: https://bun.com/docs/bundler/executables

// Build command: bun build --compile --outfile dot ./index.ts

// At runtime, list embedded files:
import { embeddedFiles } from "bun";
for (const file of embeddedFiles) {
  console.log(`${file.name} - ${file.size} bytes`);
}
```

### Interactive Text Input with bun-promptx
```typescript
// Source: https://github.com/wobsoriano/bun-promptx
import { createPrompt } from 'bun-promptx';

const { value, error } = createPrompt('Enter dotfiles path: ');
if (error) {
  console.error('Input cancelled');
  process.exit(1);
}
console.log(`You entered: ${value}`);
```

### GitHub Releases API for Self-Update
```typescript
// Source: https://docs.github.com/en/rest/releases/releases

interface Release {
  tag_name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

async function getLatestRelease(owner: string, repo: string): Promise<Release> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases/latest`,
    {
      headers: { 'Accept': 'application/vnd.github+json' }
    }
  );
  return response.json();
}

async function downloadAsset(url: string, dest: string): Promise<void> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  await Bun.write(dest, buffer);
}
```

### Config with Zod Validation
```typescript
// Source: https://zod.dev/

import { z } from 'zod';

const LinkSchema = z.object({
  source: z.string().describe('Path within dotfiles repo'),
  target: z.string().describe('Symlink location (supports ~ expansion)'),
});

const DotConfigSchema = z.object({
  version: z.literal(1),
  links: z.array(LinkSchema),
  autoCommit: z.boolean().default(true),
});

// Type is automatically inferred
type DotConfig = z.infer<typeof DotConfigSchema>;

// Safe parsing returns discriminated union
function loadConfig(data: unknown): DotConfig | null {
  const result = DotConfigSchema.safeParse(data);
  if (result.success) return result.data;
  console.error('Config validation failed:', result.error.flatten());
  return null;
}
```

### Console Iteration for Simple Prompts
```typescript
// Source: https://bun.com/docs/guides/process/stdin

// Simple yes/no confirmation
async function confirm(message: string): Promise<boolean> {
  process.stdout.write(`${message} [y/N] `);
  for await (const line of console) {
    const answer = line.trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  }
  return false;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual readline | bun-promptx / @inquirer/prompts | 2024 | Better UX, proper terminal handling |
| Node.js pkg | bun build --compile | 2023 | Faster builds, smaller binaries |
| Manual type checking | Zod runtime validation | 2022 | Type inference + runtime safety |
| curl install scripts | GitHub Releases API | Standard | Verifiable checksums, multiple architectures |

**Deprecated/outdated:**
- `inquirer` (old version): Use `@inquirer/prompts` or `bun-promptx` instead
- Manual TTY handling: Use proper prompt libraries

## Open Questions

Things that couldn't be fully resolved:

1. **TypeScript Config Loading in Compiled Binary**
   - What we know: Compiled binaries cannot dynamically import external TS files
   - What's unclear: Best user experience when they want TS config with compiled binary
   - Recommendation: Document that TS configs require `bun` installed, or provide transpile-on-first-run option

2. **Self-Update Architecture Hosting**
   - What we know: Can use GitHub Releases API, need to determine release naming convention
   - What's unclear: Will this be hosted on personal GitHub? What's the repo structure?
   - Recommendation: Start with GitHub Releases; naming like `dot-darwin-arm64`, `dot-darwin-x64`, `dot-linux-x64`

3. **Code Signing for macOS**
   - What we know: macOS may require signed binaries for Gatekeeper; codesign command available
   - What's unclear: Whether unsigned binaries will work for users (they may need `xattr -d`)
   - Recommendation: Document the `xattr -d com.apple.quarantine ./dot` workaround initially

## Sources

### Primary (HIGH confidence)
- [Bun Single-file Executables](https://bun.com/docs/bundler/executables) - Compile flags, embedding, cross-compilation
- [Bun stdin Documentation](https://bun.com/docs/guides/process/stdin) - Console iteration patterns
- [Zod Documentation](https://zod.dev/) - Schema validation API
- [GitHub Releases API](https://docs.github.com/en/rest/releases) - Asset download endpoints

### Secondary (MEDIUM confidence)
- [bun-promptx](https://github.com/wobsoriano/bun-promptx) - Prompt library API (verified working)
- [oclif plugin-update](https://github.com/oclif/plugin-update) - Self-update patterns (different stack but good patterns)

### Tertiary (LOW confidence)
- WebSearch results on dotfiles manager patterns - Informed architecture but not authoritative

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Verified with official Bun docs and library repos
- Architecture: HIGH - Based on existing codebase patterns and official docs
- Pitfalls: MEDIUM - Based on known issues and common patterns, some extrapolated
- Self-update: MEDIUM - Patterns clear, hosting details TBD

**Research date:** 2026-01-31
**Valid until:** 2026-03-01 (30 days - stable domain)

---

## Common Dotfiles to Detect (for Init Wizard)

Based on research, the init wizard should scan for these common dotfiles:

### Shell Configuration
| File | Purpose |
|------|---------|
| `~/.bashrc` | Bash interactive shell config |
| `~/.bash_profile` | Bash login shell config |
| `~/.zshrc` | Zsh interactive shell config |
| `~/.zprofile` | Zsh login shell config |
| `~/.zshenv` | Zsh environment (always loaded) |

### Version Control
| File | Purpose |
|------|---------|
| `~/.gitconfig` | Git configuration |
| `~/.config/git/config` | XDG-style Git config |

### Editors
| File | Purpose |
|------|---------|
| `~/.vimrc` | Vim configuration |
| `~/.config/nvim/` | Neovim config directory |
| `~/Library/Application Support/Code/User/settings.json` | VS Code settings (macOS) |

### Terminal
| File | Purpose |
|------|---------|
| `~/.tmux.conf` | tmux configuration |
| `~/.config/starship.toml` | Starship prompt config |
| `~/.config/alacritty/` | Alacritty terminal config |

### Other Common
| File | Purpose |
|------|---------|
| `~/.ssh/config` | SSH client config (careful - may contain sensitive paths) |
| `~/.npmrc` | npm configuration |
| `~/.config/` | XDG config directory (scan for subdirs) |

**Recommendation:** Start with shell configs (.zshrc, .bashrc), git config, and a few common tools. Don't overwhelm users with too many options.
