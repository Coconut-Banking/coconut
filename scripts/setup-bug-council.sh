#!/bin/bash
# Bug Council v2 — Local Cron Setup
# Runs the bug council audit every weekday at 9 AM local time.
# Requires: Claude Code CLI installed and authenticated (claude login).
#
# Usage:
#   ./scripts/setup-bug-council.sh              # Install the cron job
#   ./scripts/setup-bug-council.sh remove       # Uninstall the cron job
#   ./scripts/setup-bug-council.sh run          # Run full audit now (both repos)
#   ./scripts/setup-bug-council.sh reactive "description of issue"
#   ./scripts/setup-bug-council.sh reactive-mobile "description of issue"
#   ./scripts/setup-bug-council.sh status       # Check if installed
#   ./scripts/setup-bug-council.sh logs         # Tail the latest log output

set -e

LABEL="com.coconut.bug-council"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="$REPO_DIR/scripts/.bug-council-runner.sh"
LOG_DIR="$REPO_DIR/.bug-council-logs"
CLAUDE_PATH="$(command -v claude 2>/dev/null || echo "$HOME/.local/bin/claude")"

mkdir -p "$LOG_DIR"

case "${1:-install}" in
  remove|uninstall)
    if launchctl list | grep -q "$LABEL"; then
      launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
      echo "Unloaded $LABEL"
    fi
    rm -f "$PLIST"
    echo "Removed. Bug council cron job is uninstalled."
    exit 0
    ;;

  run)
    echo "Running bug council v2 (full audit, both repos)..."
    cd "$REPO_DIR"
    git fetch origin main && git checkout main && git pull origin main
    exec "$RUNNER"
    ;;

  reactive)
    echo "Running bug council v2 (reactive, web)..."
    cd "$REPO_DIR"
    exec "$RUNNER" --reactive "${2:?Usage: $0 reactive \"description of the issue\"}"
    ;;

  reactive-mobile)
    echo "Running bug council v2 (reactive, mobile)..."
    cd "$REPO_DIR"
    exec "$RUNNER" --reactive-repo coconut-app "${2:?Usage: $0 reactive-mobile \"description of the issue\"}"
    ;;

  status)
    if launchctl list | grep -q "$LABEL"; then
      echo "Bug council v2 is INSTALLED and scheduled."
      echo "Plist:  $PLIST"
      echo "Runner: $RUNNER"
      echo "Logs:   $LOG_DIR/"
    else
      echo "Bug council is NOT installed. Run: ./scripts/setup-bug-council.sh"
    fi
    exit 0
    ;;

  logs)
    LATEST=$(ls -t "$LOG_DIR"/stdout-*.log 2>/dev/null | head -1)
    if [ -n "$LATEST" ]; then
      echo "=== $LATEST ==="
      tail -100 "$LATEST"
    else
      echo "No logs yet."
    fi
    exit 0
    ;;

  install)
    ;;

  *)
    echo "Usage: $0 [install|remove|run|reactive|reactive-mobile|status|logs]"
    exit 1
    ;;
esac

# --- Install ---

# Verify claude CLI exists
if [ ! -x "$CLAUDE_PATH" ]; then
  echo "Error: Claude Code CLI not found. Install it first:"
  echo "  npm install -g @anthropic-ai/claude-code"
  echo "Then authenticate:"
  echo "  claude login"
  exit 1
fi

# Verify auth works
if ! "$CLAUDE_PATH" -p "respond with OK" --max-turns 1 2>/dev/null | grep -qi "ok"; then
  echo "Warning: Claude CLI may not be authenticated. Run 'claude login' if the job fails."
fi

# Verify runner exists
if [ ! -x "$RUNNER" ]; then
  echo "Error: Runner script not found at $RUNNER"
  echo "Make sure you're running this from the coconut repo root."
  exit 1
fi

# Unload existing if present
if launchctl list | grep -q "$LABEL"; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
fi

# Write the launchd plist (points to the runner script in the repo)
cat > "$PLIST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$RUNNER</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
    </array>
    <key>WorkingDirectory</key>
    <string>$REPO_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
PLIST

# Load it
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"

echo ""
echo "Bug Council v2 cron job installed."
echo ""
echo "  Schedule:  Weekdays at 9:00 AM (local time)"
echo "  Runner:    $RUNNER"
echo "  Logs:      $LOG_DIR/"
echo ""
echo "  Commands:"
echo "    ./scripts/setup-bug-council.sh run                          # Full audit now"
echo "    ./scripts/setup-bug-council.sh reactive \"issue desc\"        # Quick fix (web)"
echo "    ./scripts/setup-bug-council.sh reactive-mobile \"issue desc\" # Quick fix (mobile)"
echo "    ./scripts/setup-bug-council.sh logs                         # View latest output"
echo "    ./scripts/setup-bug-council.sh status                       # Check if installed"
echo "    ./scripts/setup-bug-council.sh remove                       # Uninstall"
echo ""
echo "  Environment variables (set in ~/.zshrc or similar):"
echo "    TELEGRAM_BOT_TOKEN  — Telegram bot token for notifications"
echo "    TELEGRAM_CHAT_ID    — Telegram chat ID for notifications"
echo "    COCONUT_APP_REPO    — Path to coconut-app repo (default: sibling dir)"
echo ""
