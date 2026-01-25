/**
 * Debug single row processing for Allen Sutjandra
 */
const fs = require('fs');
const csv = require('csv-parser');
const { parseOwnerName, extractPRs } = require('./name_parser');
const RadarisScraper = require('./radaris_scraper');
const { twoPhaseWhitePages } = require('./whitepages_two_phase');
const { matchProfile } = require('./matcher');
require('dotenv').config();

async function parseAddress(addr) {
    if (!addr) return { city: '', state: 'WA' };
    const parts = addr.split(',').map(p => p.trim());
    const stateMatch = addr.match(/\b([A-Z]{2})\s*\d{0,5}\b/);
    const state = stateMatch ? stateMatch[1].toUpperCase() : 'WA';
    return { city: '', state };
}

async function debugSearchPR(prName, deceasedName, city, state) {
    console.log(`\n=== tieredSearchPR Debug ===`);
    console.log(`PR Name: "${prName}"`);
    console.log(`Deceased: "${deceasedName}"`);
    console.log(`Location: ${city}, ${state}`);
    
    if (!prName || prName === 'Unknown') {
        console.log('EARLY RETURN: prName is empty or Unknown');
        return { found: false, reasoning: 'Not searched' };
    }
    
    console.log('\n--- Tier 1: Radaris WA Search ---');
    const radaris = new RadarisScraper();
    const parts = prName.split(/\s+/);
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    
    console.log(`Searching: ${firstName} ${lastName} in WA`);
    const profiles = await radaris.search(firstName, lastName, 'WA');
    console.log(`Found ${profiles.length} candidates`);
    
    if (profiles.length > 0) {
        console.log('Candidates:');
        profiles.slice(0, 5).forEach((p, i) => {
            console.log(`  ${i+1}. ${p.fullName} | ${p.location} | ${p.age || 'Unknown age'}`);
        });
        
        const match = matchProfile(profiles, prName, deceasedName, '', state);
        if (match) {
            console.log(`\nBest match: ${match.fullName}`);
            console.log(`Fetching profile: ${match.detailLink}`);
            const detail = await radaris.getProfile(match.detailLink);
            console.log('Phones found:', detail?.phones);
            if (detail?.phones?.length > 0) {
                console.log('SUCCESS - Would return with phone');
                return { found: true, phone: detail.phones[0] };
            }
        } else {
            console.log('No confident match found');
        }
    }
    
    console.log('\n--- Tier 4: WhitePages Fallback ---');
    console.log('Would trigger WhitePages since no match found');
    const wpResult = await twoPhaseWhitePages(firstName, lastName, state || 'WA');
    console.log('WhitePages result:', wpResult);
    
    if (wpResult && wpResult.phones && wpResult.phones.length > 0) {
        console.log(`SUCCESS - WhitePages found: ${wpResult.phones[0]}`);
        return { found: true, phone: wpResult.phones[0], source: 'WhitePages' };
    }
    
    console.log('FAILED - No phones found anywhere');
    return { found: false, reasoning: 'All tiers failed' };
}

async function main() {
    const rows = [];
    await new Promise((res, rej) => {
        fs.createReadStream('Fresh_Test_Run.csv')
            .pipe(csv())
            .on('data', row => rows.push(row))
            .on('end', res)
            .on('error', rej);
    });
    
    const sutjandra = rows.find(r => r['Owner Name']?.includes('SUTJANDRA'));
    if (!sutjandra) {
        console.log('Sutjandra row not found!');
        return;
    }
    
    console.log('=== PROCESSING SUTJANDRA ROW ===');
    console.log('Owner Name:', sutjandra['Owner Name']);
    console.log('Address:', sutjandra['Property Address']);
    
    const parsed = parseOwnerName(sutjandra['Owner Name']);
    console.log('Parsed:', JSON.stringify(parsed, null, 2));
    
    const prList = extractPRs(parsed.pr_name || parsed.raw);
    console.log('PR List:', prList);
    
    const { city, state } = await parseAddress(sutjandra['Property Address']);
    console.log(`Location: ${city}, ${state}`);
    
    for (const pr of prList) {
        const result = await debugSearchPR(pr, parsed.deceased_name, city, state);
        console.log('\nFinal result:', result);
    }
}

main().catch(console.error);
