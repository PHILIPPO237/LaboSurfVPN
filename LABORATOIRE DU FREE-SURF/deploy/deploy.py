#!/usr/bin/env python3
"""Simple deployment script."""
import os
import shlex
import subprocess
import sys
import tempfile
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


# Create ZIP with Unix paths.
temp_zip = Path(tempfile.gettempdir()) / "deploy.zip"
print("1/3 Creating ZIP with Unix paths...")
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
            if file_name.endswith((".db", ".db-shm", ".db-wal", ".log")):
                continue
            path = os.path.join(root, file_name)
            arcname = os.path.relpath(path, LOCAL_PATH).replace("\\", "/")
            archive.write(path, arcname)
print(f"  ZIP ready: {temp_zip}")

print("2/3 Uploading...")
subprocess.run(
    [
        "scp",
        "-P",
        str(REMOTE_PORT),
        "-o",
        "StrictHostKeyChecking=accept-new",
        str(temp_zip),
        f"{REMOTE_USER}@{REMOTE_HOST}:{ARCHIVE_REMOTE_PATH}",
    ],
    check=True,
)

print("3/3 Deploying...")
remote_sh_content = (LOCAL_PATH / "deploy_remote.sh").read_text(encoding="utf-8", errors="ignore")
temp_sh = Path(tempfile.gettempdir()) / "deploy.sh"
with open(temp_sh, "w", encoding="utf-8", newline="\n") as f:
    f.write(remote_sh_content.replace("\r\n", "\n"))

subprocess.run(
    [
        "scp",
        "-P",
        str(REMOTE_PORT),
        "-o",
        "StrictHostKeyChecking=accept-new",
        str(temp_sh),
        f"{REMOTE_USER}@{REMOTE_HOST}:/tmp/deploy.sh",
    ],
    check=True,
)
temp_sh.unlink(missing_ok=True)

result = subprocess.run(
    [
        "ssh",
        "-p",
        str(REMOTE_PORT),
        "-o",
        "StrictHostKeyChecking=accept-new",
        f"{REMOTE_USER}@{REMOTE_HOST}",
        build_remote_command(),
    ]
)

if result.returncode == 0:
    print("\nSUCCESS")
else:
    print("\nFAILED")
    sys.exit(1)

temp_zip.unlink(missing_ok=True)
