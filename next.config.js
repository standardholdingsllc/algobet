/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    KALSHI_API_KEY: process.env.KALSHI_API_KEY,
    KALSHI_PRIVATE_KEY: process.env.KALSHI_PRIVATE_KEY,
    POLYMARKET_API_KEY: process.env.POLYMARKET_API_KEY,
    POLYMARKET_PRIVATE_KEY: process.env.POLYMARKET_PRIVATE_KEY,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_REPO: process.env.GITHUB_REPO,
    GITHUB_OWNER: process.env.GITHUB_OWNER,
    EMAIL_HOST: process.env.EMAIL_HOST,
    EMAIL_PORT: process.env.EMAIL_PORT,
    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASS: process.env.EMAIL_PASS,
    ALERT_EMAIL: process.env.ALERT_EMAIL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  }
}

module.exports = nextConfig
