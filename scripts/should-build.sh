#!/bin/bash

# This script determines if Vercel should build based on what files changed
# Used to prevent rebuilds when only data files are modified
# Configure in Vercel: Settings > Git > Ignored Build Step > add: bash scripts/should-build.sh

echo "🔍 Checking if build is necessary..."

# Check if this is the first deployment or if git variables are missing
if [ -z "$VERCEL_GIT_PREVIOUS_SHA" ] || [ -z "$VERCEL_GIT_COMMIT_SHA" ]; then
  echo "✅ First deployment or missing git info, proceeding with build"
  exit 1  # Exit 1 means "proceed with build"
fi

# Get the list of changed files
FILES_CHANGED=$(git diff --name-only $VERCEL_GIT_PREVIOUS_SHA $VERCEL_GIT_COMMIT_SHA 2>&1)

# If git command fails, proceed with build (safe default)
if [ $? -ne 0 ]; then
  echo "⚠️  Git diff failed, proceeding with build for safety"
  exit 1
fi

echo "📝 Files changed:"
echo "$FILES_CHANGED"

# If no files changed (shouldn't happen, but just in case)
if [ -z "$FILES_CHANGED" ]; then
  echo "⚠️  No files detected as changed, proceeding with build for safety"
  exit 1
fi

# Filter out data directory changes
NON_DATA_CHANGES=$(echo "$FILES_CHANGED" | grep -v "^data/")

# Check if only data files changed
if [ -z "$NON_DATA_CHANGES" ]; then
  echo "🚫 Only data/ files changed, skipping build"
  echo "   Changed data files:"
  echo "$FILES_CHANGED" | sed 's/^/   - /'
  exit 0  # Exit 0 means "skip build"
else
  echo "✅ Code/config changes detected, proceeding with build"
  echo "   Changed files:"
  echo "$NON_DATA_CHANGES" | sed 's/^/   - /'
  exit 1  # Exit 1 means "proceed with build"
fi

