// Test fee calculations against Kalshi's published fee schedule
// Source: https://kalshi.com/docs/kalshi-fee-schedule.pdf

const { 
  calculateKalshiFee, 
  getKalshiFeePercentage,
  calculatePolymarketFee,
  calculateTotalCost,
  validateKalshiFeeCalculations
} = require('../lib/fees.ts');

console.log('🧪 Testing Fee Calculations\n');
console.log('=' .repeat(70));

// Test cases from Kalshi fee schedule
const kalshiTests = [
  { desc: 'General @ 50¢', ticker: 'TEST', price: 50, qty: 100, expected: 1.75 },
  { desc: 'General @ 25¢', ticker: 'TEST', price: 25, qty: 100, expected: 1.32 },
  { desc: 'General @ 75¢', ticker: 'TEST', price: 75, qty: 100, expected: 1.32 },
  { desc: 'General @ 10¢', ticker: 'TEST', price: 10, qty: 100, expected: 0.63 },
  { desc: 'General @ 90¢', ticker: 'TEST', price: 90, qty: 100, expected: 0.63 },
  { desc: 'General @ 1¢', ticker: 'TEST', price: 1, qty: 100, expected: 0.07 },
  { desc: 'General @ 99¢', ticker: 'TEST', price: 99, qty: 100, expected: 0.07 },
  
  { desc: 'S&P500 @ 50¢', ticker: 'INXD-24DEC31', price: 50, qty: 100, expected: 0.88 },
  { desc: 'S&P500 @ 25¢', ticker: 'INXW-24', price: 25, qty: 100, expected: 0.66 },
  { desc: 'S&P500 @ 75¢', ticker: 'INXM-24', price: 75, qty: 100, expected: 0.66 },
  
  { desc: 'NASDAQ @ 50¢', ticker: 'NASDAQ100D-24', price: 50, qty: 100, expected: 0.88 },
  { desc: 'NASDAQ @ 30¢', ticker: 'NASDAQ100W-24', price: 30, qty: 100, expected: 0.74 },
];

console.log('\n📊 Kalshi Fee Tests:\n');

let passed = 0;
let failed = 0;

for (const test of kalshiTests) {
  const calculated = calculateKalshiFee(test.ticker, test.price, test.qty);
  const match = Math.abs(calculated - test.expected) < 0.01;
  
  const status = match ? '✅' : '❌';
  const color = match ? '' : '\x1b[31m';
  const reset = '\x1b[0m';
  
  console.log(
    `${status} ${test.desc.padEnd(20)} | ` +
    `Expected: $${test.expected.toFixed(2)} | ` +
    `Calculated: ${color}$${calculated.toFixed(2)}${reset}`
  );
  
  if (match) passed++;
  else failed++;
}

console.log('\n' + '─'.repeat(70));
console.log(`\n📈 Results: ${passed} passed, ${failed} failed\n`);

// Show fee percentages at different prices
console.log('=' .repeat(70));
console.log('\n💡 Fee Percentages by Price:\n');

console.log('Price | General Markets | S&P500/NASDAQ | As % of Investment');
console.log('─'.repeat(70));

for (let price = 10; price <= 90; price += 10) {
  const generalPct = getKalshiFeePercentage('TEST', price);
  const indexPct = getKalshiFeePercentage('INXD-24', price);
  const investmentPct = (calculateKalshiFee('TEST', price, 100) / price) * 100;
  
  console.log(
    `${price}¢   | ${generalPct.toFixed(3)}%          | ` +
    `${indexPct.toFixed(3)}%        | ${investmentPct.toFixed(3)}%`
  );
}

// Real arbitrage example
console.log('\n' + '=' .repeat(70));
console.log('\n💰 Real Arbitrage Example:\n');

const scenario = {
  kalshi: { ticker: 'HIGHNY-25JAN15', price: 70 },
  polymarket: { price: 28 }
};

const kalshiCost = calculateTotalCost('kalshi', scenario.kalshi.ticker, scenario.kalshi.price, 100, false);
const polymktCost = calculateTotalCost('polymarket', '', scenario.polymarket.price, 100, false);

console.log('Scenario: Knicks game arbitrage');
console.log('─'.repeat(70));
console.log(`Kalshi:     Knicks win @ ${scenario.kalshi.price}¢`);
console.log(`  Base cost:   $${kalshiCost.baseCost.toFixed(2)}`);
console.log(`  Fee:         $${kalshiCost.fee.toFixed(2)} (${kalshiCost.effectiveFeePercentage.toFixed(2)}%)`);
console.log(`  Total cost:  $${kalshiCost.totalCost.toFixed(2)}`);
console.log();
console.log(`Polymarket: Knicks lose @ ${scenario.polymarket.price}¢`);
console.log(`  Base cost:   $${polymktCost.baseCost.toFixed(2)}`);
console.log(`  Fee:         $${polymktCost.fee.toFixed(2)} (${polymktCost.effectiveFeePercentage.toFixed(2)}%)`);
console.log(`  Total cost:  $${polymktCost.totalCost.toFixed(2)}`);
console.log('─'.repeat(70));

const totalCost = kalshiCost.totalCost + polymktCost.totalCost;
const guaranteedReturn = 100; // $100 from 100 contracts
const profit = guaranteedReturn - totalCost;
const profitMargin = (profit / totalCost) * 100;

console.log(`Total investment: $${totalCost.toFixed(2)}`);
console.log(`Guaranteed return: $${guaranteedReturn.toFixed(2)}`);
console.log(`Profit: $${profit.toFixed(2)}`);
console.log(`Profit margin: ${profitMargin.toFixed(2)}%`);

if (profitMargin > 0) {
  console.log('\n✅ This is a PROFITABLE arbitrage!');
} else {
  console.log('\n❌ This is NOT profitable (total cost >= $1.00)');
}

console.log('\n' + '=' .repeat(70));
console.log('\n✨ Fee Calculation Tests Complete!\n');

