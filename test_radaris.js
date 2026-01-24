const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const PROXY_URL = `http://${process.env.BRIGHTDATA_USER}:${process.env.BRIGHTDATA_PASS}@${process.env.BRIGHTDATA_HOST}:${process.env.BRIGHTDATA_PORT}`;
const HTTPS_AGENT = new HttpsProxyAgent(PROXY_URL, { rejectUnauthorized: false });

async function testSearch(firstName, lastName, state) {
    const url = `https://radaris.com/ng/search?ff=${encodeURIComponent(firstName)}&fl=${encodeURIComponent(lastName)}&fs=${encodeURIComponent(state)}`;
    console.log(`Testing URL: ${url}`);
    
    try {
        const response = await axios.get(url, {
            httpsAgent: HTTPS_AGENT,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: 10000,
            validateStatus: () => true
        });

        console.log(`Status: ${response.status}`);
        console.log(`Headers:`, response.headers);
        console.log(`Body snippet (first 500 chars):`, response.data.substring(0, 500));
        
        if (response.data.includes('SUMMARY') || response.data.includes('results')) {
            console.log('--- Found data indicators ---');
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

async function runTests() {
    console.log('--- Test 1: Full name with middle initial ---');
    await testSearch('DOUGLAS', 'A WINGER', 'Washington');
    
    console.log('\n--- Test 2: Name without middle initial ---');
    await testSearch('DOUGLAS', 'WINGER', 'Washington');
    
    console.log('\n--- Test 3: Another common failure ---');
    await testSearch('JESSICA', 'M KIEPER', 'Washington');
    
    console.log('\n--- Test 4: Without middle ---');
    await testSearch('JESSICA', 'KIEPER', 'Washington');
}

runTests();
