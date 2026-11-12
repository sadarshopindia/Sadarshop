#!/bin/bash
# Double-click this file to start the Sadarshop website.
cd "$(dirname "$0")"
echo "Starting Sadarshop…"
( sleep 2; open http://localhost:3000 ) &
node --no-warnings server.js
