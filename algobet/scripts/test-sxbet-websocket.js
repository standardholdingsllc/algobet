// Test SX.bet WebSocket API for order book data
const WebSocket = require('ws');

const WS_URL = 'wss://api.sx.bet'; // Based on API docs
const API_KEY = process.env.SXBET_API_KEY;

function testWebSocketConnection() {
  console.log('🔌 Testing SX.bet WebSocket connection...\n');

  if (!API_KEY) {
    console.log('❌ SXBET_API_KEY not set');
    return;
  }

  console.log('Connecting to WebSocket...');

  const ws = new WebSocket(WS_URL, {
    headers: {
      'X-Api-Key': API_KEY,
    }
  });

  ws.on('open', () => {
    console.log('✅ WebSocket connected successfully');

    // Try to initialize connection (based on API docs)
    const initMessage = {
      type: 'initialize',
      // Add any required initialization data
    };

    console.log('Sending initialization message...');
    ws.send(JSON.stringify(initMessage));

    // Try to subscribe to order book updates
    setTimeout(() => {
      const subscribeMessage = {
        type: 'subscribe',
        channel: 'orderbook', // Based on API docs "Order book updates"
        // May need market hash or other parameters
      };

      console.log('Subscribing to order book updates...');
      ws.send(JSON.stringify(subscribeMessage));
    }, 1000);

    // Try best odds subscription
    setTimeout(() => {
      const bestOddsMessage = {
        type: 'subscribe',
        channel: 'best-odds', // Based on API docs "Best odds"
      };

      console.log('Subscribing to best odds...');
      ws.send(JSON.stringify(bestOddsMessage));
    }, 2000);
  });

  ws.on('message', (data) => {
    console.log('📨 Received message:', data.toString());
    try {
      const parsed = JSON.parse(data.toString());
      console.log('Parsed message:', JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('Raw message (not JSON):', data.toString());
    }
  });

  ws.on('error', (error) => {
    console.log('❌ WebSocket error:', error.message);
  });

  ws.on('close', (code, reason) => {
    console.log(`🔌 WebSocket closed - Code: ${code}, Reason: ${reason.toString()}`);
  });

  // Close after 10 seconds
  setTimeout(() => {
    console.log('Closing WebSocket connection...');
    ws.close();
  }, 10000);
}

testWebSocketConnection();
