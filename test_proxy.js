const RadarisScraper = require('./radaris_scraper');
const scraper = new RadarisScraper();

async function test() {
    const url = 'https://www.google.com';
    console.log(`Testing proxy with ${url}...`);
    
    try {
        const response = await scraper._makeRequest(url);
        console.log(`Status: ${response.status}`);
        console.log(`Data Type: ${typeof response.data}`);
        console.log('Data:', response.data);
    } catch (e) {
        console.error('Error:', e);
    }
}

test().catch(console.error);
