"""Fake keyboard portal for the PRIVATE test bus. Never injects OS input."""
import json
from gi.repository import Gio, GLib

PATH = "/org/freedesktop/portal/desktop"
REMOTE = "org.freedesktop.portal.RemoteDesktop"
SESSION = "org.freedesktop.portal.Session"
CONTROL = "dev.opencookie.Test"
XML = f"""<node><interface name="{REMOTE}">
<method name="CreateSession"><arg direction="in" type="a{{sv}}"/><arg direction="out" type="o"/></method>
<method name="SelectDevices"><arg direction="in" type="o"/><arg direction="in" type="a{{sv}}"/><arg direction="out" type="o"/></method>
<method name="Start"><arg direction="in" type="o"/><arg direction="in" type="s"/><arg direction="in" type="a{{sv}}"/><arg direction="out" type="o"/></method>
<method name="NotifyKeyboardKeysym"><arg direction="in" type="o"/><arg direction="in" type="a{{sv}}"/><arg direction="in" type="i"/><arg direction="in" type="u"/></method>
</interface><interface name="{CONTROL}">
<method name="Mode"><arg direction="in" type="s"/></method>
<method name="Report"><arg direction="out" type="s"/></method>
<method name="Revoke"/>
</interface><interface name="{SESSION}"><method name="Close"/><signal name="Closed"><arg type="a{{sv}}"/></signal></interface></node>"""
info = Gio.DBusNodeInfo.new_for_xml(XML)
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
mode = "allow"
events, selected, requests = [], [], []
sessions = []
registrations = []


def method(_bus, sender, _path, interface, name, params, invocation):
    global mode, events, selected, requests
    values = params.unpack()
    if interface == CONTROL:
        if name == "Mode":
            mode = values[0]
            events, selected, requests = [], [], []
        elif name == "Report":
            invocation.return_value(GLib.Variant("(s)", (json.dumps({"events": events, "selected": selected, "requests": requests}),)))
            return
        elif name == "Revoke":
            for session, owner in sessions:
                bus.emit_signal(owner, session, SESSION, "Closed", GLib.Variant("(a{sv})", ({},)))
        invocation.return_value(GLib.Variant("()", ()))
        return
    if interface == SESSION:
        invocation.return_value(GLib.Variant("()", ()))
        return
    if name == "NotifyKeyboardKeysym":
        _session, _options, symbol, state = values
        if mode == "fail" and symbol == ord("G"):
            invocation.return_dbus_error("org.freedesktop.portal.Error.Failed", "Test typing failure")
            return
        events.append([symbol, state])
        invocation.return_value(GLib.Variant("()", ()))
        return
    requests.append(name)
    options = values[-1]
    owner = sender[1:].replace(".", "_")
    handle = PATH + "/request/" + owner + "/" + options["handle_token"]
    result, code = {}, 0
    if name == "CreateSession":
        session = PATH + "/session/" + owner + "/" + options["session_handle_token"]
        registrations.append(bus.register_object(session, info.interfaces[2], method, None, None))
        sessions.append((session, sender))
        result["session_handle"] = GLib.Variant("s", session)
    elif name == "SelectDevices":
        selected.append(options["types"])
    elif name == "Start":
        code = 1 if mode == "cancel" else 0
        result["devices"] = GLib.Variant("u", 0 if mode == "no-keyboard" else 1)
    invocation.return_value(GLib.Variant("(o)", (handle,)))

    def respond():
        bus.emit_signal(sender, handle, "org.freedesktop.portal.Request", "Response", GLib.Variant("(ua{sv})", (code, result)))
        return False
    GLib.idle_add(respond)


for interface in info.interfaces[:2]:
    registrations.append(bus.register_object(PATH, interface, method, None, None))


def owned(*_args):
    print("READY", flush=True)


Gio.bus_own_name_on_connection(bus, "org.freedesktop.portal.Desktop", Gio.BusNameOwnerFlags.DO_NOT_QUEUE, owned, lambda *_: exit(1))
GLib.MainLoop().run()
