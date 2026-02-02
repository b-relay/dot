---
status: complete
phase: 06-decouple-dot-cli
source: 06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md, 06-04-SUMMARY.md, 06-05-SUMMARY.md
started: 2026-02-01T05:30:00Z
updated: 2026-02-01T05:50:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Config Loading with --dotfiles Flag
expected: Running `dot --dotfiles /path/to/other install` uses the specified path instead of default ~/.dotfiles
result: pass

### 2. DOT_HOME Environment Variable
expected: Setting `DOT_HOME=/path/to/dotfiles` and running `dot install` uses that path
result: pass

### 3. Init Wizard First Run
expected: Running `dot init` starts interactive wizard with dotfiles path selection via directory browser
result: pass

### 4. Init Wizard Symlink Scanning
expected: Wizard scans for existing symlinks and shows them with status (already-linked, broken, available)
result: pass

### 5. Init Wizard Config Generation
expected: After init completes, dot.config.json is created with selected symlink mappings
result: pass

### 6. Track Command Interactive
expected: Running `dot link ~/.bashrc` prompts for destination folder, moves file, creates symlink, updates config
result: pass

### 7. Track Command --as Flag
expected: Running `dot link ~/.bashrc --as bash/bashrc` skips prompts, uses specified path
result: pass

### 8. Move Command
expected: Running `dot move <path> --self` moves dotfiles folder, updates all symlinks, updates state
result: pass

### 9. Move Command Confirmation
expected: Running `dot move` without --force shows confirmation prompt before proceeding
result: pass

### 10. Version Flag
expected: Running `dot --version` or `dot -v` shows version number (e.g., "dot v0.1.0")
result: pass

### 11. Update Command
expected: Running `dot update` shows update instructions
result: pass

### 12. Standalone Binary Works
expected: Compiled binary from `bun run build:release` works without Bun runtime installed
result: pass

## Summary

total: 12
passed: 12
issues: 0
pending: 0
skipped: 0

## Gaps

[none]
