"""Compare configured models on three synthetic passages; never persist credentials."""

import asyncio
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from urllib.parse import urlsplit

from logion_api.ai_gateway.generation_adapter import OpenAICompatibleGenerationAdapter
from logion_api.ai_gateway.research_skills import load_research_skill
from logion_api.errors import APIError

SAMPLES = (
    "Synthetic paper A: A controlled toy experiment compares two indexing methods on "
    "100 generated records. Method A uses less memory, but both return identical results. "
    "No external validity is claimed.",
    "Synthetic paper B: A simulated reading study assigns 20 fictional participants to two "
    "schedules. Delayed recall differs by two points; the confidence interval includes zero. "
    "The result is inconclusive.",
    "Synthetic paper C: A hypothetical graph links public source excerpts to claims. "
    "Each edge records a source and a reviewer decision. The design describes provenance, "
    "not a measured causal effect.",
)
PROVIDERS = ("DEEPSEEK", "GLM")


async def not_cancelled() -> bool:
    return False


async def compare() -> int:
    required = [
        f"LOGION_COMPARE_{provider}_{field}"
        for provider in PROVIDERS
        for field in ("KEY", "BASE_URL", "MODEL")
    ]
    missing = [name for name in required if not os.environ.get(name, "").strip()]
    if missing:
        print("未运行模型对比：请在当前进程的环境变量中提供临时 Key、BASE_URL 和 MODEL。")
        print("缺少：" + ", ".join(missing))
        return 2
    for provider in PROVIDERS:
        parsed = urlsplit(os.environ[f"LOGION_COMPARE_{provider}_BASE_URL"])
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            print("未运行模型对比：BASE_URL 必须是无凭据、查询参数或片段的 HTTPS 地址。")
            return 2
    adapter = OpenAICompatibleGenerationAdapter()
    results = []
    for provider in PROVIDERS:
        credential = os.environ[f"LOGION_COMPARE_{provider}_KEY"]
        try:
            for index, passage in enumerate(SAMPLES):
                started = perf_counter()
                row: dict[str, object] = {"provider": provider, "sample": index + 1}
                try:
                    result = await adapter.generate(
                        base_url=os.environ[f"LOGION_COMPARE_{provider}_BASE_URL"],
                        credential=credential,
                        provider_model_id=os.environ[f"LOGION_COMPARE_{provider}_MODEL"],
                        input_fields={"source": passage},
                        expected_output_fields=["summary", "limitations"],
                        max_output_tokens=500,
                        timeout_seconds=30,
                        cancelled=not_cancelled,
                        system_prompt=load_research_skill("close_reading"),
                    )
                    row.update(
                        output=result.output,
                        input_tokens=result.input_tokens,
                        output_tokens=result.output_tokens,
                    )
                except APIError as exc:
                    row["error_code"] = exc.code
                row["elapsed_seconds"] = round(perf_counter() - started, 3)
                results.append(row)
        finally:
            credential = ""
    await asyncio.to_thread(write_results, results)
    return 1 if any("error_code" in row for row in results) else 0


def write_results(results: list[dict[str, object]]) -> None:
    destination = Path(__file__).resolve().parents[1] / ".local" / "ai-comparison"
    destination.mkdir(parents=True, exist_ok=True)
    name = datetime.now(UTC).strftime("comparison-%Y%m%dT%H%M%S%fZ.json")
    (destination / name).write_text(
        json.dumps({"input_kind": "synthetic", "results": results}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    print(f"对比完成：.local/ai-comparison/{name}；请人工评估证据准确性与局限说明。")


if __name__ == "__main__":
    sys.exit(asyncio.run(compare()))
