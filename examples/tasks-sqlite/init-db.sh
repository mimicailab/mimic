#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_PATH="${SCRIPT_DIR}/tasks.db"

# Remove existing database if present
if [ -f "$DB_PATH" ]; then
  echo "Removing existing database at ${DB_PATH}..."
  rm "$DB_PATH"
fi

# Create the database from schema
sqlite3 "$DB_PATH" < "${SCRIPT_DIR}/schema.sql"

# Enable WAL mode for better concurrent read performance
sqlite3 "$DB_PATH" "PRAGMA journal_mode=WAL;"

echo "SQLite database created at ${DB_PATH}"
