"""Keyboard-only desktop portal session. JSON lines over private stdio, no server."""
import json
import re
import sys
import time
import uuid

from gi.repository import Gio, GLib

BUS = "org.freedesktop.portal.Desktop"
PATH = "/org/freedesktop/portal/desktop"
REMOTE = "org.freedesktop.portal.RemoteDesktop"
REQUEST = "org.freedesktop.portal.Request"
SESSION = "org.freedesktop.portal.Session"


class PortalKeyboard:
    def __init__(self):
        GLib.set_application_name("OpenCookie")
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.session = None
        self.started = False
        self.subscription = None

    def call(self, method, signature, values, path=PATH, interface=REMOTE):
        return self.bus.call_sync(BUS, path, interface, method,
                                 GLib.Variant(signature, values), None,
                                 Gio.DBusCallFlags.NONE, 5000, None).unpack()

    def request(self, method, signature, values, options):
        token = "opencookie_" + uuid.uuid4().hex
        sender = self.bus.get_unique_name()[1:].replace(".", "_")
        handle = PATH + "/request/" + sender + "/" + token
        options = dict(options, handle_token=GLib.Variant("s", token))
        loop = GLib.MainLoop()
        response = []

        def received(_bus, _sender, _path, _iface, _signal, params, *_extra):
            response.append(params.unpack())
            loop.quit()

        subscription = self.bus.signal_subscribe(BUS, REQUEST, "Response", handle,
                                                None, Gio.DBusSignalFlags.NONE, received)
        timer = GLib.timeout_add_seconds(120, lambda: (loop.quit(), False)[1])
        try:
            returned = self.call(method, signature, (*values, options))[0]
            if returned != handle:
                raise RuntimeError("Wayland portal returned an unexpected request handle.")
            if not response:
                loop.run()
            if not response:
                self.call("Close", "()", (), path=handle, interface=REQUEST)
                raise RuntimeError("Wayland keyboard permission timed out.")
            code, results = response[0]
            if code != 0:
                raise RuntimeError("Keyboard permission was cancelled. Pick up a new cookie and allow keyboard control to enable praise.")
            return results
        finally:
            self.bus.signal_unsubscribe(subscription)
            if GLib.MainContext.default().find_source_by_id(timer):
                GLib.source_remove(timer)

    def closed(self, *_args):
        self.started = False
        self.session = None

    def prepare(self):
        if self.started:
            return False
        self.close()
        try:
            result = self.request("CreateSession", "(a{sv})", (), {
                "session_handle_token": GLib.Variant("s", "opencookie_" + uuid.uuid4().hex)
            })
            self.session = result["session_handle"]
            self.subscription = self.bus.signal_subscribe(BUS, SESSION, "Closed", self.session,
                                                         None, Gio.DBusSignalFlags.NONE, self.closed)
            # Keyboard only: no screen capture, pointer, clipboard, or saved permission.
            self.request("SelectDevices", "(oa{sv})", (self.session,), {"types": GLib.Variant("u", 1)})
            granted = self.request("Start", "(osa{sv})", (self.session, ""), {})
            if not granted.get("devices", 0) & 1 or not self.session:
                raise RuntimeError("Keyboard permission was not granted by the desktop.")
            self.started = True
            return True
        except Exception:
            self.close()
            raise

    def key(self, symbol, state):
        self.call("NotifyKeyboardKeysym", "(oa{sv}iu)", (self.session, {}, symbol, state))

    def tap(self, symbol):
        self.key(symbol, 1)
        try:
            time.sleep(0.003)
        finally:
            self.key(symbol, 0)

    def check(self):
        if not self.started or not self.session:
            raise RuntimeError("Keyboard permission is no longer active. Pick up a new cookie to reconnect.")

    def give(self, message):
        self.check()
        if not isinstance(message, str) or not re.fullmatch(r"[\x20-\x7e]{1,160}", message):
            raise RuntimeError("Invalid praise message.")
        try:
            self.key(0xffe3, 1)  # Control_L
            try:
                self.tap(ord("c"))
            finally:
                self.key(0xffe3, 0)
            time.sleep(0.3)
            for character in message:
                self.tap(ord(character))
            self.tap(0xff0d)  # Return
        except Exception:
            self.close()
            raise RuntimeError("Wayland keyboard delivery failed. Pick up a new cookie to reconnect.")

    def close(self):
        self.started = False
        if self.subscription:
            self.bus.signal_unsubscribe(self.subscription)
            self.subscription = None
        if self.session:
            try:
                self.call("Close", "()", (), path=self.session, interface=SESSION)
            except Exception:
                pass
            self.session = None


def main():
    keyboard = PortalKeyboard()
    try:
        for line in sys.stdin:
            # Process revocation signals between commands as well as during setup.
            context = GLib.MainContext.default()
            while context.pending():
                context.iteration(False)
            request = json.loads(line)
            reply = {"id": request["id"], "ok": False}
            try:
                if request["command"] == "prepare":
                    reply["created"] = keyboard.prepare()
                elif request["command"] == "check":
                    keyboard.check()
                elif request["command"] == "give":
                    keyboard.give(request.get("message"))
                else:
                    raise RuntimeError("Unknown keyboard command.")
                reply["ok"] = True
            except RuntimeError as error:
                reply["error"] = str(error)
            except Exception:
                reply["error"] = "Wayland keyboard portal is unavailable. Check your desktop's Remote Desktop portal support."
            print(json.dumps(reply), flush=True)
    finally:
        keyboard.close()


if __name__ == "__main__":
    main()
