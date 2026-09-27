import hashlib
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType

from logion_api.errors import APIError

TASK_SKILLS = MappingProxyType(
    {
        "translate": "explain-translate",
        "explain": "explain-translate",
        "close_reading": "close-reading",
        "quiz_generate": "comprehension-quiz",
        "quiz_grade": "comprehension-quiz",
        "link_suggest": "literature-links",
        "weekly_comment": "weekly-review",
    }
)


@lru_cache(maxsize=7)
def load_research_skill(task_type: str) -> str:
    name = TASK_SKILLS.get(task_type)
    if name is None:
        raise APIError(
            code="AI_TASK_UNSUPPORTED", message="Unsupported research task.", status_code=422
        )
    path = Path(__file__).resolve().parents[5] / "packages" / "skills" / name / "SKILL.md"
    try:
        prompt = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise APIError(
            code="AI_SKILL_UNAVAILABLE",
            message="The research prompt is unavailable.",
            status_code=503,
        ) from exc
    if not prompt.strip() or len(prompt.encode()) > 32768:
        raise APIError(
            code="AI_SKILL_UNAVAILABLE", message="The research prompt is invalid.", status_code=503
        )
    return f"Research task: {task_type}\n\n{prompt}"


def skill_hash(prompt: str) -> str:
    return hashlib.sha256(prompt.encode()).hexdigest()
