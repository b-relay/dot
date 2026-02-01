/**
 * Self-update command for dot CLI.
 *
 * Currently shows manual update instructions since GitHub releases
 * aren't set up yet. Future versions will auto-update from releases.
 */

export async function update(): Promise<void> {
  console.log("Checking for updates...\n");

  // TODO: When GitHub releases are set up, implement:
  // 1. Fetch latest version from GitHub releases API
  // 2. Compare with current version
  // 3. Download new binary for current architecture
  // 4. Replace current binary (with backup)
  // 5. Verify new binary works

  console.log("Self-update from releases is not yet available.");
  console.log("");
  console.log("To update manually:");
  console.log("  cd ~/.dotfiles/dot && git pull && bun run deploy");
  console.log("");
  console.log("Or reinstall with:");
  console.log("  curl -fsSL https://raw.githubusercontent.com/brendonv/dotfiles/main/install.sh | bash");
}
