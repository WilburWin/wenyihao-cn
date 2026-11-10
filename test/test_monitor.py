import datetime as dt
import importlib.util
from pathlib import Path
import unittest
from zoneinfo import ZoneInfo

spec = importlib.util.spec_from_file_location('monitor', Path(__file__).resolve().parents[1]/'server'/'monitor.py')
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 11, 7, 12, tzinfo=ZoneInfo('Asia/Shanghai'))

    def test_first_boot_and_restart_counters(self):
        state, rate = monitor.account({}, 100, 'boot1', self.now, self.now-dt.timedelta(hours=1))
        self.assertEqual(state['monthlyBytes'], 100)
        self.assertEqual(rate, 0)
        state, rate = monitor.account(state, 160, 'boot1', self.now+dt.timedelta(minutes=1), self.now)
        self.assertEqual(state['monthlyBytes'], 160)
        self.assertEqual(rate, 1)
        state, _ = monitor.account(state, 10, 'boot2', self.now+dt.timedelta(minutes=2), self.now)
        self.assertEqual(state['monthlyBytes'], 170)

    def test_month_rollover_and_partial_coverage(self):
        state, _ = monitor.account({}, 1000, 'boot', self.now, self.now-dt.timedelta(days=60))
        self.assertEqual(state['monthlyBytes'], 0)
        self.assertEqual(state['coverageStartedAt'], self.now.isoformat())
        state['protected'] = True
        state, _ = monitor.account(state, 1100, 'boot', self.now.replace(month=12, day=1), self.now)
        self.assertEqual(state['monthlyBytes'], 100)
        self.assertFalse(state['protected'])

    def test_guard_scopes_only_web_responses_and_never_flushes_global_rules(self):
        rules = monitor.guard_rules('eth0', 1000000000, 123, replace=True)
        self.assertIn('over 1000000000 bytes used 123 bytes', rules)
        self.assertIn('tcp sport { 80, 443, 8788 } drop', rules)
        self.assertIn('quota name "month" jump blocked_web', rules)
        self.assertNotIn('22', rules)
        self.assertNotIn('flush ruleset', rules)
        with self.assertRaises(ValueError):
            monitor.guard_rules('eth0;malicious', 1, 0)


if __name__ == '__main__':
    unittest.main()
