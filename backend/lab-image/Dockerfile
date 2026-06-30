FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        bash \
        curl \
        git \
    && rm -rf /var/lib/apt/lists/*

# Create the workspace mount point — actual content comes from PVC
RUN mkdir -p /workspace

WORKDIR /workspace

# Default: keep container alive so K8s Exec can attach a shell
# The backend uses `kubectl exec` (K8s Exec API) to open bash or run python.
CMD ["bash", "-c", "sleep infinity"]
