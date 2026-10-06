import datetime
from local_hub_lifetime import lifetime_policy, keep_running

utc = datetime.datetime(2026, 10, 6, tzinfo=datetime.timezone.utc)
unbounded = lifetime_policy(None, 100, utc)
assert unbounded['deadline'] is None
assert unbounded['expiresAtUtc'] is None
assert unbounded['timeLimitRemoved'] is True
assert keep_running(unbounded['deadline'], False, True, 100 + 60 * 60 * 24 * 365)
assert not keep_running(None, True, True, 100)
assert not keep_running(None, False, False, 100)
bounded = lifetime_policy(15, 100, utc)
assert bounded['deadline'] == 1000
assert keep_running(bounded['deadline'], False, True, 999)
assert not keep_running(bounded['deadline'], False, True, 1000)
for invalid in [-1, 0, 21, True, '15']:
    try:
        lifetime_policy(invalid)
    except ValueError:
        pass
    else:
        raise AssertionError('invalid bounded lifetime admitted')
print('PASS: explicit untimed lifecycle survives former deadline; explicit stop/process failure still stop')
