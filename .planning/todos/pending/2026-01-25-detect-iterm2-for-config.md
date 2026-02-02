---
created: 2026-01-25T$(date "+%H:%M")
title: Detect iTerm2 installation for recommended deps
area: tooling
files:
  - dot/index.ts
---

## Problem

The dotfiles include an iTerm2 config, but dot doctor doesn't check if iTerm2 is installed. Users might not realize they have an iTerm config available, or might be using Terminal.app without knowing there's a preconfigured option.

## Solution

Add iTerm2 to recommended (not required) dependencies in dot doctor:
1. Check if iTerm2 is installed (e.g., `/Applications/iTerm.app` exists or `brew list --cask iterm2`)
2. If not installed, show in "recommended" section (not blocking)
3. Mention that dotfiles include iTerm2 config they could use
