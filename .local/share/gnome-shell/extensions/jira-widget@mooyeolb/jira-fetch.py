#!/usr/bin/env python3
"""Fetch Jira issues assigned to the current user and print them as JSON."""

import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

CONFIG_FILE = os.path.expanduser("~/.config/jira-widget/config.json")

_DEFAULT_JQL = (
    "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC"
)


def load_config() -> dict:
    """Return config dict.

    Priority order:
    1. JSON object on stdin  (written by extension.js from GSettings)
    2. Environment variables (legacy, kept for compatibility)
    3. ~/.config/jira-widget/config.json (legacy file-based config)
    """
    # 1. Read from stdin when the extension pipes config in
    if not sys.stdin.isatty():
        try:
            data = sys.stdin.buffer.read().strip()
            if data:
                return json.loads(data)
        except Exception:
            pass  # fall through to other sources

    # 2. Environment variables
    base_url = os.environ.get("JIRA_BASE_URL", "")
    token = os.environ.get("JIRA_TOKEN", "")
    if base_url and token:
        return {
            "base_url": base_url,
            "token": token,
            "jql": os.environ.get("JIRA_JQL", _DEFAULT_JQL),
            "max_results": int(os.environ.get("JIRA_MAX_RESULTS", "20")),
            "verify_ssl": os.environ.get("JIRA_VERIFY_SSL", "true").lower() == "true",
        }

    # 3. Legacy JSON config file
    if not os.path.exists(CONFIG_FILE):
        raise FileNotFoundError(
            f"Config not found at {CONFIG_FILE}. "
            "Open Extensions → Jira Widget → Settings to configure the extension."
        )
    with open(CONFIG_FILE) as f:
        return json.load(f)


def fetch_issues(config: dict) -> list:
    base_url = config["base_url"].rstrip("/")
    token = config["token"]
    jql = config.get("jql", _DEFAULT_JQL)
    max_results = int(config.get("max_results", 20))

    params = urllib.parse.urlencode(
        {
            "jql": jql,
            "maxResults": max_results,
            "fields": "summary,status,priority,issuetype,assignee",
        }
    )
    url = f"{base_url}/rest/api/2/search?{params}"

    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")

    ctx = ssl.create_default_context()
    if not config.get("verify_ssl", True):
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
        data = json.loads(resp.read().decode())
        return data.get("issues", [])


def main():
    try:
        config = load_config()
        issues = fetch_issues(config)
        print(json.dumps(issues))
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        print(f"HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
