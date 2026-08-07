import subprocess
import sys
from pathlib import Path
from textwrap import dedent
from uuid import uuid4

from logion_worker.local_worker_security import LocalWorkerSecurity


def test_crashed_worker_checkpoint_is_rejected_and_removed_after_restart(tmp_path: Path) -> None:
    root = tmp_path / "worker-root"
    job_id, workspace_id, space_id = (uuid4() for _ in range(3))
    script = dedent(
        """
        import os
        import sys
        from hashlib import sha256
        from uuid import UUID
        from logion_worker.local_worker_security import LocalWorkerSecurity

        root, job_id, workspace_id, space_id = sys.argv[1:]
        security = LocalWorkerSecurity(root, lease_seconds=30)
        claims, token = security.issue_lease(
            job_id=UUID(job_id),
            workspace_id=UUID(workspace_id),
            space_id=UUID(space_id),
            input_sha256=sha256(b'crash-input').hexdigest(),
        )
        security.write_checkpoint(claims, token=token, stage='running')
        os._exit(17)
        """
    )
    result = subprocess.run(  # noqa: S603 - fixed test-only interpreter and script
        [sys.executable, "-c", script, str(root), str(job_id), str(workspace_id), str(space_id)],
        check=False,
    )
    assert result.returncode == 17
    assert (root / str(job_id) / "checkpoint.json").exists()

    restarted = LocalWorkerSecurity(root)
    assert restarted.recover_after_restart() == 1
    assert not (root / str(job_id)).exists()


def test_interrupted_upload_part_is_cleaned_after_restart(tmp_path: Path) -> None:
    root = tmp_path / "worker-root"
    job_id = uuid4()
    script = dedent(
        """
        import os
        import sys
        from pathlib import Path

        root, job_id = sys.argv[1:]
        job_dir = Path(root) / job_id
        job_dir.mkdir(parents=True)
        (job_dir / 'checkpoint.json.part').write_bytes(b'interrupted-upload')
        os._exit(19)
        """
    )
    result = subprocess.run(  # noqa: S603 - fixed test-only interpreter and script
        [sys.executable, "-c", script, str(root), str(job_id)], check=False
    )
    assert result.returncode == 19
    assert (root / str(job_id) / "checkpoint.json.part").exists()

    restarted = LocalWorkerSecurity(root)
    assert restarted.recover_after_restart() == 1
    assert not (root / str(job_id)).exists()
