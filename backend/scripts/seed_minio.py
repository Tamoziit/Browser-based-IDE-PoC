"""
Seed MinIO with lab templates so the init-container can pull them.
Run once after `docker compose up -d` and MinIO is healthy.

Usage:
  python scripts/seed_minio.py                                           # auto-discovers ./templates/
  python scripts/seed_minio.py 6a1ee6d349413c0cf171e7e1 6a1ee6d349413c0cf171e7e2
"""

import io
import sys
from pathlib import Path

from minio import Minio
from minio.error import S3Error

# ── Config ────────────────────────────────────────────────────────────────────
MINIO_ENDPOINT  = "localhost:9000"
MINIO_ACCESS    = "minioadmin"
MINIO_SECRET    = "minioadmin"
BUCKET_TEMPLATES = "nc-lms-templates"
BUCKET_SNAPSHOTS = "nc-lms-snapshots"
STARTER_PY       = "# Your Python lab\nprint('Hello from the lab!')\n"

# ── Paths ─────────────────────────────────────────────────────────────────────
PROJECT_ROOT  = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = PROJECT_ROOT / "templates"


def ensure_bucket(client: Minio, name: str) -> None:
    if not client.bucket_exists(name):
        client.make_bucket(name)
        print(f"[seed] Bucket created: {name}")
    else:
        print(f"[seed] Bucket already exists: {name}")


def upload_lab(client: Minio, lab_id: str, lab_dir: Path) -> None:
    main_py = lab_dir / "main.py"
    if not main_py.exists():
        main_py.write_text(STARTER_PY, encoding="utf-8")
        print(f"[seed]   injected starter main.py")

    for file_path in sorted(lab_dir.rglob("*")):
        if not file_path.is_file():
            continue
        object_name = f"{lab_id}/{file_path.relative_to(lab_dir).as_posix()}"
        print(f"[seed]   uploading {object_name}...", end="", flush=True)  # shows which file hangs
        data = file_path.read_bytes()
        client.put_object(
            BUCKET_TEMPLATES,
            object_name,
            io.BytesIO(data),
            length=len(data),
        )
        print(" done.")


def upload_stub(client: Minio, lab_id: str) -> None:
    data = STARTER_PY.encode()
    client.put_object(
        BUCKET_TEMPLATES,
        f"{lab_id}/main.py",
        io.BytesIO(data),
        length=len(data),
        content_type="text/plain",
    )
    print(f"[seed]   stub main.py -> {BUCKET_TEMPLATES}/{lab_id}/main.py")


def main() -> None:
    client = Minio(MINIO_ENDPOINT, access_key=MINIO_ACCESS, secret_key=MINIO_SECRET, secure=False)

    print("[seed] Creating buckets...")
    ensure_bucket(client, BUCKET_TEMPLATES)
    ensure_bucket(client, BUCKET_SNAPSHOTS)

    # ── Resolve lab list ──────────────────────────────────────────────────────
    if len(sys.argv) > 1:
        lab_ids = sys.argv[1:]
        print(f"[seed] Using explicit lab IDs: {' '.join(lab_ids)}")
    else:
        if not TEMPLATES_DIR.exists():
            print("[seed] ./templates/ not found — creating it.")
            TEMPLATES_DIR.mkdir(parents=True)

        lab_ids = sorted(d.name for d in TEMPLATES_DIR.iterdir() if d.is_dir())
        if not lab_ids:
            print("[seed] No lab directories found under ./templates/ — nothing to upload.")
            sys.exit(0)
        print(f"[seed] Auto-discovered labs: {' '.join(lab_ids)}")

    # ── Upload ────────────────────────────────────────────────────────────────
    uploaded = skipped = 0

    for lab_id in lab_ids:
        lab_dir = TEMPLATES_DIR / lab_id
        try:
            if lab_dir.is_dir():
                print(f"[seed] Uploading template for {lab_id}...")
                upload_lab(client, lab_id, lab_dir)
                print(f"[seed] ✓ {lab_id} uploaded.")
                uploaded += 1
            else:
                print(f"[seed] ✗ No directory for {lab_id} — uploading stub...")
                upload_stub(client, lab_id)
                print(f"[seed] ✓ {lab_id} stub uploaded.")
                skipped += 1
        except S3Error as e:
            print(f"[seed] ERROR on {lab_id}: {e}", file=sys.stderr)
            sys.exit(1)

    print(f"\n[seed] Done. {uploaded} template(s) uploaded, {skipped} stub(s) created.")
    print(f"[seed] MinIO Console: http://localhost:9001 (admin / minioadmin)")


if __name__ == "__main__":
    main()