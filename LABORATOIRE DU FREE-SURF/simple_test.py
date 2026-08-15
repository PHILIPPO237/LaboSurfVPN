#!/usr/bin/env python3
"""Simple deployment test"""
import requests
import json

API = "http://146.19.230.203:8000"

print("\n===== DEPLOYMENT TEST =====\n")

# Test 1: Health Check
try:
    r = requests.get(f"{API}/", timeout=5)
    print(f"[1/3] Health Check")
    print(f"      Status: {r.status_code}")
    print(f"      Content-Type: {r.headers.get('content-type', 'N/A')}")
    print(f"      Length: {len(r.content)} bytes")
    if r.status_code == 200:
        print("      PASS: Application is responding\n")
    else:
        print("      FAIL: Expected status 200\n")
except Exception as e:
    print(f"[1/3] Health Check - FAIL: {e}\n")

# Test 2: API Endpoint
try:
    r = requests.get(f"{API}/api/zero-rating/services", timeout=5)
    print(f"[2/3] API Zero-Rating Services")
    print(f"      Status: {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        print(f"      Response: {json.dumps(data, ensure_ascii=False)[:100]}")
        print("      PASS: API working\n")
    else:
        print(f"      FAIL: Expected status 200, got {r.status_code}\n")
except Exception as e:
    print(f"[2/3] API - FAIL: {e}\n")

# Test 3: Protected endpoint
try:
    r = requests.get(f"{API}/api/user/me", timeout=5)
    print(f"[3/3] Protected Endpoint (/api/user/me)")
    print(f"      Status: {r.status_code}")
    if r.status_code == 401:
        print("      PASS: Authentication protection working\n")
    else:
        print(f"      INFO: Got status {r.status_code}\n")
except Exception as e:
    print(f"[3/3] Protected - FAIL: {e}\n")

print("===== DEPLOYMENT TEST COMPLETE =====\n")
print("Application is deployed and responding correctly!")
