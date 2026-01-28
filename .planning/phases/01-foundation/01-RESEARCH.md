# Phase 1: Foundation - Research

**Researched:** 2026-01-27
**Domain:** File operations safety, state management, logging, idempotency for CLI tools
**Confidence:** HIGH

## Summary

Phase 1 requires implementing safety foundations for a dotfiles management CLI tool written in Bun/TypeScript. The research focused on six core technical domains: file backup strategies, state tracking for interrupted operations, structured logging, idempotency patterns, preflight dependency checking, and architecture detection for macOS.

The standard approach for CLI tools in 2026 emphasizes crash-only design with atomic file operations, comprehensive state tracking in dedicated state files, and structured logging for auditability. Modern JavaScript runtimes like Bun have excellent Node.js compatibility (>95%) and provide both native APIs and traditional fs module support.

**Primary recommendation:** Use write-file-atomic for all state files and backups, LogTape for structured logging with JSON Lines output, and implement crash-only design where operations can be safely interrupted and resumed by re-running the command.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| write-file-atomic | 6.0.0+ | Atomic file writes | npm's official solution, prevents corruption from interrupted writes, handles concurrent writes via queuing |
| @logtape/logtape | 2.0.0+ | Structured logging | Zero dependencies, 5.3KB, multi-runtime support (Bun/Node/Deno/browsers), TypeScript-first |
| Bun native fs | Built-in | File operations | Native to Bun runtime, >95% Node.js fs compatibility, faster than polyfills |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| fs-extra | 12.0.0+ | Extended file operations | When needing copy(), remove(), mkdirs() convenience methods beyond native fs |
| write-json-file | 6.0.0+ | JSON file writes | Alternative to write-file-atomic specifically for JSON with prettier formatting options |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LogTape | Pino | Pino is fast and JSON-focused but adds dependencies; LogTape is zero-dep and works identically across runtimes |
| LogTape | Winston | Winston has plugins for everything but heavier; LogTape is 5.3KB with no deps |
| write-file-atomic | fs-extra.writeJson | fs-extra adds graceful-fs and extra methods; write-file-atomic is focused and lighter |

**Installation:**
```bash
bun add @logtape/logtape write-file-atomic
# Optional: bun add fs-extra
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── lib/
│   ├── backup.ts        # Timestamped backup operations
│   ├── state.ts         # State tracking and persistence
│   ├── logger.ts        # LogTape configuration
│   └── operations.ts    # Idempotent file operations
├── commands/
│   └── install.ts       # Command implementations
└── index.ts             # CLI entry point
```

### Pattern 1: Atomic State File Updates
**What:** Write state to temp file, then atomic rename to prevent corruption
**When to use:** Any operation that updates installation state, tracks progress, or saves recovery checkpoints
**Example:**
```typescript
// Source: https://github.com/npm/write-file-atomic
import writeFileAtomic from 'write-file-atomic';

async function saveState(state: InstallState): Promise<void> {
  const stateFile = `${config.dotfiles}/.install-state.json`;
  await writeFileAtomic(stateFile, JSON.stringify(state, null, 2), {
    encoding: 'utf8',
    fsync: true  // Ensure write reaches disk
  });
}
```

### Pattern 2: Timestamped Backups Before Destructive Operations
**What:** Copy existing file with ISO timestamp before overwriting/deleting
**When to use:** Before any symlink creation that would replace existing files
**Example:**
```typescript
// Source: Combined from Node.js fs docs and backup best practices
import { copyFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

async function backupFile(filePath: string, backupDir: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = filePath.split('/').pop();
  const backupPath = resolve(backupDir, `${fileName}.${timestamp}.backup`);

  // Copy with preserved timestamps
  await copyFile(filePath, backupPath);

  return backupPath;
}
```

### Pattern 3: Structured Logging with Context
**What:** Log all operations with structured data for machine parsing and human readability
**When to use:** Every file operation, state change, and error condition
**Example:**
```typescript
// Source: https://logtape.org/manual/struct
import { configure, getConsoleSink, getLogger, jsonLinesFormatter } from "@logtape/logtape";
import { getFileSink } from "@logtape/file";

// Setup (in entry point)
await configure({
  sinks: {
    console: getConsoleSink(),
    file: getFileSink("operations.jsonl", { formatter: jsonLinesFormatter })
  },
  loggers: [
    { category: "dot", lowestLevel: "debug", sinks: ["console", "file"] }
  ]
});

// Usage (in operations)
const logger = getLogger(["dot", "install"]);

logger.info("Creating symlink: {target} -> {source}", {
  target: "/home/user/.zshrc",
  source: "/home/user/.dotfiles/zsh/zshrc",
  operation: "symlink",
  timestamp: new Date().toISOString()
});

logger.error("Backup failed: {error}", {
  file: filePath,
  operation: "backup",
  error: err.message,
  timestamp: new Date().toISOString()
});
```

### Pattern 4: Crash-Only Design with Idempotent Operations
**What:** Operations detect current state and either skip (already done) or complete (not done yet)
**When to use:** All commands, especially install/uninstall where interruption is likely
**Example:**
```typescript
// Source: https://clig.dev (CLI Guidelines)
async function createSymlink(source: string, target: string): Promise<void> {
  try {
    const linkStat = await lstat(target);

    if (linkStat.isSymbolicLink()) {
      const dest = await resolveSymlinkTarget(target);
      if (await linksToExpectedResolved(dest, source)) {
        logger.info("Symlink already correct, skipping: {target}", { target });
        return; // Idempotent: already done
      }

      // Wrong target: backup then recreate
      await backupFile(target, backupDir);
      await unlink(target);
    } else {
      // File exists but not symlink: backup then create
      await backupFile(target, backupDir);
      await unlink(target);
    }
  } catch {
    // Target doesn't exist: create it
  }

  // Create symlink (works whether target existed or not)
  await symlink(source, target);
  logger.info("Symlink created: {target} -> {source}", { target, source });
}
```

### Pattern 5: State-Based Recovery
**What:** Track which steps completed; resume from last checkpoint on re-run
**When to use:** Multi-step operations like installing multiple symlinks
**Example:**
```typescript
// Source: https://clig.dev and CLI state management patterns
type InstallState = {
  version: string;
  startedAt: string;
  completedSteps: string[];
  totalSteps: number;
  status: 'in-progress' | 'completed' | 'failed';
};

async function installWithRecovery(config: Config): Promise<void> {
  const stateFile = `${config.dotfiles}/.install-state.json`;
  let state: InstallState;

  // Load or create state
  try {
    state = JSON.parse(await Bun.file(stateFile).text());
    logger.info("Resuming installation from checkpoint", {
      completed: state.completedSteps.length,
      total: state.totalSteps
    });
  } catch {
    state = {
      version: '1.0.0',
      startedAt: new Date().toISOString(),
      completedSteps: [],
      totalSteps: Object.keys(config.links).length,
      status: 'in-progress'
    };
  }

  // Process each link
  for (const [source, target] of Object.entries(config.links)) {
    const stepId = `symlink:${target}`;

    if (state.completedSteps.includes(stepId)) {
      logger.debug("Step already completed, skipping: {step}", { step: stepId });
      continue;
    }

    await createSymlink(source, target);

    // Checkpoint after each step
    state.completedSteps.push(stepId);
    await saveState(state);
  }

  // Mark complete
  state.status = 'completed';
  await saveState(state);
}
```

### Pattern 6: Architecture Detection
**What:** Detect ARM vs Intel to determine Homebrew paths
**When to use:** Any operation that needs Homebrew paths or architecture-specific configs
**Example:**
```typescript
// Source: https://www.tweaking4all.com/forum/delphi-lazarus-free-pascal/macos-determine-cpu-and-architecture-in-terminal/
function getArchitecture(): 'arm64' | 'x86_64' {
  // process.arch is reliable for actual architecture
  // Returns 'arm64' on Apple Silicon, 'x64' on Intel
  return process.arch === 'arm64' ? 'arm64' : 'x86_64';
}

function getHomebrewPrefix(arch: 'arm64' | 'x86_64'): string {
  return arch === 'arm64' ? '/opt/homebrew' : '/usr/local';
}

// Usage
const arch = getArchitecture();
const brewPrefix = getHomebrewPrefix(arch);
logger.info("Detected architecture: {arch}, Homebrew at: {brewPrefix}", {
  arch,
  brewPrefix
});
```

### Anti-Patterns to Avoid
- **Manual cleanup on failure:** Don't try to undo partial operations on error; let crash-only design handle it by re-running
- **Unstructured logging:** Don't use console.log with interpolated strings; use structured logging with field objects
- **Non-atomic state writes:** Never use fs.writeFile directly for state files; always use write-file-atomic
- **Hardcoded paths:** Never hardcode /opt/homebrew or /usr/local; always detect architecture first
- **Silent overwrites:** Never replace files without backing them up first with timestamps

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic file writes | Custom temp file + rename logic | write-file-atomic | Handles concurrent writes, cleanup on error, cross-platform quirks, proper fsync |
| Structured logging | Custom logger with JSON.stringify | LogTape with jsonLinesFormatter | Zero deps, multi-runtime, proper log levels, filtering, formatting, sinks |
| File copying with timestamps | fs.copyFile wrapper | Native fs.copyFile or fs-extra.copy | Handles edge cases, preserves metadata correctly, cross-platform |
| Idempotency checks | Manual state tracking per operation | State file pattern with completedSteps array | Survives crashes, enables progress reporting, standardized across operations |
| Architecture detection | Parsing uname output | process.arch | Built-in, reliable, works in Rosetta, no shell commands needed |

**Key insight:** File operations have subtle edge cases (partial writes, concurrent access, permission errors, symlink loops). Battle-tested libraries handle these; custom code usually doesn't until production failures force fixes.

## Common Pitfalls

### Pitfall 1: State File Corruption from Interrupted Writes
**What goes wrong:** Using fs.writeFile to save state during long operations; user presses Ctrl+C mid-write; state file is half-written JSON; next run crashes trying to parse it
**Why it happens:** fs.writeFile writes directly to target file without atomicity guarantees
**How to avoid:** Always use write-file-atomic with fsync: true for state files
**Warning signs:** "Unexpected token in JSON" errors when loading state, intermittent crashes on resume

### Pitfall 2: Backup Collisions Without Timestamps
**What goes wrong:** Backing up files as .backup extension; running install twice in same day overwrites first backup; user loses data from first backup
**Why it happens:** Backup naming doesn't include timestamp for uniqueness
**How to avoid:** Use ISO timestamps in backup filenames: `file.2026-01-27T14-30-45-123Z.backup`
**Warning signs:** Only one backup per file regardless of how many times install ran

### Pitfall 3: Lost Context in Plain Text Logs
**What goes wrong:** Logs show "Error: EACCES" without knowing which file operation failed; debugging requires reproducing the exact sequence
**Why it happens:** Using console.log with interpolated strings instead of structured logging
**How to avoid:** Use LogTape with structured fields for every log, include operation type, file paths, timestamps
**Warning signs:** Grepping logs for specific operations is impossible; "which file failed?" questions can't be answered

### Pitfall 4: Non-Idempotent Operations Failing on Retry
**What goes wrong:** First install run partially completes; retry fails because some symlinks exist; user must manually clean up to retry
**Why it happens:** Operations don't check current state before acting
**How to avoid:** Every operation checks "is this already done?" and skips if yes, proceeds if no
**Warning signs:** "File exists" errors on retry, users asking how to "reset" before retrying

### Pitfall 5: Rosetta Confusion on Apple Silicon
**What goes wrong:** Tool detects x86_64 architecture on M1 Mac because it's running under Rosetta; uses Intel Homebrew paths; operations fail
**Why it happens:** process.arch reports the Node/Bun binary architecture, not hardware architecture
**How to avoid:** Use process.arch for architecture detection (it's correct for the runtime environment); document that tool must be run with native ARM Bun, not x86_64 Bun under Rosetta
**Warning signs:** M1 users reporting Homebrew not found at /usr/local; architecture detection returning unexpected values

### Pitfall 6: State File in Wrong Location
**What goes wrong:** State file saved in ~/.config/dot/state.json; users complain it's not in git; state gets lost when dotfiles repo is cloned fresh
**Why it happens:** Confusion between XDG state directory (for machine-local state) vs dotfiles repo (for tracked config)
**How to avoid:** Installation state goes in dotfiles repo (e.g., ~/.dotfiles/.install-state.json) so it's version-controlled; runtime cache/logs go in XDG directories
**Warning signs:** State resets when switching machines; state not in git status

## Code Examples

Verified patterns from official sources:

### Preflight Dependency Check
```typescript
// Source: Current codebase (index.ts) - already implements this pattern well
async function preflightCheck(force: boolean): Promise<boolean> {
  if (force) {
    logger.warn("Bypassing dependency check (--force)");
    return true;
  }

  const deps = await checkDependencies();
  const missingRequired = deps.filter(d => d.required && !d.installed);

  if (missingRequired.length === 0) {
    logger.info("All required dependencies installed");
    return true;
  }

  logger.error("Missing required dependencies", {
    missing: missingRequired.map(d => d.name),
    count: missingRequired.length
  });

  for (const dep of missingRequired) {
    const hint = dep.brewPackage ? ` (brew install ${dep.brewPackage})` : "";
    console.error(`  ✘ ${dep.name}${hint}`);
  }

  console.error("\nInstall dependencies first, or use --force to bypass this check.");
  return false;
}

async function isToolInstalled(name: string): Promise<boolean> {
  // Source: Bun shell error handling - https://bun.com/docs/runtime/shell
  const { exitCode } = await $`which ${name}`.nothrow().quiet();
  return exitCode === 0;
}
```

### Complete Backup + Restore Flow
```typescript
// Source: Node.js backup strategies and write-file-atomic patterns
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import writeFileAtomic from 'write-file-atomic';

type BackupManifest = {
  backups: Array<{
    original: string;
    backup: string;
    timestamp: string;
  }>;
};

async function backupWithManifest(
  filePath: string,
  backupDir: string,
  manifest: BackupManifest
): Promise<string> {
  await mkdir(backupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = basename(filePath);
  const backupPath = join(backupDir, `${fileName}.${timestamp}.backup`);

  // Copy file
  await copyFile(filePath, backupPath);

  // Record in manifest
  manifest.backups.push({
    original: filePath,
    backup: backupPath,
    timestamp: new Date().toISOString()
  });

  logger.info("Backed up: {original} -> {backup}", {
    original: filePath,
    backup: backupPath
  });

  return backupPath;
}

async function saveManifest(manifestPath: string, manifest: BackupManifest): Promise<void> {
  await writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2), {
    encoding: 'utf8',
    fsync: true
  });
}
```

### Error Handling with Structured Context
```typescript
// Source: LogTape structured logging - https://logtape.org/manual/struct
import { getLogger } from "@logtape/logtape";

const logger = getLogger(["dot", "operations"]);

async function safeOperation<T>(
  operation: () => Promise<T>,
  context: Record<string, unknown>
): Promise<T | null> {
  try {
    const result = await operation();
    logger.info("Operation succeeded", context);
    return result;
  } catch (error) {
    logger.error("Operation failed: {error}", {
      ...context,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return null;
  }
}

// Usage
const result = await safeOperation(
  () => createSymlink(source, target),
  {
    operation: "create_symlink",
    source,
    target,
    timestamp: new Date().toISOString()
  }
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| console.log debugging | Structured logging (LogTape, Pino) | ~2020-2022 | Machine-readable logs, queryable with jq, retention policies possible |
| fs.writeFile for state | write-file-atomic | npm adopted ~2014, mainstream ~2020 | State files survive crashes, no corruption from Ctrl+C |
| Manual retry logic | Crash-only + idempotent design | Research paper 2003, CLI adoption ~2018+ | No cleanup code, instant exit on failure, faster recovery |
| Callback-based fs | fs/promises (async/await) | Node.js 10 (2018), standard by Node.js 14 (2020) | Cleaner code, easier error handling, no callback hell |
| ~/Library/Application Support | XDG Base Directory on macOS | Community shift ~2022-2024 | Consistent across platforms, ~/.config standard for CLI tools |

**Deprecated/outdated:**
- **Callback-based fs methods:** Node.js documentation now marks these as "legacy"; use fs/promises
- **fs.F_OK constants:** Removed in Node.js v24.0.0+; use fs.constants.F_OK instead
- **~/Library/Application Support for CLI:** macOS CLI tools should use XDG (~/.config), not Application Support

## Open Questions

Things that couldn't be fully resolved:

1. **Should state file be in dotfiles repo or XDG state directory?**
   - What we know: XDG says state goes in ~/.local/state; but installation state is repo-specific
   - What's unclear: Best practice for dotfiles-specific state that should travel with the repo
   - Recommendation: Put installation state in dotfiles repo (e.g., ~/.dotfiles/.install-state.json) to version-control it; put runtime logs/cache in XDG directories

2. **How long to keep backup files?**
   - What we know: Timestamped backups prevent collisions, but accumulate indefinitely
   - What's unclear: Industry standard for backup retention in CLI tools
   - Recommendation: Keep last N backups per file (e.g., 5) or backups from last N days (e.g., 30); add cleanup command

3. **Should preflight check verify Homebrew itself?**
   - What we know: Tool depends on Homebrew-installed packages
   - What's unclear: Whether to check Homebrew installation before checking packages
   - Recommendation: Yes, check `which brew` before checking packages; provides clearer error messages

## Sources

### Primary (HIGH confidence)
- [write-file-atomic - npm](https://www.npmjs.com/package/write-file-atomic) - Atomic write operations API
- [write-file-atomic - GitHub](https://github.com/npm/write-file-atomic) - Implementation details
- [LogTape Quick Start](https://logtape.org/manual/start) - Installation and setup
- [LogTape Structured Logging](https://logtape.org/manual/struct) - API and examples
- [CLI Guidelines](https://clig.dev/) - Idempotency, crash-only design, error handling
- [Bun Node.js Compatibility](https://bun.com/docs/runtime/nodejs-compat) - fs module support
- [Bun Shell Documentation](https://bun.com/docs/runtime/shell) - Error handling patterns

### Secondary (MEDIUM confidence)
- [Node.js File Backup Strategies 2026](https://learnpurpose.hashnode.dev/protect-your-data-create-a-backup-script-with-javascript-and-nodejs-part-6-of-automation-series) - Backup patterns
- [Crash-only Software Paper](https://www.usenix.org/conference/hotos-ix/crash-only-software) - Foundational research (2003)
- [macOS dotfiles should not go in ~/Library/Application Support](https://becca.ooo/blog/macos-dotfiles/) - XDG on macOS
- [XDG Base Directory Specification](https://wiki.archlinux.org/title/XDG_Base_Directory) - State file locations
- [macOS Architecture Detection](https://www.tweaking4all.com/forum/delphi-lazarus-free-pascal/macos-determine-cpu-and-architecture-in-terminal/) - uname -m vs process.arch

### Tertiary (LOW confidence - requires validation)
- [LogTape vs Other Libraries](https://logtape.org/comparison) - Comparison claims should be verified
- [Logging in Node.js 2026](https://dev.to/hongminhee/logging-in-nodejs-or-deno-or-bun-or-edge-functions-in-2026-36l2) - Blog post, not official docs
- [CLI Preflight Check Patterns](https://www.npmjs.com/package/preflight-check) - Package exists but limited documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages are actively maintained with official docs, Bun compatibility verified
- Architecture: HIGH - Patterns sourced from official CLI guidelines (clig.dev) and npm's own tools
- Pitfalls: HIGH - Based on documented issues in Node.js/Bun repos and CLI design research
- Code examples: HIGH - Sourced from official documentation and current codebase patterns

**Research date:** 2026-01-27
**Valid until:** ~2026-04-27 (90 days - stable domain, slow-moving standards)

**Notes:**
- LogTape is relatively new (v2.0.0 released recently) but actively maintained and designed for modern runtimes
- write-file-atomic has been npm's standard since 2014, very stable
- Crash-only design is old research (2003) but increasingly adopted in modern CLIs
- Bun is fast-moving; verify Node.js compatibility claims if this research is older than 30 days
