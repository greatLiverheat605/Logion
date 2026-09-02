"""Add the global official template catalog.

Revision ID: 0036_official_template_catalog
Revises: 0035_add_user_settings
"""

import json
from collections.abc import Sequence
from hashlib import sha256
from uuid import UUID

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0036_official_template_catalog"
down_revision: str | None = "0035_add_user_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DAILY_TEMPLATE_ID = UUID("01982f3e-7b00-7000-8000-000000000101")
DAILY_TEMPLATE_KEY = UUID("01982f3e-7b00-7000-8000-000000000201")
RESEARCH_TEMPLATE_ID = UUID("01982f3e-7b00-7000-8000-000000000102")
RESEARCH_TEMPLATE_KEY = UUID("01982f3e-7b00-7000-8000-000000000202")


def _daily_graph() -> dict[str, object]:
    return {
        "goal_plan": {
            "title": "每日工作台 · 7 天执行循环",
            "description": "用七天把一个重要目标从捕获推进到可复盘证据。",
            "desired_outcome": "完成一轮可验收的七天执行循环。",
            "weekly_minutes": 420,
            "target_day_offset": 6,
            "phases": [
                {
                    "title": "捕获与聚焦",
                    "description": "确定本周唯一值得推进的结果。",
                    "position": 0,
                    "estimated_minutes": 45,
                    "acceptance_criteria": ["写出一个可验证的本周结果。"],
                    "tasks": [
                        {
                            "title": "写下本周结果",
                            "description": "把想法收敛成一句可检查的结果描述。",
                            "priority": 1,
                            "estimated_minutes": 45,
                            "day_offset": 0,
                            "resources": [],
                        }
                    ],
                },
                {
                    "title": "拆解下一动作",
                    "description": "把结果拆成今天可以开始的动作。",
                    "position": 1,
                    "estimated_minutes": 60,
                    "acceptance_criteria": ["下一动作在 30 分钟内可开始。"],
                    "tasks": [
                        {
                            "title": "列出三个下一动作",
                            "description": "按影响和可执行性排序。",
                            "priority": 1,
                            "estimated_minutes": 60,
                            "day_offset": 1,
                            "resources": [],
                        }
                    ],
                },
                {
                    "title": "深度执行",
                    "description": "保护连续时间，完成最重要的工作块。",
                    "position": 2,
                    "estimated_minutes": 180,
                    "acceptance_criteria": ["交付一个可检查的中间产物。"],
                    "tasks": [
                        {
                            "title": "完成第一版产物",
                            "description": "在不追求完美的前提下完成可检查版本。",
                            "priority": 1,
                            "estimated_minutes": 180,
                            "day_offset": 2,
                            "resources": [],
                        }
                    ],
                },
                {
                    "title": "反馈与修正",
                    "description": "用真实反馈修正方向，而不是继续盲目堆量。",
                    "position": 3,
                    "estimated_minutes": 90,
                    "acceptance_criteria": ["记录至少一条反馈和对应改动。"],
                    "tasks": [
                        {
                            "title": "收集反馈并修正",
                            "description": "记录反馈来源、决定和改动。",
                            "priority": 2,
                            "estimated_minutes": 90,
                            "day_offset": 3,
                            "resources": [],
                        }
                    ],
                },
                {
                    "title": "验证与复盘",
                    "description": "确认结果、保留证据并决定下一轮。",
                    "position": 4,
                    "estimated_minutes": 45,
                    "acceptance_criteria": ["完成一次结果复盘并写出下一步。"],
                    "tasks": [
                        {
                            "title": "完成结果复盘",
                            "description": "对照结果标准，保留证据并安排下一步。",
                            "priority": 2,
                            "estimated_minutes": 45,
                            "day_offset": 4,
                            "resources": [],
                        },
                        {
                            "title": "整理可复用做法",
                            "description": "把有效的工作方法写成可复用记录。",
                            "priority": 3,
                            "estimated_minutes": 30,
                            "day_offset": 6,
                            "resources": [],
                        },
                    ],
                },
            ],
        }
    }


def _research_graph() -> dict[str, object]:
    return {
        "goal_plan": {
            "title": "研究项目 · 问题到证据",
            "description": "沿着问题、来源、声明和实验建立可追溯研究链路。",
            "desired_outcome": "形成一份有来源、有证据、有边界的研究结论。",
            "weekly_minutes": 360,
            "target_day_offset": 6,
            "phases": [
                {
                    "title": "定义研究问题",
                    "description": "把兴趣收敛成可检验的问题。",
                    "position": 0,
                    "estimated_minutes": 60,
                    "acceptance_criteria": ["问题包含对象、范围和可观察结果。"],
                    "tasks": [
                        {
                            "title": "写出可检验问题",
                            "description": "明确研究对象和判断标准。",
                            "priority": 1,
                            "estimated_minutes": 60,
                            "day_offset": 0,
                            "resources": [],
                        }
                    ],
                },
                {
                    "title": "检索与筛选来源",
                    "description": "收集可核对的来源并记录筛选理由。",
                    "position": 1,
                    "estimated_minutes": 90,
                    "acceptance_criteria": ["至少两条来源完成基本可信度检查。"],
                    "tasks": [
                        {
                            "title": "建立来源索引",
                            "description": "记录来源、发布日期和与问题的关系。",
                            "priority": 1,
                            "estimated_minutes": 90,
                            "day_offset": 1,
                            "resources": [],
                        }
                    ],
                },
                {
                    "title": "建立声明与证据",
                    "description": "区分支持、反证和不确定证据。",
                    "position": 2,
                    "estimated_minutes": 90,
                    "acceptance_criteria": ["每条声明都有来源和立场记录。"],
                    "tasks": [
                        {
                            "title": "整理声明证据表",
                            "description": "为关键声明标注支持、反证或不确定。",
                            "priority": 1,
                            "estimated_minutes": 90,
                            "day_offset": 2,
                            "resources": [],
                        }
                    ],
                },
                {
                    "title": "设计小型实验",
                    "description": "用低成本实验缩小不确定性。",
                    "position": 3,
                    "estimated_minutes": 75,
                    "acceptance_criteria": ["实验有输入、步骤、指标和停止条件。"],
                    "tasks": [
                        {
                            "title": "记录实验运行",
                            "description": "写下实验步骤、结果和偏差。",
                            "priority": 2,
                            "estimated_minutes": 75,
                            "day_offset": 4,
                            "resources": [],
                        }
                    ],
                },
                {
                    "title": "综合与边界",
                    "description": "形成结论，同时明确不能从证据推出的内容。",
                    "position": 4,
                    "estimated_minutes": 45,
                    "acceptance_criteria": ["结论包含证据覆盖率和下一步验证。"],
                    "tasks": [
                        {
                            "title": "写出研究结论",
                            "description": "区分已知、推断和待验证部分。",
                            "priority": 2,
                            "estimated_minutes": 45,
                            "day_offset": 6,
                            "resources": [],
                        }
                    ],
                },
            ],
        }
    }


def _official_rows() -> list[dict[str, object]]:
    common_risk = {
        "external_links": [],
        "contains_executable": False,
        "contains_members_or_tokens": False,
        "contains_provider_credentials": False,
        "source_scope": "official_catalog",
    }
    specs = [
        (
            DAILY_TEMPLATE_ID,
            DAILY_TEMPLATE_KEY,
            "每日工作台 · 7 天执行循环",
            "用七天把一个重要目标从捕获推进到可复盘证据。",
            ["self-study", "execution"],
            "每日执行模板 v1：从捕获到复盘。",
            _daily_graph(),
        ),
        (
            RESEARCH_TEMPLATE_ID,
            RESEARCH_TEMPLATE_KEY,
            "研究项目 · 问题到证据",
            "沿着问题、来源、声明和实验建立可追溯研究链路。",
            ["research", "self-study"],
            "研究项目模板 v1：从问题到证据。",
            _research_graph(),
        ),
    ]
    rows: list[dict[str, object]] = []
    for template_id, template_key, name, description, personas, changelog, graph in specs:
        manifest = {
            "schema_version": 1,
            "product_min_version": "0.1.0",
            "author": "Logion",
            "license": "CC-BY-4.0",
            "locale": "zh-CN",
            "target_personas": personas,
            "objects": graph,
            "changelog": changelog,
            "risk_metadata": common_risk,
        }
        rows.append(
            {
                "id": template_id,
                "workspace_id": None,
                "template_key": template_key,
                "version_number": 1,
                "name": name,
                "description": description,
                "schema_version": 1,
                "product_min_version": "0.1.0",
                "author_name": "Logion",
                "license": "CC-BY-4.0",
                "locale": "zh-CN",
                "target_personas": personas,
                "changelog": changelog,
                "content_hash": sha256(
                    json.dumps(
                        manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                    ).encode("utf-8")
                ).hexdigest(),
                "risk_metadata": common_risk,
                "object_graph": graph,
                "visibility": "official",
                "status": "active",
                "created_by": None,
            }
        )
    return rows


def _template_table() -> sa.sql.expression.TableClause:
    return sa.table(
        "template_packages",
        sa.column("id", sa.Uuid()),
        sa.column("workspace_id", sa.Uuid()),
        sa.column("template_key", sa.Uuid()),
        sa.column("version_number", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("description", sa.String()),
        sa.column("schema_version", sa.Integer()),
        sa.column("product_min_version", sa.String()),
        sa.column("author_name", sa.String()),
        sa.column("license", sa.String()),
        sa.column("locale", sa.String()),
        sa.column("target_personas", postgresql.JSONB()),
        sa.column("changelog", sa.String()),
        sa.column("content_hash", sa.String()),
        sa.column("risk_metadata", postgresql.JSONB()),
        sa.column("object_graph", postgresql.JSONB()),
        sa.column("visibility", sa.String()),
        sa.column("status", sa.String()),
        sa.column("created_by", sa.Uuid()),
    )


def upgrade() -> None:
    op.drop_constraint("ck_template_visibility", "template_packages", type_="check")
    op.alter_column("template_packages", "workspace_id", existing_type=sa.Uuid(), nullable=True)
    op.alter_column("template_packages", "created_by", existing_type=sa.Uuid(), nullable=True)
    op.create_check_constraint(
        "ck_template_visibility",
        "template_packages",
        "visibility IN ('private','workspace','official')",
    )
    op.create_check_constraint(
        "ck_template_scope_ownership",
        "template_packages",
        "(visibility = 'official' AND workspace_id IS NULL AND created_by IS NULL)"
        " OR (visibility IN ('private','workspace') AND workspace_id IS NOT NULL"
        " AND created_by IS NOT NULL)",
    )
    op.create_index(
        "uq_official_template_version",
        "template_packages",
        ["template_key", "version_number"],
        unique=True,
        postgresql_where=sa.text("visibility = 'official'"),
    )

    table = _template_table()
    bind = op.get_bind()
    insert = postgresql.insert(table).on_conflict_do_nothing(index_elements=[table.c.id])
    for row in _official_rows():
        bind.execute(insert.values(**row))
        stored = bind.execute(
            sa.text("SELECT content_hash, visibility FROM template_packages WHERE id = :id"),
            {"id": str(row["id"])},
        ).mappings().one()
        if stored["content_hash"] != row["content_hash"] or stored["visibility"] != "official":
            raise RuntimeError(f"official template seed mismatch: {row['id']}")


def downgrade() -> None:
    ids = [DAILY_TEMPLATE_ID, RESEARCH_TEMPLATE_ID]
    bind = op.get_bind()
    bind.execute(
        sa.text("DELETE FROM template_packages WHERE id = ANY(CAST(:ids AS uuid[]))"),
        {"ids": ids},
    )
    remaining = bind.execute(
        sa.text("SELECT count(*) FROM template_packages WHERE visibility = 'official'")
    ).scalar_one()
    if remaining:
        raise RuntimeError("cannot downgrade while non-seed official templates exist")
    op.drop_index("uq_official_template_version", table_name="template_packages")
    op.drop_constraint("ck_template_scope_ownership", "template_packages", type_="check")
    op.drop_constraint("ck_template_visibility", "template_packages", type_="check")
    op.alter_column("template_packages", "workspace_id", existing_type=sa.Uuid(), nullable=False)
    op.alter_column("template_packages", "created_by", existing_type=sa.Uuid(), nullable=False)
    op.create_check_constraint(
        "ck_template_visibility",
        "template_packages",
        "visibility IN ('private','workspace')",
    )
