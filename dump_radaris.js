const RadarisScraper = require('./radaris_scraper');
const fs = require('fs');

async function dump() {
    const radaris = new RadarisScraper();
    const targetUrl = process.argv[2] || `https://radaris.com/ng/search?ff=KENNETH&fl=WEISENBACH&fs=Washington`;
    console.log(`Dumping HTML from ${targetUrl}...`);
    
    const response = await radaris._makeRequest(targetUrl);
    if (response.status === 200) {
        fs.writeFileSync('radaris_dump.html', response.data);
        console.log(`Dumped ${response.data.length} bytes to radaris_dump.html`);
    } else {
        console.error(`Status ${response.status}`);
        console.error(response.data);
    }
}

dump().catch(console.error);
