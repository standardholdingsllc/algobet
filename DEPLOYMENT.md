# Deployment Guide

This guide covers deploying AlgoBet to Vercel for 24/7 operation.

## Prerequisites

- Completed initial setup (see SETUP.md)
- Vercel account (free tier works)
- All environment variables ready
- GitHub repository created with storage.json

## Deployment Methods

### Method 1: Vercel CLI (Recommended)

#### 1. Install Vercel CLI

```bash
npm install -g vercel
```

#### 2. Login to Vercel

```bash
vercel login
```

#### 3. Deploy

```bash
vercel
```

Follow the prompts:
- **Set up and deploy?** Y
- **Which scope?** Select your account
- **Link to existing project?** N
- **Project name?** algobet (or your choice)
- **Directory?** ./
- **Override settings?** N

#### 4. Add Environment Variables

```bash
# Add each variable
vercel env add NEXTAUTH_SECRET
vercel env add NEXTAUTH_URL
vercel env add ADMIN_USERNAME
vercel env add ADMIN_PASSWORD_HASH
vercel env add KALSHI_API_KEY
vercel env add KALSHI_PRIVATE_KEY
vercel env add KALSHI_EMAIL
vercel env add POLYMARKET_API_KEY
vercel env add POLYMARKET_PRIVATE_KEY
vercel env add POLYMARKET_WALLET_ADDRESS
vercel env add GITHUB_TOKEN
vercel env add GITHUB_OWNER
vercel env add GITHUB_REPO
vercel env add EMAIL_HOST
vercel env add EMAIL_PORT
vercel env add EMAIL_USER
vercel env add EMAIL_PASS
vercel env add ALERT_EMAIL
```

For each variable:
- Select environment: **Production, Preview, Development**
- Enter the value

#### 5. Deploy to Production

```bash
vercel --prod
```

Your app is now live at `https://your-project.vercel.app`

### Method 2: GitHub Integration

#### 1. Push to GitHub

```bash
git remote add origin https://github.com/YOUR_USERNAME/AlgoBet.git
git branch -M main
git push -u origin main
```

#### 2. Import in Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "Add New..." → "Project"
3. Import your GitHub repository
4. Configure:
   - **Framework Preset**: Next.js
   - **Root Directory**: ./
   - **Build Command**: npm run build
   - **Output Directory**: .next

#### 3. Add Environment Variables

In the Vercel project settings:
1. Go to Settings → Environment Variables
2. Add each variable from your `.env` file
3. Set for all environments (Production, Preview, Development)

#### 4. Deploy

Click "Deploy" and wait for the build to complete.

## Post-Deployment Configuration

### 1. Update NEXTAUTH_URL

After deployment, update the `NEXTAUTH_URL` environment variable:

```bash
vercel env add NEXTAUTH_URL
# Enter: https://your-project.vercel.app
```

Or in the Vercel dashboard:
- Settings → Environment Variables
- Find `NEXTAUTH_URL`
- Update to your production URL
- Redeploy

### 2. Verify Deployment

Visit your app:
```
https://your-project.vercel.app
```

Check:
- [ ] Login page loads
- [ ] Can authenticate
- [ ] Dashboard displays
- [ ] Bot controls work
- [ ] Configuration saves to GitHub

### 3. Test Bot Operation

1. Log in to dashboard
2. Click "Start Bot"
3. Monitor Vercel logs:
   ```bash
   vercel logs --follow
   ```
4. Check for:
   - API calls to Kalshi and Polymarket
   - Arbitrage detection logs
   - No error messages

## Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXTAUTH_SECRET` | Random secret for NextAuth | Output of `openssl rand -base64 32` |
| `NEXTAUTH_URL` | Your deployment URL | `https://algobet.vercel.app` |
| `ADMIN_USERNAME` | Admin login username | `admin` |
| `ADMIN_PASSWORD_HASH` | Bcrypt hash of password | Output of password hash script |
| `KALSHI_API_KEY` | Kalshi API key | From Kalshi dashboard |
| `KALSHI_PRIVATE_KEY` | Kalshi private key | From Kalshi dashboard |
| `KALSHI_EMAIL` | Kalshi account email | `user@example.com` |
| `POLYMARKET_API_KEY` | Polymarket API key | From Polymarket settings |
| `POLYMARKET_PRIVATE_KEY` | Polymarket private key | From Polymarket settings |
| `POLYMARKET_WALLET_ADDRESS` | Your wallet address | `0x...` |
| `GITHUB_TOKEN` | GitHub PAT with repo scope | `ghp_...` |
| `GITHUB_OWNER` | GitHub username | `your-username` |
| `GITHUB_REPO` | Repository name | `AlgoBet` |
| `EMAIL_HOST` | SMTP host | `smtp.gmail.com` |
| `EMAIL_PORT` | SMTP port | `587` |
| `EMAIL_USER` | Email address | `user@gmail.com` |
| `EMAIL_PASS` | Email password/app password | `xxxx xxxx xxxx xxxx` |
| `ALERT_EMAIL` | Alert recipient email | `alerts@example.com` |

## Continuous Deployment

### Automatic Deployments

Vercel automatically deploys when you push to GitHub:

```bash
git add .
git commit -m "Update bot logic"
git push
```

Vercel will:
1. Detect the push
2. Build your app
3. Run tests (if configured)
4. Deploy to production

### Preview Deployments

Every pull request gets a preview deployment:
1. Create a branch
2. Make changes
3. Push and create PR
4. Vercel creates preview URL
5. Test before merging

## Monitoring

### Vercel Logs

Real-time logs:
```bash
vercel logs --follow
```

View recent logs:
```bash
vercel logs
```

Filter by function:
```bash
vercel logs --filter "api/bot"
```

### Vercel Dashboard

Monitor in the dashboard:
- **Deployments**: Build history and status
- **Functions**: Serverless function executions
- **Analytics**: Traffic and performance
- **Logs**: Real-time application logs

### Email Alerts

Configure email alerts for:
- Low balance warnings
- Bet placement notifications
- Error alerts

## Scaling

### Serverless Functions

Vercel runs your API routes as serverless functions:
- **Free**: 100 GB-hours
- **Pro**: 1000 GB-hours
- Auto-scales with traffic

### Continuous Operation

For 24/7 bot operation:

**Option 1: Vercel Cron Jobs**

Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/bot/cron",
    "schedule": "*/5 * * * *"
  }]
}
```

**Option 2: External Cron (Recommended)**

Use a service like:
- Cron-job.org (free)
- EasyCron
- AWS EventBridge

Configure to ping:
```
https://your-app.vercel.app/api/bot/trigger
```

Every 5 minutes to keep bot active.

## Security

### Environment Variables

- Never commit `.env` files
- Rotate API keys quarterly
- Use strong passwords
- Enable 2FA on all accounts

### Access Control

- Keep GitHub repo private
- Limit Vercel team access
- Use role-based permissions
- Monitor access logs

### HTTPS

Vercel provides:
- Automatic HTTPS
- SSL certificates
- TLS 1.3
- HTTP/2

## Troubleshooting

### Deployment Fails

**Check build logs:**
```bash
vercel logs --build
```

**Common issues:**
- Missing dependencies: Check `package.json`
- TypeScript errors: Run `npm run build` locally
- Environment variables: Verify all are set

### Bot Not Running

**Check function logs:**
```bash
vercel logs --filter "api/bot"
```

**Common issues:**
- API keys expired
- Rate limits hit
- Network timeouts
- GitHub storage permissions

### Authentication Issues

**Symptoms:** Can't log in or session expires

**Solutions:**
- Verify `NEXTAUTH_URL` matches deployment URL
- Regenerate `NEXTAUTH_SECRET`
- Clear browser cookies
- Check Vercel function logs

### Database/Storage Issues

**Symptoms:** Configuration not saving, bets not recorded

**Solutions:**
- Verify GitHub token permissions
- Check `GITHUB_OWNER` and `GITHUB_REPO` values
- Ensure `storage.json` exists in repo
- Test token: `curl -H "Authorization: token TOKEN" https://api.github.com/user`

## Cost Optimization

### Vercel Pricing

**Free Tier:**
- 100 GB-hours/month
- 100 GB bandwidth
- Unlimited domains
- **Usually sufficient for AlgoBet**

**Pro Tier ($20/month):**
- 1000 GB-hours/month
- 1 TB bandwidth
- Better support
- Advanced features

### Reduce Costs

1. **Optimize scan frequency** (30-60 seconds instead of 10)
2. **Cache market data** (reduce API calls)
3. **Batch operations** (fewer function invocations)
4. **Use preview deployments wisely** (delete old ones)

## Maintenance

### Weekly Tasks

- [ ] Review bot performance
- [ ] Check account balances
- [ ] Export and analyze data
- [ ] Review Vercel usage

### Monthly Tasks

- [ ] Rotate API keys
- [ ] Update dependencies
- [ ] Review and optimize code
- [ ] Backup GitHub data

### Quarterly Tasks

- [ ] Security audit
- [ ] Performance review
- [ ] Cost optimization
- [ ] Strategy adjustment

## Rollback

### Instant Rollback

In Vercel dashboard:
1. Go to Deployments
2. Find working deployment
3. Click "..." → "Promote to Production"

### CLI Rollback

```bash
# List deployments
vercel ls

# Promote a deployment
vercel promote <deployment-url>
```

## Support

### Resources

- **Vercel Docs**: https://vercel.com/docs
- **Next.js Docs**: https://nextjs.org/docs
- **AlgoBet README**: See README.md

### Getting Help

1. Check Vercel logs first
2. Review GitHub issues
3. Open new issue with:
   - Error messages
   - Steps to reproduce
   - Environment details
   - Relevant logs

## Next Steps

1. Set up monitoring and alerts
2. Configure cron job for 24/7 operation
3. Test with small amounts
4. Gradually increase limits
5. Monitor and optimize

Happy trading! 🚀
