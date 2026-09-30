#!/usr/bin/env bash
# Stop hook: before a Claude Code session finishes, require docs/delivery/STATUS.md
# to be updated whenever other repository files changed in this piece of work.
#
# "Changed" = uncommitted changes (incl. untracked files) plus commits on the current
# branch that are not yet on origin/main. If STATUS.md is among them, or nothing
# changed, the session may finish. See CLAUDE.md ("Session routine").

STATUS_FILE="docs/delivery/STATUS.md"

input="$(cat)"

# Claude is already continuing because of this hook: never block twice (prevents loops).
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

changed="$(git status --porcelain --untracked-files=all 2>/dev/null | cut -c4- | sed 's/.* -> //')"
if git rev-parse --verify -q origin/main >/dev/null 2>&1; then
  changed="$changed
$(git diff --name-only origin/main...HEAD 2>/dev/null)"
fi

# Ignore personal, non-shared files.
changed="$(printf '%s\n' "$changed" | grep -v -e '^$' -e '^\.claude/settings\.local\.json$' | sort -u)"

[ -z "$changed" ] && exit 0
printf '%s\n' "$changed" | grep -qx "$STATUS_FILE" && exit 0

cat <<'EOF'
{"decision":"block","reason":"Repository files changed in this session but docs/delivery/STATUS.md was not updated. Before finishing, follow the end-of-session routine in CLAUDE.md: update STATUS.md (milestone/task status, decisions with dates, blockers/risks, next actions, and a one-line session-log entry), then commit and push it with the other changes. If the changes truly need no status entry (e.g. a typo fix), add a brief session-log line saying so."}
EOF
exit 0
