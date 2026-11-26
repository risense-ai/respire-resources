"""Run inside a fresh Linux network namespace: unshare -Urn python3 this-file cmd."""

import fcntl
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import sys

if len(sys.argv) < 2:
    raise SystemExit("A pre-provisioned local command is required")


def interfaces():
    return [line.split(":", 1)[0].strip()
            for line in Path("/proc/net/dev").read_text().splitlines()[2:]]


if interfaces() != ["lo"] or len(Path("/proc/net/route").read_text().splitlines()) > 1:
    raise SystemExit("Refusing to run outside a fresh loopback-only namespace")

with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as device:
    template = "16sH22x"
    request = struct.pack(template, b"lo", 0)
    flags = struct.unpack(template, fcntl.ioctl(device.fileno(), 0x8913, request))[1]
    if flags & 1:
        raise SystemExit("Expected an inactive loopback in a fresh namespace")
    fcntl.ioctl(device.fileno(), 0x8914, struct.pack(template, b"lo", flags | 1))

with socket.socket() as check:
    check.bind(("127.0.0.1", 0))

if interfaces() != ["lo"] or len(Path("/proc/net/route").read_text().splitlines()) > 1:
    raise SystemExit("Loopback-only containment was not established")

allowed = {"PATH", "NODE_PATH", "LANG", "TZ", "RESPIRE_E2E_WEBUI_BUNDLE",
           "RESPIRE_E2E_WEBUI_MANIFEST_SHA", "RESPIRE_E2E_PRODUCT_SHA",
           "RESPIRE_E2E_WAILS_RUNTIME", "RESPIRE_E2E_BROWSER",
           "RESPIRE_E2E_BROWSER_EXECUTABLE", "PLAYWRIGHT_BROWSERS_PATH"}
environment = {key: value for key, value in os.environ.items() if key in allowed}
environment["NO_PROXY"] = "127.0.0.1,localhost"
with tempfile.TemporaryDirectory(prefix="card018-offline-home-", dir="/tmp") as home:
    environment.update(HOME=home, TMPDIR=home)
    raise SystemExit(subprocess.run(sys.argv[1:], env=environment).returncode)
