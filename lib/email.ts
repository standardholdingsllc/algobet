import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export async function sendBalanceAlert(
  platform: string,
  currentBalance: number,
  threshold: number
): Promise<void> {
  const alertEmail = process.env.ALERT_EMAIL;

  if (!alertEmail) {
    console.error('Alert email not configured');
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
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: alertEmail,
      subject,
      text,
      html,
    });

    console.log(`Balance alert email sent for ${platform}`);
  } catch (error) {
    console.error('Error sending balance alert email:', error);
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
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: alertEmail,
      subject,
      text,
      html,
    });

    console.log('Bet notification email sent');
  } catch (error) {
    console.error('Error sending bet notification email:', error);
  }
}
