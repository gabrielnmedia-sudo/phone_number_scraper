const RadarisScraper = require('./radaris_scraper');
const scraper = new RadarisScraper();

const fs = require('fs');

async function debug() {
    const prName = 'THOMAS D LANCASTER';
    const state = 'WA';
    console.log(`Searching for ${prName} in ${state}...`);
    // Manually call _makeRequest to get full response
    const url = `https://radaris.com/ng/search?ff=${encodeURIComponent('THOMAS')}&fl=${encodeURIComponent('LANCASTER')}&fs=${encodeURIComponent('Washington')}`;
    console.log(`URL: ${url}`);
    
    try {
        const response = await scraper._makeRequest(url);
        console.log(`Status: ${response.status}`);
        console.log(`Data Type: ${typeof response.data}`);
        if (response.headers) console.log(`Content-Type: ${response.headers['content-type']}`);
        
        let content = response.data;
        if (typeof content === 'object') {
            console.log('Response data is an object, stringifying...');
            content = JSON.stringify(content, null, 2);
        }
        
        console.log(`Content Length: ${content.length}`);
        fs.writeFileSync('debug_search_dump.html', content);
        console.log('Dumped content to debug_search_dump.html');
        
        const $ = require('cheerio').load(response.data);
        const cards = $('.card');
        console.log(`Found ${cards.length} .card elements in Cheerio parsing`);
        
    } catch (e) {
        console.error('Error:', e);
    }
}

debug().catch(console.error);
