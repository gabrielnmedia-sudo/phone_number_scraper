/**
 * PARALLEL CSV Processor - 5x faster with concurrent requests
 */

const fs = require('fs');
const csv = require('csv-parser');
const { parseOwnerName, extractPRs } = require('./name_parser');
const RadarisScraper = require('./radaris_scraper');
const { matchProfile } = require('./matcher');
require('dotenv').config();

// Configuration
const CONFIG = {
    INPUT_FILE: './test run - Sheet1.csv',
    OUTPUT_FILE: './test_run_results_v2.csv',
    CONCURRENT_REQUESTS: 40, // Max speed for BrightData
    CONFIDENCE_THRESHOLD: 40,
    MAX_CANDIDATES_TO_CHECK: 5, // Check top 5 profiles (with smart sorting)
};

/**
 * Parse city and state from a property address
 */
function parseAddress(address) {
    if (!address) return { city: '', state: 'WA' };
    
    // Handle multi-line addresses (some have newlines)
    const cleanAddr = address.replace(/\n/g, ', ').trim();
    
    // Try to parse "City, State ZIP" pattern
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
        const lastPart = parts[parts.length - 1];
        const stateMatch = lastPart.match(/([A-Z]{2})/i);
        const city = parts[parts.length - 2] || '';
        return {
            city: city,
            state: stateMatch ? stateMatch[1].toUpperCase() : 'WA'
        };
    }
    
    return { city: '', state: 'WA' }; // Default to WA
}

// Process a single row
async function processRow(row, scraper, rowIndex) {
    const ownerName = row['Owner Name'];
    const address = row['Property Address'];
    const existingContact = row['Contact Info'];
    
    const result = {
        ...row,
        'Deceased Name_PARSED': '',
        'PR Name_PARSED': '',
        'Is Probate': 'No',
        'PR Phone_FOUND': '',
        'All Phones': '',
        'Match Confidence': '',
        'Match Reasoning': '',
        'Source': '',
        'Detail URL': '',
        'Needs Manual Skiptrace': '', // Flag for WhitePages/manual lookup
        '_rowIndex': rowIndex
    };
    
    if (!ownerName || ownerName.trim() === '') {
        return null;
    }
    
    const parsed = parseOwnerName(ownerName);
    result['Deceased Name_PARSED'] = parsed.deceased_name || '';
    result['PR Name_PARSED'] = parsed.pr_name || '';
    result['Is Probate'] = parsed.is_probate ? 'Yes' : 'No';
    
    // Skip non-probate
    if (!parsed.is_probate) {
        return null; // Don't include in output
    }
    
    // Skip if no PR name
    if (!parsed.pr_name || parsed.pr_name === 'Unknown') {
        result['Match Reasoning'] = 'No PR name found';
        return result;
    }
    
    const { city, state } = parseAddress(address);
    
    // OPTIMIZATION 1: Extract all PR names (handles compound names like "Person A & Person B")
    let prNames = extractPRs(parsed.pr_name);
    if (prNames.length === 0) {
        prNames.push(parsed.pr_name); // Fallback to original
    }
    
    // OPTIMIZATION 4: Detect inverted names (LASTNAME FIRSTNAME) and add corrected version
    // If first word matches deceased's last name, it's likely inverted
    const deceasedLastName = parsed.deceased_name ? 
        parsed.deceased_name.split(/\s+/).pop().toLowerCase() : '';
    
    const expandedPRNames = [];
    for (const prName of prNames) {
        expandedPRNames.push(prName); // Keep original
        
        const parts = prName.split(/\s+/);
        if (parts.length >= 2) {
            const firstWord = parts[0].toLowerCase();
            // If first word matches deceased's last name or looks like a surname (all caps, ends with common patterns)
            if (firstWord === deceasedLastName || 
                (parts[0] === parts[0].toUpperCase() && parts.length >= 2)) {
                // Try inverted: move first word to end
                const inverted = [...parts.slice(1), parts[0]].join(' ');
                if (!expandedPRNames.includes(inverted)) {
                    expandedPRNames.push(inverted);
                    console.log(`[${rowIndex}] 🔄 Added inverted name: ${inverted}`);
                }
            }
        }
    }
    
    // OPTIMIZATION 5: Add common nickname variations
    const nicknames = {
        'robert': ['bob', 'rob'], 'william': ['bill', 'will'], 'richard': ['rick', 'dick'],
        'james': ['jim', 'jimmy'], 'joseph': ['joe', 'joey'], 'michael': ['mike'],
        'thomas': ['tom', 'tommy'], 'christopher': ['chris'], 'daniel': ['dan', 'danny'],
        'stephen': ['steve'], 'steven': ['steve'], 'kathleen': ['kathy', 'kate'],
        'elizabeth': ['liz', 'beth', 'betty'], 'margaret': ['maggie', 'peggy'],
        'jennifer': ['jenny', 'jen'], 'patricia': ['pat', 'patty'], 'barbara': ['barb'],
        'jessica': ['jess'], 'nancy': ['nan'], 'diane': ['di']
    };
    
    const finalPRNames = [...expandedPRNames];
    
    // OPTIMIZATION 7: Handle Hyphenated Names and Middle Initials
    for (const prName of expandedPRNames) {
        // Handle Hyphenated Names: "Smith-Jones" -> "Smith Jones", "Smith", "Jones"
        if (prName.includes('-')) {
            const spaceSep = prName.replace(/-/g, ' ');
            if (!finalPRNames.includes(spaceSep)) finalPRNames.push(spaceSep);
            
            const parts = prName.split(/[-\s]+/);
            if (parts.length > 1) {
                // Try searching just the last part (often the primary surname)
                const lastPart = parts[parts.length - 1]; 
                 // Only if it looks like a real name (len > 2)
                if (lastPart.length > 2 && !finalPRNames.some(n => n.includes(lastPart) && n.length < prName.length)) {
                     // Construct First + Last Part (e.g. "Mary Smith-Jones" -> "Mary Jones")
                     const first = parts[0];
                     if (first.length > 2) {
                         const simplified = `${first} ${lastPart}`;
                         if (!finalPRNames.includes(simplified)) {
                             finalPRNames.push(simplified);
                             console.log(`[${rowIndex}] 🔄 Added simplified hyphen name: ${simplified}`);
                         }
                     }
                }
            }
        }
        
        // Handle Middle Initials: "Heather K Van Nuys" -> "Heather Van Nuys"
        const parts = prName.split(/\s+/);
        if (parts.length > 2) {
            // Check if second part is a single letter (or single letter + dot)
            const secondPart = parts[1].replace('.', '');
            if (secondPart.length === 1) {
                const noMiddle = [parts[0], ...parts.slice(2)].join(' ');
                if (!finalPRNames.includes(noMiddle)) {
                    finalPRNames.push(noMiddle);
                    console.log(`[${rowIndex}] 🔄 Added no-middle-initial variation: ${noMiddle}`);
                }
            }
        }
    }

    for (const prName of expandedPRNames) {
        const parts = prName.toLowerCase().split(/\s+/);
        const firstName = parts[0];
        if (nicknames[firstName]) {
            for (const nick of nicknames[firstName]) {
                const nickName = [nick.charAt(0).toUpperCase() + nick.slice(1), ...parts.slice(1)].join(' ');
                if (!finalPRNames.some(n => n.toLowerCase() === nickName.toLowerCase())) {
                    finalPRNames.push(nickName);
                }
            }
        }
    }
    
    console.log(`[${rowIndex}] 🔍 Searching ${finalPRNames.length} PR variation(s): ${finalPRNames.slice(0,3).join(', ')}${finalPRNames.length > 3 ? '...' : ''} (${city}, ${state})`);
    
    // Helper function to search and match a name
    async function searchAndMatch(searchName, isReverseLookup = false) {
        const candidates = await scraper.search(searchName, '', state);
        if (candidates.length === 0) return null;
        
        // Extract middle initial/name from the original search name for prioritization
        const searchParts = searchName.toUpperCase().split(/\s+/);
        const middleInitial = searchParts.length >= 3 ? searchParts[1][0] : null; // Second word's first letter
        
        // Sort candidates: prioritize those with matching middle initial
        if (middleInitial) {
            candidates.sort((a, b) => {
                const aName = (a.fullName || '').toUpperCase();
                const bName = (b.fullName || '').toUpperCase();
                const aHasMiddle = aName.includes(` ${middleInitial} `) || aName.includes(` ${middleInitial}.`);
                const bHasMiddle = bName.includes(` ${middleInitial} `) || bName.includes(` ${middleInitial}.`);
                if (aHasMiddle && !bHasMiddle) return -1;
                if (!aHasMiddle && bHasMiddle) return 1;
                return 0;
            });
        }
        
        // Fetch profiles for top candidates
        const detailedCandidates = [];
        for (let i = 0; i < Math.min(candidates.length, CONFIG.MAX_CANDIDATES_TO_CHECK); i++) {
            const candidate = candidates[i];
            const details = await scraper.getProfile(candidate.detailLink);
            if (details) {
                // OPTIMIZATION: Smart Early Exit
                // Check if this single candidate is an excellent match immediately to save API calls
                const tempCandidate = { ...candidate, ...details };
                const tempMatch = await matchProfile(
                    parsed.deceased_name,
                    `${city}, ${state}`,
                    searchName,
                    [tempCandidate]
                );
                
                // If we found a high confidence match (90%+), STOP here and return it!
                // This saves fetching the other 4 profiles (80% cost reduction for easy hits)
                if (tempMatch.confidence >= 90) {
                     const phoneList = (tempCandidate.allPhones || []).filter(p => p && p.length >= 10);
                     if (phoneList.length > 0) {
                         console.log(`[${rowIndex}] ⚡ Smart Exit: Found 90%+ match on candidate ${i+1}/${candidates.length}. Stopping early.`);
                         return { best: tempCandidate, phoneList, match: tempMatch, isReverseLookup };
                     }
                }
                
                detailedCandidates.push(tempCandidate);
            }
        }
        if (detailedCandidates.length === 0) return null;
        
        const match = await matchProfile(
            parsed.deceased_name,
            `${city}, ${state}`,
            searchName,
            detailedCandidates
        );
        
        if (match.bestMatchIndex !== -1 && match.confidence >= CONFIG.CONFIDENCE_THRESHOLD) {
            const best = detailedCandidates[match.bestMatchIndex];
            const phoneList = (best.allPhones || []).filter(p => p && p.length >= 10);
            if (phoneList.length > 0) {
                return { best, phoneList, match, isReverseLookup };
            }
        }
        return null;
    }
    
    // Helper function for nationwide search (no state filter)
    async function searchAndMatchNationwide(searchName) {
        const candidates = await scraper.search(searchName, '', ''); // Empty state = nationwide
        if (candidates.length === 0) return null;
        
        // Extract middle initial for prioritization (same as regular search)
        const searchParts = searchName.toUpperCase().split(/\s+/);
        const middleInitial = searchParts.length >= 3 ? searchParts[1][0] : null;
        
        if (middleInitial) {
            candidates.sort((a, b) => {
                const aName = (a.fullName || '').toUpperCase();
                const bName = (b.fullName || '').toUpperCase();
                const aHasMiddle = aName.includes(` ${middleInitial} `) || aName.includes(` ${middleInitial}.`);
                const bHasMiddle = bName.includes(` ${middleInitial} `) || bName.includes(` ${middleInitial}.`);
                if (aHasMiddle && !bHasMiddle) return -1;
                if (!aHasMiddle && bHasMiddle) return 1;
                return 0;
            });
        }
        
        const detailedCandidates = [];
        for (let i = 0; i < Math.min(candidates.length, CONFIG.MAX_CANDIDATES_TO_CHECK); i++) {
            const candidate = candidates[i];
            const details = await scraper.getProfile(candidate.detailLink);
            if (details) {
                detailedCandidates.push({ ...candidate, ...details });
            }
        }
        if (detailedCandidates.length === 0) return null;
        
        // For nationwide, require higher confidence (50%) since we lost location validation
        const match = await matchProfile(
            parsed.deceased_name,
            `${city}, ${state}`,
            searchName,
            detailedCandidates
        );
        
        if (match.bestMatchIndex !== -1 && match.confidence >= 50) {
            const best = detailedCandidates[match.bestMatchIndex];
            const phoneList = (best.allPhones || []).filter(p => p && p.length >= 10);
            if (phoneList.length > 0) {
                return { best, phoneList, match };
            }
        }
        return null;
    }
    
    try {
        // OPTIMIZATION 2: Try each PR name variation in sequence
        for (const prName of finalPRNames) {
            const searchResult = await searchAndMatch(prName);
            if (searchResult) {
                result['PR Phone_FOUND'] = searchResult.phoneList[0];
                result['All Phones'] = searchResult.phoneList.join(' | ');
                result['Match Confidence'] = searchResult.match.confidence;
                result['Match Reasoning'] = searchResult.match.reasoning;
                result['Source'] = 'Radaris';
                result['Detail URL'] = searchResult.best.url || searchResult.best.detailLink;
                console.log(`[${rowIndex}] ✅ ${searchResult.best.fullName} - ${searchResult.phoneList.length} phones (${searchResult.match.confidence}%)`);
                return result;
            }
        }
        
        // OPTIMIZATION 3: Reverse lookup via deceased profile
        if (parsed.deceased_name) {
            console.log(`[${rowIndex}] 🔄 Reverse lookup: searching for deceased ${parsed.deceased_name}`);
            const deceasedCandidates = await scraper.search(parsed.deceased_name, '', state);
            
            if (deceasedCandidates.length > 0) {
                // Fetch deceased profile to get relatives
                const deceasedProfile = await scraper.getProfile(deceasedCandidates[0].detailLink);
                
                if (deceasedProfile && deceasedProfile.allRelatives) {
                    // Helper: extract first and last name for fuzzy matching
                    const getFirstLast = (name) => {
                        const parts = name.toLowerCase().trim().split(/\s+/).filter(p => p.length > 1);
                        if (parts.length === 0) return { first: '', last: '' };
                        return { first: parts[0], last: parts[parts.length - 1] };
                    };
                    
                    // Find a relative that matches any PR name variation (fuzzy: first + last only)
                    for (const prName of finalPRNames) {
                        const pr = getFirstLast(prName);
                        
                        for (const relative of deceasedProfile.allRelatives) {
                            const relName = relative.name || relative;
                            const rel = getFirstLast(relName);
                            
                            // Fuzzy match: first name starts with same letters OR matches, AND last name matches
                            const firstMatches = pr.first === rel.first || 
                                                 pr.first.startsWith(rel.first) || 
                                                 rel.first.startsWith(pr.first);
                            const lastMatches = pr.last === rel.last;
                            
                            if (firstMatches && lastMatches && relative.url) {
                                console.log(`[${rowIndex}] 🎯 Found PR in relatives: ${relName} (fuzzy match for ${prName})`);
                                const relativeProfile = await scraper.getProfile(relative.url);
                                
                                if (relativeProfile) {
                                    const phoneList = (relativeProfile.allPhones || []).filter(p => p && p.length >= 10);
                                    if (phoneList.length > 0) {
                                        result['PR Phone_FOUND'] = phoneList[0];
                                        result['All Phones'] = phoneList.join(' | ');
                                        result['Match Confidence'] = 85; // Reverse lookup confidence
                                        result['Match Reasoning'] = `Found via reverse lookup: ${relName} in deceased's relatives`;
                                        result['Source'] = 'Radaris (Reverse)';
                                        result['Detail URL'] = relative.url;
                                        console.log(`[${rowIndex}] ✅ Reverse hit: ${relName} - ${phoneList.length} phones`);
                                        return result;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // OPTIMIZATION 6: Nationwide search fallback (remove state restriction)
        console.log(`[${rowIndex}] 🌎 Trying nationwide search...`);
        for (const prName of finalPRNames.slice(0, 5)) { // Try top 5 variations nationwide
            const nationwideResult = await searchAndMatchNationwide(prName);
            if (nationwideResult) {
                result['PR Phone_FOUND'] = nationwideResult.phoneList[0];
                result['All Phones'] = nationwideResult.phoneList.join(' | ');
                result['Match Confidence'] = nationwideResult.match.confidence;
                result['Match Reasoning'] = nationwideResult.match.reasoning + ' (nationwide search)';
                result['Source'] = 'Radaris (Nationwide)';
                result['Detail URL'] = nationwideResult.best.url || nationwideResult.best.detailLink;
                console.log(`[${rowIndex}] ✅ Nationwide hit: ${nationwideResult.best.fullName} - ${nationwideResult.phoneList.length} phones`);
                return result;
            }
        }
        
        // No match found after all attempts - flag for manual skip tracing
        result['Match Reasoning'] = 'No match found - recommend WhitePages or manual skiptrace';
        result['Needs Manual Skiptrace'] = 'YES';
        console.log(`[${rowIndex}] ⚠️ Flagged for manual skiptrace`);
        
    } catch (error) {
        result['Match Reasoning'] = `Error: ${error.message}`;
        console.log(`[${rowIndex}] 💥 Error: ${error.message}`);
    }
    
    return result;
}


// Process batch of rows concurrently
async function processBatch(rows, scraper, startIndex) {
    const promises = rows.map((row, i) => processRow(row, scraper, startIndex + i));
    return Promise.all(promises);
}

async function main() {
    console.log('='.repeat(60));
    console.log('PARALLEL PROBATE PHONE SCRAPER (5x FASTER)');
    console.log('='.repeat(60));
    
    // Read CSV
    const rows = [];
    await new Promise((resolve, reject) => {
        fs.createReadStream(CONFIG.INPUT_FILE)
            .pipe(csv())
            .on('data', row => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
    });
    
    console.log(`📂 Loaded ${rows.length} rows`);
    console.log(`⚡ Processing ${CONFIG.CONCURRENT_REQUESTS} at a time\n`);
    
    const scraper = new RadarisScraper();
    const inputHeaders = Object.keys(rows[0] || {});
    const outputHeaders = [
        ...inputHeaders,
        'Deceased Name_PARSED', 'PR Name_PARSED', 'Is Probate',
        'PR Phone_FOUND', 'All Phones', 'Match Confidence',
        'Match Reasoning', 'Source', 'Detail URL', 'Needs Manual Skiptrace'
    ];
    
    fs.writeFileSync(CONFIG.OUTPUT_FILE, outputHeaders.join(',') + '\n');
    
    let stats = { total: 0, found: 0, noMatch: 0, skipped: 0 };
    
    // Process in batches
    // For testing: find the first 100 searchable probate rows (even if they have contact)
    const probateRows = rows.filter(r => {
        const parsed = parseOwnerName(r['Owner Name'] || '');
        return parsed.is_probate;
    });

    console.log(`🔎 Found ${probateRows.length} probate rows for testing`);
    const testRows = probateRows; // Process all probate records
    
    for (let i = 0; i < testRows.length; i += CONFIG.CONCURRENT_REQUESTS) {
        const batch = testRows.slice(i, i + CONFIG.CONCURRENT_REQUESTS);
        const results = await processBatch(batch, scraper, i + 1);
        
        for (const result of results) {
            if (result === null) continue; // Skip non-probate
            
            stats.total++;
            if (result['PR Phone_FOUND']) stats.found++;
            else if (result['Match Reasoning'] === 'Already has contact info') stats.skipped++;
            else stats.noMatch++;
            
            // Write row
            const csvRow = outputHeaders.map(h => {
                let val = result[h] || '';
                if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
                    val = `"${val.replace(/"/g, '""')}"`;
                }
                return val;
            }).join(',');
            fs.appendFileSync(CONFIG.OUTPUT_FILE, csvRow + '\n');
        }
        
        console.log(`\n📊 Progress: ${Math.min(i + CONFIG.CONCURRENT_REQUESTS, rows.length)}/${rows.length} | Found: ${stats.found} | Skipped: ${stats.skipped}\n`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('COMPLETE!');
    console.log(`Found phones: ${stats.found}`);
    console.log(`Skipped (has contact): ${stats.skipped}`);
    console.log(`No match: ${stats.noMatch}`);
    console.log(`Output: ${CONFIG.OUTPUT_FILE}`);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
