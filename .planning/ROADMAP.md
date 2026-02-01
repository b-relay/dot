# Roadmap: dot CLI v2.1 Polish & Self-Update

## Overview

Milestone v2.1 enhances the dot CLI with self-update capability, improved diagnostics, and refined UX based on real usage. Starting with low-risk refinements to the init wizard and doctor-reviewed tracking, progressing through brewfile sync enhancements, and culminating with the self-update mechanism. This milestone adds no new dependencies—all features leverage existing Bun APIs and the established @clack/prompts library.

## Milestones

- ✅ **v1.0 Onboarding MVP** - Phases 1-2 (shipped 2025)
- ✅ **v1.1 Architecture Portability** - Phases 3-4 (shipped 2025)
- ✅ **v2.0 Standalone CLI** - Phases 5-6 (shipped 2026-02-01)
- 🚧 **v2.1 Polish & Self-Update** - Phases 7-11 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (7, 8, 9, 10, 11): Planned milestone work (continues from v2.0)
- Decimal phases (7.1, 7.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>✅ v1.0 Onboarding MVP (Phases 1-2) - SHIPPED 2025</summary>

### Phase 1: Core Foundation
**Goal**: Users can manage symlinks and check dependencies
**Plans**: Multiple plans
**Status**: Complete

### Phase 2: Dependency Checking
**Goal**: Users are guided when dependencies are missing
**Plans**: Multiple plans
**Status**: Complete

</details>

<details>
<summary>✅ v1.1 Architecture Portability (Phases 3-4) - SHIPPED 2025</summary>

### Phase 3: Dynamic Homebrew Paths
**Goal**: Tool works across Apple Silicon and Intel Macs
**Plans**: Multiple plans
**Status**: Complete

### Phase 4: Path Hardcoding Detection
**Goal**: Doctor detects architecture-specific path issues
**Plans**: Multiple plans
**Status**: Complete

</details>

<details>
<summary>✅ v2.0 Standalone CLI (Phases 5-6) - SHIPPED 2026-02-01</summary>

### Phase 5: External Config
**Goal**: Users can configure dot via JSON without modifying source
**Plans**: Multiple plans
**Status**: Complete

### Phase 6: Init Wizard
**Goal**: Users can interactively discover and add dotfiles
**Plans**: Multiple plans
**Status**: Complete

</details>

## 🚧 v2.1 Polish & Self-Update (In Progress)

**Milestone Goal:** Add self-update capability, improve diagnostics, and refine brewfile/doctor UX based on real usage

### Phase 7: Init Wizard Fixes
**Goal**: Init wizard handles edge cases and provides better testing/guidance
**Depends on**: Nothing (refinement of existing Phase 6 functionality)
**Requirements**: INIT-01, INIT-02, INIT-03, INIT-04
**Success Criteria** (what must be TRUE):
  1. User browsing directories never sees /tmp folders
  2. User can test init command without creating symlinks using --dry-run flag
  3. User sees helpful annotations for non-valuable dotfiles (caches, temp files)
  4. False conflict detection bug is resolved and verified
**Plans**: TBD

Plans:
- [ ] 07-01: TBD

### Phase 8: Doctor-Reviewed Migration
**Goal**: Reviewed paths stored in machine-specific location with flexible ignore options
**Depends on**: Nothing (independent cleanup)
**Requirements**: REVIEW-01, REVIEW-02, REVIEW-03
**Success Criteria** (what must be TRUE):
  1. Reviewed paths stored at ~/.config/dot/reviewed.json instead of in dotfiles repo
  2. User can specify custom ignore duration when reviewing a path
  3. User can choose "forever" option to permanently ignore a path
  4. Existing reviewed paths auto-migrate on first doctor run after update
**Plans**: TBD

Plans:
- [ ] 08-01: TBD

### Phase 9: Brewfile Sync UX
**Goal**: Brewfile sync adapts to installed packages and lets users control exclusions
**Depends on**: Nothing (enhancement of existing sync functionality)
**Requirements**: BREW-01, BREW-02, BREW-03, BREW-04, BREW-05
**Success Criteria** (what must be TRUE):
  1. Sync discovers package types dynamically from brew bundle dump output
  2. User is prompted with interactive multiselect to choose exclusions
  3. User sees type counts (e.g., "vscode (42 extensions)") in selection UI
  4. Exclusion preferences persist in dot config file
  5. No hardcoded default exclusions—user makes explicit choices
**Plans**: TBD

Plans:
- [ ] 09-01: TBD

### Phase 10: Enhanced Diagnostics
**Goal**: Doctor provides comprehensive environment information for troubleshooting
**Depends on**: Nothing (extends existing doctor infrastructure)
**Requirements**: DIAG-01, DIAG-02
**Success Criteria** (what must be TRUE):
  1. Doctor detects iTerm2 via TERM_PROGRAM environment variable
  2. Doctor falls back to /Applications/iTerm.app check if TERM_PROGRAM unset
  3. Doctor shows environment info section with shell version
  4. Doctor shows Homebrew prefix and system architecture in environment info
**Plans**: TBD

Plans:
- [ ] 10-01: TBD

### Phase 11: Self-Update Foundation
**Goal**: Users can update dot from GitHub releases with confidence
**Depends on**: Nothing (new standalone capability)
**Requirements**: UPDATE-01, UPDATE-02, UPDATE-03, UPDATE-04, UPDATE-05
**Success Criteria** (what must be TRUE):
  1. User can check for updates via `dot update` command
  2. User sees comparison of current version vs latest available version
  3. User sees release notes/changelog before confirming update
  4. User is prompted for confirmation before downloading and building
  5. Source code is fetched from GitHub and built locally with Bun
  6. Binary replacement is atomic (backup/rollback on failure)
**Plans**: TBD

Plans:
- [ ] 11-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 7 → 8 → 9 → 10 → 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Core Foundation | v1.0 | N/A | Complete | 2025 |
| 2. Dependency Checking | v1.0 | N/A | Complete | 2025 |
| 3. Dynamic Homebrew Paths | v1.1 | N/A | Complete | 2025 |
| 4. Path Hardcoding Detection | v1.1 | N/A | Complete | 2025 |
| 5. External Config | v2.0 | N/A | Complete | 2026-02-01 |
| 6. Init Wizard | v2.0 | N/A | Complete | 2026-02-01 |
| 7. Init Wizard Fixes | v2.1 | 0/TBD | Not started | - |
| 8. Doctor-Reviewed Migration | v2.1 | 0/TBD | Not started | - |
| 9. Brewfile Sync UX | v2.1 | 0/TBD | Not started | - |
| 10. Enhanced Diagnostics | v2.1 | 0/TBD | Not started | - |
| 11. Self-Update Foundation | v2.1 | 0/TBD | Not started | - |
