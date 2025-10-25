#!/bin/bash

# Initialize GitHub storage for AlgoBet

echo "🚀 Initializing AlgoBet GitHub Storage"
echo ""

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "📁 Initializing git repository..."
    git init
fi

# Check if data directory exists
if [ ! -d "data" ]; then
    echo "📂 Creating data directory..."
    mkdir data
fi

# Check if storage.json exists
if [ ! -f "data/storage.json" ]; then
    echo "📄 Creating storage.json..."
    cat > data/storage.json << EOF
{
  "bets": [],
  "arbitrageGroups": [],
  "config": {
    "maxBetPercentage": 4,
    "maxDaysToExpiry": 5,
    "minProfitMargin": 0.5,
    "balanceThresholds": {
      "kalshi": 100,
      "polymarket": 100
    },
    "emailAlerts": true
  },
  "dailyStats": [],
  "balances": []
}
EOF
fi

# Add and commit
echo "📦 Committing initial storage..."
git add data/storage.json
git commit -m "Initialize AlgoBet data storage" || echo "⚠️  No changes to commit"

echo ""
echo "✅ Storage initialized!"
echo ""
echo "Next steps:"
echo "1. Create a GitHub repository"
echo "2. Add remote: git remote add origin https://github.com/YOUR_USERNAME/AlgoBet.git"
echo "3. Push: git push -u origin main"
echo "4. Create a GitHub Personal Access Token with 'repo' scope"
echo "5. Add token to .env as GITHUB_TOKEN"

