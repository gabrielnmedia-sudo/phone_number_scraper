const GoogleHelper = require('./google_helper');

async function test() {
    const google = new GoogleHelper();
    const query = "ALLEN SUTJANDRA JASAWIDYA SUTJANDRA WA";
    console.log(`Testing Broad Google Search: "${query}"`);
    
    try {
        const results = await google.searchBroad(query);
        console.log(`\nFound ${results.length} results.`);
        if (results.length > 0) {
            results.forEach((r, i) => {
                console.log(`\n[${i}] ${r.title}`);
                console.log(`    Link: ${r.link}`);
                console.log(`    Snippet: ${r.snippet}`);
            });
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

test();
