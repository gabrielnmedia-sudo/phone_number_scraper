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
    OUTPUT_FILE: './Data_Tracking_Processed_Universal_V8.csv',
    CONCURRENT_ROWS: 35, 
    CONFIDENCE_THRESHOLD_PERFECT: 85, // Skip Tier 2 if we hit this
    CONFIDENCE_THRESHOLD_STRONG: 70, 
    CONFIDENCE_THRESHOLD_MEDIUM: 40, 
};

const radaris = new RadarisScraper();
const spf = new SearchPeopleFreeScraper();
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
 * Universal V8 Strategy: Integrated Deep Search
 */
async function tieredSearchPR(prName, deceasedName, city, state, rowIndex) {
    const targetInfo = `${city || ''} ${state || ''}`.trim();
    let result = { name: prName, phone: '', allPhones: '', source: 'None', reasoning: 'Not searched', found: false, confidence: 0 };
    
    if (!prName || prName === 'Unknown') return result;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            if (attempt > 1) console.log(`[Row ${rowIndex}] 🔄 Retry Attempt ${attempt} for '${prName}'...`);
            
            let pool = [];
            let bestMatch = null;

            console.log(`[Row ${rowIndex}] 🏎️  Tier 1 Race (Radaris WA + CBC WA) for '${prName}' in ${city}, ${state}...`);
            
            // --- TIER 1: Local Speed Race ---
            const [candidatesWA, candidatesCBC] = await Promise.all([
                radaris.search(prName, null, state, { maxPages: 1 }),
                enhanced.searchCBCWithPagination(prName, city, state, { maxPages: 1 })
            ]);

            pool = [...candidatesWA, ...candidatesCBC];
            console.log(`[Row ${rowIndex}] Tier 1 Pool: ${pool.length} candidates.`);

            if (pool.length > 0) {
                bestMatch = await matchProfile(deceasedName || prName, targetInfo, prName, pool);
                console.log(`[Row ${rowIndex}] Tier 1 AI Match: Index ${bestMatch?.bestMatchIndex}, Confidence ${bestMatch?.confidence}`);
                
                // EARLY EXIT: High Confidence
                if (bestMatch && bestMatch.bestMatchIndex !== -1 && bestMatch.confidence >= CONFIG.CONFIDENCE_THRESHOLD_PERFECT) {
                    const best = pool[bestMatch.bestMatchIndex];
                    const phones = (best.visiblePhones || best.phones || []).filter(p => p && p.length >= 10);
                    if (phones.length > 0) {
                        return { 
                            ...result, 
                            phone: phones[0], 
                            allPhones: phones.join(' | '), 
                            source: `${best.source} (Tier 1 Speed)`, 
                            confidence: bestMatch.confidence,
                            reasoning: bestMatch.reasoning, 
                            found: true 
                        };
                    }
                }
            }

            // --- TIER 2: Deep Search Fallback ---
            console.log(`[Row ${rowIndex}] 🌊 Tier 2 Deep Search (Nationwide + TPS + Google)...`);
            
            try {
                 // Tier 2: Radaris NW, TPS, and Google
                 const googleQuery = `${prName} ${deceasedName} WA`;
                 const [candidatesUS, candidatesTPS, googleItems] = await Promise.all([
                    radaris.search(prName, null, "US", { maxPages: 1 }), // Radaris Nationwide
                    enhanced.searchTPSWithPagination(prName, city, state, { maxPages: 1 }).catch(e => []), // TPS WA
                    google.searchBroad(googleQuery).catch(e => []) // Google Broad Search Fallback
                ]);
                
                // Process Google Results: Extract Radaris/CBC/TPS/Clustrmaps/PeekYou links
                const googleCandidates = [];
                if (googleItems && googleItems.length > 0) {
                     googleItems.forEach(item => {
                         const isScrapable = item.link.includes('radaris.com') || item.link.includes('cyberbackgroundchecks.com') || item.link.includes('truepeoplesearch.com');
                         const isInfoSource = item.link.includes('clustrmaps.com') || item.link.includes('peekyou.com') || item.link.includes('fastpeoplesearch.com') || item.link.includes('peoplesearchnow.com');
                         
                         if (isScrapable || isInfoSource) {
                             // Extract phones directly from snippet if present
                             const snippetPhones = (item.snippet.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || []);
                             
                             googleCandidates.push({
                                 fullName: item.title.split(' | ')[0].split(' - ')[0],
                                 age: 'Unknown',
                                 location: 'Unknown',
                                 livesIn: 'Unknown',
                                 relatives: [], 
                                 phones: snippetPhones,
                                 detailLink: item.link,
                                 source: isScrapable ? (item.link.includes('radaris') ? 'Radaris' : (item.link.includes('cyber') ? 'CBC' : 'TPS')) : 'Google',
                                 snippet: item.snippet
                             });
                         }
                     });
                }

                // Add new candidates to pool
                const previousCount = pool.length;
                pool = [...pool, ...candidatesUS, ...candidatesTPS, ...googleCandidates];
                console.log(`[Row ${rowIndex}] Tier 2 Pool expanded: ${previousCount} -> ${pool.length} candidates.`);
                
                if (pool.length > previousCount) {
                    // Rerun AI Match on expanded pool
                    bestMatch = await matchProfile(deceasedName || prName, targetInfo, prName, pool);
                    console.log(`[Row ${rowIndex}] Tier 2 AI Match: Index ${bestMatch?.bestMatchIndex}, Confidence ${bestMatch?.confidence}`);
                }

            } catch (tier2Err) {
                console.log(`[Row ${rowIndex}] Tier 2 Error: ${tier2Err.message}`);
            }

            // Final Result Processing
            if (bestMatch && bestMatch.bestMatchIndex !== -1 && bestMatch.confidence >= CONFIG.CONFIDENCE_THRESHOLD_MEDIUM) {
                 const best = pool[bestMatch.bestMatchIndex];
                 let phones = (best.visiblePhones || best.phones || []).filter(p => p && p.length >= 10); 

                 // Fetch Deep Details if needed
                 if (phones.length === 0 && best.detailLink && best.source !== 'Google') {
                    try {
                        let profile;
                        if (best.source === 'Radaris') profile = await radaris.getProfile(best.detailLink);
                        else if (best.source === 'CBC' || best.source === 'TPS') profile = await enhanced.getDetailsCBC(best.detailLink);
                        else if (best.source === 'SearchPeopleFree') {
                            const sProf = await spf.getProfile(best.detailLink);
                            if (sProf) phones = sProf.phones;
                        }
                        
                        if (profile) phones = (profile.allPhones || profile.phones || []).filter(p => p && p.length >= 10);

                    } catch (e) { console.log(`[Row ${rowIndex}] Detail fetch error: ${e.message}`); }
                 }

                 if (phones.length > 0) {
                      return { 
                        ...result, 
                        phone: phones[0], 
                        allPhones: phones.join(' | '), 
                        source: `${best.source} (Tier 2 Deep)`, 
                        confidence: bestMatch.confidence,
                        reasoning: bestMatch.reasoning, 
                        found: true 
                    };
                 }
            }

            // TIER 3: Greedy Fallback
            if (pool.length > 0 && bestMatch && bestMatch.bestMatchIndex !== -1 && bestMatch.confidence > 25) {
                 const best = pool[bestMatch.bestMatchIndex];
                 const phones = (best.visiblePhones || best.phones || []).filter(p => p && p.length >= 10);
                 if (phones.length > 0) {
                     return { ...result, phone: phones[0], allPhones: phones.join(' | '), source: `${best.source} (Greedy)`, confidence: bestMatch.confidence, reasoning: "Best match available with contact info.", found: true };
                 }
            }

            result.reasoning = 'Exhausted all sources (Tier 1 + Tier 2) without result.';
            // If we are on attempt 1 and failed, maybe continue to attempt 2. 
            // Only retry if we truly found nothing or hit an error.
            if (attempt === 2) return result;

        } catch (error) {
            console.error(`[Row ${rowIndex}] Attempt ${attempt} Error: ${error.message}`);
            if (attempt === 2) {
                result.reasoning = `Error: ${error.message}`;
                return result;
            }
            await new Promise(r => setTimeout(r, 2000)); // Cool off
        }
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
    const prTasks = prList.slice(0, 3).map((name, idx) => tieredSearchPR(name, parsed.deceased_name, city, state, rowIndex));
    const prResults = await Promise.all(prTasks);

    prResults.forEach((res, idx) => {
        const p = `PR ${idx + 1}`;
        outputRow[`${p} Name`] = res.name;
        outputRow[`${p} Phone`] = res.phone;
        outputRow[`${p} All Phones`] = res.allPhones;
        outputRow[`${p} Source`] = res.source;
        outputRow[`${p} Match Confidence`] = res.confidence || 0;
        outputRow[`${p} Match Reasoning`] = res.reasoning;
    });

    return outputRow;
}

async function main() {
    console.log('='.repeat(60));
    console.log('UNIVERSAL SCRAPER V8: INTEGRATED DEEP SEARCH (PRODUCTION READY)');
    console.log('='.repeat(60));

    const rows = [];
    if (!fs.existsSync(CONFIG.INPUT_FILE)) { console.error('Input file missing'); return; }

    await new Promise((res, rej) => fs.createReadStream(CONFIG.INPUT_FILE).pipe(csv()).on('data', r => rows.push(r)).on('end', res).on('error', rej));

    if (rows.length === 0) { console.error('No rows to process'); return; }

    const outputHeaders = [...Object.keys(rows[0]), 'Deceased Name_PARSED', 'Is Probate', 'PR 1 Name', 'PR 1 Phone', 'PR 1 All Phones', 'PR 1 Source', 'PR 1 Match Confidence', 'PR 1 Match Reasoning', 'PR 2 Name', 'PR 2 Phone', 'PR 2 All Phones', 'PR 2 Source', 'PR 2 Match Confidence', 'PR 2 Match Reasoning', 'Notes'];
    fs.writeFileSync(CONFIG.OUTPUT_FILE, outputHeaders.join(',') + '\n');
    
    let activeCount = 0;
    let completedCount = 0;
    let currentIndex = 0;
    const total = rows.length;

    // Helper to write row immediately
    const writeRow = (res) => {
        if (!res) return;
        const csvRow = outputHeaders.map(h => {
                let v = res[h] || '';
                if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) v = `"${v.replace(/"/g, '""')}"`;
                return v;
        }).join(',');
        fs.appendFileSync(CONFIG.OUTPUT_FILE, csvRow + '\n');
    };

    return new Promise((resolve) => {
        const next = async () => {
            if (currentIndex >= total && activeCount === 0) {
                console.log('\n✅ V8 PROCESSING COMPLETE');
                resolve();
                return;
            }

            while (currentIndex < total && activeCount < CONFIG.CONCURRENT_ROWS) {
                const idx = currentIndex++;
                const row = rows[idx];
                activeCount++;
                
                // Process async
                processRow(row, idx + 1).then(res => {
                    activeCount--;
                    completedCount++;
                    writeRow(res);
                    console.log(`Progress: ${completedCount}/${total} (${Math.round(completedCount/total*100)}%) | Active: ${activeCount}`);
                    next(); // Trigger next
                }).catch(e => {
                    activeCount--;
                    completedCount++;
                    console.error(`\nRow ${idx+1} Error: ${e.message}`);
                    next();
                });
            }
        };

        // Start initial batch
        next();
    });
}

main().catch(console.error);
