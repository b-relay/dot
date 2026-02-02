# Phase 9: Brewfile Sync UX & Command Restructure - Context

**Gathered:** 2026-02-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Improve Brewfile sync by discovering package types dynamically, prompting for exclusions interactively, and persisting preferences. Restructure commands so ignore/unignore live under `doctor` and a new `list` command shows current state. Auto-commit when enabled.

</domain>

<decisions>
## Implementation Decisions

### Exclusion selection UI
- Use @clack/prompts built-in multiselect component
- Counts displayed inline with label: `vscode (42 extensions)` — lowercase type names to match Brewfile syntax
- Nothing pre-selected — user explicitly chooses every exclusion
- Hide zero-count types — only show types that actually have packages
- No select/deselect all shortcuts — user selects individually
- Prompt text: "Which types do you NOT want in your Brewfile?"
- After selection, show summary + confirmation: "Excluding: vscode, mas. Syncing: brew, cask, tap. Continue?"

### Sync workflow behavior
- Always offer to change exclusions, but non-intrusively
- Show current exclusions with modify option: "Excluding: vscode, mas. Press 'm' to modify, Enter to continue"
- Detect new package types that weren't reviewed yet — prompt separately for new types before showing full summary
- Separate prompt for new types: first ask about new types, then show exclusion summary
- Show diff summary of Brewfile changes before auto-commit (if autoCommit enabled)
- Silent success when no changes: "Brewfile up to date" — no diff, no commit prompt

### Command restructure
- `dot doctor --ignore [path]` — path optional, shows picker of untracked paths if no arg
- Picker shows paths from doctor's untracked detection (no Claude analysis, just the path list)
- `dot doctor --unignore` — shows picker of currently ignored paths for selection
- `dot list` — three labeled sections: symlinks, ignored paths, sync exclusions

### Config persistence
- Two-tier exclusion storage:
  - Universal defaults in `dot.config.json` (syncs with dotfiles repo)
  - Local additions in `~/.config/dot/` (machine-specific)
- Local exclusions ADD to universal — universal is baseline, local can add more
- Simple array of type strings: `["vscode", "mas"]`
- `dot sync --edit` allows modifying both universal and local exclusions through interactive prompts

### Claude's Discretion
- Exact key names in config files
- Local config filename (sync.json or similar)
- Diff format for Brewfile changes summary
- Exact wording of prompts beyond specified text

</decisions>

<specifics>
## Specific Ideas

- The "press 'm' to modify, Enter to continue" pattern keeps sync fast for repeat runs while allowing changes
- New type detection ensures users don't accidentally sync package types they didn't know about
- Two-tier config mirrors how dotfiles work: repo-level defaults + machine-specific overrides

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-brewfile-sync-ux*
*Context gathered: 2026-02-02*
