#!/usr/bin/env python3
"""List available routes"""
import requests

API = "http://146.19.230.203:8000"

print("\n===== ENDPOINT SCAN =====\n")

# Test common admin endpoints
endpoints = [
    "/admin",
    "/admin/users",
    "/admin/config-generator",
    "/admin/dns-cloudflare",
    "/admin/ip-bans",
    "/admin/activation-keys",
    "/admin/payments",
    "/admin/ads",
    "/api/admin/ads",
    "/api/admin/config-distribution",
]

print("Testing Admin Endpoints:\n")
for endpoint in endpoints:
    try:
        r = requests.get(f"{API}{endpoint}", timeout=3)
        status = f"{r.status_code}"
        icon = "✓" if r.status_code < 400 else "✗"
        print(f"  {icon} GET {endpoint:40} → {status}")
    except Exception as e:
        print(f"  E GET {endpoint:40} → {str(e)[:20]}")

# Test API endpoints
api_endpoints = [
    "/api/zero-rating/services",
    "/api/user/me",
    "/api/tchat/messages",
    "/api/tchat/quotas",
]

print("\n\nTesting API Endpoints:\n")
for endpoint in api_endpoints:
    try:
        r = requests.get(f"{API}{endpoint}", timeout=3)
        status = f"{r.status_code}"
        icon = "✓" if r.status_code in [200, 401] else "✗"
        print(f"  {icon} GET {endpoint:40} → {status}")
    except Exception as e:
        print(f"  E GET {endpoint:40} → {str(e)[:20]}")

print("\nNote: 401/403 = Authentication required (normal)")
print("      404 = Endpoint not found (issue)")
print("      200 = OK")
