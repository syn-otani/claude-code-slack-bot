#!/bin/bash
#
# Resume a Slack bot session in terminal
#
# Usage:
#   ./resume-session.sh                    # Show available sessions
#   ./resume-session.sh <session-id>       # Resume specific session
#   ./resume-session.sh --latest           # Resume most recent session
#

BACKUP_FILE="$HOME/.claude-code-slack-bot/backups/sessions.json"

if [[ ! -f "$BACKUP_FILE" ]]; then
    echo "No backup file found at: $BACKUP_FILE"
    exit 1
fi

# Function to list sessions
list_sessions() {
    echo "Available sessions:"
    echo "==================="
    echo ""

    # Parse JSON and display sessions
    python3 -c "
import json
import sys
from datetime import datetime

with open('$BACKUP_FILE', 'r') as f:
    data = json.load(f)

if not data['sessions']:
    print('No sessions found.')
    sys.exit(0)

# Get working directories
wd = data.get('workingDirectories', {})

for i, s in enumerate(data['sessions'], 1):
    session_id = s.get('sessionId', 'N/A')
    key = s.get('key', '')
    last_activity = s.get('lastActivity', 'N/A')

    # Find matching working directory
    working_dir = 'N/A'
    for wk, wv in wd.items():
        if wk in key or key in wk:
            working_dir = wv
            break

    # Parse and format timestamp
    try:
        dt = datetime.fromisoformat(last_activity.replace('Z', '+00:00'))
        last_activity = dt.strftime('%Y-%m-%d %H:%M:%S')
    except:
        pass

    print(f'{i}. Session ID: {session_id}')
    print(f'   Last Activity: {last_activity}')
    print(f'   Working Dir: {working_dir}')
    print('')
"
}

# Function to get latest session
get_latest_session() {
    python3 -c "
import json
with open('$BACKUP_FILE', 'r') as f:
    data = json.load(f)
if data['sessions']:
    # Sort by lastActivity and get the most recent
    sessions = sorted(data['sessions'], key=lambda x: x.get('lastActivity', ''), reverse=True)
    print(sessions[0].get('sessionId', ''))
"
}

# Function to get working directory for session
get_working_dir() {
    local session_id="$1"
    python3 -c "
import json
with open('$BACKUP_FILE', 'r') as f:
    data = json.load(f)

wd = data.get('workingDirectories', {})
sessions = data.get('sessions', [])

# Find session with matching ID
for s in sessions:
    if s.get('sessionId') == '$session_id':
        key = s.get('key', '')
        # Find matching working directory
        for wk, wv in wd.items():
            if wk in key or key in wk:
                print(wv)
                break
        break
"
}

# Main logic
if [[ $# -eq 0 ]]; then
    list_sessions
    echo ""
    echo "Usage:"
    echo "  $0 <session-id>    Resume specific session"
    echo "  $0 --latest        Resume most recent session"
    exit 0
fi

SESSION_ID="$1"

if [[ "$SESSION_ID" == "--latest" || "$SESSION_ID" == "-l" ]]; then
    SESSION_ID=$(get_latest_session)
    if [[ -z "$SESSION_ID" ]]; then
        echo "No sessions found."
        exit 1
    fi
    echo "Resuming latest session: $SESSION_ID"
fi

# Get working directory
WORKING_DIR=$(get_working_dir "$SESSION_ID")

if [[ -n "$WORKING_DIR" && -d "$WORKING_DIR" ]]; then
    echo "Working directory: $WORKING_DIR"
    cd "$WORKING_DIR"
else
    echo "Warning: Working directory not found, using current directory"
fi

echo "Resuming Claude Code session..."
echo ""

# Resume the session
exec claude --resume "$SESSION_ID"
