#!/usr/bin/env python3
"""Robust deployment script with better error handling."""
import os
import shlex
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

LOCAL_PATH = Path(__file__).parent
REMOTE_HOST = os.getenv("REMOTE_HOST", "146.19.230.203")
REMOTE_USER = os.getenv("REMOTE_USER", "root")
REMOTE_PORT = int(os.getenv("REMOTE_PORT", "22"))
REMOTE_PATH = os.getenv("REMOTE_PATH", "/opt/LABORATOIRE DU FREE-SURF")
APP_PORT = os.getenv("APP_PORT", "8000")
APP_HOST = os.getenv("APP_HOST", "127.0.0.1")
FS_ENV = os.getenv("FS_ENV", "production")
SERVICE_NAME = os.getenv("SERVICE_NAME", "laboratoire-free-surf")
PUBLIC_URL = os.getenv("PUBLIC_URL", "")
ADMIN_URL = os.getenv("ADMIN_URL", "")
INSTALL_REQUIREMENTS = os.getenv("INSTALL_REQUIREMENTS", "1")
USE_SYSTEMD = os.getenv("USE_SYSTEMD", "1")
ARCHIVE_REMOTE_PATH = "/tmp/lfs_deploy.zip"
MAX_RETRIES = 3


def build_remote_command() -> str:
    remote_vars = {
        "REMOTE_PATH": REMOTE_PATH,
        "ARCHIVE_PATH": ARCHIVE_REMOTE_PATH,
        "APP_PORT": APP_PORT,
        "APP_HOST": APP_HOST,
        "FS_ENV": FS_ENV,
        "SERVICE_NAME": SERVICE_NAME,
        "PUBLIC_URL": PUBLIC_URL,
        "ADMIN_URL": ADMIN_URL,
        "INSTALL_REQUIREMENTS": INSTALL_REQUIREMENTS,
        "USE_SYSTEMD": USE_SYSTEMD,
    }
    env_prefix = " ".join(
        f"{key}={shlex.quote(str(value))}"
        for key, value in remote_vars.items()
    )
    return f"{env_prefix} bash /tmp/deploy.sh"


def run_command(cmd, description, retry=False):
    """Run command with retry logic."""
    attempts = 0
    while attempts < MAX_RETRIES:
        attempts += 1
        try:
            print(f"[Attempt {attempts}/{MAX_RETRIES}] {description}...")
            result = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=60)
            if result.returncode == 0:
                if result.stdout:
                    print(f"  OK {result.stdout.strip()[:120]}")
                else:
                    print("  OK Success")
                return True
            if "Connection refused" in result.stderr or "Connection closed" in result.stderr:
                if retry and attempts < MAX_RETRIES:
                    print("  Connection error, waiting 5s before retry...")
                    time.sleep(5)
                    continue
            print(f"  Error: {result.stderr[:200]}")
            return False
        except subprocess.TimeoutExpired:
            print("  Timeout, waiting 5s before retry...")
            if retry and attempts < MAX_RETRIES:
                time.sleep(5)
                continue
            return False
        except Exception as exc:
            print(f"  Exception: {str(exc)[:200]}")
            return False
    return False


# Create ZIP.
temp_zip = Path(tempfile.gettempdir()) / "deploy.zip"
print("\n1/4 Creating ZIP with Unix paths...")

try:
    with zipfile.ZipFile(temp_zip, "w", zipfile.ZIP_DEFLATED) as archive:
        for root, dirs, files in os.walk(LOCAL_PATH):
            dirs[:] = [
                directory
                for directory in dirs
                if directory not in [".git", "__pycache__", ".venv_local", "deploy-reports", ".venv", "node_modules"]
            ]
            for file_name in files:
                if file_name in ["deploy.ps1", "deploy.py", "deploy_robust.py", "deploy_remote.sh", ".admin_password", ".env"]:
                    continue
                if file_name.startswith("test_"):
                    continue
                path = os.path.join(root, file_name)
                arcname = os.path.relpath(path, LOCAL_PATH).replace("\\", "/")
                archive.write(path, arcname)

    size_mb = temp_zip.stat().st_size / (1024 * 1024)
    print(f"  OK ZIP ready: {temp_zip.name} ({size_mb:.1f} MB)")
except Exception as exc:
    print(f"  Failed to create ZIP: {exc}")
    sys.exit(1)

print("\n2/4 Testing SSH connection...")
if not run_command(
    [
        "ssh",
        "-p",
        str(REMOTE_PORT),
        "-o",
        "ConnectTimeout=10",
        "-o",
        "StrictHostKeyChecking=accept-new",
        f"{REMOTE_USER}@{REMOTE_HOST}",
        "echo OK",
    ],
    "SSH Connection test",
    retry=True,
):
    print("  Cannot reach server. Is it online?")
    sys.exit(1)

print("\n3/4 Uploading ZIP...")
if not run_command(
    [
        "scp",
        "-P",
        str(REMOTE_PORT),
        "-o",
        "ConnectTimeout=10",
        "-o",
        "StrictHostKeyChecking=accept-new",
        str(temp_zip),
        f"{REMOTE_USER}@{REMOTE_HOST}:{ARCHIVE_REMOTE_PATH}",
    ],
    "Upload ZIP file",
    retry=True,
):
    print("  Failed to upload ZIP")
    sys.exit(1)

print("\n3.5/4 Uploading deploy script...")
if not run_command(
    [
        "scp",
        "-P",
        str(REMOTE_PORT),
        "-o",
        "ConnectTimeout=10",
        "-o",
        "StrictHostKeyChecking=accept-new",
        str(LOCAL_PATH / "deploy_remote.sh"),
        f"{REMOTE_USER}@{REMOTE_HOST}:/tmp/deploy.sh",
    ],
    "Upload deploy script",
    retry=True,
):
    print("  Failed to upload deploy script")
    sys.exit(1)

print("\n4/4 Executing deployment...")
result = subprocess.run(
    [
        "ssh",
        "-p",
        str(REMOTE_PORT),
        "-o",
        "ConnectTimeout=10",
        "-o",
        "StrictHostKeyChecking=accept-new",
        f"{REMOTE_USER}@{REMOTE_HOST}",
        build_remote_command(),
    ],
    capture_output=True,
    text=True,
    timeout=180,
)

if result.stdout:
    print(result.stdout)
if result.stderr:
    print(result.stderr)

if result.returncode == 0:
    print("\n" + "=" * 50)
    print("DEPLOYMENT SUCCESSFUL")
    print("=" * 50)
else:
    print("\n" + "=" * 50)
    print("DEPLOYMENT FAILED")
    print("=" * 50)
    sys.exit(1)

temp_zip.unlink(missing_ok=True)
print("\nCleanup complete.")
