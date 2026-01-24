#!/bin/bash
#
# Claude Code Slack Bot - Setup Script for macOS
#
# Usage: ./setup.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_step() {
    echo -e "${BLUE}==>${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Check if running on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    print_error "This script is for macOS only."
    exit 1
fi

echo ""
echo "========================================"
echo "  Claude Code Slack Bot Setup"
echo "========================================"
echo ""

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$(dirname "$SCRIPT_DIR")"

# Check Node.js version
print_step "Checking Node.js version..."
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18 or later."
    echo "  Install with: brew install node"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [[ "$NODE_VERSION" -lt 18 ]]; then
    print_error "Node.js version 18 or later is required. Current version: $(node -v)"
    exit 1
fi
print_success "Node.js $(node -v) detected"

# Check Claude Code CLI
print_step "Checking Claude Code CLI..."
if ! command -v claude &> /dev/null; then
    print_error "Claude Code CLI is not installed."
    echo "  Install with: npm install -g @anthropic-ai/claude-code"
    exit 1
fi
CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "unknown")
print_success "Claude Code CLI $CLAUDE_VERSION detected"

# Check Claude Code login status
print_step "Checking Claude Code login status..."
if ! claude whoami &> /dev/null; then
    print_warning "You are not logged in to Claude Code."
    echo "  Please run: claude /login"
    echo "  Then run this setup script again."
    exit 1
fi
CLAUDE_USER=$(claude whoami 2>/dev/null | grep -o 'logged in as.*' | sed 's/logged in as `//' | sed 's/`.//')
print_success "Logged in to Claude Code"

# Get current username and home directory
USERNAME=$(whoami)
HOME_DIR=$(eval echo ~$USERNAME)

echo ""
print_step "Installing npm dependencies..."
cd "$BOT_DIR"
npm install
print_success "Dependencies installed"

# Update Claude Code SDK to latest version
print_step "Updating Claude Code SDK..."
npm update @anthropic-ai/claude-code
print_success "Claude Code SDK updated"

# Prompt for Slack tokens
echo ""
echo "========================================"
echo "  Slack App Configuration"
echo "========================================"
echo ""
echo "Please enter your Slack App credentials."
echo "You can get these from https://api.slack.com/apps"
echo ""

read -p "SLACK_BOT_TOKEN (xoxb-...): " SLACK_BOT_TOKEN
read -p "SLACK_APP_TOKEN (xapp-...): " SLACK_APP_TOKEN
read -p "SLACK_SIGNING_SECRET: " SLACK_SIGNING_SECRET

# Validate tokens
if [[ ! "$SLACK_BOT_TOKEN" =~ ^xoxb- ]]; then
    print_warning "SLACK_BOT_TOKEN should start with 'xoxb-'"
fi
if [[ ! "$SLACK_APP_TOKEN" =~ ^xapp- ]]; then
    print_warning "SLACK_APP_TOKEN should start with 'xapp-'"
fi

# Create .env file
print_step "Creating .env file..."
cat > "$BOT_DIR/.env" << EOF
SLACK_BOT_TOKEN=$SLACK_BOT_TOKEN
SLACK_APP_TOKEN=$SLACK_APP_TOKEN
SLACK_SIGNING_SECRET=$SLACK_SIGNING_SECRET
# Session timeout in hours (0 = never timeout)
SESSION_TIMEOUT_HOURS=0
EOF
print_success ".env file created"

# Create backup directory
print_step "Creating backup directory..."
mkdir -p "$HOME_DIR/.claude-code-slack-bot/backups"
print_success "Backup directory created at $HOME_DIR/.claude-code-slack-bot/backups"

# Create LaunchAgents directory if it doesn't exist
mkdir -p "$HOME_DIR/Library/LaunchAgents"

# Create plist file
print_step "Creating launchd configuration..."
PLIST_FILE="$HOME_DIR/Library/LaunchAgents/com.claude-code-slack-bot.plist"

# Find node and tsx paths
NODE_PATH=$(which node)
TSX_PATH="$BOT_DIR/node_modules/.bin/tsx"

cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude-code-slack-bot</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$TSX_PATH</string>
        <string>$BOT_DIR/src/index.ts</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$BOT_DIR</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>$HOME_DIR</string>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>SLACK_BOT_TOKEN</key>
        <string>$SLACK_BOT_TOKEN</string>
        <key>SLACK_APP_TOKEN</key>
        <string>$SLACK_APP_TOKEN</string>
        <key>SLACK_SIGNING_SECRET</key>
        <string>$SLACK_SIGNING_SECRET</string>
        <key>SESSION_TIMEOUT_HOURS</key>
        <string>0</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/tmp/claude-code-slack-bot.log</string>

    <key>StandardErrorPath</key>
    <string>/tmp/claude-code-slack-bot.error.log</string>
</dict>
</plist>
EOF
print_success "launchd configuration created"

# Test the bot
echo ""
print_step "Testing bot startup..."
cd "$BOT_DIR"
timeout 10 npm run dev 2>&1 | head -20 || true
echo ""

# Ask if user wants to start the service
echo ""
read -p "Do you want to start the bot service now? (y/n): " START_SERVICE
if [[ "$START_SERVICE" =~ ^[Yy]$ ]]; then
    print_step "Starting the bot service..."
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    launchctl load "$PLIST_FILE"
    sleep 3

    if launchctl list | grep -q "com.claude-code-slack-bot"; then
        print_success "Bot service started successfully!"
    else
        print_error "Failed to start the service. Check the logs:"
        echo "  tail -f /tmp/claude-code-slack-bot.error.log"
    fi
fi

echo ""
echo "========================================"
echo "  Setup Complete!"
echo "========================================"
echo ""
echo "Important files:"
echo "  - Bot directory: $BOT_DIR"
echo "  - Config file: $BOT_DIR/.env"
echo "  - Launchd plist: $PLIST_FILE"
echo "  - Session backups: $HOME_DIR/.claude-code-slack-bot/backups/"
echo "  - Logs: /tmp/claude-code-slack-bot.log"
echo "  - Errors: /tmp/claude-code-slack-bot.error.log"
echo ""
echo "Service commands:"
echo "  Start:   launchctl load $PLIST_FILE"
echo "  Stop:    launchctl unload $PLIST_FILE"
echo "  Status:  launchctl list | grep claude-code-slack-bot"
echo "  Logs:    tail -f /tmp/claude-code-slack-bot.log"
echo ""
echo "Usage in Slack:"
echo "  1. Set working directory: cwd /path/to/your/project"
echo "  2. Ask questions or request tasks"
echo ""
echo "Session features:"
echo "  - Sessions are automatically backed up every 30 minutes"
echo "  - Sessions persist across service restarts"
echo "  - Resume Slack session in terminal: ./scripts/resume-session.sh --latest"
echo ""
