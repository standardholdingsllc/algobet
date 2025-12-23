const bcrypt = require('bcryptjs');

// Get password from command line argument
const password = process.argv[2];

if (!password) {
  console.error('Usage: node generate-password-hash.js <password>');
  process.exit(1);
}

// Generate hash
const hash = bcrypt.hashSync(password, 10);
console.log('\nGenerated password hash:');
console.log(hash);
console.log('\nAdd this to your .env file as:');
console.log(`ADMIN_PASSWORD_HASH=${hash}`);

