const GoogleHelper = require('./google_helper');

async function test() {
    const google = new GoogleHelper();
    const results = await google.searchBroad("test");
    console.log(`Google found ${results.length} results.`);
    if (results.length > 0) {
        console.log(`First result: ${results[0].title}`);
    }
}

test();
