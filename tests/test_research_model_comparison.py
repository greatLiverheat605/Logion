import os
import subprocess
import sys
from pathlib import Path


def test_model_comparison_without_environment_keys_exits_before_network_or_output() -> None:
    root = Path(__file__).resolve().parents[1]
    environment = {
        key: value for key, value in os.environ.items() if not key.startswith("LOGION_COMPARE_")
    }
    output_dir = root / ".local/ai-comparison"
    before = set(output_dir.glob("*.json"))
    result = subprocess.run(  # noqa: S603
        # Fixed interpreter and repository script, with no shell or user-controlled arguments.
        [sys.executable, str(root / "scripts/compare-research-models.py")],
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 2
    assert "未运行模型对比" in result.stdout
    assert "LOGION_COMPARE_DEEPSEEK_KEY" in result.stdout
    assert "LOGION_COMPARE_GLM_KEY" in result.stdout
    assert result.stderr == ""
    assert set(output_dir.glob("*.json")) == before
