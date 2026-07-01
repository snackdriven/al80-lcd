import sys
import time
import datetime
import subprocess
import os
import hid  # pip install hidapi

VID, PID = 0x28E9, 0x30AF
USAGE_PAGE = 0xFF60            # raw/VIA interface, NOT the keyboard interface
SYNC_EVERY_SECONDS = 60
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "al80_clock.log")
ONCE = "--once" in sys.argv

def log(level, msg):
    line = "[%s] %s: %s" % (datetime.datetime.now().isoformat(), level, msg)
    print(line, file=(sys.stderr if level == "ERROR" else sys.stdout))
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

def toast(title, message):
    ps = (
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null; "
        "$xml=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); "
        "$t=$xml.GetElementsByTagName('text'); "
        "$t.Item(0).AppendChild($xml.CreateTextNode('%s'))|Out-Null; "
        "$t.Item(1).AppendChild($xml.CreateTextNode('%s'))|Out-Null; "
        "$toast=[Windows.UI.Notifications.ToastNotification]::new($xml); "
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('AL80 Clock').Show($toast)"
    ) % (title.replace("'", "''"), message.replace("'", "''"))
    try:
        subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps])
    except Exception as e:
        log("ERROR", "toast failed: %s" % e)

consecutive_failures = 0
def report_failure(msg):
    global consecutive_failures
    consecutive_failures += 1
    log("ERROR", "%s  (consecutive failures: %d)" % (msg, consecutive_failures))
    if consecutive_failures == 3:
        alert = "Clock is NOT updating. Check: browser tab open? keyboard asleep/unplugged? wrong interface?"
        log("ERROR", "*** %s ***" % alert)
        toast("AL80 clock sync failed", alert)

def find_path():
    matches = [d for d in hid.enumerate(VID, PID)]
    if not matches:
        raise RuntimeError("No AL80 found (VID 0x28e9 PID 0x30af). Is it plugged in?")
    m = next((d for d in matches if d.get("usage_page") == USAGE_PAGE), matches[0])
    if not m.get("path"):
        raise RuntimeError("Found device but it has no usable path.")
    return m["path"]

def build_packets():
    now = datetime.datetime.now()
    h = (now.hour % 12) or 12       # 0->12, 13->1, 12->12
    m, s = now.minute, now.second
    cksum = (0x41 + 0x03 + h + m + s) & 0xFF
    def pad(b):
        return bytes([0x00] + b + [0] * (64 - len(b)))  # 0x00 = report ID
    packets = [
        pad([0x40, 0, 0, 0x07, 0xF6, 0x02, 0, 0xA5, 0x5A, 0x09, 0, 0x03, 0xC3, 0xE1]),
        pad([0x41, 0, 0, 0x03, cksum, 0, 0, h, m, s]),
        pad([0x42, 0, 0, 0x38, 0x7A]),
    ]
    return packets, "%d:%02d:%02d" % (h, m, s)

def sync_once():
    path = find_path()
    dev = hid.device()
    dev.open_path(path)
    try:
        packets, display = build_packets()
        for pkt in packets:
            written = dev.write(pkt)
            if written <= 0:
                raise RuntimeError("dev.write returned %s - device rejected the packet." % written)
            time.sleep(0.06)
        log("INFO", "synced %s (12hr)" % display)
        return True
    finally:
        dev.close()

def main():
    global consecutive_failures
    log("INFO", "al80_clock starting (mode: %s, log: %s)" % ("once" if ONCE else "loop", LOG_FILE))
    if ONCE:
        try:
            sync_once()
            sys.exit(0)
        except Exception as e:
            log("ERROR", "single sync failed: %s" % e)
            sys.exit(1)
    while True:
        try:
            sync_once()
            consecutive_failures = 0
        except Exception as e:
            report_failure(str(e))
        time.sleep(SYNC_EVERY_SECONDS)

if __name__ == "__main__":
    main()
