const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { parseOwnerName, extractPRs } = require('./name_parser');
const EnhancedScraper = require('./enhanced_scraper');
const RadarisScraper = require('./radaris_scraper');
const SearchPeopleFreeScraper = require('./searchpeoplefree_scraper');
const { matchProfile } = require('./matcher');
require('dotenv').config();

// Configuration
const CONFIG = {
    INPUT_FILE: './Fresh_Test_Run.csv',
    OUTPUT_FILE: './Data_Tracking_Processed_Enhanced_V2.csv',
    OWNER_NAME_COLUMN: 'Owner Name',
    PROPERTY_ADDRESS_COLUMN: 'Property Address',
    RECORD_TYPE_COLUMN: 'Record Type',
    
    // Processing options
    MAX_PAGES_PER_SEARCH: 3,
    CONFIDENCE_THRESHOLD: 50,
    RATE_LIMIT_MS: 1000,
    
    // Set to true to only process probate records
    PROBATE_ONLY: false, // Process all since we handle APT too
    
    // Set to a number to limit processing (for testing)
    MAX_ROWS: null, // null = process all rows
    
    // Set to true to skip rows that already have contact info
    SKIP_WITH_CONTACT: false // Set to false to rerun with new logic
};

/**
 * Parse city and state from a property address
 */
function parseAddress(address) {
    if (!address) return { city: '', state: '' };
    const cleanAddr = address.replace(/\n/g, ', ').trim();
    
    // Try to parse "City, State ZIP" pattern (standard with comma)
    const match = cleanAddr.match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})?/i);
    if (match) {
        return {
            city: match[1].trim(),
            state: match[2].toUpperCase()
        };
    }
    
    // Fallback: split by comma and take last parts
    const parts = cleanAddr.split(',').map(p => p.trim());
    if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1]; // "WA 98177"
        const secondToLast = parts[parts.length - 2]; // "49 NW Cherry Loop Shoreline"
        
        const stateMatch = lastPart.match(/([A-Z]{2})/i);
        const state = stateMatch ? stateMatch[1].toUpperCase() : 'WA';
        
        // Extract city from second to last part - usually the last word
        const cityParts = secondToLast.split(/\s+/);
        const city = cityParts[cityParts.length - 1];
        
        return { city, state };
    }
    return { city: '', state: 'WA' };
}

/**
 * Main processing function
 */
async function processEnhancedCSV() {
    console.log('='.repeat(60));
    console.log('ENHANCED PROBATE PHONE NUMBER SCRAPER V2');
    console.log('='.repeat(60));
    
    const rows = await readCSV(CONFIG.INPUT_FILE);
    console.log(`📂 Found ${rows.length} total rows`);
    
    const cbcScraper = new EnhancedScraper();
    const radarisScraper = new RadarisScraper();
    const spfScraper = new SearchPeopleFreeScraper();
    
    const inputHeaders = Object.keys(rows[0] || {});
    const outputHeaders = [
        ...inputHeaders,
        'Deceased Name_PARSED',
        'Is Probate',
        'PR 1 Name', 'PR 1 Phone', 'PR 1 All Phones', 'PR 1 Source', 'PR 1 Match Reasoning',
        'PR 2 Name', 'PR 2 Phone', 'PR 2 All Phones', 'PR 2 Source', 'PR 2 Match Reasoning',
        'Notes'
    ];
    
    fs.writeFileSync(CONFIG.OUTPUT_FILE, outputHeaders.join(',') + '\n');
    
    const maxRows = CONFIG.MAX_ROWS || rows.length;
    
    for (let i = 0; i < Math.min(rows.length, maxRows); i++) {
        const row = rows[i];
        const ownerName = row[CONFIG.OWNER_NAME_COLUMN];
        const address = row[CONFIG.PROPERTY_ADDRESS_COLUMN];
        
        if (!ownerName || ownerName.trim() === '') continue;
        
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`📋 Row ${i + 1}/${rows.length}: ${ownerName.substring(0, 50)}...`);
        
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
        
        for (let prIdx = 0; prIdx < Math.min(prList.length, 2); prIdx++) {
            const prName = prList[prIdx];
            const colPrefix = `PR ${prIdx + 1}`;
            outputRow[`${colPrefix} Name`] = prName;
            
            console.log(`   👤 Processing ${colPrefix}: ${prName}`);
            
            try {
                // Strategy 1: Radaris
                console.log(`   🔍 Searching Radaris...`);
                let candidates = await radarisScraper.search(prName, null, state);
                
                // Strategy 2: SearchPeopleFree Fallback if needed
                if (candidates.length === 0) {
                    console.log(`   🔍 Radaris empty. Searching SearchPeopleFree...`);
                    candidates = await spfScraper.search(prName, city, state);
                }

                if (candidates.length === 0) {
                    outputRow[`${colPrefix} Match Reasoning`] = 'No candidates found in scrapers';
                    continue;
                }

                // Initial Match
                let match = await matchProfile(
                    parsed.deceased_name || prName,
                    `${city}, ${state}`,
                    prName,
                    candidates
                );

                // Handle Deceased or Mismatched candidates
                if (match.bestMatchIndex !== -1) {
                    let best = candidates[match.bestMatchIndex];
                    
                    // Fetch full profile to check for deceased status if not already fetched
                    if (best.source === 'Radaris' && !best.allPhones) {
                        const profile = await radarisScraper.getProfile(best.detailLink);
                        if (profile) best = { ...best, ...profile };
                    } else if (best.source === 'SearchPeopleFree' && !best.allPhones) {
                        const profile = await spfScraper.getProfile(best.detailLink);
                        if (profile) best = { ...best, ...profile };
                    }

                    // If deceased, try ignoring this candidate and matching again
                    if (best && best.isDeceased) {
                        console.log(`   ⚠️  Matched candidate ${best.fullName} is deceased. Retrying match...`);
                        candidates.splice(match.bestMatchIndex, 1);
                        if (candidates.length > 0) {
                            match = await matchProfile(
                                parsed.deceased_name || prName,
                                `${city}, ${state}`,
                                prName,
                                candidates
                            );
                            if (match.bestMatchIndex !== -1) {
                                best = candidates[match.bestMatchIndex];
                                // Fetch profile for new best candidate
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
                            outputRow[`${colPrefix} Phone`] = phoneList[0];
                            outputRow[`${colPrefix} All Phones`] = phoneList.join(' | ');
                            outputRow[`${colPrefix} Source`] = best.source;
                            outputRow[`${colPrefix} Match Reasoning`] = match.reasoning;
                            console.log(`   ✅ FOUND: ${phoneList[0]} (${best.source})`);
                        } else {
                            outputRow[`${colPrefix} Match Reasoning`] = 'Match found but no phones';
                        }
                    } else {
                        outputRow[`${colPrefix} Match Reasoning`] = best?.isDeceased ? 'Best match was deceased' : (match.reasoning || 'No high-confidence match');
                    }
                } else {
                    outputRow[`${colPrefix} Match Reasoning`] = match.reasoning || 'No high-confidence match';
                }
            } catch (error) {
                console.error(`   💥 Error processing PR: ${error.message}`);
                outputRow[`${colPrefix} Match Reasoning`] = `Error: ${error.message}`;
            }
            
            await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_MS));
        }
        
        writeRow(CONFIG.OUTPUT_FILE, outputHeaders, outputRow);
    }
    console.log('\n✅ PROCESSING COMPLETE');
}

function readCSV(filepath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        if (!fs.existsSync(filepath)) return resolve([]);
        fs.createReadStream(filepath).pipe(csv()).on('data', row => rows.push(row)).on('end', () => resolve(rows)).on('error', reject);
    });
}

function writeRow(filepath, headers, rowData) {
    const csvRow = headers.map(header => {
        let val = rowData[header] || '';
        if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
            val = `"${val.replace(/"/g, '""')}"`;
        }
        return val;
    }).join(',');
    fs.appendFileSync(filepath, csvRow + '\n');
}

processEnhancedCSV().catch(console.error);
