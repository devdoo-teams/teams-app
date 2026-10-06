"""Lifetime policy only. The operator supplies current authorization to start.

None means no automatic time limit; it never grants access or starts a process.
"""
import datetime
import time


def lifetime_policy(minutes, now_monotonic=None, now_utc=None):
    if minutes is None:
        return {'deadline': None, 'expiresAtUtc': None, 'maximumMinutes': None,
                'timeLimitRemoved': True}
    if not isinstance(minutes, int) or isinstance(minutes, bool) or not 1 <= minutes <= 20:
        raise ValueError('bounded window must be 1 to 20 minutes')
    monotonic = time.monotonic() if now_monotonic is None else now_monotonic
    utc = datetime.datetime.now(datetime.timezone.utc) if now_utc is None else now_utc
    return {'deadline': monotonic + minutes * 60,
            'expiresAtUtc': (utc + datetime.timedelta(minutes=minutes)).isoformat(),
            'maximumMinutes': minutes, 'timeLimitRemoved': False}


def keep_running(deadline, explicit_stop, server_alive, now_monotonic=None):
    if explicit_stop or not server_alive:
        return False
    now = time.monotonic() if now_monotonic is None else now_monotonic
    return deadline is None or now < deadline
