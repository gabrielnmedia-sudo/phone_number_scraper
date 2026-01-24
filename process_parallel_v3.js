const fs = require('fs');
const csv = require('csv-parser');
const { parseOwnerName, extractPRs } = require('./name_parser');
const RadarisScraper = require('./radaris_scraper');
const SearchPeopleFreeScraper = require('./searchpeoplefree_scraper');
const EnhancedScraper = require('./enhanced_scraper');
const GoogleHelper = require('./google_helper');
const { matchProfile } = require('./matcher');
require('dotenv').config();

// Configuration
const CONFIG = {
    INPUT_FILE: './Fresh_Test_Run.csv',
    OUTPUT_FILE: './Data_Tracking_Processed_Parallel_Apex.csv',
    CONCURRENT_ROWS: 100, // True parallel list processing
    CONFIDENCE_THRESHOLD_STRONG: 70, 
    CONFIDENCE_THRESHOLD_MEDIUM: 40, 
};

const radaris = new RadarisScraper();
const searchPeopleFree = new SearchPeopleFreeScraper();
const enhanced = new EnhancedScraper();
const google = new GoogleHelper();

/**
 * Improved address parser
 */
function parseAddress(address) {
    if (!address) return { city: '', state: 'WA' };
    const cleanAddr = address.replace(/\n/g, ', ').trim();
    const match = cleanAddr.match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})?/i);
    if (match) return { city: match[1].trim(), state: match[2].toUpperCase() };
    const parts = cleanAddr.split(',').map(p => p.trim());
    if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1];
        const stateMatch = lastPart.match(/([A-Z]{2})/i);
        const state = stateMatch ? stateMatch[1].toUpperCase() : 'WA';
        const secondToLast = parts[parts.length - 2];
        const cityParts = secondToLast.split(/\s+/);
        return { city: cityParts[cityParts.length - 1], state };
    }
    return { city: '', state: 'WA' };
}

/**
 * Turbo V5 Search Strategy: Parallel Tiers
 */
/**
 * Apex Speed V7 Strategy: Racing Parallel Tiers with Early Hit
 */
async function tieredSearchPR(prName, deceasedName, city, state, rowIndex) {
    const result = { name: prName, phone: '', allPhones: '', source: '', reasoning: '', found: false };
    const targetInfo = `${city}, ${state}`.replace(/^,\s*/, '');

    try {
        console.log(`[Row ${rowIndex}] 🏎️  Race Tier 1 (WA/CBC) starting...`);
        
        // Launch Tier 1: Local Search
        const [candidatesWA, candidatesCBC] = await Promise.all([
            radaris.search(prName, null, state, { maxPages: 1 }),
            enhanced.searchCBCWithPagination(prName, city, state, { maxPages: 1 })
        ]);

        const tier1Pool = [...candidatesWA, ...candidatesCBC];
        if (tier1Pool.length > 0) {
            let match = await matchProfile(deceasedName || prName, targetInfo, prName, tier1Pool);
            
            // EARLY HIT: If we are extremely confident, exit NOW.
            if (match && match.bestMatchIndex !== -1 && match.confidence >= 90) {
                const best = tier1Pool[match.bestMatchIndex];
                const phones = (best.visiblePhones || []).filter(p => p && p.length >= 10);
                
                // If phone is already visible, 0ms wait for profile fetch
                if (phones.length > 0) {
                    return { ...result, phone: phones[0], allPhones: phones.join(' | '), source: `${best.source} (Apex)`, reasoning: match.reasoning, found: true };
                }
                
                // Fast profile fetch
                const profile = (best.source === 'Radaris') ? await radaris.getProfile(best.detailLink) : await enhanced.getDetailsCBC(best.detailLink);
                const deepPhones = (profile?.allPhones || []).filter(p => p && p.length >= 10);
                if (deepPhones.length > 0) {
                    return { ...result, phone: deepPhones[0], allPhones: deepPhones.join(' | '), source: `${best.source} (Apex)`, reasoning: match.reasoning, found: true };
                }
            }
        }

        // TIER 2: Nationwide and Google (Only if Tier 1 wasn't a "Perfect Hit")
        console.log(`[Row ${rowIndex}] 🔎 Tier 2: Nationwide/Google discovery fallback...`);
        const [candidatesNW, googleItems] = await Promise.all([
            radaris.search(prName, null, null, { maxPages: 1 }),
            google.searchQuoted(prName, deceasedName)
        ]);

        // Integrate Google links into the pool
        const googleCandidates = [];
        const googleLinks = googleItems.map(i => i.link).filter(l => l.includes('radaris.com') || l.includes('cyberbackgroundchecks.com'));
        
        // Final Pool Aggregation
        const finalPool = [...tier1Pool, ...candidatesNW];
        const seenLinks = new Set(finalPool.map(c => c.detailLink));

        // AI Match Pass 2
        let finalMatch = await matchProfile(deceasedName || prName, targetInfo, prName, finalPool);
        
        if (finalMatch && finalMatch.bestMatchIndex !== -1 && finalMatch.confidence >= 60) {
            const best = finalPool[finalMatch.bestMatchIndex];
            const profile = (best.source === 'Radaris') ? await radaris.getProfile(best.detailLink) : await enhanced.getDetailsCBC(best.detailLink);
            const phones = (profile?.allPhones || best.visiblePhones || []).filter(p => p && p.length >= 10);
            if (phones.length > 0) {
                return { ...result, phone: phones[0], allPhones: phones.join(' | '), source: best.source, reasoning: finalMatch.reasoning, found: true };
            }
        }

        // TIER 5: Greedy Best Guess
        if (!result.found) {
            const greedyCandidates = candidatesWA.length > 0 ? candidatesWA : candidatesNW;
            if (greedyCandidates.length > 0) {
                const best = greedyCandidates[0];
                if (best) {
                    const profile = (best.source === 'Radaris') ? await radaris.getProfile(best.detailLink) : null;
                    const phones = (profile?.allPhones || []).filter(p => p && p.length >= 10);
                    if (phones.length > 0) {
                        return { ...result, phone: phones[0], allPhones: phones.join(' | '), source: `${best.source || 'Unknown'} (Greedy)`, reasoning: 'Best available match found (Low Confidence)', found: true };
                    }
                }
            }
        }

        result.reasoning = 'Exhausted all sources without any match';
    } catch (error) {
        console.error(`[Row ${rowIndex}] 💥 Error: ${error.message}`);
        result.reasoning = `Error: ${error.message}`;
    }

    return result;
}

/**
 * Process a single row
 */
async function processRow(row, rowIndex) {
    const ownerName = row['Owner Name'];
    const address = row['Property Address'];
    if (!ownerName || ownerName.trim() === '') return null;

    const parsed = parseOwnerName(ownerName);
    const prList = extractPRs(parsed.pr_name || parsed.raw);
    const { city, state } = parseAddress(address);

    const outputRow = {
        ...row,
        'Deceased Name_PARSED': parsed.deceased_name || '',
        'Is Probate': parsed.is_probate ? 'Yes' : 'No',
    };

    // Parallel PR search
    const prTasks = prList.slice(0, 2).map((name, idx) => tieredSearchPR(name, parsed.deceased_name, city, state, rowIndex));
    const prResults = await Promise.all(prTasks);

    prResults.forEach((res, idx) => {
        const p = `PR ${idx + 1}`;
        outputRow[`${p} Name`] = res.name;
        outputRow[`${p} Phone`] = res.phone;
        outputRow[`${p} All Phones`] = res.allPhones;
        outputRow[`${p} Source`] = res.source;
        outputRow[`${p} Match Reasoning`] = res.reasoning;
    });

    return outputRow;
}

async function main() {
    console.log('='.repeat(60));
    console.log('UNIVERSAL PROBATE PHONE SCRAPER V3');
    console.log('='.repeat(60));

    const rows = [];
    if (!fs.existsSync(CONFIG.INPUT_FILE)) { console.error('Input file missing'); return; }

    await new Promise((res, rej) => fs.createReadStream(CONFIG.INPUT_FILE).pipe(csv()).on('data', r => rows.push(r)).on('end', res).on('error', rej));

    const outputHeaders = [...Object.keys(rows[0]), 'Deceased Name_PARSED', 'Is Probate', 'PR 1 Name', 'PR 1 Phone', 'PR 1 All Phones', 'PR 1 Source', 'PR 1 Match Reasoning', 'PR 2 Name', 'PR 2 Phone', 'PR 2 All Phones', 'PR 2 Source', 'PR 2 Match Reasoning', 'Notes'];
    fs.writeFileSync(CONFIG.OUTPUT_FILE, outputHeaders.join(',') + '\n');

    for (let i = 0; i < rows.length; i += CONFIG.CONCURRENT_ROWS) {
        const batch = rows.slice(i, i + CONFIG.CONCURRENT_ROWS);
        console.log(`\n🚀 Batch ${Math.floor(i/CONFIG.CONCURRENT_ROWS)+1}/${Math.ceil(rows.length/CONFIG.CONCURRENT_ROWS)}`);
        const results = await Promise.all(batch.map((r, idx) => processRow(r, i + idx + 1)));

        results.forEach(res => {
            if (!res) return;
            const csvRow = outputHeaders.map(h => {
                let v = res[h] || '';
                if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) v = `"${v.replace(/"/g, '""')}"`;
                return v;
            }).join(',');
            fs.appendFileSync(CONFIG.OUTPUT_FILE, csvRow + '\n');
        });
    }
    console.log('\n✅ V3 PROCESSING COMPLETE');
}

main().catch(console.error);
