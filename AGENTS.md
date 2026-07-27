# dot CLI - Claude Guidance

## Overview

Bun/TypeScript CLI tool for managing dotfiles. Located in `dot/index.ts`.

## Architecture

### Config Type

The `Config` type holds all configuration:
- `dotfiles` - Path to dotfiles repo (~/.dotfiles)
- `dotconfig` - Path to ~/.config
- `home` - User's home directory
- `reviewedFile` - Path to .doctor-reviewed.json
- `links` - Record mapping source paths to target symlink locations

### LINKS Map

The `links` record in `createConfig()` defines all symlinks. Each entry maps a source file in the dotfiles repo to its target location on the system.

### Key Functions

| Function | Purpose |
|----------|---------|
| `install()` | Creates symlinks from LINKS map |
| `uninstall()` | Removes symlinks that point to our sources |
| `sync()` | Updates brewfile from current Homebrew state |
| `doctor()` | Gathers system state and analyzes with Claude |
| `review()` | Marks a path as reviewed for 90 days |

### Symlink Helpers

- `resolveSymlinkTarget()` - Resolves symlink to absolute path
- `linksToExpectedResolved()` - Checks if symlink points to expected source
- `pathExists()` - Checks if path exists using stat

## Testing

Test files are in `tests/`:
- `index.test.ts` - Unit tests for individual functions
- `integration.test.ts` - Integration tests with temp directories

Run tests:
```bash
cd dot && bun test
```

## Extending

To add a new command:

1. Add the function implementing the command
2. Add case to the switch statement at the bottom of index.ts
3. Update the `help()` function
4. Export the function if it needs testing
