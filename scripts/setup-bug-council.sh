#!/bin/bash
# Bug Council — Local Cron Setup
# Runs the bug council audit every weekday at 9 AM Pacific.
# Requires: Claude Code CLI installed and authenticated (claude login).
#
# Usage:
#   ./scripts/setup-bug-council.sh          # Install the cron job
#   ./scripts/setup-bug-council.sh remove   # Uninstall the cron job
#   ./scripts/setup-bug-council.sh run      # Run it right now (manual trigger)
#   ./scripts/setup-bug-council.sh status   # Check if it's installed
#   ./scripts/setup-bug-council.sh logs     # Tail the latest log output

set -e

LABEL="com.coconut.bug-council"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$REPO_DIR/.bug-council-logs"
CLAUDE_PATH="$(which claude 2>/dev/null || echo "$HOME/.local/bin/claude")"

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
    echo "Running bug council now..."
    cd "$REPO_DIR"
    git fetch origin main && git checkout main && git pull origin main
    "$CLAUDE_PATH" -p "$(cat .claude/commands/bug-council.md)

Execute the Bug Council skill exactly as described above. This is a manual run. Do not ask for confirmation — proceed through all phases automatically." \
      --dangerously-skip-permissions \
      --max-turns 200 \
      --verbose
    exit 0
    ;;

  status)
    if launchctl list | grep -q "$LABEL"; then
      echo "Bug council is INSTALLED and scheduled."
      echo "Plist: $PLIST"
      echo "Logs:  $LOG_DIR/"
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
    echo "Usage: $0 [install|remove|run|status|logs]"
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

# Unload existing if present
if launchctl list | grep -q "$LABEL"; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null
fi

# Write the runner script (launchd needs a simple executable)
RUNNER="$REPO_DIR/scripts/.bug-council-runner.sh"
cat > "$RUNNER" << SCRIPT
#!/bin/bash
export PATH="/usr/local/bin:/opt/homebrew/bin:\$HOME/.local/bin:\$PATH"
TIMESTAMP=\$(date +%Y%m%d-%H%M%S)
cd "$REPO_DIR"
git fetch origin main && git checkout main && git pull origin main
"$CLAUDE_PATH" -p "\$(cat .claude/commands/bug-council.md)

Execute the Bug Council skill exactly as described above. This is an automated daily run. Do not ask for confirmation — proceed through all phases automatically." \\
  --dangerously-skip-permissions \\
  --max-turns 200 \\
  --verbose \\
  > "$LOG_DIR/stdout-\$TIMESTAMP.log" 2> "$LOG_DIR/stderr-\$TIMESTAMP.log"

# Clean up logs older than 14 days
find "$LOG_DIR" -name "*.log" -mtime +14 -delete 2>/dev/null
SCRIPT
chmod +x "$RUNNER"

# Write the launchd plist
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
echo "Bug Council cron job installed."
echo ""
echo "  Schedule:  Weekdays at 9:00 AM (local time)"
echo "  Logs:      $LOG_DIR/"
echo ""
echo "  Commands:"
echo "    ./scripts/setup-bug-council.sh run      # Run it now"
echo "    ./scripts/setup-bug-council.sh logs     # View latest output"
echo "    ./scripts/setup-bug-council.sh status   # Check if installed"
echo "    ./scripts/setup-bug-council.sh remove   # Uninstall"
echo ""
