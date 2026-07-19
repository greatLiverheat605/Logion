import json

from logion_worker import __version__


def health_payload() -> dict[str, str]:
    return {"status": "ok", "service": "worker", "version": __version__}


def main() -> None:
    print(json.dumps(health_payload(), separators=(",", ":")))


if __name__ == "__main__":
    main()
