# Local Automation Setup

This guide sets up the two daily automated pipelines that run on your Mac:

1. **Bug Council** — daily codebase audit across both repos (10:30 AM), creates fix PRs
2. **AI Fix Bot** — picks up `ai-fix` labeled GitHub issues, fixes and PRs them (11:30 AM)

Both jobs use Claude Code CLI, run in dedicated git worktrees (never touch your main checkouts), and send a single consolidated Telegram notification when done.

---

## Prerequisites

Before starting, install and configure these on the new machine:

### 1. Homebrew
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Node.js via nvm
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc
nvm install 24
nvm use 24
nvm alias default 24
```

### 3. Claude Code CLI
```bash
npm install -g @anthropic-ai/claude-code
claude login   # authenticate with your Anthropic account
```

Verify it works:
```bash
claude -p "respond with OK" --max-turns 1
```

### 4. GitHub CLI
```bash
brew install gh
gh auth login   # authenticate with your GitHub account (KoushikP04)
```

Verify:
```bash
gh api user --jq .login   # should print: KoushikP04
```

### 5. Shell env vars — add to `~/.zshrc`

```bash
# Claude Code output limit (required for large card catalog operations)
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=32768
```

Run `source ~/.zshrc` after editing.

---

## Step 1: Clone the repos

```bash
mkdir -p ~/github
cd ~/github
git clone https://github.com/Coconut-Banking/coconut.git
git clone https://github.com/KoushikP04/coconut-app.git coconut-app
cd coconut-app && git remote add upstream https://github.com/Coconut-Banking/coconut-app.git
```

### Install dependencies
```bash
cd ~/github/coconut && npm install
cd ~/github/coconut-app && npm install
```

### Set up `.env.local` for coconut
```bash
cp ~/github/coconut/.env.example ~/github/coconut/.env.local
# Then fill in all values — get them from 1Password or ask Koushik
```

---

## Step 2: Create git worktrees

The automation runs in isolated worktrees so it never disturbs your main checkouts.

```bash
# Bug Council worktrees
mkdir -p ~/github/coconut-worktrees
mkdir -p ~/github/coconut-app-worktrees

git -C ~/github/coconut worktree add ~/github/coconut-worktrees/bug-council main
git -C ~/github/coconut worktree add ~/github/coconut-worktrees/ai-fix main
git -C ~/github/coconut-app worktree add ~/github/coconut-app-worktrees/bug-council main
git -C ~/github/coconut-app worktree add ~/github/coconut-app-worktrees/ai-fix main
```

Install dependencies in each worktree:
```bash
cd ~/github/coconut-worktrees/bug-council && npm install
cd ~/github/coconut-worktrees/ai-fix && npm install
```

---

## Step 3: Install the Bug Council cron job

```bash
cd ~/github/coconut
chmod +x scripts/.bug-council-runner.sh scripts/.ai-fix-runner.sh scripts/setup-bug-council.sh
./scripts/setup-bug-council.sh install
```

This installs a launchd job (`com.coconut.bug-council`) that runs daily at **10:30 AM**.

Verify it's installed:
```bash
./scripts/setup-bug-council.sh status
```

---

## Step 4: Install the AI Fix Bot cron job

Manually install the launchd plist. Run this whole block (substituting your username):

```bash
cat > ~/Library/LaunchAgents/com.coconut.ai-fix.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.coconut.ai-fix</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>REPO=/Users/YOUR_USERNAME/github/coconut/scripts/.ai-fix-runner.sh; LOCAL=/Users/YOUR_USERNAME/.local/bin/coconut/ai-fix-runner.sh; if [ -x "$REPO" ]; then exec "$REPO"; else exec "$LOCAL"; fi</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key><integer>11</integer>
        <key>Minute</key><integer>30</integer>
    </dict>
    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/github/coconut-worktrees/ai-fix</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/Users/YOUR_USERNAME/.local/bin:/Users/YOUR_USERNAME/.nvm/versions/node/v24.12.0/bin:/usr/bin:/bin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/github/coconut/.ai-fix-logs/launchd-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/github/coconut/.ai-fix-logs/launchd-stderr.log</string>
</dict>
</plist>
EOF
```

Replace `YOUR_USERNAME` with your actual macOS username (`echo $USER`).

Then load it:
```bash
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.coconut.ai-fix.plist
```

Verify both jobs are loaded:
```bash
launchctl list | grep coconut
# Should show both com.coconut.bug-council and com.coconut.ai-fix
```

---

## Step 5: Set Telegram credentials

The scripts need your Telegram bot token and chat ID to send notifications. These are hardcoded in `.ai-fix-runner.sh` and passed via env in `.bug-council-runner.sh`.

**Values:**
- Bot token: `8763230267:AAEz3-3Y6nNE7QZRCdYKobUSFVO3JiAwVmk`
- Chat ID: `1728663117`
- Bot: `@coconut_bug_bot`

Optionally add to `~/.zshrc` so the bug council runner picks them up:
```bash
export TELEGRAM_BOT_TOKEN="8763230267:AAEz3-3Y6nNE7QZRCdYKobUSFVO3JiAwVmk"
export TELEGRAM_CHAT_ID="1728663117"
```

---

## Step 6: Verify end-to-end

Run the bug council manually to make sure everything works:

```bash
cd ~/github/coconut
./scripts/setup-bug-council.sh run
```

This will:
1. Audit both repos (coconut web + coconut-app mobile)
2. Run the Bug Council 12-agent audit for web and 7-agent audit for mobile
3. Create fix PRs if bugs are found
4. Poll CI until green
5. Send a Telegram notification with the results

Check logs if something goes wrong:
```bash
./scripts/setup-bug-council.sh logs
# or directly:
tail -f ~/github/coconut/.bug-council-logs/stdout-*.log | head -100
```

---

## Schedule Summary

| Job | Time | What it does |
|-----|------|--------------|
| Bug Council | 10:30 AM daily | Audits coconut + coconut-app, creates fix PRs |
| AI Fix Bot | 11:30 AM daily | Picks up `ai-fix` GitHub issues, fixes and PRs them |

---

## Manual Commands

```bash
# Bug Council
./scripts/setup-bug-council.sh run                         # Full audit now (both repos)
./scripts/setup-bug-council.sh reactive "error desc"       # Quick fix for web repo
./scripts/setup-bug-council.sh reactive-mobile "error"     # Quick fix for mobile repo
./scripts/setup-bug-council.sh status                      # Check if installed
./scripts/setup-bug-council.sh logs                        # View latest run output
./scripts/setup-bug-council.sh remove                      # Uninstall the cron job

# AI Fix Bot (run manually)
cd ~/github/coconut && bash scripts/.ai-fix-runner.sh
```

---

## File Locations

| File | Purpose |
|------|---------|
| `scripts/.bug-council-runner.sh` | Bug Council main runner — orchestrates both repos |
| `scripts/.ai-fix-runner.sh` | AI Fix Bot runner — processes `ai-fix` issues |
| `scripts/setup-bug-council.sh` | One-command installer for the Bug Council launchd job |
| `.claude/commands/bug-council.md` | Bug Council prompt for the web (Next.js) repo |
| `.claude/commands/bug-council-mobile.md` | Bug Council prompt for the mobile (Expo) repo |
| `.bug-council-logs/` | Run logs, kept for 14 days |
| `.ai-fix-logs/` | AI fix run logs |
| `.bug-council-logs/.last-successful-run` | SHA of last successful audit — used to diff changed files |
| `~/Library/LaunchAgents/com.coconut.bug-council.plist` | launchd schedule for Bug Council |
| `~/Library/LaunchAgents/com.coconut.ai-fix.plist` | launchd schedule for AI Fix Bot |
| `~/github/coconut-worktrees/` | Isolated worktrees for coconut automation |
| `~/github/coconut-app-worktrees/` | Isolated worktrees for coconut-app automation |

---

## Troubleshooting

**Job not running at scheduled time:**
```bash
launchctl list | grep coconut   # check both are listed
# If missing, re-bootstrap:
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.coconut.bug-council.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.coconut.ai-fix.plist
```

**Claude CLI errors:**
```bash
claude login   # re-authenticate
claude -p "respond with OK" --max-turns 1   # verify it works
```

**Worktree already exists error:**
```bash
git -C ~/github/coconut worktree list   # check existing worktrees
git -C ~/github/coconut worktree remove ~/github/coconut-worktrees/bug-council
# then re-add:
git -C ~/github/coconut worktree add ~/github/coconut-worktrees/bug-council main
```

**Stuck lockfile (job was killed mid-run):**
```bash
rm -f /tmp/coconut-bug-council.lock
rm -f /tmp/coconut-ai-fix.lock
```

**PATH issues (node/claude not found in launchd):**
The plists include a hardcoded PATH with nvm node path at `v24.12.0`. If your node version differs, update the PATH line in both plists to match your actual node path:
```bash
ls ~/.nvm/versions/node/   # find your installed version
# Then edit the plist and reload it
```
