"""Generated vendor recognition must not hide edited or adjacent application scripts."""

import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_context_guard_only_recognizes_byte_identical_pinned_worker(tmp_path: Path) -> None:
    (tmp_path / "packages").mkdir()
    web = tmp_path / "apps/web"
    source = web / "node_modules/pdfjs-dist"
    public = web / "public/pdfjs/1.2.3"
    (source / "build").mkdir(parents=True)
    public.mkdir(parents=True)
    (source / "package.json").write_text(
        json.dumps({"name": "pdfjs-dist", "version": "1.2.3"}), encoding="utf-8"
    )
    (web / "package.json").write_text(
        json.dumps({"dependencies": {"pdfjs-dist": "1.2.3"}}), encoding="utf-8"
    )
    # Synthetic upstream attribution deliberately exercises the non-example-domain rule.
    upstream = "/* author@upstream.invalid */"
    (source / "build/pdf.worker.min.mjs").write_text(upstream, encoding="utf-8")
    worker = public / "pdf.worker.min.mjs"
    worker.write_text(upstream, encoding="utf-8")

    def check() -> subprocess.CompletedProcess[str]:
        node = shutil.which("node")
        assert node is not None
        return subprocess.run(  # noqa: S603 - fixed repository script, synthetic fixture directory
            [node, str(ROOT / "scripts/check-dynamic-context.mjs")],
            cwd=tmp_path,
            capture_output=True,
            text=True,
            check=False,
        )

    assert check().returncode == 0
    worker.write_text(upstream + "\n/* owner@private.invalid */", encoding="utf-8")
    assert check().returncode == 1
    worker.write_text(upstream, encoding="utf-8")
    (public / "custom.mjs").write_text("/* owner@private.invalid */", encoding="utf-8")
    assert check().returncode == 1
