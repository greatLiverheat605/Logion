import asyncio
from logging.config import fileConfig

from alembic import context
from logion_api.config import get_settings
from logion_api.content import models as content_models  # noqa: F401
from logion_api.db import Base
from logion_api.exam import models as exam_models  # noqa: F401
from logion_api.execution import evidence_models as evidence_models  # noqa: F401
from logion_api.execution import models as execution_models  # noqa: F401
from logion_api.identity import models as identity_models  # noqa: F401
from logion_api.memory import models as memory_models  # noqa: F401
from logion_api.planning import models as planning_models  # noqa: F401
from logion_api.research import models as research_models  # noqa: F401
from logion_api.self_study import models as self_study_models  # noqa: F401
from logion_api.sync import models as sync_models  # noqa: F401
from logion_api.workspaces import models as workspace_models  # noqa: F401
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    configuration = config.get_section(config.config_ini_section, {})
    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def do_run_migrations(connection: object) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
