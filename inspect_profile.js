const axios = require('axios');
const cheerio = require('cheerio');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const PROXY_URL = `http://${process.env.BRIGHTDATA_USER}:${process.env.BRIGHTDATA_PASS}@${process.env.BRIGHTDATA_HOST}:${process.env.BRIGHTDATA_PORT}`;
const agent = new HttpsProxyAgent(PROXY_URL, { rejectUnauthorized: false });

async function inspectProfile(url) {
    console.log(`Inspecting: ${url}`);
    try {
        const response = await axios.get(url, {
            httpsAgent: agent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            },
            timeout: 15000,
            validateStatus: () => true
        });

        console.log(`Status: ${response.status}`);
        if (response.status !== 200) {
            console.log('Error Content Snippet:', response.data.substring(0, 500));
            return;
        }

        const $ = cheerio.load(response.data);
        
        console.log('\n--- Phones Found (Current Logic) ---');
        $('a[href^="/ng/phone/"], a[href^="tel:"]').each((i, el) => {
            console.log(`[${i}] Text: "${$(el).text().trim()}", Href: "${$(el).attr('href')}"`);
        });

        console.log('\n--- Searching for anything looking like a phone ---');
        // Look for common phone patterns like (XXX) XXX-XXXX
        const phoneRegex = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
        const bodyText = $('body').text();
        const matches = bodyText.match(phoneRegex);
        if (matches) {
            const unique = [...new Set(matches)];
            console.log('Pattern matches found:', unique);
        } else {
            console.log('No pattern matches found in body text.');
        }

        console.log('\n--- Looking at specific sections ---');
        $('.phones-list, .phones, #phones, .p-list').each((i, el) => {
            console.log(`Section ${i} Content:`, $(el).text().trim());
        });

    } catch (error) {
        console.error('Fatal Error:', error.message);
    }
}

// Test with a profile that should have phones
const testUrl = process.argv[2] || 'https://radaris.com/~Elspeth-Reff/1439006431';
inspectProfile(testUrl);
