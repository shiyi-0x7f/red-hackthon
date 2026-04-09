FROM python:3.11-slim

WORKDIR /app

# 使用国内 apt 镜像
RUN sed -i 's|deb.debian.org|mirrors.ustc.edu.cn|g' /etc/apt/sources.list.d/debian.sources

# 系统依赖（bcrypt 需要 build tools）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖层（利用缓存）
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    -i https://mirrors.aliyun.com/pypi/simple/ \
    --trusted-host mirrors.aliyun.com

# 应用代码
COPY app /app/app
COPY pyproject.toml /app/pyproject.toml

# 数据目录（挂载用）
RUN mkdir -p /data
ENV DATABASE_URL=sqlite:////data/ai_learning.db
ENV MIGRATIONS_DIR=/migrations
ENV DATA_DIR=/data_files
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=9000

EXPOSE 9000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9000"]
