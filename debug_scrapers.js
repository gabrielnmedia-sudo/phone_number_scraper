const RadarisScraper = require('./radaris_scraper');
const WhitePagesScraper = require('./whitepages_scraper');
const WhitePagesDiscovery = require('./whitepages_search_optimized');

async function debug() {
    const radaris = new RadarisScraper();
    const name = "KENNETH WEISENBACH";
    const city = "Bothell";
    const state = "WA";

    console.log(`Searching Radaris for ${name}...`);
    const rResults = await radaris.search(name, null, state);
    console.log(`Radaris found ${rResults.length} candidates.`);
    if (rResults.length > 0) {
        console.log(`First candidate: ${JSON.stringify(rResults[0], null, 2)}`);
        if (rResults[0].detailLink) {
            console.log(`Fetching profile for ${rResults[0].detailLink}...`);
            const profile = await radaris.getProfile(rResults[0].detailLink);
            console.log(`Profile search result: ${JSON.stringify(profile, null, 2)}`);
        }
    }

    console.log(`\nSearching WhitePages for ${name}...`);
    const wpUrl = await WhitePagesDiscovery.discoverProfileUrl("KENNETH", "WEISENBACH", city, state);
    console.log(`WhitePages URL: ${wpUrl}`);
    if (wpUrl) {
        const wpProfile = await WhitePagesScraper.scrapeWhitePagesProfile(wpUrl);
        console.log(`WhitePages Profile: ${JSON.stringify(wpProfile, null, 2)}`);
    }
}

debug().catch(console.error);
