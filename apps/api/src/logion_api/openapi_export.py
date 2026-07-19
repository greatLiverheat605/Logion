import json
import sys
from pathlib import Path

from logion_api.main import app


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m logion_api.openapi_export OUTPUT_PATH")

    output_path = Path(sys.argv[1])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
