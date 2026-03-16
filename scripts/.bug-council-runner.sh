#!/bin/bash
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:/Users/koushik/.nvm/versions/node/v24.12.0/bin:$PATH"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_DIR="/Users/koushik/github/coconut/.bug-council-logs"
mkdir -p "$LOG_DIR"
cd "/Users/koushik/github/coconut"
git fetch origin main && git checkout main && git pull origin main
"/Users/koushik/.nvm/versions/node/v24.12.0/bin/claude" -p "$(cat .claude/commands/bug-council.md)

Execute the Bug Council skill exactly as described above. This is an automated daily run. Do not ask for confirmation — proceed through all phases automatically." \
  --dangerously-skip-permissions \
  --max-turns 200 \
  --verbose \
  > "$LOG_DIR/stdout-$TIMESTAMP.log" 2> "$LOG_DIR/stderr-$TIMESTAMP.log"

# Clean up logs older than 14 days
find "$LOG_DIR" -name "*.log" -mtime +14 -delete 2>/dev/null
