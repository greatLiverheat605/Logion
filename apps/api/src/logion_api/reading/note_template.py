"""The close-reading Markdown template and its bounded draft fields."""

import re

SECTIONS = {
    "motivation": "动机",
    "modeling": "建模",
    "experiments": "实验",
    "conclusions": "结论",
    "critique": "批判",
    "takeaway": "一句话要点",
    "open_questions": "待解决问题",
}
TEMPLATE = "\n\n".join(f"## {label}\n" for label in SECTIONS.values()) + "\n"


def section_ranges(markdown: str) -> dict[str, tuple[int, int]]:
    headings = list(re.finditer(r"^##[ \t]+([^\n]+)\n?", markdown, re.MULTILINE))
    result = {}
    for key, label in SECTIONS.items():
        matches = [
            (i, heading) for i, heading in enumerate(headings) if heading[1].strip() == label
        ]
        if len(matches) == 1:
            i, heading = matches[0]
            result[key] = (
                heading.end(),
                headings[i + 1].start() if i + 1 < len(headings) else len(markdown),
            )
    return result


def missing_sections(markdown: str) -> list[str]:
    ranges = section_ranges(markdown)
    return [
        key for key in SECTIONS if key not in ranges or not markdown[slice(*ranges[key])].strip()
    ]


def fill_sections(markdown: str, output: dict[str, str]) -> str:
    ranges = section_ranges(markdown)
    for key, (start, end) in sorted(ranges.items(), key=lambda entry: entry[1][0], reverse=True):
        if key in output:
            markdown = markdown[:start] + output[key].strip() + "\n\n" + markdown[end:]
    for key in SECTIONS:
        if key in output and key not in ranges:
            markdown = markdown.rstrip() + f"\n\n## {SECTIONS[key]}\n{output[key].strip()}\n"
    return markdown
