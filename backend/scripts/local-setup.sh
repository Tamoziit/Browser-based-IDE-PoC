#!/usr/bin/env bash
# One-shot local dev setup.
# Run once from the project root after cloning.
set -e

echo "=== [1/5] Starting supporting services ==="
docker compose up -d

echo "Waiting for MinIO to be ready..."
until curl -sf http://localhost:9000/minio/health/ready > /dev/null 2>&1; do
  printf '.'
  sleep 2
done
echo " ready."

echo "=== [2/5] Seeding MinIO templates ==="
python3 scripts/seed_minio.py

echo "=== [3/5] Starting minikube ==="
minikube start --driver=docker --cpus=2 --memory=4096
kubectl config use-context minikube
kubectl cluster-info

echo "=== [4/5] Creating labs namespace ==="
kubectl apply -f k8s/namespace.yaml

echo "=== [5/5] Building & loading lab image ==="
docker build -t nc-labs/python:latest ./lab-image
minikube image load nc-labs/python:latest

echo ""
echo "✓ All done. Start the backend:"
echo "  npm install && npm run dev"
echo ""
echo "Test with:"
echo "  curl -X POST http://localhost:3001/api/labs/start \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -H 'x-user-id: user123' \\"
echo "    -d '{\"labId\": \"<chapter-_id-from-mongo>\"}'"
