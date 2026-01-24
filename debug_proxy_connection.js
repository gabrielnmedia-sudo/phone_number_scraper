const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

async function testProxy() {
    console.log('Testing Proxy Connection...');
    const proxyUrl = `http://${process.env.BRIGHTDATA_USER}:${process.env.BRIGHTDATA_PASS}@${process.env.BRIGHTDATA_HOST}:${process.env.BRIGHTDATA_PORT}`;
    console.log('Proxy URL constructed (hidden credentials)');
    
    const agent = new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });
    
    try {
        const response = await axios.get('https://httpbin.org/ip', {
            httpsAgent: agent,
            proxy: false, // Axios proxy support is disabled to use agent
            validateStatus: () => true
        });
        
        console.log(`Status: ${response.status}`);
        console.log('Data:', response.data);
        
    } catch (e) {
        console.error('Proxy Error:', e.message);
        if (e.response) {
             console.log('Response Status:', e.response.status);
             console.log('Response Data:', e.response.data);
        }
    }
}

testProxy();
