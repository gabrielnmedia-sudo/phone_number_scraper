const fs = require('fs');
const csv = require('csv-parser');
const { parseOwnerName, extractPRs } = require('./name_parser');
const RadarisScraper = require('./radaris_scraper');
const SearchPeopleFreeScraper = require('./searchpeoplefree_scraper');
const EnhancedScraper = require('./enhanced_scraper');
const GoogleHelper = require('./google_helper');
const { twoPhaseWhitePages } = require('./whitepages_two_phase');
const { matchProfile } = require('./matcher');
require('dotenv').config();

// Configuration
const CONFIG = {
    INPUT_FILE: './Fresh_Test_Run.csv',
    OUTPUT_FILE: './Data_Tracking_Processed_Universal_V11.csv',
    CONCURRENT_ROWS: 20, // Mach 1 Speed for V11.7
    MAX_DEEP_FETCHES: 2, // V11.7 Cost-Cutter: Limit expensive profile fetches
    CONFIDENCE_THRESHOLD_PERFECT: 85, 
    CONFIDENCE_THRESHOLD_STRONG: 70, 
    CONFIDENCE_THRESHOLD_MEDIUM: 40, 
};

const radaris = new RadarisScraper();
const spf = new SearchPeopleFreeScraper();
const enhanced = new EnhancedScraper();
const google = new GoogleHelper();

// V11.7 Cost-Cutter: In-memory profile cache to avoid duplicate fetches
const profileCache = new Map();

async function cachedProfileFetch(url, source) {
    if (profileCache.has(url)) return profileCache.get(url);
    let profile = null;
    try {
        if (source === 'Radaris') profile = await radaris.getProfile(url);
        else if (source === 'CBC') profile = await enhanced.getDetailsCBC(url);
        else if (source === 'TPS') profile = await enhanced.getDetailsTPS(url);
    } catch (e) {}
    profileCache.set(url, profile);
    return profile;
}

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
 * Universal V11 Strategy: The Retentionist
 */
async function tieredSearchPR(prName, deceasedName, city, state, rowIndex) {
    const targetInfo = `${city || ''} ${state || ''}`.trim();
    let result = { name: prName, phone: '', allPhones: '', source: 'None', reasoning: 'Not searched', found: false, confidence: 0 };
    
    if (!prName || prName === 'Unknown') return result;

    const variations = [prName];
    const parts = prName.split(/\s+/);
    if (parts.length > 2) {
        variations.push(`${parts[0]} ${parts[parts.length-1]}`); // First Last
    }
    // V11.7: Handle hyphenated surnames (e.g., "ERIC BLADINE-GLOMBECKI" -> "ERIC GLOMBECKI", "ERIC BLADINE")
    const lastName = parts[parts.length - 1];
    if (lastName.includes('-')) {
        const hyphenParts = lastName.split('-');
        hyphenParts.forEach(hp => {
            if (hp.length > 2) variations.push(`${parts[0]} ${hp}`);
        });
    }

    let masterPool = [];

    // --- TIER 1: HIGH CONCURRENCY POOLING ---
    console.log(`[Row ${rowIndex}] 🏎️  Apex Pooling: ${prName}...`);
    
    const searches = variations.flatMap(v => [
        radaris.search(v, null, state, { maxPages: 1 }).catch(e => []),
        enhanced.searchCBCWithPagination(v, city, state, { maxPages: 1 }).catch(e => [])
    ]);

    const tier1Results = await Promise.all(searches);
    masterPool = tier1Results.flat();

    // OPTIMIZATION: Check for "Perfect Match" in Tier 1 to skip Tier 2
    const hasPerfect = masterPool.length > 0 && masterPool.some(c => 
        c.fullName.toLowerCase() === prName.toLowerCase() && 
        c.location && c.location.toLowerCase().includes(city.toLowerCase())
    );
    
    if (hasPerfect) {
        console.log(`[Row ${rowIndex}] ⚡ Perfect Tier 1 match found. Speed-bypassing Tier 2.`);
    } else {
        // --- TIER 2: BROADEN (runs even if Tier 1 is empty) ---
        const googleQuery = `"${prName}" "${deceasedName}" WA`;
        const [cUS, cTPS, googleItems] = await Promise.all([
           radaris.search(prName, null, "US", { maxPages: 1 }).catch(e => []),
           enhanced.searchTPSWithPagination(prName, city, state, { maxPages: 1 }).catch(e => []),
           google.searchBroad(googleQuery).catch(e => [])
       ]);

       const googleCandidates = googleItems.map(item => {
           const snippetPhones = (item.snippet.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || []);
           return { fullName: item.title.split(' | ')[0].split(' - ')[0], phones: snippetPhones, detailLink: item.link, source: 'Google', snippet: item.snippet, relatives: [] };
       }).filter(c => c.phones.length > 0 || c.detailLink.includes('radaris.com'));

       masterPool = [...masterPool, ...cUS, ...cTPS, ...googleCandidates];
    }

    if (masterPool.length === 0) return result;

    // AI MATCHING
    console.log(`[Row ${rowIndex}] 🤖 AI Matching ${masterPool.length} candidates...`);
    let match = await matchProfile(deceasedName || prName, targetInfo, prName, masterPool);

    if (match && match.bestMatchIndex !== -1 && match.confidence >= CONFIG.CONFIDENCE_THRESHOLD_MEDIUM) {
        let best = masterPool[match.bestMatchIndex];
        
        // --- APEX MERGER (Parallel Deep Extract) ---
        let phones = await extractMergedPhones(best, masterPool, rowIndex, prName);
        
        if (phones.length > 0) {
            return { ...result, name: best.fullName, phone: phones[0], allPhones: phones.join(' | '), source: `${best.source} (Apex V11.5)`, confidence: match.confidence, reasoning: match.reasoning, found: true };
        }

        // --- RECURSIVE RELAY FALLBACK ---
        if (best.relatives && best.relatives.length > 0) {
            console.log(`[Row ${rowIndex}] 🔗 Relay: ${best.fullName}...`);
            const relayTargets = best.relatives.slice(0, 3);
            const relayPromises = relayTargets.map(async (relative) => {
                 const nameOnly = relative.name ? relative.name.split(',')[0] : relative;
                 const [rW, rC] = await Promise.all([
                    radaris.search(nameOnly, null, state, { maxPages: 1 }).catch(e => []),
                    enhanced.searchCBCWithPagination(nameOnly, city, state, { maxPages: 1 }).catch(e => [])
                 ]);
                 const rPool = [...rW, ...rC];
                 const backlink = rPool.find(p => {
                     const rText = (p.relatives || []).join(' ').toLowerCase();
                     return rText.includes(parts[0].toLowerCase()) && rText.includes(parts[parts.length-1].toLowerCase());
                 });
                 if (backlink) return await extractMergedPhones(backlink, rPool, rowIndex, nameOnly);
                 return [];
            });
            const allRelayPhones = (await Promise.all(relayPromises)).flat();
            if (allRelayPhones.length > 0) {
                return { ...result, name: best.fullName, phone: allRelayPhones[0], allPhones: allRelayPhones.join(' | '), source: `Relay (Apex)`, confidence: match.confidence, reasoning: `Found via household link. ${match.reasoning}`, found: true };
            }
        }
    }

    return result;
}

/**
 * Apex-Merger: Parallel Deep Extraction for 100% Retention (V11.7 Cost-Optimized)
 */
async function extractMergedPhones(best, pool, rowIndex, targetName) {
    let phones = new Set((best.visiblePhones || best.phones || []).filter(p => p && p.length >= 10));
    const targetParts = targetName.toLowerCase().split(/\s+/).filter(p => p.length > 2);
    const bestParts = best.fullName.toLowerCase().split(/\s+/).filter(p => p.length > 2);

    const targetFirst = targetParts[0];
    const targetLast = targetParts[targetParts.length - 1];
    const bestFirst = bestParts[0];
    const bestLast = bestParts[bestParts.length - 1];

    // V11.7: Prioritize the best match first, then similar profiles
    const group = pool.filter(c => {
        const cName = c.fullName.toLowerCase();
        const matchesTarget = cName.includes(targetFirst) && cName.includes(targetLast);
        const matchesBest = cName.includes(bestFirst) && cName.includes(bestLast);
        const isLocMatch = c.location && best.location && (c.location.includes(best.location) || best.location.includes(c.location));
        return (matchesTarget || matchesBest || c.detailLink === best.detailLink) && (isLocMatch || !best.location || c.age === best.age);
    });

    // V11.7 Cost-Cutter: Only deep-fetch top N profiles (prioritize best match + unique sources)
    const toFetch = [best, ...group.filter(c => c.detailLink !== best.detailLink)].slice(0, CONFIG.MAX_DEEP_FETCHES);

    const deepPromises = toFetch.map(async (cand) => {
        if (!cand.detailLink || cand.source === 'Google') return cand.phones || [];
        const profile = await cachedProfileFetch(cand.detailLink, cand.source);
        return profile ? (profile.allPhones || profile.phones || []) : [];
    });

    const results = await Promise.all(deepPromises);
    results.flat().forEach(p => phones.add(p));

    return Array.from(phones).filter(p => {
        const clean = p.replace(/\D/g, '');
        return clean.length >= 10 && !['8557232747'].includes(clean);
    });
}

/**
 * Tier 3: Extract survivors from obituary
 */
async function extractSurvivorsFromObituary(deceasedName, state, rowIndex) {
    if (!deceasedName) return [];
    try {
        const query = `Obituary "${deceasedName}" ${state || ''}`;
        const items = await google.searchBroad(query).catch(e => []);
        if (items.length === 0) return [];
        
        const context = items.slice(0, 3).map(i => i.snippet).join("\n---\n");
        const model = (new (require("@google/generative-ai")).GoogleGenerativeAI(process.env.GEMINI_API_KEY)).getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = `Analyze obituary snippets for "${deceasedName}". Extract FULL NAMES of surviving family members (Spouse, Children, or PRs). Return ONLY a JSON array of strings. If none found, return [].\n\nSnippets:\n${context}`;
        
        const result = await model.generateContent(prompt).catch(e => null);
        if (!result) return [];
        const text = result.response.text();
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const survivors = JSON.parse(jsonStr);
        return Array.isArray(survivors) ? survivors.filter(s => s.length > 3) : [];
    } catch (e) {
        console.log(`[Row ${rowIndex}] Obituary error: ${e.message}`);
        return [];
    }
}

/**
 * Address residencies pivot
 */
async function addressCentricSearch(address, rowIndex) {
    if (!address) return [];
    try {
        const query = `"${address}" residents "Full Name"`;
        const items = await google.searchBroad(query).catch(e => []);
        return items.map(item => {
            const snippetPhones = (item.snippet.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || []);
            const nameMatch = item.title.match(/^([^|•-]+)/);
            if (nameMatch && !item.title.includes('Zillow')) {
                return { fullName: nameMatch[1].trim(), phones: snippetPhones, source: 'Address Pivot', detailLink: item.link, snippet: item.snippet };
            }
            return null;
        }).filter(c => c !== null);
    } catch (e) { return []; }
}

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

    let prResults = await Promise.all(prList.slice(0, 3).map((name, idx) => tieredSearchPR(name, parsed.deceased_name, city, state, rowIndex)));

    // Tier 3: Deep Excavation
    if (prResults.every(res => !res.found) && parsed.deceased_name) {
        console.log(`[Row ${rowIndex}] 🕵️  V11 Deep Excavation...`);
        const survivors = await extractSurvivorsFromObituary(parsed.deceased_name, state, rowIndex);
        if (survivors.length > 0) {
            const survivorResults = await Promise.all(survivors.slice(0, 2).map(s => tieredSearchPR(s, parsed.deceased_name, city, state, rowIndex)));
            const successfulSurvivor = survivorResults.find(s => s.found);
            if (successfulSurvivor) prResults[0] = { ...successfulSurvivor, reasoning: `Recovered via Obituary: ${successfulSurvivor.reasoning}` };
        }

        if (prResults.every(res => !res.found) && address) {
            const addrCandidates = await addressCentricSearch(address, rowIndex);
            if (addrCandidates.length > 0) {
                const bestAddrMatch = await matchProfile(parsed.deceased_name, `${city} ${state}`, "Resident", addrCandidates);
                if (bestAddrMatch && bestAddrMatch.bestMatchIndex !== -1 && bestAddrMatch.confidence >= 50) {
                    const best = addrCandidates[bestAddrMatch.bestMatchIndex];
                    if (best.phones && best.phones.length > 0) {
                        prResults[0] = { name: best.fullName, phone: best.phones[0], allPhones: best.phones.join(' | '), source: 'Address Pivot', confidence: bestAddrMatch.confidence, reasoning: `Found at target address: ${bestAddrMatch.reasoning}`, found: true };
                    }
                }
            }
        }

        // Tier 3.5: WhitePages Verification (for low-confidence matches < 85%)
        const lowConfidenceMatch = prResults.find(res => res.found && res.confidence < 85);
        if (lowConfidenceMatch && prList[0]) {
            console.log(`[Row ${rowIndex}] 🔍 Tier 3.5: WhitePages Verification (${lowConfidenceMatch.confidence}% confidence)...`);
            try {
                const nameParts = prList[0].split(/\s+/);
                const firstName = nameParts[0];
                const lastName = nameParts[nameParts.length - 1];
                
                const wpResult = await twoPhaseWhitePages(firstName, lastName, state || 'WA');
                if (wpResult && wpResult.phones && wpResult.phones.length > 0) {
                    const wpPhone = wpResult.phones[0].replace(/\D/g, '');
                    const currentPhone = lowConfidenceMatch.phone.replace(/\D/g, '');
                    
                    if (wpPhone !== currentPhone) {
                        console.log(`[Row ${rowIndex}] ⚠️ WhitePages found different phone! Replacing ${lowConfidenceMatch.phone} → ${wpResult.phones[0]}`);
                        const idx = prResults.indexOf(lowConfidenceMatch);
                        prResults[idx] = {
                            name: wpResult.fullName || prList[0],
                            phone: wpResult.phones[0],
                            allPhones: wpResult.phones.join(' | '),
                            source: 'WhitePages (Verified)',
                            confidence: 90,
                            reasoning: `WhitePages cross-verified - replaced low-confidence Radaris match (${lowConfidenceMatch.confidence}%)`,
                            found: true
                        };
                    } else {
                        console.log(`[Row ${rowIndex}] ✓ WhitePages confirmed phone ${wpResult.phones[0]}`);
                    }
                }
            } catch (e) {
                console.log(`[Row ${rowIndex}] ⚠️ WhitePages verification error: ${e.message}`);
            }
        }

        // Tier 4: WhitePages Fallback (if all else fails)
        if (prResults.every(res => !res.found) && prList[0]) {
            console.log(`[Row ${rowIndex}] 📞 Tier 4: WhitePages Fallback...`);
            const nameParts = prList[0].split(/\s+/);
            const firstName = nameParts[0];
            const lastName = nameParts[nameParts.length - 1];
            
            // Retry wrapper for robustness
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    const wpResult = await twoPhaseWhitePages(firstName, lastName, state || 'WA');
                    if (wpResult && wpResult.phones && wpResult.phones.length > 0) {
                        prResults[0] = {
                            name: wpResult.fullName || prList[0],
                            phone: wpResult.phones[0],
                            allPhones: wpResult.phones.join(' | '),
                            source: 'WhitePages',
                            confidence: 75,
                            reasoning: `WhitePages Tier 4 fallback - found ${wpResult.phones.length} phone(s)`,
                            found: true
                        };
                        console.log(`[Row ${rowIndex}] ✅ WhitePages found: ${wpResult.phones[0]}`);
                        break; // Success, exit retry loop
                    } else if (attempt < 2) {
                        console.log(`[Row ${rowIndex}] ⏳ WhitePages attempt ${attempt} returned no phones, retrying...`);
                        await new Promise(r => setTimeout(r, 5000));
                    }
                } catch (e) {
                    console.log(`[Row ${rowIndex}] ⚠️ WhitePages attempt ${attempt} error: ${e.message}`);
                    if (attempt < 2) {
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }
            }
        }
    }

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
    console.log('UNIVERSAL SCRAPER V11: THE RETENTIONIST');
    console.log('='.repeat(60));

    const rows = [];
    if (!fs.existsSync(CONFIG.INPUT_FILE)) { console.error('Input file missing'); return; }

    await new Promise((res, rej) => fs.createReadStream(CONFIG.INPUT_FILE).pipe(csv()).on('data', r => rows.push(r)).on('end', res).on('error', rej));
    if (rows.length === 0) return;

    const outputHeaders = [...Object.keys(rows[0]), 'Deceased Name_PARSED', 'Is Probate', 'PR 1 Name', 'PR 1 Phone', 'PR 1 All Phones', 'PR 1 Source', 'PR 1 Match Confidence', 'PR 1 Match Reasoning', 'PR 2 Name', 'PR 2 Phone', 'PR 2 All Phones', 'PR 2 Source', 'PR 2 Match Confidence', 'PR 2 Match Reasoning', 'Notes'];
    fs.writeFileSync(CONFIG.OUTPUT_FILE, outputHeaders.join(',') + '\n');
    
    let activeCount = 0;
    let completedCount = 0;
    let currentIndex = 0;
    const total = rows.length;

    const next = async () => {
        if (currentIndex >= total && activeCount === 0) {
            console.log('\n✅ V11 PROCESSING COMPLETE');
            return;
        }

        while (currentIndex < total && activeCount < CONFIG.CONCURRENT_ROWS) {
            const idx = currentIndex++;
            const row = rows[idx];
            activeCount++;
            
            processRow(row, idx + 1).then(res => {
                activeCount--;
                completedCount++;
                if (res) {
                    const l = outputHeaders.map(h => {
                        let v = res[h] || '';
                        if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) v = `"${v.replace(/"/g, '""')}"`;
                        return v;
                    }).join(',');
                    fs.appendFileSync(CONFIG.OUTPUT_FILE, l + '\n');
                }
                console.log(`Progress: ${completedCount}/${total} | Active: ${activeCount}`);
                next();
            }).catch(e => {
                activeCount--;
                completedCount++;
                console.error(`Row ${idx+1} Error: ${e.message}`);
                next();
            });
        }
    };
    next();
}

main().catch(console.error);
