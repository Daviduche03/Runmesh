from __future__ import annotations

import json

from enum import Enum

from pydantic import BaseModel

from typing import (
    Any,
    TypeVar,
)

from utils.types import ConnectRowBase


TRow = TypeVar("TRow", bound=ConnectRowBase)


def _dump_create(model: BaseModel) -> dict[str, Any]:
    data = model.model_dump(exclude_none=True)
    for key, value in list(data.items()):
        if isinstance(value, Enum):
            data[key] = value.value
        elif isinstance(value, list):
            data[key] = json.dumps(value)
        elif isinstance(value, dict):
            data[key] = json.dumps(value)
        elif isinstance(value, bool):
            data[key] = 1 if value else 0
    return data


def _rows(raw_rows: list[dict[str, Any]], row_model: type[TRow]) -> list[TRow]:
    out: list[TRow] = []
    for raw in raw_rows:
        row = row_model.from_row(raw)
        if row is not None:
            out.append(row)
    return out


