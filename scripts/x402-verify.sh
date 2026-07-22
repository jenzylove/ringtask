#!/usr/bin/env bash
# x402 seller-side verification battery for ringtask.onrender.com
set -u
HOST="https://ringtask.onrender.com"
HDR="${SIGNED_HEADER:?run: SIGNED_HEADER=$(node scripts/sign-test-payment.mjs) bash scripts/x402-verify.sh}"
HDR2="${SIGNED_HEADER_HOLD:?also export SIGNED_HEADER_HOLD from sign-test-payment.mjs 500000}"

echo "=== 1. GET probe /v1/tasks: expect 402 + PAYMENT-REQUIRED ==="
curl -s -D - -o /tmp/b1.json --max-time 60 "$HOST/v1/tasks" | grep -icE "^HTTP/2 402|^payment-required" | xargs -I{} echo "{}==2 markers found"

echo "=== 2. GET probe /v1/services/appointment-hold: expect 402 ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 60 "$HOST/v1/services/appointment-hold"

echo "=== 3. Forged signature: expect 402 ==="
FAKE=$(printf '{"x402Version":1,"scheme":"exact","network":"eip155:196","payload":{"signature":"0x%s","authorization":{"from":"0x1111111111111111111111111111111111111111","to":"0x5bbc247738d9c44e852dac08de3cbc0bd0a5d718","value":"1500000","validBefore":"99999999999"}}}' "$(printf 'ab%.0s' $(seq 65))" | base64 -w0)
curl -s --max-time 60 -X POST -H "PAYMENT-SIGNATURE: $FAKE" -H "Content-Type: application/json" -d '{}' -o /tmp/b3.json -w "HTTP %{http_code} " "$HOST/v1/tasks"
grep -o '"error":"[^"]*"' /tmp/b3.json

echo "=== 4. Properly signed payment: expect 200 + taskId ==="
curl -s -D /tmp/h4.txt --max-time 60 -X POST -H "PAYMENT-SIGNATURE: $HDR" -H "Content-Type: application/json" -d '{"goal":"Find same-day laptop battery replacement","location":"Yaba, Lagos","requiredAnswers":["availability","price"]}' -o /tmp/b4.json -w "HTTP %{http_code}\n" "$HOST/v1/tasks"
grep -o '"taskId":"[^"]*"' /tmp/b4.json
grep -i '^payment-response' /tmp/h4.txt | sed 's/^[^:]*: //' | tr -d '\r' | base64 -d; echo

echo "=== 5. Replay of the SAME signed header: expect 402 replay rejection ==="
curl -s --max-time 60 -X POST -H "PAYMENT-SIGNATURE: $HDR" -H "Content-Type: application/json" -d '{}' -o /tmp/b5.json -w "HTTP %{http_code} " "$HOST/v1/tasks"
grep -o '"error":"[^"]*"' /tmp/b5.json

echo "=== 6. Paid appointment-hold (0.5 USDT header): expect 200 + calls note ==="
curl -s --max-time 60 -X POST -H "PAYMENT-SIGNATURE: $HDR2" -H "Content-Type: application/json" -d '{"goal":"Hold a haircut appointment for tomorrow morning","location":"Lekki"}' -o /tmp/b6.json -w "HTTP %{http_code}\n" "$HOST/v1/services/appointment-hold"
grep -o '"taskId":"[^"]*"\|"callNote":"[^"]*"' /tmp/b6.json

echo "=== 7. Underpaid: 0.5 header on the 1.5 endpoint: expect 402 ==="
curl -s --max-time 60 -X POST -H "PAYMENT-SIGNATURE: $HDR2" -H "Content-Type: application/json" -d '{}' -o /tmp/b7.json -w "HTTP %{http_code} " "$HOST/v1/tasks"
grep -o '"error":"[^"]*"' /tmp/b7.json
