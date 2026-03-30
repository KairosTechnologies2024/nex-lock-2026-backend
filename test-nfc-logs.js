const axios = require('axios');

// Test the GET endpoint
async function testGetLogs() {
  try {
    console.log('Testing GET /api/nfc-logs...');
    const response = await axios.get('http://localhost:3001/api/nfc-logs');
    console.log('GET Response:', response.data);
  } catch (error) {
    console.error('GET Error:', error.response?.data || error.message);
  }
}

// Test the POST endpoint
async function testPostLog() {
  try {
    console.log('\nTesting POST /api/nfc-logs...');
    const testData = {
      company: 'Test Company',
      log: 'Test NFC scan successful',
      truck: 'TEST-TRK-001'
    };
    
    const response = await axios.post('http://localhost:3001/api/nfc-logs', testData);
    console.log('POST Response:', response.data);
  } catch (error) {
    console.error('POST Error:', error.response?.data || error.message);
  }
}

// Run tests
async function runTests() {
  await testGetLogs();
  await testPostLog();
  await testGetLogs(); // Test GET again to see the new entry
}

runTests();