FROM python:3.12-slim

RUN apt-get update && apt-get install -y \
    bash \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    numpy \
    requests

WORKDIR /workspace

CMD ["tail", "-f", "/dev/null"]