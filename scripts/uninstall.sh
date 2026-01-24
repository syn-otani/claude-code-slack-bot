#!/bin/bash
#
# Claude Code Slack Bot - Uninstall Script for macOS
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step() {
    echo -e "${BLUE}==>${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

echo ""
echo "========================================"
echo "  Claude Code Slack Bot Uninstall"
echo "========================================"
echo ""

HOME_DIR=$(eval echo ~$(whoami))
PLIST_FILE="$HOME_DIR/Library/LaunchAgents/com.claude-code-slack-bot.plist"

# Stop the service
print_step "Stopping the service..."
launchctl unload "$PLIST_FILE" 2>/dev/null || true
print_success "Service stopped"

# Remove plist file
print_step "Removing launchd configuration..."
rm -f "$PLIST_FILE"
print_success "Configuration removed"

# Remove log files
print_step "Removing log files..."
rm -f /tmp/claude-code-slack-bot.log
rm -f /tmp/claude-code-slack-bot.error.log
print_success "Log files removed"

echo ""
echo "========================================"
echo "  Uninstall Complete!"
echo "========================================"
echo ""
echo "The bot directory was NOT removed."
echo "To completely remove, run:"
echo "  rm -rf ~/claude-code-slack-bot"
echo ""
