import nodemailer from 'nodemailer';

const emailSecureFlag = (process.env.EMAIL_SECURE || '').trim().toLowerCase();
const isEmailSecure = emailSecureFlag === 'true';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: isEmailSecure,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  // Add timeout and connection options to prevent hanging
  connectionTimeout: 10000, // 10 seconds
  greetingTimeout: 5000, // 5 seconds
  socketTimeout: 30000, // 30 seconds
  // Disable debugging in production
  debug: process.env.NODE_ENV === 'development',
  logger: process.env.NODE_ENV === 'development',
});

// Helper function to send email with retry logic
async function sendEmailWithRetry(mailOptions: any, maxRetries: number = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await transporter.sendMail(mailOptions);
      return; // Success, exit the retry loop
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries;
      const shouldRetry = !isLastAttempt && (
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ENOTFOUND' ||
        error.message?.includes('Greeting never received')
      );

      if (shouldRetry) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
        console.warn(`Email attempt ${attempt} failed, retrying in ${delay}ms:`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Final failure
      throw error;
    }
  }
}

export async function sendBalanceAlert(
  platform: string,
  currentBalance: number,
  threshold: number
): Promise<void> {
  const alertEmail = process.env.ALERT_EMAIL;

  if (!alertEmail) {
    console.warn('Alert email not configured - skipping balance alert');
    return;
  }

  // Check if required email environment variables are set
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('Email configuration incomplete - skipping balance alert');
    return;
  }

  const subject = `⚠️ Low Balance Alert: ${platform.toUpperCase()}`;
  const text = `
Your ${platform.toUpperCase()} account balance has fallen below the threshold.

Current Balance: $${currentBalance.toFixed(2)}
Threshold: $${threshold.toFixed(2)}

Please add funds to continue automated trading.

Time: ${new Date().toLocaleString()}
  `.trim();

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ef4444;">⚠️ Low Balance Alert</h2>
      <p>Your <strong>${platform.toUpperCase()}</strong> account balance has fallen below the threshold.</p>

      <div style="background-color: #fee2e2; border-left: 4px solid #ef4444; padding: 16px; margin: 20px 0;">
        <p style="margin: 8px 0;"><strong>Current Balance:</strong> $${currentBalance.toFixed(2)}</p>
        <p style="margin: 8px 0;"><strong>Threshold:</strong> $${threshold.toFixed(2)}</p>
      </div>

      <p>Please add funds to continue automated trading.</p>

      <p style="color: #6b7280; font-size: 14px; margin-top: 32px;">
        Time: ${new Date().toLocaleString()}
      </p>
    </div>
  `;

  try {
    await sendEmailWithRetry({
      from: process.env.EMAIL_USER,
      to: alertEmail,
      subject,
      text,
      html,
    });

    console.log(`✅ Balance alert email sent successfully for ${platform}`);
  } catch (error: any) {
    console.error(`❌ Failed to send balance alert email for ${platform} after retries:`, error.message);
    // Don't rethrow - email failures shouldn't break the bot
  }
}

export async function sendBetNotification(
  bet1: any,
  bet2: any,
  expectedProfit: number
): Promise<void> {
  const alertEmail = process.env.ALERT_EMAIL;

  if (!alertEmail) {
    return;
  }

  const subject = `✅ Arbitrage Bet Placed: $${expectedProfit.toFixed(2)} Expected Profit`;
  const text = `
An arbitrage opportunity has been executed:

Bet 1:
Platform: ${bet1.platform.toUpperCase()}
Market: ${bet1.marketTitle}
Side: ${bet1.side.toUpperCase()}
Amount: $${bet1.amount.toFixed(2)}

Bet 2:
Platform: ${bet2.platform.toUpperCase()}
Market: ${bet2.marketTitle}
Side: ${bet2.side.toUpperCase()}
Amount: $${bet2.amount.toFixed(2)}

Expected Profit: $${expectedProfit.toFixed(2)}
Total Invested: $${(bet1.amount + bet2.amount).toFixed(2)}

Time: ${new Date().toLocaleString()}
  `.trim();

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #10b981;">✅ Arbitrage Bet Placed</h2>
      
      <div style="background-color: #d1fae5; border-left: 4px solid #10b981; padding: 16px; margin: 20px 0;">
        <p style="margin: 8px 0; font-size: 18px;"><strong>Expected Profit: $${expectedProfit.toFixed(2)}</strong></p>
      </div>
      
      <div style="background-color: #f9fafb; padding: 16px; margin: 20px 0; border-radius: 8px;">
        <h3 style="margin-top: 0;">Bet 1</h3>
        <p style="margin: 4px 0;"><strong>Platform:</strong> ${bet1.platform.toUpperCase()}</p>
        <p style="margin: 4px 0;"><strong>Market:</strong> ${bet1.marketTitle}</p>
        <p style="margin: 4px 0;"><strong>Side:</strong> ${bet1.side.toUpperCase()}</p>
        <p style="margin: 4px 0;"><strong>Amount:</strong> $${bet1.amount.toFixed(2)}</p>
      </div>
      
      <div style="background-color: #f9fafb; padding: 16px; margin: 20px 0; border-radius: 8px;">
        <h3 style="margin-top: 0;">Bet 2</h3>
        <p style="margin: 4px 0;"><strong>Platform:</strong> ${bet2.platform.toUpperCase()}</p>
        <p style="margin: 4px 0;"><strong>Market:</strong> ${bet2.marketTitle}</p>
        <p style="margin: 4px 0;"><strong>Side:</strong> ${bet2.side.toUpperCase()}</p>
        <p style="margin: 4px 0;"><strong>Amount:</strong> $${bet2.amount.toFixed(2)}</p>
      </div>
      
      <p style="color: #6b7280; font-size: 14px; margin-top: 32px;">
        Time: ${new Date().toLocaleString()}
      </p>
    </div>
  `;

  try {
    await sendEmailWithRetry({
      from: process.env.EMAIL_USER,
      to: alertEmail,
      subject,
      text,
      html,
    });

    console.log('✅ Bet notification email sent successfully');
  } catch (error: any) {
    console.error('❌ Failed to send bet notification email after retries:', error.message);
    // Don't rethrow - email failures shouldn't break the bot
  }
}
