#!/usr/bin/env python3
"""Apple Family-Controls-Antrag: Login + Formular automatisieren.

2FA-Code wird aus /opt/apps/internetblocker/2fa.txt gelesen (poll).
"""
import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
PROFILE = Path("/opt/backups/apple-browser-profile")
TWOFA_FILE = Path("/opt/apps/internetblocker/2fa.txt")

APPLE_ID = os.environ.get("APPLE_ID", "karsdorf.2004@web.de")
APPLE_PW = os.environ.get("APPLE_PW", "")

SIGNIN_URL = "https://developer.apple.com/account/sign-in"
REQUEST_URL = "https://developer.apple.com/contact/request/family-controls-distribution"


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def shot(page, name):
    page.screenshot(path=str(HERE / name))


def wait_2fa(timeout=600):
    log(f"Warte auf 2FA-Code in {TWOFA_FILE} …")
    end = time.time() + timeout
    while time.time() < end:
        if TWOFA_FILE.exists():
            code = TWOFA_FILE.read_text().strip()
            if code:
                log("2FA-Code gelesen")
                return code
        time.sleep(1)
    return None


def fill_apple_id(page):
    sel = "input#account_name_text_field"
    try:
        page.wait_for_selector(sel, timeout=20000)
        page.fill(sel, APPLE_ID)
        log("Apple-ID eingetragen")
        return True
    except Exception as e:
        log(f"Apple-ID-Feld fehlt: {e}")
        shot(page, "step_id.png")
        return False


def click_continue(page):
    for sel in ("button#sign-in", "button#continue", "#signInButton", "button[type='submit']"):
        try:
            if page.locator(sel).count() and page.locator(sel).first.is_visible():
                page.locator(sel).first.click(timeout=8000)
                log(f"Klick: {sel}")
                return True
        except Exception:
            continue
    return False


def fill_password(page):
    sel = "input#password_text_field"
    try:
        page.wait_for_selector(sel, timeout=20000)
        page.fill(sel, APPLE_PW)
        log("Passwort eingetragen")
        click_continue(page)
        return True
    except Exception as e:
        log(f"Passwort-Feld fehlt: {e}")
        shot(page, "step_pw.png")
        return False


def submit_2fa(page, code):
    # Variante A: 6 einzelne Ziffernfelder
    try:
        boxes = page.locator("input[type='text'][maxlength='1'], input[inputmode='numeric']")
        if boxes.count() >= 6:
            for i in range(6):
                boxes.nth(i).fill(code[i])
            log("2FA in 6 Felder eingetragen")
            click_continue(page)
            return
    except Exception:
        pass
    # Variante B: ein kombiniertes Feld
    try:
        page.fill("input[type='text'], input[type='tel'], input#char0", code)
        log("2FA in kombiniertes Feld eingetragen")
        click_continue(page)
    except Exception as e:
        log(f"2FA-Eingabe: {e}")
        shot(page, "step_2fa.png")


def main():
    with sync_playwright() as p:
        PROFILE.mkdir(parents=True, exist_ok=True)
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE),
            headless=True,
            viewport={"width": 1280, "height": 900},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        log("Öffne Apple-Sign-in …")
        page.goto(SIGNIN_URL, wait_until="domcontentloaded", timeout=60000)
        time.sleep(3)
        log(f"URL: {page.url}")

        if not fill_apple_id(page):
            log("ABBRUCH: Apple-ID-Feld nicht erreichbar")
            ctx.close()
            return 1
        click_continue(page)
        time.sleep(4)

        if not fill_password(page):
            log("WARNUNG: Passwort-Schritt nicht erkannt, prüfe Screenshot")

        time.sleep(4)
        log(f"Nach Login-Versuch: {page.url}")

        # 2FA
        code = wait_2fa()
        if not code:
            shot(page, "step_2fa_timeout.png")
            log("ABBRUCH: kein 2FA-Code")
            ctx.close()
            return 1
        submit_2fa(page, code)
        time.sleep(6)
        log(f"Nach 2FA: {page.url}")

        # Zur Request-Seite
        if "family-controls" not in page.url:
            page.goto(REQUEST_URL, wait_until="domcontentloaded", timeout=60000)
            time.sleep(4)
        log(f"Request-Seite: {page.url}")
        shot(page, "step_request.png")

        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
