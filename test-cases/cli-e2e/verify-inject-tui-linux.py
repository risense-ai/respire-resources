#!/usr/bin/env python3
"""Qualify a reviewed Linux CLI digest on a disposable host with user namespaces."""

import argparse
from contextlib import contextmanager
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time

ORIGINAL = b"# Synthetic Claude fixture\n\nPreserve this text.\n"
# Source-derived Claude bytes at risense-ai/respire a3b9b4a5738be2f071d59d06ac975ff1672677bf.
INJECTED_SHA256 = "43fcdf0ac1706a4ecdc6e92c29eb03ff707c21dd122aec3866a7fcde77a90c19"
CONTROL = b"Unselected fixture must not change.\n"
LIMIT = 1024 * 1024
WAIT = 12


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def remaining(deadline):
    seconds = deadline - time.monotonic()
    require(seconds > 0, "fixture timeout")
    return seconds


@contextmanager
def owned(argv, **options):
    # No poll(), wait() or communicate() until killpg: the unreaped session
    # leader reserves its numeric PID/PGID even if it has already exited.
    child = subprocess.Popen(argv, **options)
    try:
        yield child
    finally:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        finally:
            child.wait(timeout=3)
            for stream in (child.stdout, child.stderr):
                if stream is not None:
                    stream.close()


def check_exit(child, deadline):
    fd = os.pidfd_open(child.pid)
    try:
        require(select.select([fd], [], [], remaining(deadline))[0], "exit timeout")
        status = os.waitid(os.P_PIDFD, fd, os.WEXITED | os.WNOWAIT)
        require(status.si_code == os.CLD_EXITED and status.si_status == 0, "nonzero exit")
    finally:
        os.close(fd)


def capture(argv, cwd, env):
    deadline = time.monotonic() + WAIT
    with owned(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
               stderr=subprocess.PIPE, start_new_session=True) as child:
        streams = [child.stdout, child.stderr]
        stdout = bytearray()
        total = 0
        while streams:
            ready = select.select(streams, [], [], remaining(deadline))[0]
            require(ready, "CLI output timeout")
            for stream in ready:
                chunk = os.read(stream.fileno(), min(32768, LIMIT + 1 - total))
                if not chunk:
                    streams.remove(stream)
                    continue
                total += len(chunk)
                require(total <= LIMIT, "combined CLI output exceeded limit")
                if stream is child.stdout:
                    stdout.extend(chunk)
        check_exit(child, deadline)
        return stdout


def invoke(argv, project, env, *extra):
    value = json.loads(capture([*argv, "--json", "inject", "--id", "claude", *extra], project, env))
    require(value["command"] == "inject" and value["status"] == "ok" and not value["errors"],
            "unexpected CLI response")
    return value["summary"]["changed"]


def fixture(root):
    home, project, tmp, data = (root / name for name in
                                ("home", "checkout with spaces", "tmp", "runtime-data"))
    claude = home / ".claude" / "CLAUDE.md"
    for path in (claude.parent, project, tmp, data):
        path.mkdir(mode=0o700, parents=True)
    claude.write_bytes(ORIGINAL)
    controls = [home / "AGENTS.md", project / "AGENTS.md"]
    for path in controls:
        path.write_bytes(CONTROL)

    def check():
        require(all(path.read_bytes() == CONTROL for path in controls), "unselected target changed")
        files = {p for p in root.rglob("*") if p.is_symlink() or not p.is_dir()}
        require(files == {claude, *controls}, "unexpected fixture file")
        require(not any(p.is_symlink() for p in files), "unexpected fixture symlink")

    env = {"HOME": str(home), "USERPROFILE": str(home), "PATH": "/usr/bin:/bin",
           "XDG_CONFIG_HOME": str(home / ".config"), "XDG_CACHE_HOME": str(home / ".cache"),
           "XDG_DATA_HOME": str(home / ".local/share"), "XDG_RUNTIME_DIR": str(tmp),
           "TMPDIR": str(tmp), "TMP": str(tmp), "TEMP": str(tmp),
           "TERM": "xterm-256color", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
           "RSRS_DATA_DIR": str(data), "RSRS_BIN_DIR": str(root / "bin"),
           "RSRS_NO_AUTOSYNC": "1", "RSRS_NO_AUTOSTART": "1"}
    return project, env, claude, check


def controlling_tty():
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)


def interactive(argv, project, env, claude, check, injected, removed):
    master, slave = pty.openpty()
    transcript = bytearray()

    def stage(marker, keys=b""):
        start = len(transcript)
        if keys:
            require(os.write(master, keys) == len(keys), "partial PTY write")
        deadline = time.monotonic() + WAIT
        while transcript.find(marker, start) < 0:
            require(select.select([master], [], [], remaining(deadline))[0], "missing " + repr(marker))
            try:
                chunk = os.read(master, min(32768, LIMIT + 1 - len(transcript)))
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                chunk = b""
            require(chunk, "terminal closed before " + repr(marker))
            require(len(transcript) + len(chunk) <= LIMIT, "terminal output exceeded limit")
            transcript.extend(chunk)

    def expect(content):
        require(claude.read_bytes() == content, "unexpected Claude configuration bytes")
        check()

    try:
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 48, 180, 0, 0))
        with owned([*argv, "inject", "--tui"], stdin=slave, stdout=slave, stderr=slave,
                   cwd=project, env=env, preexec_fn=controlling_tty) as child:
            os.close(slave)
            slave = None
            stage(b"claude code")
            require(b"\x1b[?1049h" in transcript, "missing alternate screen")
            stage(b"WRITE injected claude", b"\x1b[F i")
            expect(injected)
            stage(b"will uninstall 1 checked", b"u")
            expect(injected)
            stage(b"host status refreshed", b"r")
            expect(injected)
            stage(b"will uninstall 1 checked", b"u")
            stage(b"PURGE uninstalled claude", b"y")
            expect(removed)
            stage(b"\x1b[?1049l", b"q")
            check_exit(child, time.monotonic() + 3)
    finally:
        if slave is not None:
            os.close(slave)
        os.close(master)
    expect(removed)


def qualify():
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cli", required=True, type=Path)
    parser.add_argument("--sha256", required=True)
    args = parser.parse_args()
    require(re.fullmatch("[a-f0-9]{64}", args.sha256), "invalid CLI digest")
    require(args.cli.is_absolute() and args.cli.resolve(strict=True) == args.cli
            and args.cli.is_file() and os.access(args.cli, os.X_OK), "expected exact executable")
    with tempfile.TemporaryDirectory(prefix="card018-") as directory:
        root = Path(directory)
        # Copy into private storage so the executable used at every stage is the one hashed.
        binary = root / "rsrs"
        shutil.copyfile(args.cli, binary)
        with binary.open("rb") as stream:
            require(stream.read(4) == b"\x7fELF", "expected a compiled Linux CLI")
            stream.seek(0)
            require(hashlib.file_digest(stream, "sha256").hexdigest() == args.sha256, "digest mismatch")
        binary.chmod(0o500)
        argv = [str(binary)]
        project, env, claude, check = fixture(root / "cli")
        require(invoke(argv, project, env) is True, "expected first write")
        injected = claude.read_bytes()
        require(hashlib.sha256(injected).hexdigest() == INJECTED_SHA256,
                "injected bytes differ from the pinned Claude fixture")
        check()
        require(invoke(argv, project, env) is False and claude.read_bytes() == injected,
                "repeat injection changed bytes")
        check()
        require(invoke(argv, project, env, "--remove") is True, "expected CLI removal")
        removed = claude.read_bytes()
        require(removed == ORIGINAL + b"\n\n", "CLI removal changed unrelated text")
        check()
        interactive(argv, *fixture(root / "tui"), injected, removed)
        print(json.dumps({"cli_sha256": args.sha256, "injected_sha256": hashlib.sha256(injected).hexdigest(),
                          "removed_sha256": hashlib.sha256(removed).hexdigest(),
                          "remove_byte_exact": removed == ORIGINAL}))


if __name__ == "__main__":
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    script = Path(__file__).resolve()
    wrapper = script.parents[1] / "client2-e2e/compiled-webui/loopback-only-exec.py"
    # No flag or environment variable skips setup. The wrapper brings up lo
    # and verifies literal 127.0.0.1 before invoking the qualification function.
    runner = "import runpy,sys; sys.argv=sys.argv[1:]; runpy.run_path(sys.argv[0])['qualify']()"
    os.execve("/usr/bin/unshare", ["unshare", "-Urnpf", "--kill-child=KILL", sys.executable,
              "-I", str(wrapper), sys.executable, "-I", "-c", runner, str(script), *sys.argv[1:]],
              {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"})
