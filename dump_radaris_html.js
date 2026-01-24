const RadarisScraper = require('./radaris_scraper');
const fs = require('fs');

async function test() {
    const radaris = new RadarisScraper();
    const url = "https://radaris.com/ng/search?ff=KENNETH&fl=WEISENBACH&fs=Washington";
    const response = await radaris._makeRequest(url);
    if (response.status === 200) {
        fs.writeFileSync('radaris_debug_search.html', response.data);
        console.log("HTML dumped to radaris_debug_search.html");
    } else {
        console.error("Request failed with status", response.status);
    }
}

test();
