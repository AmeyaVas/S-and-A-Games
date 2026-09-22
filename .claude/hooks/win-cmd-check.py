#!/usr/bin/env python3
"""Stop hook: if Claude's reply hands the user a shell command to paste, make
sure it is written for Windows, or that the reply says which shell it is for.

Reads the hook payload on stdin, opens the transcript it names, looks at the
last main-loop assistant message, and exits 2 (re-prompt) when a pasteable
command block uses Unix-only syntax with no Windows context anywhere in the
reply. Exits 0 otherwise. Never blocks on anything it cannot read."""

import json, re, sys

# Blocks tagged as one of these are data or output, not a command to paste.
NOT_COMMANDS = {"json","css","html","js","javascript","jsx","ts","tsx","python",
                "py","md","markdown","diff","yaml","yml","xml","sql","java","go",
                "rust","c","cpp","toml","ini","csv","log","text","txt"}

# Unix-only constructs that would fail or misbehave in cmd.exe.
UNIX = [
    (r"(?m)(?<![\w%])~/",           "~/ (cmd has no ~; use %USERPROFILE%)"),
    (r"(?m)\bmkdir\s+-p\b",         "mkdir -p (cmd mkdir needs no -p)"),
    (r"(?m)^\s*cp\s",               "cp (Windows uses copy)"),
    (r"(?m)^\s*ls\b",               "ls (Windows uses dir)"),
    (r"(?m)^\s*grep\s",             "grep (Windows uses findstr)"),
    (r"(?m)^\s*rm\s",               "rm (Windows uses del)"),
    (r"(?m)^\s*cat\s",              "cat (Windows uses type)"),
    (r"(?m)^\s*touch\s",            "touch"),
    (r"(?m)^\s*export\s",           "export (cmd uses set)"),
    (r"/dev/null",                  "/dev/null (cmd uses nul)"),
    (r"\$HOME\b",                   "$HOME (cmd uses %USERPROFILE%)"),
    (r"(?m)^\s*chmod\s",            "chmod"),
]

# Anything here means the reply already frames the shell for the reader.
WINDOWS_CONTEXT = [
    r"Command Prompt", r"PowerShell", r"%USERPROFILE%", r"cmd\.exe",
    r"\bfindstr\b", r"\bWindows\b", r"Git Bash", r"\bWSL\b",
    r"(?m)^\s*copy\s+\"", r"(?m)^\s*del\s+\"",
]

FENCE = re.compile(r"```([A-Za-z0-9_+-]*)\n(.*?)```", re.S)


def last_assistant_text(path):
    """Text of the final main-loop assistant message, or None."""
    found = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("type") != "assistant" or e.get("isSidechain"):
                continue
            msg = e.get("message") or {}
            parts = [b.get("text", "") for b in msg.get("content", [])
                     if isinstance(b, dict) and b.get("type") == "text"]
            if parts:
                found = "\n".join(parts)
    return found


def findings(text):
    """(hits, blocks_checked) for pasteable command blocks in `text`."""
    if not text:
        return [], 0
    if any(re.search(p, text) for p in WINDOWS_CONTEXT):
        return [], 0                      # reply already names the platform
    hits, checked = [], 0
    for lang, body in FENCE.findall(text):
        if lang.lower() in NOT_COMMANDS:
            continue
        checked += 1
        for pat, label in UNIX:
            if re.search(pat, body):
                hits.append(label)
    return sorted(set(hits)), checked


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)                       # unreadable payload: never block
    if payload.get("stop_hook_active"):
        sys.exit(0)                       # already re-prompted once
    path = payload.get("transcript_path")
    if not path:
        sys.exit(0)
    try:
        text = last_assistant_text(path)
    except OSError:
        sys.exit(0)
    hits, _ = findings(text)
    if hits:
        print("This reply gives commands to paste, but they use Unix syntax and "
              "the reply never says which shell: " + "; ".join(hits) +
              ". This project's user works on Windows (see CLAUDE.md). Rewrite "
              "them for Command Prompt, or say explicitly which shell they are "
              "for.", file=sys.stderr)
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
