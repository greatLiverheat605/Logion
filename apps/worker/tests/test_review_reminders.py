from datetime import datetime

import pytest
from logion_api.engagement.models import NotificationPreference
from logion_worker.review_reminders import in_quiet_time


@pytest.mark.parametrize(
    ("timezone", "start", "end", "instant", "quiet"),
    [
        ("Asia/Shanghai", 1320, 420, "2026-09-18T14:00:00+00:00", True),
        ("Asia/Shanghai", 1320, 420, "2026-09-18T22:59:00+00:00", True),
        ("Asia/Shanghai", 1320, 420, "2026-09-18T23:00:00+00:00", False),
        ("UTC", 600, 660, "2026-09-18T10:00:00+00:00", True),
        ("UTC", 600, 660, "2026-09-18T11:00:00+00:00", False),
        ("UTC", 0, 0, "2026-09-18T00:00:00+00:00", False),
        ("America/New_York", 60, 180, "2026-11-01T05:30:00+00:00", True),
        ("America/New_York", 60, 180, "2026-11-01T06:30:00+00:00", True),
    ],
)
def test_quiet_time_uses_local_minutes_and_handles_midnight_and_dst(
    timezone: str, start: int, end: int, instant: str, quiet: bool
) -> None:
    preference = NotificationPreference(
        timezone=timezone, quiet_start_minute=start, quiet_end_minute=end
    )
    assert in_quiet_time(preference, datetime.fromisoformat(instant)) is quiet


def test_unset_quiet_time_does_not_delay_reminders() -> None:
    assert not in_quiet_time(None, datetime.fromisoformat("2026-09-18T00:00:00+00:00"))
