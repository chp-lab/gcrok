#!/bin/bash
source .env
echo "Start gcrok on " $SUBDOMAIN ":" $PORT
node --env-file .env ./gcrok.js --port $PORT --subdomain $SUBDOMAIN