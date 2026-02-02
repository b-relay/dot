#!/bin/bash
#
# Dotfiles Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/b-relay/dot/main/install.sh | bash
#
# Interactive installer that:
# 1. Checks for prerequisites (Homebrew, Bun)
# 2. Lets you choose where to clone dotfiles
# 3. Lets you choose where to install the dot binary
# 4. Builds and installs everything
# 5. Guides you on next steps
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Symbols
CHECK="${GREEN}✓${NC}"
CROSS="${RED}✗${NC}"
ARROW="${CYAN}›${NC}"
WARN="${YELLOW}⚠${NC}"

# Defaults
DEFAULT_DOTFILES_DIR="$HOME/.dotfiles"
DEFAULT_BIN_DIR="$HOME/.local/bin"
REPO_URL="git@github.com:b-relay/dot.git"
REPO_URL_HTTPS="https://github.com/b-relay/dot.git"

# State
DOTFILES_DIR=""
BIN_DIR=""
USE_HTTPS=false

# --- UI Helpers ---

print_header() {
  echo ""
  echo -e "${BOLD}╭─────────────────────────────────────────╮${NC}"
  echo -e "${BOLD}│  Dotfiles Installer                     │${NC}"
  echo -e "${BOLD}╰─────────────────────────────────────────╯${NC}"
  echo ""
}

print_step() {
  echo -e "\n${BOLD}$1${NC}"
}

print_success() {
  echo -e "  ${CHECK} $1"
}

print_error() {
  echo -e "  ${CROSS} $1"
}

print_warn() {
  echo -e "  ${WARN} $1"
}

print_info() {
  echo -e "  ${ARROW} $1"
}

# --- Input Helpers ---

# Read a single keypress
read_key() {
  local key
  IFS= read -rsn1 key 2>/dev/null || true

  # Handle arrow keys (escape sequences)
  if [[ $key == $'\x1b' ]]; then
    read -rsn2 -t 0.1 key 2>/dev/null || true
    case "$key" in
      '[A') echo "up" ;;
      '[B') echo "down" ;;
      *) echo "" ;;
    esac
  elif [[ $key == "" ]]; then
    echo "enter"
  else
    echo "$key"
  fi
}

# Interactive menu selector
# Usage: select_option "prompt" "option1" "option2" "option3"
# Returns: selected index (0-based) in $SELECTED_INDEX, value in $SELECTED_VALUE
select_option() {
  local prompt="$1"
  shift
  local options=("$@")
  local selected=0
  local count=${#options[@]}

  # Hide cursor
  tput civis 2>/dev/null || true

  # Ensure cursor is restored on exit
  trap 'tput cnorm 2>/dev/null || true' EXIT

  while true; do
    # Clear previous menu (move up and clear lines)
    if [[ -n "${MENU_DRAWN:-}" ]]; then
      for ((i=0; i<count+1; i++)); do
        tput cuu1 2>/dev/null || echo -en "\033[1A"
        tput el 2>/dev/null || echo -en "\033[2K"
      done
    fi

    # Print prompt
    echo -e "${BOLD}$prompt${NC}"

    # Print options
    for i in "${!options[@]}"; do
      if [[ $i -eq $selected ]]; then
        echo -e "  ${CYAN}› ${options[$i]}${NC}"
      else
        echo -e "    ${DIM}${options[$i]}${NC}"
      fi
    done

    MENU_DRAWN=1

    # Read input
    local key
    key=$(read_key)

    case "$key" in
      up|k)
        ((selected = selected > 0 ? selected - 1 : count - 1))
        ;;
      down|j)
        ((selected = selected < count - 1 ? selected + 1 : 0))
        ;;
      enter|"")
        break
        ;;
    esac
  done

  # Show cursor
  tput cnorm 2>/dev/null || true
  unset MENU_DRAWN

  SELECTED_INDEX=$selected
  SELECTED_VALUE="${options[$selected]}"
}

# Prompt for custom path
prompt_path() {
  local prompt="$1"
  local default="$2"
  local result

  echo -en "${BOLD}$prompt${NC} ${DIM}[$default]${NC}: "
  read -r result

  if [[ -z "$result" ]]; then
    echo "$default"
  else
    # Expand ~ to $HOME
    echo "${result/#\~/$HOME}"
  fi
}

# --- Prerequisite Checks ---

check_command() {
  command -v "$1" &>/dev/null
}

check_prerequisites() {
  print_step "Checking prerequisites..."

  local missing=()

  # Check for git
  if check_command git; then
    print_success "git"
  else
    print_error "git (required)"
    missing+=("git")
  fi

  # Check for Homebrew
  if check_command brew; then
    print_success "Homebrew"
  else
    print_error "Homebrew"
    missing+=("brew")
  fi

  # Check for Bun
  if check_command bun; then
    print_success "Bun"
  else
    print_error "Bun"
    missing+=("bun")
  fi

  # Handle missing prerequisites
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo ""

    if [[ " ${missing[*]} " =~ " brew " ]]; then
      echo -e "${YELLOW}Homebrew is required. Install it with:${NC}"
      echo -e "  ${DIM}/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"${NC}"
      echo ""
    fi

    if [[ " ${missing[*]} " =~ " bun " ]]; then
      if check_command brew; then
        echo -e "${YELLOW}Bun is required. Install it with:${NC}"
        echo -e "  ${DIM}brew install bun${NC}"
      else
        echo -e "${YELLOW}Bun is required. Install Homebrew first, then:${NC}"
        echo -e "  ${DIM}brew install bun${NC}"
      fi
      echo ""
    fi

    echo -e "${RED}Please install missing prerequisites and run this installer again.${NC}"
    exit 1
  fi

  echo ""
}

# --- Git Setup ---

check_git_auth() {
  print_step "Checking Git authentication..."

  # Try SSH first
  if ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
    print_success "SSH authentication working"
    USE_HTTPS=false
    return 0
  fi

  # SSH didn't work, ask user
  echo ""
  select_option "SSH authentication failed. How would you like to clone?" \
    "Use HTTPS (works without SSH setup)" \
    "Use SSH (I'll fix my SSH keys)" \
    "Cancel installation"

  case $SELECTED_INDEX in
    0)
      USE_HTTPS=true
      print_info "Will use HTTPS for cloning"
      ;;
    1)
      echo ""
      echo -e "${YELLOW}Set up SSH keys and run this installer again.${NC}"
      echo -e "${DIM}Guide: https://docs.github.com/en/authentication/connecting-to-github-with-ssh${NC}"
      exit 1
      ;;
    2)
      echo ""
      echo "Installation cancelled."
      exit 0
      ;;
  esac
}

# --- Directory Selection ---

select_dotfiles_dir() {
  print_step "Where should dotfiles be cloned?"

  select_option "Select location:" \
    "$DEFAULT_DOTFILES_DIR (recommended)" \
    "$HOME/dotfiles" \
    "Custom path..."

  case $SELECTED_INDEX in
    0) DOTFILES_DIR="$DEFAULT_DOTFILES_DIR" ;;
    1) DOTFILES_DIR="$HOME/dotfiles" ;;
    2) DOTFILES_DIR=$(prompt_path "Enter path" "$DEFAULT_DOTFILES_DIR") ;;
  esac

  print_info "Dotfiles will be cloned to: ${BOLD}$DOTFILES_DIR${NC}"

  # Check if directory already exists
  if [[ -d "$DOTFILES_DIR" ]]; then
    echo ""
    select_option "Directory already exists. What would you like to do?" \
      "Use existing (skip clone, just build)" \
      "Cancel installation"

    case $SELECTED_INDEX in
      0)
        print_info "Will use existing directory"
        SKIP_CLONE=true
        ;;
      1)
        echo ""
        echo "Installation cancelled."
        exit 0
        ;;
    esac
  fi
}

select_bin_dir() {
  print_step "Where should the dot binary be installed?"

  select_option "Select location:" \
    "$DEFAULT_BIN_DIR (recommended)" \
    "/usr/local/bin (requires sudo)" \
    "Custom path..."

  case $SELECTED_INDEX in
    0) BIN_DIR="$DEFAULT_BIN_DIR" ;;
    1) BIN_DIR="/usr/local/bin" ;;
    2) BIN_DIR=$(prompt_path "Enter path" "$DEFAULT_BIN_DIR") ;;
  esac

  print_info "Binary will be installed to: ${BOLD}$BIN_DIR/dot${NC}"
}

# --- Installation ---

clone_repo() {
  if [[ "${SKIP_CLONE:-}" == "true" ]]; then
    print_success "Using existing dotfiles directory"
    return 0
  fi

  print_step "Cloning dotfiles..."

  local repo_url
  if [[ "$USE_HTTPS" == "true" ]]; then
    repo_url="$REPO_URL_HTTPS"
  else
    repo_url="$REPO_URL"
  fi

  if git clone "$repo_url" "$DOTFILES_DIR" 2>/dev/null; then
    print_success "Cloned to $DOTFILES_DIR"
  else
    print_error "Failed to clone repository"
    exit 1
  fi
}

build_and_install() {
  print_step "Building dot CLI..."

  cd "$DOTFILES_DIR/dot"

  # Install dependencies
  if bun install --silent 2>/dev/null; then
    print_success "Dependencies installed"
  else
    print_error "Failed to install dependencies"
    exit 1
  fi

  # Build
  if bun run build 2>/dev/null; then
    print_success "Built successfully"
  else
    print_error "Build failed"
    exit 1
  fi

  # Create bin directory if needed
  mkdir -p "$BIN_DIR"

  # Install binary
  if [[ "$BIN_DIR" == "/usr/local/bin" ]]; then
    if sudo cp dot "$BIN_DIR/dot" && sudo chmod +x "$BIN_DIR/dot"; then
      print_success "Installed to $BIN_DIR/dot"
    else
      print_error "Failed to install (sudo required)"
      exit 1
    fi
  else
    if cp dot "$BIN_DIR/dot" && chmod +x "$BIN_DIR/dot"; then
      print_success "Installed to $BIN_DIR/dot"
    else
      print_error "Failed to install"
      exit 1
    fi
  fi
}

check_path() {
  print_step "Checking PATH..."

  if [[ ":$PATH:" == *":$BIN_DIR:"* ]]; then
    print_success "$BIN_DIR is in your PATH"
    return 0
  else
    print_warn "$BIN_DIR is not in your PATH"
    echo ""
    echo -e "  Add this to your shell config (${DIM}~/.zshrc${NC} or ${DIM}~/.bashrc${NC}):"
    echo ""
    echo -e "    ${CYAN}export PATH=\"$BIN_DIR:\$PATH\"${NC}"
    echo ""
    echo -e "  Then reload your shell: ${DIM}exec zsh${NC} or ${DIM}exec bash${NC}"
    echo ""
    echo -e "  ${DIM}(After running 'dot install', the zsh config will include this PATH automatically)${NC}"
    return 1
  fi
}

print_next_steps() {
  echo ""
  echo -e "${BOLD}╭─────────────────────────────────────────╮${NC}"
  echo -e "${BOLD}│  Installation Complete!                 │${NC}"
  echo -e "${BOLD}╰─────────────────────────────────────────╯${NC}"
  echo ""
  echo -e "${BOLD}Next steps:${NC}"
  echo ""
  echo -e "  1. ${DIM}(if PATH not set)${NC} Add to your shell config:"
  echo -e "     ${CYAN}export PATH=\"$BIN_DIR:\$PATH\"${NC}"
  echo ""
  echo -e "  2. Reload shell or open new terminal"
  echo ""
  echo -e "  3. Create symlinks for your dotfiles:"
  echo -e "     ${CYAN}dot install${NC}"
  echo ""
  echo -e "  ${DIM}Note: 'dot install' will NOT overwrite existing config files.${NC}"
  echo -e "  ${DIM}It skips any file that already exists and shows a warning.${NC}"
  echo ""
  echo -e "  4. ${DIM}(optional)${NC} Run diagnostics:"
  echo -e "     ${CYAN}dot doctor${NC}"
  echo ""
}

# --- Main ---

main() {
  print_header

  echo -e "This will set up the ${BOLD}dot${NC} CLI and clone your dotfiles."
  echo -e "${DIM}Your existing config files will NOT be overwritten.${NC}"

  check_prerequisites
  check_git_auth
  select_dotfiles_dir
  select_bin_dir
  clone_repo
  build_and_install
  check_path
  print_next_steps
}

main "$@"
