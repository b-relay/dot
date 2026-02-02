# Phase 8: Doctor-Reviewed Migration - Context

**Gathered:** 2026-02-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Store reviewed paths at `~/.config/dot/reviewed.json` instead of in the dotfiles repo. Add flexible ignore durations (1 month, custom days, forever) and a command to list/manage ignored paths. No migration needed — no existing users.

</domain>

<decisions>
## Implementation Decisions

### Ignore durations
- Single preset: 1 month
- Custom: numeric input for days
- Forever: permanent ignore, stored distinctly
- Confirm if custom days > 999 (catch typos)
- When paths expire, doctor says "X paths came back from review" at top of output

### Forever handling
- Same level as other options in selection menu
- Undo via `dot ignore --unignore <path>` or by editing reviewed.json directly
- When listing ignored paths, show expiry date or "permanent" for forever items

### Ignore command
- `dot ignore --list` to list all ignored paths with their expiry dates
- `dot ignore --unignore <path>` to remove a path from ignore list

### Review prompt UX
- Issues listed first, then "Would you like to fix anything?" at end
- Arrow-key selection: 1 month → Forever → Custom → Don't ignore
- One path at a time (no batch selection)
- Brief inline confirmation: "✓ Ignored until Mar 15" or "✓ Ignored permanently"
- If user declines to fix anything: silent exit

### Doctor output
- Update Claude prompt to specify no markdown (terminal output)
- Fix menu offers ignore only (no auto-fix options)

### Claude's Discretion
- Custom days input flow (how the text input appears after selection)
- Context shown in ignore prompt (path only vs path + reason)
- reviewed.json file format and structure

</decisions>

<specifics>
## Specific Ideas

- Order of options matters: 1 month first (common case), Forever second (power users), Custom third, Don't ignore last
- File should be human-readable so users can edit directly if preferred

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-doctor-reviewed-migration*
*Context gathered: 2026-02-01*
