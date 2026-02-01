# Phase 7: Init Wizard Fixes - Context

**Gathered:** 2026-02-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Refine the existing init wizard to handle edge cases and provide better testing/guidance. Covers: filtering noise from directory browsing, adding --dry-run flag, annotating low-value files, and fixing false conflict detection. No new wizard features—this is polish and bug fixes.

</domain>

<decisions>
## Implementation Decisions

### Directory filtering
- Filter system noise (/tmp, /var, /private) plus common caches (~/Library/Caches, node_modules, .git)
- Filtered directories shown but disabled (greyed out), not hidden
- Display format: `dim("node_modules — skipped (cache dir)")`
- Users can override filter with confirmation warning ("Are you sure?")

### Dry-run output
- --dry-run runs full interactive wizard flow, but doesn't execute
- Output grouped by action type: "New symlinks", "Would replace", "Conflicts"
- Use colors: green for new, yellow for replace, red for conflicts
- End with prompt: "Apply these changes now? [y/n]" (default: no)
- User can convert dry-run to real execution if they confirm

### File annotations
- Annotate cache/temp patterns: .cache, .tmp, *_history, *.log
- Also annotate app-specific: .DS_Store, .localized, Thumbs.db, desktop.ini
- Allow user customization of patterns in config file
- Group display: valuable files first, then "Other files:" section
- "Other files" section collapsed if >5 items, expanded if ≤5
- Users can select from "Other files" but see warning: "This file may not be worth tracking"

### Conflict detection
- Symlink pointing to correct target: show as "already linked" (green/check)
- Real conflict (file exists, not symlink): ask user for each conflict individually
- Resolution options offered per conflict:
  1. Backup and replace (move to .backup, create symlink)
  2. Show diff first (display differences, then choose)
  3. Create merge conflict markers (user resolves manually)
- No "apply to all" option—each conflict handled individually

### Claude's Discretion
- Exact color/styling implementation
- Conflict marker format if merge style chosen
- Backup file naming convention (.backup vs .bak vs timestamped)
- Warning message wording

</decisions>

<specifics>
## Specific Ideas

- Dim styling should clearly communicate "skipped" without being invisible
- Dry-run should feel like a safe preview—user gains confidence before committing
- The conflict resolution flow should feel like git's interactive staging

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-init-wizard-fixes*
*Context gathered: 2026-02-01*
