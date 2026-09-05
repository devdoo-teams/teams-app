"""MP-307: exercise recovery decisions and real filesystem effects, never root."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest


def observed_failure():
    error = "('write_files', OSError('Unknown user or group: \"getgrnam(): name not found: \\'teamsworker\\'\"'))"
    warning = "Running module write_files (<module 'cloudinit.config.cc_write_files' from '/usr/lib/python3/dist-packages/cloudinit/config/cc_write_files.py'>) failed"
    data = dict(status='error', extended_status='error - done', stage=None,
                datasource='azure', boot_status_code='enabled-by-generator',
                errors=[error], recoverable_errors={'WARNING': [warning]})
    for name in ('init-local', 'init', 'modules-config', 'modules-final'):
        data[name] = dict(start=1, finished=2, errors=[], recoverable_errors={})
    data['init'].update(errors=[error], recoverable_errors={'WARNING': [warning]})
    return data


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        source = Path(__file__).resolve().parents[1] / 'infra/azure/scripts/recover-worker-prerequisites.py'
        if not source.exists():
            self.fail('MP-307 existing-VM prerequisite recovery is not implemented')
        spec = importlib.util.spec_from_file_location('worker_recovery', source)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.owners = {'root': os.getuid(), 'teamsworker': os.getuid()}
        self.groups = {'root': os.getgid(), 'teamsworker': os.getgid()}
        self.files = [
            dict(path='/etc/teamsapp/worker.env.example', owner='root:teamsworker', permissions='0640', content='# nonsecret example\n'),
            dict(path='/etc/systemd/system/teamsapp-worker.service', owner='root:root', permissions='0644', content='[Unit]\nDescription=worker fixture\n'),
        ]

    def test_known_terminal_user_order_failure_is_recoverable(self):
        self.module.validate_failure(observed_failure(), 1)

    def test_other_failures_and_pending_stages_are_rejected(self):
        for field, value in [('errors', ['network failure']), ('status', 'running'),
                             ('stage', 'init'), ('datasource', 'nocloud'),
                             ('recoverable_errors', {'WARNING': ['another failure']})]:
            with self.subTest(field=field):
                data = observed_failure()
                data[field] = value
                with self.assertRaises(ValueError):
                    self.module.validate_failure(data, 1)
        data = observed_failure()
        data['modules-final']['errors'] = ['package failure']
        with self.assertRaises(ValueError):
            self.module.validate_failure(data, 1)
        for code in (0, 2, 124):
            with self.assertRaises(ValueError):
                self.module.validate_failure(observed_failure(), code)

    def test_missing_files_are_created_and_repeat_preserves_inode(self):
        self.module.reconcile(self.root, self.files, self.owners, self.groups)
        inodes = []
        for entry in self.files:
            path = self.root / entry['path'].lstrip('/')
            self.assertEqual(path.read_text(), entry['content'])
            self.assertEqual(path.stat().st_mode & 0o777, int(entry['permissions'], 8))
            inodes.append(path.stat().st_ino)
        self.module.reconcile(self.root, self.files, self.owners, self.groups)
        self.assertEqual(inodes, [(self.root / e['path'].lstrip('/')).stat().st_ino for e in self.files])

    def test_existing_conflict_blocks_before_creating_any_files(self):
        target = self.root / 'etc/systemd/system/teamsapp-worker.service'
        target.parent.mkdir(parents=True)
        target.write_text('preserve this user content')
        with self.assertRaises(ValueError):
            self.module.reconcile(self.root, self.files, self.owners, self.groups)
        self.assertEqual(target.read_text(), 'preserve this user content')
        self.assertFalse((self.root / 'etc/teamsapp/worker.env.example').exists())

    def test_symlink_and_hardlink_targets_are_never_followed(self):
        target = self.root / 'etc/teamsapp/worker.env.example'
        target.parent.mkdir(parents=True)
        outside = self.root / 'untouched'
        outside.write_text(self.files[0]['content'])
        target.symlink_to(outside)
        with self.assertRaises(ValueError):
            self.module.reconcile(self.root, self.files, self.owners, self.groups)
        target.unlink()
        os.link(outside, target)
        with self.assertRaises(ValueError):
            self.module.reconcile(self.root, self.files, self.owners, self.groups)

    def test_out_of_scope_path_is_rejected(self):
        self.files[0]['path'] = '/etc/shadow'
        with self.assertRaises(ValueError):
            self.module.reconcile(self.root, self.files, self.owners, self.groups)


if __name__ == '__main__':
    unittest.main()
