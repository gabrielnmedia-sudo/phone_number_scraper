const fs = require('fs');
const csv = require('csv-parser');
const { parseOwnerName, extractPRs } = require('./name_parser');
const RadarisScraper = require('./radaris_scraper');
const SearchPeopleFreeScraper = require('./searchpeoplefree_scraper');
const { matchProfile } = require('./matcher');
require('dotenv').config();

// Configuration
const CONFIG = {
    INPUT_FILE: './Fresh_Test_Run.csv',
    OUTPUT_FILE: './Data_Tracking_Processed_Parallel_V2.csv',
    CONCURRENT_ROWS: 10, // Process 10 rows at a time
    CONCURRENT_PRS: 2,   // Process PRs within a row in parallel
    CONFIDENCE_THRESHOLD: 50,
    RATE_LIMIT_MS: 500,
};

const radarisScraper = new RadarisScraper();
const spfScraper = new SearchPeopleFreeScraper();

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
        const secondToLast = parts[parts.length - 2];
        const stateMatch = lastPart.match(/([A-Z]{2})/i);
        const state = stateMatch ? stateMatch[1].toUpperCase() : 'WA';
        const cityParts = secondToLast.split(/\s+/);
        const city = cityParts[cityParts.length - 1];
        return { city, state };
    }
    return { city: '', state: 'WA' };
}

/**
 * Process a single PR for a row
 */
async function processPR(prName, deceasedName, city, state, rowIndex, prIdx) {
    const colPrefix = `PR ${prIdx + 1}`;
    const result = {
        name: prName,
        phone: '',
        allPhones: '',
        source: '',
        reasoning: ''
    };

    console.log(`[Row ${rowIndex}] 👤 Processing ${prName}...`);

    try {
        // Strategy 1: Radaris
        console.log(`[Row ${rowIndex}] 🔍 Searching Radaris for ${prName}...`);
        let candidates = await radarisScraper.search(prName, null, state);
        
        // Strategy 2: SearchPeopleFree Fallback
        if (candidates.length === 0) {
            console.log(`[Row ${rowIndex}] 🔍 Radaris empty. Trying SearchPeopleFree...`);
            candidates = await spfScraper.search(prName, city, state);
        }

        if (candidates.length === 0) {
            result.reasoning = 'No candidates found in scrapers';
            return result;
        }

        let match = await matchProfile(deceasedName || prName, `${city}, ${state}`, prName, candidates);

        if (match && match.bestMatchIndex !== -1) {
            let best = candidates[match.bestMatchIndex];
            
            // Fetch full profile for deceased check and phones
            if (best.source === 'Radaris') {
                const profile = await radarisScraper.getProfile(best.detailLink);
                if (profile) best = { ...best, ...profile };
            } else if (best.source === 'SearchPeopleFree') {
                const profile = await spfScraper.getProfile(best.detailLink);
                if (profile) best = { ...best, ...profile };
            }

            // Handle Deceased candidates
            if (best && best.isDeceased) {
                console.log(`[Row ${rowIndex}] ⚠️ ${best.fullName} is deceased. Retrying...`);
                candidates.splice(match.bestMatchIndex, 1);
                if (candidates.length > 0) {
                    match = await matchProfile(deceasedName || prName, `${city}, ${state}`, prName, candidates);
                    if (match && match.bestMatchIndex !== -1) {
                        best = candidates[match.bestMatchIndex];
                        if (best.source === 'Radaris') {
                            const p = await radarisScraper.getProfile(best.detailLink);
                            if (p) best = { ...best, ...p };
                        }
                    } else {
                        best = null;
                    }
                } else {
                    best = null;
                }
            }

            if (best && !best.isDeceased && match.confidence >= CONFIG.CONFIDENCE_THRESHOLD) {
                const phoneList = (best.allPhones || []).filter(p => p && p.length >= 10);
                if (phoneList.length > 0) {
                    result.phone = phoneList[0];
                    result.allPhones = phoneList.join(' | ');
                    result.source = best.source;
                    result.reasoning = match.reasoning;
                    console.log(`[Row ${rowIndex}] ✅ FOUND: ${phoneList[0]} (${best.source})`);
                } else {
                    result.reasoning = 'Match found but no phones';
                }
            } else {
                result.reasoning = best?.isDeceased ? 'Best match was deceased' : (match?.reasoning || 'No high-confidence match');
            }
        } else {
            result.reasoning = match?.reasoning || 'No high-confidence match';
        }
    } catch (error) {
        console.error(`[Row ${rowIndex}] 💥 Error: ${error.message}`);
        result.reasoning = `Error: ${error.message}`;
    }

    return result;
}

/**
 * Process a single row with multiple PRs in parallel
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
        'Notes': ''
    };

    // Initialize PR columns
    for (let j = 1; j <= 2; j++) {
        outputRow[`PR ${j} Name`] = '';
        outputRow[`PR ${j} Phone`] = '';
        outputRow[`PR ${j} All Phones`] = '';
        outputRow[`PR ${j} Source`] = '';
        outputRow[`PR ${j} Match Reasoning`] = '';
    }

    const prTasks = prList.slice(0, 2).map((prName, idx) => 
        processPR(prName, parsed.deceased_name, city, state, rowIndex, idx)
    );

    const prResults = await Promise.all(prTasks);

    prResults.forEach((res, idx) => {
        const prefix = `PR ${idx + 1}`;
        outputRow[`${prefix} Name`] = res.name;
        outputRow[`${prefix} Phone`] = res.phone;
        outputRow[`${prefix} All Phones`] = res.allPhones;
        outputRow[`${prefix} Source`] = res.source;
        outputRow[`${prefix} Match Reasoning`] = res.reasoning;
    });

    return outputRow;
}

async function main() {
    console.log('='.repeat(60));
    console.log('PARALLEL PROBATE PHONE SCRAPER V2');
    console.log('='.repeat(60));

    const rows = [];
    if (!fs.existsSync(CONFIG.INPUT_FILE)) {
        console.error(`Input file not found: ${CONFIG.INPUT_FILE}`);
        return;
    }

    await new Promise((resolve, reject) => {
        fs.createReadStream(CONFIG.INPUT_FILE).pipe(csv()).on('data', r => rows.push(r)).on('end', resolve).on('error', reject);
    });

    console.log(`📂 Loaded ${rows.length} rows. Processing in batches of ${CONFIG.CONCURRENT_ROWS}...`);

    const inputHeaders = Object.keys(rows[0] || {});
    const outputHeaders = [
        ...inputHeaders,
        'Deceased Name_PARSED', 'Is Probate',
        'PR 1 Name', 'PR 1 Phone', 'PR 1 All Phones', 'PR 1 Source', 'PR 1 Match Reasoning',
        'PR 2 Name', 'PR 2 Phone', 'PR 2 All Phones', 'PR 2 Source', 'PR 2 Match Reasoning',
        'Notes'
    ];

    fs.writeFileSync(CONFIG.OUTPUT_FILE, outputHeaders.join(',') + '\n');

    for (let i = 0; i < rows.length; i += CONFIG.CONCURRENT_ROWS) {
        const batch = rows.slice(i, i + CONFIG.CONCURRENT_ROWS);
        console.log(`\n🚀 Processing batch ${Math.floor(i / CONFIG.CONCURRENT_ROWS) + 1}/${Math.ceil(rows.length / CONFIG.CONCURRENT_ROWS)}...`);
        
        const results = await Promise.all(batch.map((row, idx) => processRow(row, i + idx + 1)));

        results.forEach(res => {
            if (!res) return;
            const csvRow = outputHeaders.map(h => {
                let val = res[h] || '';
                if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
                    val = `"${val.replace(/"/g, '""')}"`;
                }
                return val;
            }).join(',');
            fs.appendFileSync(CONFIG.OUTPUT_FILE, csvRow + '\n');
        });
    }

    console.log('\n✅ PARALLEL PROCESSING COMPLETE');
}

main().catch(console.error);
