const RadarisScraper = require('./radaris_scraper');
const { matchProfile } = require('./matcher');
require('dotenv').config();

async function debug() {
    const radaris = new RadarisScraper();

    // Case 1: Allan Nelson / Stephen Gruse - PR who should be found via deceased's relatives
    const prName = "STEPHEN GRUSE";
    const deceasedName = "ALLAN R NELSON";
    const city = "Burien";
    const state = "WA";

    console.log(`\n--- V11.13 DEBUG: ${prName} for ${deceasedName} ---\n`);
    
    // V11.13 Tier 0.5: Reverse Linkage - Search for DECEASED
    console.log(`[Tier 0.5] Searching for deceased: ${deceasedName}...`);
    const deceasedResults = await radaris.search(deceasedName, null, state, { maxPages: 1 });
    console.log(`Found ${deceasedResults.length} results for deceased.`);
    
    for (const deceased of deceasedResults) {
        console.log(`\n  Profile: ${deceased.fullName} (${deceased.location})`);
        console.log(`  Relatives: ${(deceased.relatives || []).join(', ')}`);
        
        if (deceased.relatives && deceased.relatives.length > 0) {
            const prParts = prName.toLowerCase().split(/\s+/);
            const prFirst = prParts[0];
            const prLast = prParts[prParts.length - 1];
            
            const linkedPR = deceased.relatives.find(rel => {
                const relStr = typeof rel === 'string' ? rel : (rel.name || '');
                const relLower = relStr.toLowerCase();
                return relLower.includes(prFirst) && relLower.includes(prLast);
            });
            
            if (linkedPR) {
                console.log(`\n  ✅ FOUND PR IN DECEASED'S RELATIVES: ${linkedPR}`);
            }
        }
    }
    
    // Regular search for PR
    console.log(`\n[Tier 1] Searching for PR: ${prName}...`);
    const prResults = await radaris.search(prName, null, state, { maxPages: 1 });
    console.log(`Found ${prResults.length} candidates for PR.`);
    
    // AI Match
    const match = await matchProfile(deceasedName, `${city} ${state}`, prName, prResults);
    console.log('\n--- AI Match Result ---');
    console.log(JSON.stringify(match, null, 2));
}

debug().catch(console.error);
