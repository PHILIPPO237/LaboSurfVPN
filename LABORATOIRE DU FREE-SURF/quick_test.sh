#!/usr/bin/env bash
# Quick Testing Commands for LABORATOIRE DU FREE-SURF API

# Configuration
API="http://146.19.230.203:8000"
USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

echo "╔════════════════════════════════════════════════╗"
echo "║ Quick API Test Commands - LABORATOIRE          ║"
echo "║ API: $API                     ║"
echo "╚════════════════════════════════════════════════╝"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to test endpoint
test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    
    echo -e "\n${YELLOW}Testing: $name${NC}"
    if [ "$method" = "GET" ]; then
        curl -s -X GET "$API$endpoint" \
            -H "User-Agent: $USER_AGENT" \
            -w "\nStatus: %{http_code}\n"
    elif [ "$method" = "POST" ]; then
        curl -s -X POST "$API$endpoint" \
            -H "Content-Type: application/json" \
            -H "User-Agent: $USER_AGENT" \
            -d "$data" \
            -w "\nStatus: %{http_code}\n"
    fi
}

# Test 1: Health Check
echo -e "\n${GREEN}=== HEALTH CHECKS ===${NC}"
test_endpoint "Root Health Check" "GET" "/"

# Test 2: Authentication Pages
echo -e "\n${GREEN}=== AUTHENTICATION PAGES ===${NC}"
test_endpoint "Login Page" "GET" "/acces"
test_endpoint "Signup Page" "GET" "/inscription"

# Test 3: Zero-Rating API
echo -e "\n${GREEN}=== ZERO-RATING API ===${NC}"
echo -e "\n${YELLOW}Testing: Zero-Rating Services${NC}"
curl -s "$API/api/zero-rating/services" | head -c 200
echo ""

# Test 4: Generate Config (POST)
echo -e "\n${GREEN}=== CONFIG GENERATION ===${NC}"
test_endpoint "Generate Zero-Rating Config" "POST" "/api/zero-rating/generate-config" \
    '{
        "server": "example.com",
        "services": ["1500"],
        "port": 443
    }'

# Test 5: Protected Endpoints
echo -e "\n${GREEN}=== PROTECTED ENDPOINTS ===${NC}"
test_endpoint "User Configs (Protected)" "GET" "/api/user/get-configs"
test_endpoint "User Profile (Protected)" "GET" "/api/user/me"
test_endpoint "Chat Messages (Protected)" "GET" "/api/tchat/messages"

# Test 6: Admin Pages
echo -e "\n${GREEN}=== ADMIN ENDPOINTS ===${NC}"
test_endpoint "Admin Dashboard" "GET" "/admin"
test_endpoint "Admin Users" "GET" "/admin/users"

# Test 7: Error Handling
echo -e "\n${GREEN}=== ERROR HANDLING ===${NC}"
test_endpoint "Non-existent Route" "GET" "/api/nonexistent"

# Performance Test
echo -e "\n${GREEN}=== PERFORMANCE TEST ===${NC}"
echo -e "${YELLOW}Testing response times...${NC}"
for i in {1..3}; do
    start=$(date +%s%N)
    curl -s "$API/" > /dev/null
    end=$(date +%s%N)
    ms=$(( (end - start) / 1000000 ))
    echo "Request $i: ${ms}ms"
done

# Summary
echo -e "\n${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ All tests completed${NC}"
echo -e "\n${YELLOW}API is running at: $API${NC}"
echo -e "${YELLOW}Current datetime: $(date)${NC}"
echo -e "\n${GREEN}════════════════════════════════════════════════${NC}"

# Additional useful commands
cat << 'EOF'

=== Additional Useful Commands ===

1. SSH to VPS:
   ssh root@146.19.230.203

2. Check Application Status:
   curl -s -I http://146.19.230.203:8000/

3. View Uvicorn Logs:
   ssh root@146.19.230.203 "tail -f /opt/LABORATOIRE\ DU\ FREE-SURF/uvicorn.log"

4. Check Process:
   ssh root@146.19.230.203 "ps aux | grep uvicorn"

5. Restart Application:
   ssh root@146.19.230.203 "pkill -f uvicorn; sleep 2; cd /opt/LABORATOIRE\ DU\ FREE-SURF && nohup python -m uvicorn main:app --host 0.0.0.0 --port 8000 > uvicorn.log 2>&1 &"

6. Test with Authentication Header:
   curl -H "Cookie: session=YOUR_TOKEN" http://146.19.230.203:8000/api/user/me

7. Test Post Request:
   curl -X POST -H "Content-Type: application/json" \
     -d '{"key":"value"}' \
     http://146.19.230.203:8000/api/endpoint

8. View Network Stats:
   curl -s http://146.19.230.203:8000/ -w "@curl_format.txt"

9. Performance check (Apache Bench):
   ab -n 100 -c 10 http://146.19.230.203:8000/

10. Check SSL/TLS (when configured):
    curl -I https://146.19.230.203:443/

=== Important URLs ===
- Application: http://146.19.230.203:8000
- Login: http://146.19.230.203:8000/acces
- Signup: http://146.19.230.203:8000/inscription
- Admin: http://146.19.230.203:8000/admin (requires auth)
- Zero-Rating API: http://146.19.230.203:8000/api/zero-rating/services

=== Health Check cURL ===
curl -v http://146.19.230.203:8000/ 2>&1 | head -20

EOF
