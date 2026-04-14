#!/usr/bin/env python3
"""Fetch work-time data from Naver HR system and print as JSON.

Supports two modes:
  - fetch (default): get summary, history, and check-in status
  - action: perform check-in / check-out / pause

Config (JSON on stdin):
  username, password     — SSO credentials
  company                — 'naver' or 'line'
  base_url_override      — optional
  action                 — 'checkin', 'checkout', or 'pause' (optional)
"""

import html as html_mod
import http.cookiejar
import json
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

HOSTS = {
    "naver": "https://nhrlove.navercorp.com",
    "line": "https://hronline.navercorp.com",
}

SAVE_URL = "/user/hrms/odm/worktime/saveWorktimeHistory"
REST_URL = "/user/hrms/odm/worktime/saveWorktimeLeftSeatRest"


def load_config() -> dict:
    if not sys.stdin.isatty():
        data = sys.stdin.buffer.read().strip()
        if data:
            return json.loads(data)
    raise RuntimeError("No config provided on stdin")


def create_opener():
    """Create a urllib opener with cookie-jar and SSL support."""
    cj = http.cookiejar.CookieJar()
    ctx = ssl.create_default_context()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cj),
        urllib.request.HTTPSHandler(context=ctx),
    )
    opener.addheaders = [
        ("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) GNOME WorkTime Widget"),
        ("Accept", "text/html,application/json,*/*"),
    ]
    return opener


def _open(opener, url, data=None, extra_headers=None):
    req = urllib.request.Request(url, data=data)
    if extra_headers:
        for k, v in extra_headers.items():
            req.add_header(k, v)
    return opener.open(req, timeout=30)


# ── HTML form helpers ────────────────────────────────────────────────────


def _parse_hidden_fields(html_text):
    """Extract hidden input fields from HTML as a dict."""
    fields = {}
    for inp in re.finditer(r"<input\b[^>]*>", html_text, re.IGNORECASE):
        tag = inp.group(0)
        if not re.search(r'type=["\']hidden["\']', tag, re.IGNORECASE):
            continue
        nm = re.search(r'name=["\']([^"\']+)["\']', tag, re.IGNORECASE)
        vm = re.search(r'value=["\']([^"\']*)["\']', tag, re.IGNORECASE)
        if nm:
            fields[nm.group(1)] = html_mod.unescape(vm.group(1)) if vm else ""
    return fields


def _find_input_name(html_text, input_type):
    """Find the first <input> with the given type and return its name."""
    for inp in re.finditer(r"<input\b[^>]*>", html_text, re.IGNORECASE):
        tag = inp.group(0)
        tm = re.search(r'type=["\'](\w+)["\']', tag, re.IGNORECASE)
        nm = re.search(r'name=["\']([^"\']+)["\']', tag, re.IGNORECASE)
        if tm and nm and tm.group(1).lower() == input_type:
            return nm.group(1)
    return None


def _is_authenticated(html_text, resp_url=""):
    """Check if we're on an authenticated HR page (not SSO login)."""
    if "nss.navercorp.com" in resp_url:
        return False
    # jQuery selector only present on the actual check-in page
    return bool(re.search(r'\$\(["\']#staTime["\']\)', html_text))


def _follow_auto_submit(opener, html_text, current_url):
    """Follow a JavaScript auto-submit form (onload submit).

    Returns (new_html, new_url) or (html_text, current_url) if no
    auto-submit detected.
    """
    if "submit()" not in html_text:
        return html_text, current_url

    form_m = re.search(
        r"<form\b[^>]*>", html_text, re.IGNORECASE
    )
    if not form_m:
        return html_text, current_url

    form_tag = form_m.group(0)
    action_m = re.search(r'action=["\']([^"\']+)["\']', form_tag, re.IGNORECASE)
    method_m = re.search(r'method=["\'](\w+)["\']', form_tag, re.IGNORECASE)
    if not action_m:
        return html_text, current_url

    action = html_mod.unescape(action_m.group(1))
    method = (method_m.group(1) if method_m else "get").lower()

    if not action.startswith("http"):
        action = urllib.parse.urljoin(current_url, action)

    fields = _parse_hidden_fields(html_text)

    if method == "get":
        query = urllib.parse.urlencode(fields)
        url = f"{action}?{query}" if query else action
        resp = _open(opener, url)
    else:
        encoded = urllib.parse.urlencode(fields).encode()
        resp = _open(
            opener, action, data=encoded,
            extra_headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    new_html = resp.read().decode(errors="replace")
    return new_html, resp.geturl()


# ── Login ────────────────────────────────────────────────────────────────


def login(opener, base_url, username, password):
    """Authenticate through Naver Corp NSS SSO.

    Flow:
      1. GET HR page → redirect to nss.navercorp.com/nssauthorize
      2. Auto-submit form → /loginRequest (GET)
      3. Parse login form → POST /loginProcess with credentials
      4. Follow redirects back to HR system
    """
    # Step 1: Access HR page, follow HTTP redirects
    resp = _open(opener, f"{base_url}/user/connect/odm/worktimeRegInfo")
    html = resp.read().decode(errors="replace")
    url = resp.geturl()

    if _is_authenticated(html, url):
        return

    # Step 2: Follow auto-submit forms (JS onload redirects)
    for _ in range(5):  # safety limit
        prev = html
        html, url = _follow_auto_submit(opener, html, url)
        if html is prev:
            break
        if _is_authenticated(html, url):
            return

    # Step 3: We should now be on the login form (POST to /loginProcess)
    form_m = re.search(
        r'<form\b[^>]*action=["\']([^"\']+)["\'][^>]*method=["\']post["\']',
        html, re.IGNORECASE,
    )
    if not form_m:
        form_m = re.search(
            r'<form\b[^>]*method=["\']post["\'][^>]*action=["\']([^"\']+)["\']',
            html, re.IGNORECASE,
        )
    if not form_m:
        raise RuntimeError("Login form not found — unexpected SSO page")

    action_url = html_mod.unescape(form_m.group(1))
    if not action_url.startswith("http"):
        action_url = urllib.parse.urljoin(url, action_url)

    fields = _parse_hidden_fields(html)

    # Add credentials
    user_field = _find_input_name(html, "text") or "user"
    pw_field = _find_input_name(html, "password") or "password"
    fields[user_field] = username
    fields[pw_field] = password

    # Timezone
    fields.setdefault("loginTimeZone", "Asia/Seoul:+9")

    # Step 4: POST login
    encoded = urllib.parse.urlencode(fields).encode()
    resp = _open(
        opener, action_url, data=encoded,
        extra_headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": url,
        },
    )
    html = resp.read().decode(errors="replace")
    url = resp.geturl()

    # Check for login error (error_noti on the NSS page)
    err_m = re.search(
        r'class=["\']error_noti["\'][^>]*style=["\'][^"\']*display:\s*block[^>]*>([^<]+)',
        html, re.IGNORECASE,
    )
    if err_m:
        raise RuntimeError(f"Login failed — {err_m.group(1).strip()}")

    # Follow post-login auto-submit forms (NSS → nscauthorize → HR page)
    for _ in range(5):
        prev = html
        html, url = _follow_auto_submit(opener, html, url)
        if html is prev:
            break
        if _is_authenticated(html, url):
            return

    # Step 5: Verify we can access the HR page
    if not _is_authenticated(html, url):
        resp = _open(opener, f"{base_url}/user/connect/odm/worktimeRegInfo")
        html = resp.read().decode(errors="replace")
        url = resp.geturl()
        # May need one more auto-submit follow
        for _ in range(3):
            prev = html
            html, url = _follow_auto_submit(opener, html, url)
            if html is prev:
                break
        if not _is_authenticated(html, url):
            raise RuntimeError("Login failed — could not reach HR page after login")


# ── Data fetching ────────────────────────────────────────────────────────


def fetch_summary(opener, base_url) -> dict:
    url = f"{base_url}/user/hrms/odm/worktime/getWorktimeTotal"
    resp = _open(opener, url, extra_headers={"Accept": "application/json"})
    body = resp.read()
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        raise RuntimeError("Session expired — re-login required")
    return data.get("worktimeTot", {})


def fetch_history(opener, base_url) -> list:
    url = f"{base_url}/user/hrms/odm/worktime/selectWorktimeHistoryList"
    resp = _open(opener, url, extra_headers={"Accept": "application/json"})
    body = resp.read()
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        raise RuntimeError("Session expired — re-login required")
    return data.get("DATA", [])


def fetch_checkin(opener, base_url) -> dict:
    try:
        url = f"{base_url}/user/connect/odm/worktimeRegInfo"
        resp = _open(opener, url)
        html = resp.read().decode(errors="replace")

        sta_match = re.search(
            r'["\']staTime["\']\)\.text\(["\'](\d{4})["\']', html
        )
        end_match = re.search(
            r'["\']endTime["\']\)\.text\(["\'](\d{4})["\']', html
        )

        can_checkin = bool(re.search(r"btnSta", html))
        can_checkout = bool(re.search(r"btnEnd", html))
        can_pause = bool(re.search(r"btnOut", html))

        return {
            "sta_hm": sta_match.group(1) if sta_match else None,
            "end_hm": end_match.group(1) if end_match else None,
            "can_checkin": can_checkin,
            "can_checkout": can_checkout,
            "can_pause": can_pause,
        }
    except Exception:
        return {
            "sta_hm": None,
            "end_hm": None,
            "can_checkin": False,
            "can_checkout": False,
            "can_pause": False,
        }


# ── Actions ──────────────────────────────────────────────────────────────


def perform_action(opener, base_url, action, config) -> dict:
    """Perform a check-in, check-out, or pause action."""
    import datetime

    now = datetime.datetime.now()
    today = now.strftime("%Y%m%d")
    now_hm = now.strftime("%H%M")
    workplace = config.get("workplace", "REMOTE")
    referer = f"{base_url}/user/connect/odm/worktimeRegInfo"
    hdrs = {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": referer,
    }

    if action == "checkin":
        hour = now.hour
        if hour >= 22 or hour < 6:
            raise RuntimeError("출근은 06:00~22:00 사이에만 가능합니다.")
        params = {
            "work_ymd": today,
            "sta_hm": now_hm,
            "workplace_cd": workplace,
        }
        url = f"{base_url}{SAVE_URL}"
        resp = _open(
            opener, url,
            data=urllib.parse.urlencode(params).encode(),
            extra_headers=hdrs,
        )

    elif action == "checkout":
        # Need the check-in time from current status
        sta_hm = config.get("sta_hm", "")
        if not sta_hm:
            raise RuntimeError("출근 기록이 없습니다.")
        params = {
            "work_ymd": today,
            "sta_hm": sta_hm,
            "end_hm": now_hm,
            "workplace_cd": workplace,
        }
        url = f"{base_url}{SAVE_URL}"
        resp = _open(
            opener, url,
            data=urllib.parse.urlencode(params).encode(),
            extra_headers=hdrs,
        )

    elif action == "pause":
        pause_type = config.get("pause_type", "sta")  # "sta" or "end"
        params = {
            "target": pause_type,
            "isLeftSeat": "false",
        }
        url = f"{base_url}{REST_URL}"
        resp = _open(
            opener, url,
            data=urllib.parse.urlencode(params).encode(),
            extra_headers=hdrs,
        )

    else:
        raise RuntimeError(f"Unknown action: {action}")

    body = resp.read().decode(errors="replace")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {"raw": body[:300]}


# ── Main ─────────────────────────────────────────────────────────────────


def main():
    try:
        config = load_config()
        company = config.get("company", "naver")
        username = config.get("username", "")
        password = config.get("password", "")
        action = config.get("action", "")

        base_url = (config.get("base_url_override") or "").rstrip("/")
        if not base_url:
            base_url = HOSTS.get(company, HOSTS["naver"])

        if not username or not password:
            print(
                "Settings에서 사용자 ID/비밀번호를 설정하세요.",
                file=sys.stderr,
            )
            sys.exit(1)

        opener = create_opener()
        login(opener, base_url, username, password)

        if action:
            result = perform_action(opener, base_url, action, config)
            print(json.dumps({"action_result": result, "base_url": base_url}))
            return

        summary = fetch_summary(opener, base_url)
        history = fetch_history(opener, base_url)
        checkin = fetch_checkin(opener, base_url)

        print(
            json.dumps(
                {
                    "summary": summary,
                    "history": history,
                    "checkin": checkin,
                    "base_url": base_url,
                }
            )
        )
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        if e.code in (401, 403) or "login" in body.lower():
            print("인증 실패 — Settings에서 ID/비밀번호를 확인하세요.", file=sys.stderr)
        else:
            print(f"HTTP {e.code}: {body[:200]}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        reason = str(e.reason) if hasattr(e, "reason") else str(e)
        if "Name or service not known" in reason or "getaddrinfo" in reason:
            print("No network", file=sys.stderr)
        elif "Connection refused" in reason or "Connection reset" in reason:
            print("Intranet unreachable", file=sys.stderr)
        elif "timed out" in reason:
            print("Connection timed out", file=sys.stderr)
        else:
            print(f"Connection failed: {reason}", file=sys.stderr)
        sys.exit(2)
    except (TimeoutError, OSError) as e:
        msg = str(e)
        if "timed out" in msg:
            print("Connection timed out", file=sys.stderr)
        else:
            print(f"Connection failed: {msg}", file=sys.stderr)
        sys.exit(2)
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
