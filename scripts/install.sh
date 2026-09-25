#!/usr/bin/env bash
# Installs or updates AgentLab on macOS (Apple Silicon) from the latest GitHub release.
#
#   gh release download -R uptive/Uptive-AgentLab -p install.sh -O - | bash
#
# The repository is private, so the download goes through the GitHub CLI (`gh auth login` first).
# Set MONGODB_URI to skip the prompt for the connection string, and AGENTLAB_REPO to install from
# another repository (e.g. a public releases repo, where plain curl works too).
set -euo pipefail

REPO="${AGENTLAB_REPO:-uptive/Uptive-AgentLab}"
ASSET="AgentLab-mac-arm64.zip"

die() { echo "error: $*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "this script installs the macOS app; on Windows use install.ps1"
[ "$(uname -m)" = "arm64" ] || die "only Apple Silicon Macs are supported for now"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading the latest AgentLab from $REPO…"
if command -v gh >/dev/null 2>&1 && gh auth status --hostname github.com >/dev/null 2>&1; then
  gh release download --repo "$REPO" --pattern "$ASSET" --dir "$tmp"
else
  curl -fL --progress-bar -o "$tmp/$ASSET" "https://github.com/$REPO/releases/latest/download/$ASSET" \
    || die "download failed. The repository is private: install the GitHub CLI (brew install gh), run gh auth login, and try again"
fi

dest="/Applications"
[ -w "$dest" ] || dest="$HOME/Applications"
mkdir -p "$dest"

osascript -e 'quit app "AgentLab"' >/dev/null 2>&1 || true
rm -rf "$dest/AgentLab.app"
ditto -x -k "$tmp/$ASSET" "$dest"
# Downloads by script carry no quarantine flag; clear it anyway in case the zip came from a browser.
xattr -dr com.apple.quarantine "$dest/AgentLab.app" 2>/dev/null || true

# The MongoDB connection string is a credential, so it is never built into the app. It goes into the
# app's own .env, readable only by this user.
env_dir="$HOME/Library/Application Support/AgentLab"
env_file="$env_dir/.env"
if [ ! -f "$env_file" ]; then
  uri="${MONGODB_URI:-}"
  if [ -z "$uri" ] && [ -r /dev/tty ]; then
    printf "MongoDB connection string (input hidden, leave empty to skip): " >/dev/tty
    read -rs uri </dev/tty || true
    printf "\n" >/dev/tty
  fi
  if [ -n "$uri" ]; then
    mkdir -p "$env_dir"
    (umask 077 && printf 'MONGODB_URI=%s\n' "$uri" >"$env_file")
    echo "Saved the connection string to $env_file"
  else
    echo "No connection string saved. Shared agents and flows need one: add MONGODB_URI=… to $env_file"
  fi
fi

echo "Installed AgentLab to $dest/AgentLab.app"
open "$dest/AgentLab.app"
