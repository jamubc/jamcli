#!/usr/bin/env python3
"""Keystroke echo latency and frame size of the interface, in a pseudo-terminal.

Usage: python3 scripts/bench/pty-latency.py [--messages N] [--keys N] [--json FILE]

It writes a session of N messages (1,000 by default) into a scratch project, opens the
interface on it at 120 by 40, resumes the session, and types keys one at a time. For each
key it records the time until the first output byte (echo latency) and the bytes written
until the screen is quiet again (frame size). Run `bun run build` first; the built command
is what is measured.
"""
import argparse, fcntl, json, os, pty, select, shutil, statistics, struct, subprocess, sys, tempfile, termios, time

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
QUIET = 0.25


def read_until_quiet(fd, quiet=QUIET, limit=30.0):
    """Bytes read until nothing arrives for `quiet` seconds, and when the first came."""
    data, first, start = b'', None, time.monotonic()
    while time.monotonic() - start < limit:
        ready, _, _ = select.select([fd], [], [], quiet)
        if not ready:
            if data or time.monotonic() - start > quiet * 4:
                break
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        if first is None:
            first = time.monotonic()
        data += chunk
    return data, first


def read_until(fd, marker, limit=30.0):
    """Bytes read until `marker` arrives, when the first byte came, and when the marker did."""
    data, first, start = b'', None, time.monotonic()
    while marker not in data and time.monotonic() - start < limit:
        ready, _, _ = select.select([fd], [], [], 0.05)
        if not ready:
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        if first is None:
            first = time.monotonic()
        data += chunk
    return data, first, (time.monotonic() if marker in data else None)


def resident_mb(pid):
    """Resident memory of a process and its children, in megabytes, where /proc says."""
    total = 0
    pids = [pid]
    try:
        pids += [int(child) for child in open(f'/proc/{pid}/task/{pid}/children').read().split()]
    except OSError:
        pass
    for each in pids:
        try:
            for line in open(f'/proc/{each}/status'):
                if line.startswith('VmRSS:'):
                    total += int(line.split()[1])
        except OSError:
            pass
    return round(total / 1024, 1) if total else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--messages', type=int, default=1000)
    parser.add_argument('--keys', type=int, default=30)
    parser.add_argument('--json')
    parser.add_argument('--full-view', action='store_true', help='press Ctrl+R after resuming, to render the whole history (the Ink interface)')
    parser.add_argument('--ready', default='ready', help='the text that shows the first frame is drawn')
    parser.add_argument('--command', default=os.path.join(REPO, 'dist', 'index.js'))
    args = parser.parse_args()

    base = tempfile.mkdtemp(prefix='jamcli-pty-')
    project = os.path.join(base, 'project')
    os.makedirs(project)
    # A model is named so that a first run's setup does not open over the session.
    env = dict(os.environ, TERM='xterm-256color', COLUMNS='120', LINES='40', JAMCLI_MODEL='ollama:bench',
               JAMCLI_CONFIG_DIR=os.path.join(base, 'user'), JAMCLI_STATE_DIR=os.path.join(base, 'state'),
               JAMCLI_CACHE_DIR=os.path.join(base, 'cache'))
    try:
        session = subprocess.check_output(['bun', os.path.join(REPO, 'scripts', 'bench', 'make-session.ts'), project, str(args.messages)],
                                          env=env, text=True).strip()
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(project)
            os.execvpe('/bin/sh', ['/bin/sh', '-c', args.command], env)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
        started = time.monotonic()
        # The first frame is whole once the status line says the session is ready.
        boot, first, drawn = read_until(fd, args.ready.encode())
        rest, _ = read_until_quiet(fd, quiet=1.0)
        boot += rest
        boot_ms = ((first or time.monotonic()) - started) * 1000
        frame_ms = (drawn - started) * 1000 if drawn else None

        # /resume opens the session picker; the benchmark session is the only one.
        os.write(fd, b'/resume')
        read_until_quiet(fd)
        os.write(fd, b'\r')
        read_until_quiet(fd, quiet=1.0)
        resume_at = time.monotonic()
        os.write(fd, b'\r')
        loaded, _ = read_until_quiet(fd, quiet=1.0)
        resume_ms = (time.monotonic() - resume_at) * 1000
        if args.full_view:
            os.write(fd, b'\x12')
            read_until_quiet(fd, quiet=1.0)
        if os.environ.get('BENCH_DUMP'):
            with open(os.environ['BENCH_DUMP'], 'wb') as handle:
                handle.write(boot + b'\n=====RESUME=====\n' + loaded)

        idle_mb = resident_mb(pid)
        latencies, frames = [], []
        for index in range(args.keys):
            sent = time.monotonic()
            os.write(fd, b'abcdefghij'[index % 10:index % 10 + 1])
            frame, first = read_until_quiet(fd)
            if first is not None:
                latencies.append((first - sent) * 1000)
            frames.append(len(frame))
        os.write(fd, b'\x03')
        time.sleep(0.2)
        os.write(fd, b'\x03')
        try:
            os.kill(pid, 9)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)

        p95 = sorted(latencies)[max(0, int(len(latencies) * 0.95) - 1)] if latencies else None
        result = {
            'command': args.command,
            'messages': args.messages,
            'full_view': args.full_view,
            'keys': args.keys,
            'echoed_keys': len(latencies),
            'first_output_ms': round(boot_ms, 1),
            'first_frame_ms': round(frame_ms, 1) if frame_ms is not None else None,
            'idle_resident_mb': idle_mb,
            'resume_ms': round(resume_ms, 1),
            'resume_bytes': len(loaded),
            'latency_median_ms': round(statistics.median(latencies), 1) if latencies else None,
            'latency_p95_ms': round(p95, 1) if p95 is not None else None,
            'frame_median_bytes': int(statistics.median(frames)) if frames else None,
            'frame_max_bytes': max(frames) if frames else None,
        }
        print(json.dumps(result, indent=2))
        if args.json:
            with open(args.json, 'w') as handle:
                json.dump(result, handle, indent=2)
    finally:
        shutil.rmtree(base, ignore_errors=True)


if __name__ == '__main__':
    main()
