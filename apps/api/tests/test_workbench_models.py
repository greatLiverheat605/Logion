from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from logion_api.workbenches.models import (
    WorkbenchDefinition,
    WorkbenchIdempotencyReceipt,
    WorkbenchLink,
)
from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Table, UniqueConstraint


def _constraint(table: Table, name: str) -> Any:
    return next(constraint for constraint in table.constraints if constraint.name == name)


def _columns(constraint: Any) -> tuple[str, ...]:
    return tuple(column.name for column in constraint.columns)


def _migration() -> ModuleType:
    path = Path(__file__).parents[1] / "migrations" / "versions" / "0039_workbench_foundation.py"
    spec = importlib.util.spec_from_file_location("workbench_foundation_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _ScalarResult:
    def __init__(self, value: bool) -> None:
        self.value = value

    def scalar(self) -> bool:
        return self.value


class _Connection:
    def __init__(self, populated_table: str | None = None) -> None:
        self.populated_table = populated_table

    def execute(self, statement: Any) -> _ScalarResult:
        return _ScalarResult(
            self.populated_table is not None and self.populated_table in str(statement)
        )


class _Context:
    def __init__(self, as_sql: bool = False) -> None:
        self.as_sql = as_sql


class _Operations:
    def __init__(self, *, as_sql: bool = False, populated_table: str | None = None) -> None:
        self.context = _Context(as_sql)
        self.connection = _Connection(populated_table)
        self.created_tables: dict[str, tuple[Any, ...]] = {}
        self.created_indexes: list[tuple[str, str, tuple[str, ...]]] = []
        self.dropped: list[tuple[str, str]] = []

    def create_table(self, name: str, *items: Any) -> None:
        self.created_tables[name] = items

    def create_index(self, name: str, table: str, columns: list[str]) -> None:
        self.created_indexes.append((name, table, tuple(columns)))

    def get_context(self) -> _Context:
        return self.context

    def get_bind(self) -> _Connection:
        return self.connection

    def drop_index(self, name: str, *, table_name: str) -> None:
        self.dropped.append(("index", f"{table_name}.{name}"))

    def drop_table(self, name: str) -> None:
        self.dropped.append(("table", name))


def test_definition_owns_link_set_revision_and_is_scoped_to_owner() -> None:
    table = WorkbenchDefinition.__table__

    assert "link_set_revision" in table.c
    assert "link_set_revision" not in WorkbenchLink.__table__.c
    owner_fk = next(iter(table.c.owner_user_id.foreign_keys))
    assert owner_fk.target_fullname == "users.id"
    assert owner_fk.ondelete == "CASCADE"
    assert _columns(_constraint(table, "uq_workbench_definition_owner")) == (
        "id",
        "owner_user_id",
    )
    assert isinstance(
        _constraint(table, "ck_workbench_definition_link_set_revision"), CheckConstraint
    )


def test_link_owner_target_registry_and_uniqueness_are_fail_closed() -> None:
    table = WorkbenchLink.__table__
    owner_scope = _constraint(table, "fk_workbench_link_definition_owner")
    assert isinstance(owner_scope, ForeignKeyConstraint)
    assert _columns(owner_scope) == ("workbench_id", "owner_user_id")
    assert tuple(element.target_fullname for element in owner_scope.elements) == (
        "workbench_definitions.id",
        "workbench_definitions.owner_user_id",
    )
    assert owner_scope.ondelete == "CASCADE"
    target_unique = _constraint(table, "uq_workbench_link_target")
    assert isinstance(target_unique, UniqueConstraint)
    assert _columns(target_unique) == ("workbench_id", "target_kind", "target_id")
    target_check = str(_constraint(table, "ck_workbench_link_target_kind").sqltext)
    for kind in ("task", "source", "topic", "note", "evidence", "claim", "project"):
        assert f"'{kind}'" in target_check
    assert not table.c.target_id.foreign_keys


def test_receipts_are_terminal_owner_scoped_and_survive_definition_delete() -> None:
    table = WorkbenchIdempotencyReceipt.__table__
    owner_key = _constraint(table, "uq_workbench_receipt_owner_key")
    assert _columns(owner_key) == ("owner_user_id", "idempotency_key")
    assert "operation" not in _columns(owner_key)
    assert "retryable = false" in str(_constraint(table, "ck_workbench_receipt_terminal").sqltext)
    assert not table.c.definition_id.foreign_keys
    assert table.c.request_fingerprint.type.length == 71


def test_migration_matches_model_tables_and_revision_chain(monkeypatch: pytest.MonkeyPatch) -> None:
    migration = _migration()
    operations = _Operations()
    monkeypatch.setattr(migration, "op", operations)

    migration.upgrade()

    assert migration.revision == "0039_workbench_foundation"
    assert migration.down_revision == "0038_local_worker_protocol"
    models = (WorkbenchDefinition, WorkbenchLink, WorkbenchIdempotencyReceipt)
    assert set(operations.created_tables) == {model.__tablename__ for model in models}
    for model in models:
        migration_columns = {
            item.name
            for item in operations.created_tables[model.__tablename__]
            if hasattr(item, "type")
        }
        assert migration_columns == set(model.__table__.c.keys())


def test_empty_downgrade_drops_only_new_tables_in_dependency_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    migration = _migration()
    operations = _Operations()
    monkeypatch.setattr(migration, "op", operations)

    migration.downgrade()

    dropped_tables = [name for kind, name in operations.dropped if kind == "table"]
    assert dropped_tables == [
        "workbench_idempotency_receipts",
        "workbench_links",
        "workbench_definitions",
    ]


@pytest.mark.parametrize(
    "populated_table",
    ["workbench_idempotency_receipts", "workbench_links", "workbench_definitions"],
)
def test_downgrade_refuses_to_discard_workbench_data(
    monkeypatch: pytest.MonkeyPatch,
    populated_table: str,
) -> None:
    migration = _migration()
    operations = _Operations(populated_table=populated_table)
    monkeypatch.setattr(migration, "op", operations)

    with pytest.raises(RuntimeError, match=f"{populated_table} is not empty"):
        migration.downgrade()

    assert operations.dropped == []


def test_offline_downgrade_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    migration = _migration()
    operations = _Operations(as_sql=True)
    monkeypatch.setattr(migration, "op", operations)

    with pytest.raises(RuntimeError, match="emptiness cannot be proven"):
        migration.downgrade()

    assert operations.dropped == []
