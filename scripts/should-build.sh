#!/bin/bash

# This script determines if Vercel should build based on what files changed
# Used to prevent rebuilds when only data files are modified
# Configure in Vercel: Settings > Git > Ignored Build Step > add: bash scripts/should-build.sh

echo "Checking if build is necessary..."

# Check if this is the first deployment
if [ -z "$VERCEL_GIT_PREVIOUS_SHA" ]; then
  echo "✅ First deployment, proceeding with build"
  exit 1  # Exit 1 means "proceed with build"
fi

# Get the list of changed files
FILES_CHANGED=$(git diff --name-only $VERCEL_GIT_PREVIOUS_SHA $VERCEL_GIT_COMMIT_SHA)

echo "Files changed:"
echo "$FILES_CHANGED"

# Filter out data directory changes
NON_DATA_CHANGES=$(echo "$FILES_CHANGED" | grep -v "^data/")

if [ -z "$NON_DATA_CHANGES" ]; then
  echo "🚫 Only data files changed, skipping build"
  exit 0  # Exit 0 means "skip build"
else
  echo "✅ Code changes detected, proceeding with build"
  echo "$NON_DATA_CHANGES"
  exit 1  # Exit 1 means "proceed with build"
fi

