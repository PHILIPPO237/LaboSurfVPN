#!/bin/bash
# Diagnostic script to verify app can start before deploying

echo "=== DIAGNOSTIC: Testing Python import chain ==="
echo ""

# Change to app directory
cd /opt/LABORATOIRE\ DU\ FREE-SURF 2>/dev/null || cd /opt/LABORATOIRE\ DU\ FREE-SURF || cd . 
APP_DIR=$(pwd)

echo "Working directory: $APP_DIR"
echo "Python PATH contents:"
ls -la /opt/LABORATOIRE\ DU\ FREE-SURF/ 2>/dev/null | head -20

echo ""
echo "Testing imports..."

python3 <<'DIAGNOSTIC'
import sys
import os

print("Python version:", sys.version)
print("Python executable:", sys.executable)
print()

print("PYTHONPATH:", os.getenv("PYTHONPATH"))
print()

print("Current directory:", os.getcwd())
print()

print("Files in current directory:")
import glob
py_files = glob.glob("*.py")
for f in py_files[:15]:
    print(f"  {f}")
print()

print("Attempting imports...")
try:
    import config
    print("  OK: import config")
    print(f"     config._VIP_COOKIE_SECRET = {hasattr(config, '_VIP_COOKIE_SECRET')}")
except Exception as e:
    print(f"  FAIL: import config - {e}")

try:
    import app.application
    print("  OK: import app.application")
except Exception as e:
    print(f"  FAIL: import app.application - {e}")
    import traceback
    traceback.print_exc()

try:
    import main
    print("  OK: import main")
    print(f"     main.app = {main.app}")
except Exception as e:
    print(f"  FAIL: import main - {e}")
    import traceback
    traceback.print_exc()
DIAGNOSTIC

echo ""
echo "=== END DIAGNOSTIC ==="
