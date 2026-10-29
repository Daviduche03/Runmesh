FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DB_PATH=/data/runmesh.db \
    PORT=8787

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY schema.sql ./
COPY migrations ./migrations
COPY src ./src
COPY scripts ./scripts

RUN useradd --create-home runmesh && mkdir -p /data && chown -R runmesh:runmesh /data /app

USER runmesh
VOLUME ["/data"]
EXPOSE 8787

CMD ["sh", "-c", "uv run --no-sync python src/main.py"]
