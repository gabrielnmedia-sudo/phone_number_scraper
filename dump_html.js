const axios = require('axios');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const PROXY_URL = `http://${process.env.BRIGHTDATA_USER}:${process.env.BRIGHTDATA_PASS}@${process.env.BRIGHTDATA_HOST}:${process.env.BRIGHTDATA_PORT}`;
const agent = new HttpsProxyAgent(PROXY_URL, { rejectUnauthorized: false });

async function dumpHtml(url, filename) {
    console.log(`Dumping HTML from: ${url}`);
    try {
        const response = await axios.get(url, {
            httpsAgent: agent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            timeout: 20000,
            validateStatus: () => true
        });

        console.log(`Status: ${response.status}`);
        fs.writeFileSync(filename, response.data);
        console.log(`Saved to ${filename} (${response.data.length} bytes)`);
        
        if (response.data.includes('Access Denied') || response.data.includes('Robot Check')) {
            console.log('WARNING: Access Denied or Robot Check detected in HTML.');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

const url = 'https://radaris.com/~Elspeth-Reff/1439006431';
dumpHtml(url, 'radaris_profile_dump.html');
