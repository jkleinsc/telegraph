curl -H 'Content-Type: application/json' \
            -X POST http://localhost:3000/db/messages \
            -d "{\"message\": \"$1\"}"
