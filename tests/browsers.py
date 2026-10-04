"""Cross-browser checks for gifshooter, driven by Selenium.

Each available engine (Chromium, Firefox, WebKitGTK) is tested on its own and paired
with Chromium over real WebRTC (signalled through a local Nostr relay), in both the
presenter and the painter role. Engines built without WebRTC (Ubuntu's WebKitGTK) get
the UI checks only, plus a check that the page explains it can't connect. Results go to public/tested-browsers.json, which the
landing page shows briefly.

    npm run build && python3 tests/browsers.py

Browsers/drivers are found through env vars (an engine is skipped if missing):
    CHROME_BIN, CHROMEDRIVER      Chromium + matching chromedriver
    FIREFOX_BIN, GECKODRIVER      Firefox + geckodriver
    WEBKIT_BIN                    WebKitGTK MiniBrowser (WebKitWebDriver on PATH);
                                  needs a display, e.g. run under xvfb-run
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
from datetime import date
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By

ROOT = Path(__file__).resolve().parent.parent
PORT, RELAY_PORT = 4173, 7777
BASE = f"http://localhost:{PORT}/"
RELAY = f"&relays=ws://localhost:{RELAY_PORT}"


# ---- browsers -------------------------------------------------------------------
def chrome():
    from selenium.webdriver.chrome.service import Service
    o = webdriver.ChromeOptions()
    o.binary_location = os.environ["CHROME_BIN"]
    for a in ("--headless=new", "--no-sandbox", "--window-size=1200,800", "--autoplay-policy=no-user-gesture-required"):
        o.add_argument(a)
    return webdriver.Chrome(options=o, service=Service(os.environ["CHROMEDRIVER"]))


def firefox():
    from selenium.webdriver.firefox.service import Service
    o = webdriver.FirefoxOptions()
    o.binary_location = os.environ["FIREFOX_BIN"]
    o.add_argument("-headless")
    o.set_preference("media.peerconnection.ice.loopback", True)  # allow WebRTC over localhost
    o.set_preference("media.peerconnection.ice.obfuscate_host_addresses", False)
    d = webdriver.Firefox(options=o, service=Service(os.environ["GECKODRIVER"]))
    d.set_window_size(1200, 800)
    return d


def webkit():
    o = webdriver.WebKitGTKOptions()
    o.binary_location = os.environ.get("WEBKIT_BIN", "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser")
    # WebKitGTK ships with WebRTC switched off (Safari has it on), so switch it on
    for arg in ("--automation", "--enable-webrtc=true", "--enable-media-stream=true"):
        o.add_argument(arg)
    d = webdriver.WebKitGTK(options=o)
    d.set_window_size(1200, 800)
    return d


ENGINES = {
    "chromium": (chrome, lambda: os.environ.get("CHROME_BIN") and os.environ.get("CHROMEDRIVER")),
    "firefox": (firefox, lambda: os.environ.get("FIREFOX_BIN") and os.environ.get("GECKODRIVER")),
    "webkit": (webkit, lambda: shutil.which("WebKitWebDriver")),
}


# ---- helpers ----------------------------------------------------------------------
def wait(fn, timeout=20, step=0.25):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v:
                return v
        except Exception:
            pass
        time.sleep(step)
    return None


def js(d, script, *args):
    return d.execute_script(script, *args)


def stamps(d):
    m = re.search(r"stamps (\d+)", js(d, "return document.querySelector('.debug')?.textContent || ''"))
    return int(m.group(1)) if m else -1


def canvas_painted(d, sel):
    return js(d, """
      const c = document.querySelector(arguments[0]); if (!c || !c.width) return false
      const x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      for (let i = 3; i < x.length; i += 4) if (x[i] > 0 && (x[i-1] || x[i-2] || x[i-3])) return true
      return false""", sel)


def paint_stroke(d):
    pad = d.find_element(By.ID, "pad")
    a = ActionChains(d, duration=30)
    a.move_to_element_with_offset(pad, -150, 0).click_and_hold().pause(0.15)
    for i in range(24):
        a.move_by_offset(12, 8 if i % 6 < 3 else -8)
    a.release().perform()


def describe(d):
    ua = js(d, "return navigator.userAgent")
    caps = d.capabilities
    name, ver = caps.get("browserName", "?"), caps.get("browserVersion", "?")
    if "firefox" in name.lower():
        return "Firefox", f"Firefox {ver.split('.')[0]}"
    if "minibrowser" in name.lower() or ("Safari" in ua and "Chrome" not in ua):
        return "WebKit", f"WebKit {ver.rsplit('.', 1)[0]} (Safari's engine)"
    return "Chromium", f"Chrome/Chromium {ver.split('.')[0]}"


# ---- checks ---------------------------------------------------------------------------
def check_solo(d):
    out = {}
    d.get(BASE)
    out["landing loads"] = bool(wait(lambda: js(d, "return document.querySelector('.logo').naturalWidth") > 0))
    out["random 5-letter code"] = bool(re.fullmatch(r"[a-z]{5}", js(d, "return document.getElementById('present-name').value")))

    d.get(BASE + "?c=solo&present&debug" + RELAY)
    out["present renders"] = bool(wait(lambda: stamps(d) >= 0)) and js(d, "return document.getElementById('present-code').textContent") == "solo"
    out["QR code drawn"] = bool(wait(lambda: canvas_painted(d, "#qr")))

    d.get(BASE + "?c=solo" + RELAY)
    out["paint renders"] = bool(wait(lambda: js(d, "return !document.getElementById('paint').hidden")))
    out["gif preview animates"] = bool(wait(lambda: canvas_painted(d, "#gif-preview")))

    hold = d.find_element(By.ID, "hold-gif")
    ActionChains(d).click_and_hold(hold).pause(1.3).release().perform()
    out["1 s hold opens picker"] = bool(wait(lambda: js(d, "return !document.getElementById('picker').hidden"), 5))
    first = js(d, "return document.querySelector('.thumb').style.backgroundPosition")
    out["picker thumbnails animate"] = bool(wait(lambda: js(d, "return document.querySelector('.thumb').style.backgroundPosition") != first, 3))
    return out


def check_pair(presenter, painter, code):
    presenter.get(BASE + f"?c={code}&present&debug" + RELAY)
    wait(lambda: stamps(presenter) >= 0)
    painter.get(BASE + f"?c={code}" + RELAY)
    connected = bool(wait(lambda: "finger" in js(painter, "return document.getElementById('paint-status').textContent"), 40))
    if not connected:
        return False, False
    before = stamps(presenter)
    paint_stroke(painter)
    drew = bool(wait(lambda: stamps(presenter) > before, 10))
    return connected, drew


def run():
    available = {k: v for k, v in ENGINES.items() if v[1]()}
    if "chromium" not in available:
        sys.exit("Chromium is required as the partner browser (set CHROME_BIN and CHROMEDRIVER)")
    results = []
    partner = chrome()
    try:
        for key, (make, _) in available.items():
            print(f"\n== {key}")
            d = None
            try:
                d = make()
                short, label = describe(d)
                checks = check_solo(d)
                skipped = []
                if js(d, "return typeof RTCPeerConnection") == "undefined":
                    # e.g. Ubuntu's WebKitGTK is built without WebRTC; real Safari has it.
                    # The page must say so instead of silently failing.
                    d.get(BASE + "?c=solo" + RELAY)
                    checks["explains missing WebRTC"] = bool(wait(lambda: "no WebRTC" in js(d, "return document.getElementById('paint-status').textContent"), 10))
                    skipped.append("peer-to-peer (this build has no WebRTC)")
                else:
                    for role, (pres, paint) in (("as screen, Chrome painting", (d, partner)), ("painting on a Chrome screen", (partner, d))):
                        connected, drew = check_pair(pres, paint, f"x{key[:2]}{int(time.time()) % 100000}")
                        checks[f"connects {role}"] = connected
                        checks[f"strokes arrive {role}"] = drew
            except Exception as e:
                traceback.print_exc()
                short, label, checks, skipped = key, key, {"driver error": False}, []
            finally:
                if d is not None:
                    d.quit()
            ok = all(checks.values())
            for name, v in checks.items():
                print(f"  {'PASS' if v else 'FAIL'}  {name}")
            for name in skipped:
                print(f"  SKIP  {name}")
            results.append({"browser": short, "label": label, "ok": ok, "checks": checks, "skipped": skipped})
    finally:
        partner.quit()

    report = {"date": date.today().isoformat(), "results": results}
    (ROOT / "public" / "tested-browsers.json").write_text(json.dumps(report, indent=2) + "\n")
    print("\n" + ", ".join(f"{r['label']}: {'ok' if r['ok'] else 'FAILED'}{' (some checks skipped)' if r['skipped'] else ''}" for r in results))
    return all(r["ok"] for r in results)


if __name__ == "__main__":
    relay = subprocess.Popen(["node", str(ROOT / "tests" / "relay.mjs"), str(RELAY_PORT)], stdout=subprocess.DEVNULL)
    server = subprocess.Popen(["npx", "vite", "preview", "--port", str(PORT), "--strictPort"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(3)
        ok = run()
    finally:
        server.terminate()
        relay.terminate()
    sys.exit(0 if ok else 1)
