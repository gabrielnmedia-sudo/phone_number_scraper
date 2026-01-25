const RadarisScraper = require('./radaris_scraper');
const { matchProfile } = require('./matcher');
require('dotenv').config();

async function debug() {
    const radaris = new RadarisScraper();
    const prName = "SUSANNA K ROHRBACH";
    const deceasedName = "PAUL DEES";
    const city = "Bonney Lake";
    const state = "WA";

    console.log(`Searching for ${prName} in ${state}...`);
    const masterPool = await radaris.search(prName, null, state, { maxPages: 1 });
    console.log(`Found ${masterPool.length} candidates in WA.`);
    console.log(JSON.stringify(masterPool.map(c => ({ name: c.fullName, location: c.location, link: c.detailLink, relatives: c.relatives })), null, 2));

    const match = await matchProfile(deceasedName, `${city} ${state}`, prName, masterPool);
    console.log('--- AI Match Result ---');
    console.log(JSON.stringify(match, null, 2));
    
    if (match.bestMatchIndex !== -1) {
        console.log('Best Match Link:', masterPool[match.bestMatchIndex].detailLink);
    }
}

debug().catch(console.error);
