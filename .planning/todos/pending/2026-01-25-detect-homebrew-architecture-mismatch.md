---
created: 2026-01-25T$(date "+%H:%M")
title: Detect Homebrew architecture mismatch in dot doctor
area: tooling
files:
  - dot/index.ts
  - zsh/zprofile
---

## Problem

The config hardcodes `/opt/homebrew` (Apple Silicon path), but Intel Macs use `/usr/local` for Homebrew. This makes the dotfiles non-portable across Mac architectures.

Current state:
- zsh/zprofile likely has hardcoded `/opt/homebrew` paths
- dot doctor doesn't detect this mismatch
- Users on Intel Macs would have broken PATH or tool initialization

## Solution

Add architecture detection to dot doctor:
1. Detect current architecture (`uname -m` → arm64 vs x86_64)
2. Determine correct Homebrew prefix (`/opt/homebrew` vs `/usr/local`)
3. Scan config files for hardcoded Homebrew paths that don't match
4. Report as issue if mismatch found, suggest fix
