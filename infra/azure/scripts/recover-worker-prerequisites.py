"""Repair only MP-307's verified missing worker files, preserving cloud-init history.

Invoked as root by the trusted ARM extension, not from the downloaded archive.
Contract: https://docs.cloud-init.io/en/26.1/reference/cli.html
Never clean/re-run cloud-init stages, reset principals, or touch auth material.
"""
import base64
import grp
import json
import math
import os
from pathlib import Path
import pwd
import stat
import subprocess
import sys


def validate_failure(data, code):
    error = "('write_files', OSError('Unknown user or group: \"getgrnam(): name not found: \\'teamsworker\\'\"'))"
    warnings = {'WARNING': ["Running module write_files (<module 'cloudinit.config.cc_write_files' from '/usr/lib/python3/dist-packages/cloudinit/config/cc_write_files.py'>) failed"]}
    if (code != 1 or data.get('status') != 'error' or
            data.get('extended_status') != 'error - done' or data.get('stage') is not None or
            data.get('datasource') != 'azure' or data.get('boot_status_code') != 'enabled-by-generator' or
            data.get('errors') != [error] or data.get('recoverable_errors') != warnings):
        raise ValueError('cloud-init failure is not the known completed MP-307 failure')
    for name in ('init-local', 'init', 'modules-config', 'modules-final'):
        stage = data.get(name, {})
        start, end = stage.get('start'), stage.get('finished')
        if (type(start) not in (int, float) or type(end) not in (int, float) or
                not math.isfinite(start) or not math.isfinite(end) or not 0 < start <= end or
                stage.get('errors') != ([error] if name == 'init' else []) or
                stage.get('recoverable_errors') != (warnings if name == 'init' else {})):
            raise ValueError('cloud-init stage is incomplete or has another failure')


def safe_directory(path, owner):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != owner or info.st_mode & 0o022:
        raise ValueError('worker prerequisite parent directory is unsafe')


def reconcile(root, entries, owners, groups):
    allowed = {
        '/etc/teamsapp/worker.env.example': ('root:teamsworker', '0640'),
        '/etc/systemd/system/teamsapp-worker.service': ('root:root', '0644'),
    }
    if len(entries) != 2 or {e.get('path') for e in entries} != set(allowed):
        raise ValueError('worker recovery file set is not allowlisted')
    safe_directory(root, owners['root'])
    planned = []
    # Preflight the entire set before making changes. Existing data is never replaced.
    for entry in entries:
        name = entry['path']
        if (entry.get('owner'), entry.get('permissions')) != allowed[name]:
            raise ValueError('worker recovery ownership or mode is invalid')
        content = entry.get('content')
        if not isinstance(content, str) or not content or len(content.encode()) > 65536:
            raise ValueError('worker recovery content is invalid')
        uid_name, gid_name = entry['owner'].split(':')
        uid, gid = owners[uid_name], groups[gid_name]
        path = root / name.lstrip('/')
        parent = root
        for component in Path(name).parts[1:-1]:
            parent = parent / component
            if os.path.lexists(parent):
                safe_directory(parent, owners['root'])
        mode = int(entry['permissions'], 8)
        if os.path.lexists(path):
            info = path.lstat()
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or
                    (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (uid, gid, mode) or
                    path.read_bytes() != content.encode()):
                raise ValueError('existing worker prerequisite conflicts with trusted configuration')
        planned.append((path, content.encode(), uid, gid, mode))
    created = []
    for path, content, uid, gid, mode in planned:
        parent = root
        for component in path.relative_to(root).parts[:-1]:
            parent = parent / component
            if not os.path.lexists(parent):
                parent.mkdir(mode=0o755)
            safe_directory(parent, owners['root'])
        if os.path.lexists(path):
            continue
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(content)
                stream.flush()
                os.fchmod(stream.fileno(), mode)
                os.fchown(stream.fileno(), uid, gid)
                os.fsync(stream.fileno())
        except BaseException:
            # Keep partial evidence; a retry refuses the conflicting file.
            raise
        created.append(str(path))
    return created


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise ValueError('worker recovery requires root and trusted cloud-config')
    import yaml  # The Azure Ubuntu cloud-init package supplies PyYAML.
    config = yaml.safe_load(base64.b64decode(sys.argv[1], validate=True))
    result = subprocess.run(['cloud-init', 'status', '--format', 'json'],
                            capture_output=True, text=True, timeout=20, check=False)
    validate_failure(json.loads(result.stdout), result.returncode)
    worker = pwd.getpwnam('teamsworker')
    group = grp.getgrnam('teamsworker')
    if worker.pw_uid == 0 or group.gr_gid == 0 or worker.pw_gid != group.gr_gid:
        raise ValueError('worker principal is missing or unsafe')
    auth = Path('/var/lib/teamsapp/codex-home')
    for parent in (Path('/var'), Path('/var/lib'), Path('/var/lib/teamsapp')):
        safe_directory(parent, 0)
    info = auth.lstat()
    if (not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700 or
            (info.st_uid, info.st_gid) != (worker.pw_uid, group.gr_gid)):
        raise ValueError('existing worker auth directory is unsafe')
    created = reconcile(Path('/'), config['write_files'],
                        {'root': 0, 'teamsworker': worker.pw_uid},
                        {'root': 0, 'teamsworker': group.gr_gid})
    subprocess.run(['systemctl', 'daemon-reload'], timeout=20, check=True, capture_output=True)
    print(json.dumps({'schema': 1, 'state': 'worker-prerequisites-reconciled',
                      'historicalCloudInitErrorPreserved': True, 'created': created}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Do not expose raw config, subprocess output, or user-controlled errors.
        print('WORKER_PREREQUISITES_BLOCKED', file=sys.stderr)
        sys.exit(1)
