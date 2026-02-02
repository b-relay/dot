---
quick-task: 001
description: Update tests for phase 8.1 changes
completed: 2026-02-02
---

# Quick Task 001: Update Tests for Phase 8.1 Changes

## Summary

Added tests for the new `hasNewLinks` property and `expandPath` function introduced in Phase 8.1.

## Changes Made

### New Tests Added

1. **expandPath tests** (5 tests):
   - Expands `~` to home directory
   - Expands `~/` at start only
   - Returns absolute paths unchanged
   - Resolves relative paths to absolute using cwd
   - Handles `~` alone

2. **hasNewLinks assertions** added to all existing previewSymlinks tests:
   - `new` status → hasNewLinks=true
   - `will-create` status → hasNewLinks=true
   - `already-linked` status → hasNewLinks=false
   - `wrong-target` status → hasNewLinks=true
   - `conflict` status → hasNewLinks=true
   - Mixed statuses → hasNewLinks=true

3. **New test cases**:
   - "returns hasNewLinks=false when all links are already correct"
   - "works with relative source paths (as config stores them)"

## Test Results

- **Before:** 218 tests passing
- **After:** 225 tests passing (+7 new tests)

## Commit

`f6112d4` - test(wizard): add tests for hasNewLinks and expandPath
