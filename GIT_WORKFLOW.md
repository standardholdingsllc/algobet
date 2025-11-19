# Git Workflow Guide for AlgoBet

## Branch Structure

This project uses **two primary branches** with distinct purposes:

| Branch | Purpose | Auto-Deploy | Contains |
|--------|---------|-------------|----------|
| **`data`** | Active development & bot data updates | ✅ Yes | Latest code + bot data (storage.json, logs, etc.) |
| **`main`** | Production code (clean) | ✅ Yes | Latest stable code only (no bot data) |

---

## 🔄 Standard Workflow

### 1. Making Code Changes

When making changes to the codebase:

```bash
# Step 1: Ensure you're on the data branch
git checkout data
git pull origin data

# Step 2: Make your changes
# (edit files)

# Step 3: Stage and commit
git add .
git commit -m "feat: your descriptive commit message"

# Step 4: Push to data branch
git push origin data
```

**Result:** Vercel auto-deploys from the `data` branch.

---

### 2. Syncing to Main (After Testing on Data)

Once changes are tested and working on `data`, sync them to `main`:

```bash
# Step 1: Switch to main branch
git checkout main
git pull origin main

# Step 2: Merge data branch into main
git merge data -m "Merge latest changes from data branch"

# Step 3: Push to main
git push origin main
```

---

## 🚀 Quick Commands

### Push Changes to Data Branch Only
```bash
cd "c:\AlgoBet Project\AlgoBet"
git checkout data
git add .
git commit -m "your commit message"
git push origin data
```

### Push Changes to Both Branches
```bash
cd "c:\AlgoBet Project\AlgoBet"

# Push to data first
git checkout data
git add .
git commit -m "your commit message"
git push origin data

# Then sync to main
git checkout main
git pull origin main
git merge data
git push origin main
```

### Force Sync Data to Match Main (Use Carefully!)
```bash
git checkout data
git reset --hard main
git push origin data --force
```

---

## 📝 Common Scenarios

### Scenario 1: Quick Bug Fix

```bash
# Fix the bug on data branch
git checkout data
git add lib/bot.ts
git commit -m "fix: correct balance calculation"
git push origin data

# Test on production (data branch deploys automatically)
# Wait 2 minutes, verify fix works

# Sync to main
git checkout main
git merge data
git push origin main
```

---

### Scenario 2: Multiple Files Changed

```bash
# Stage specific files
git checkout data
git add lib/markets/kalshi.ts
git add lib/bot.ts
git add components/Dashboard.tsx
git commit -m "feat: add balance breakdown display"
git push origin data

# After testing, sync to main
git checkout main
git merge data
git push origin main
```

---

### Scenario 3: Data Branch Has Conflicts

```bash
# Pull latest from data
git checkout data
git pull origin data

# If conflicts occur, resolve them manually
# Then:
git add .
git commit -m "merge: resolve conflicts"
git push origin data
```

---

## 🆘 Troubleshooting

### Error: "Updates were rejected (fetch first)"

```bash
# Solution: Pull and rebase
git pull origin data --rebase
git push origin data
```

### Error: "Non-fast-forward" when pushing main

```bash
# Solution: Pull main first
git checkout main
git pull origin main
git merge data
git push origin main
```

### Error: Branches have diverged

```bash
# Option 1: Rebase (preferred)
git checkout data
git fetch origin
git rebase origin/main
git push origin data --force-with-lease

# Option 2: Reset data to match main (CAUTION: loses commits)
git checkout data
git reset --hard main
git push origin data --force
```

---

## 🔍 Checking Branch Status

### View current branch
```bash
git branch
```

### View all branches with last commit
```bash
git branch -v
```

### View remote branches
```bash
git branch -r
```

### Check if branches are in sync
```bash
git checkout main
git log --oneline --graph --decorate --all
```

---

## 📦 Managing Data Files

### The data branch contains:
- `data/storage.json` - Bot data (bets, balances, config)
- `data/bot-status.json` - Bot status
- `logs.txt` - Application logs
- `data/opportunities.json` - Arbitrage opportunities

**These files should stay on the `data` branch only!**

### To exclude data files from main:
They're already in `.gitignore` on main, so they won't sync automatically.

---

## ✅ Best Practices

1. **Always work on `data` branch** for active development
2. **Test thoroughly** before merging to `main`
3. **Commit often** with clear messages
4. **Pull before pushing** to avoid conflicts
5. **Use descriptive commit messages**:
   - ✅ `feat: add balance breakdown to dashboard`
   - ✅ `fix: correct Kalshi signature generation`
   - ❌ `update`
   - ❌ `changes`

6. **Never force push to main** unless absolutely necessary

---

## 🎯 Commit Message Convention

Use these prefixes for clarity:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code formatting (no logic change)
- `refactor:` - Code restructuring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

**Examples:**
```bash
git commit -m "feat: implement Polymarket position tracking"
git commit -m "fix: handle null orderbook responses from Kalshi"
git commit -m "docs: update setup instructions"
git commit -m "chore: remove old test files"
```

---

## 🔄 Emergency: Undo Last Commit

### Undo commit but keep changes
```bash
git reset --soft HEAD~1
```

### Undo commit and discard changes
```bash
git reset --hard HEAD~1
```

### Undo push (if you just pushed)
```bash
git reset --hard HEAD~1
git push origin data --force
```

---

## 📚 Quick Reference

| Task | Command |
|------|---------|
| Check current branch | `git branch` |
| Switch to data | `git checkout data` |
| Switch to main | `git checkout main` |
| Pull latest | `git pull origin <branch>` |
| Stage all changes | `git add .` |
| Commit changes | `git commit -m "message"` |
| Push to branch | `git push origin <branch>` |
| Merge data to main | `git checkout main && git merge data` |
| View commit history | `git log --oneline` |
| View changes | `git status` |
| Discard changes | `git restore <file>` |

---

## 🎓 Complete Example Workflow

```bash
# 1. Start fresh
cd "c:\AlgoBet Project\AlgoBet"
git checkout data
git pull origin data

# 2. Make changes
# (edit files in your IDE)

# 3. Check what changed
git status
git diff

# 4. Stage and commit
git add lib/bot.ts components/Dashboard.tsx
git commit -m "feat: show total balance and available cash separately"

# 5. Push to data (auto-deploys)
git push origin data

# 6. Wait 2 minutes, test on production

# 7. If working correctly, sync to main
git checkout main
git pull origin main
git merge data -m "Merge balance display improvements"
git push origin main

# 8. Verify both branches are synced
git log --oneline --graph --all --decorate

# 9. Return to data for next changes
git checkout data
```

---

## 📞 Help

If you're stuck:
1. Check `git status` to see current state
2. Check `git log --oneline` to see recent commits
3. Check `git branch -v` to see which branch you're on
4. Use `git stash` to temporarily save uncommitted changes
5. Use `git stash pop` to restore stashed changes

**Remember:** The `data` branch is your working branch. Always develop there first! 🚀

