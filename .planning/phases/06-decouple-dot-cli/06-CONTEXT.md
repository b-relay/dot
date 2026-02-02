# Phase 6: Decouple dot CLI - Context

**Gathered:** 2026-01-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the `dot` CLI work independently of any specific dotfiles repo structure. Users can configure symlink mappings via config file, specify dotfiles location, and install dot standalone. The CLI helps users set up new dotfiles repos and add files to existing ones.

</domain>

<decisions>
## Implementation Decisions

### Config format & location
- Support both JSON and TypeScript config formats (user's choice)
- Config file lives inside dotfiles repo (e.g., `dot.config.json` or `dot.config.ts`)
- On first run with no config, dot prompts interactively: "Where are your dotfiles?"
- Store discovered location in `~/.config/dot/state.json` for future runs
- Override via `--dotfiles <path>` flag or `DOT_HOME` env var
- Add `dot move` command to relocate dotfiles folder and update stored location

### Init/setup experience
- Guided wizard on first run
- Wizard scans for common dotfiles in home directory and offers to migrate them
- If existing dotfiles repo found, detect if it matches dot format
  - If matches: adopt and generate config
  - If different format: separate migration wizard (future version)
- Can also import from URL: `dot init --from github.com/user/dotfiles`
- Scan home directory symlinks to help reconstruct config if missing
- Always initialize git in dotfiles folder
- After init, show dry-run preview of symlinks, then ask for confirmation before creating

### Adding new dotfiles
- Command: `dot track <path>` (not "add" to avoid git confusion)
- Interactive destination selection:
  - Show list of existing folders in dotfiles repo
  - Option to create new folder and name it
  - Can also specify via flag: `dot track ~/.zshrc --as zsh/zshrc`
- Auto-commit behavior configured during init (default: yes)
- On conflict (file already in repo):
  - Prompt with options: Replace / Backup and replace / Create git merge conflict
  - User resolves in their preferred git merge editor if they choose merge conflict

### Distribution method
- Primary: Standalone binary via `bun build --compile`
- Install script asks user: `~/.local/bin` or `/usr/local/bin`
- `dot update` command for self-updates (fetches and replaces binary)

### Claude's Discretion
- Exact config schema structure
- Which common dotfiles to detect during init wizard
- Install script implementation details
- State file format for storing dotfiles location

</decisions>

<specifics>
## Specific Ideas

- Migration wizard for non-dot-format repos is explicitly out of scope for v1 — just detect and defer
- Use same dry-run preview pattern for both init and track commands
- Conflict resolution with git merge conflict option is nice-to-have if complex

</specifics>

<deferred>
## Deferred Ideas

- Migration wizard for arbitrary dotfiles repo formats — future phase
- Homebrew formula distribution — could add later
- npm/bun package distribution — could add later
- Template system for common dotfiles setups

</deferred>

---

*Phase: 06-decouple-dot-cli*
*Context gathered: 2026-01-31*
