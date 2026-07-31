from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from logion_api.db import Base


class UserSetting(Base):
    __tablename__ = "user_settings"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_user_settings_version"),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(String(8192), nullable=False)
    version: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
