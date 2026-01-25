require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const { parseOwnerName, extractPRs } = require('./name_parser');
const RadarisScraper = require('./radaris_scraper');
const SearchPeopleFreeScraper = require('./searchpeoplefree_scraper');
const EnhancedScraper = require('./enhanced_scraper');
const GoogleHelper = require('./google_helper');
const WhitePagesScraper = require('./whitepages_scraper');
const WhitePagesDiscovery = require('./whitepages_search_optimized');
const { matchProfile } = require('./matcher');

const CONFIG = {
    INPUT_FILE: './compare_input.csv',
    OUTPUT_FILE: './compare_results.csv',
    CONCURRENT_ROWS: 25,
    MAX_DEEP_FETCHES: 8, 
    // V12.3 SMART CONSERVATIVE: Balanced thresholds
    CONFIDENCE_THRESHOLD_PERFECT: 90, 
    CONFIDENCE_THRESHOLD_STRONG: 85, 
    CONFIDENCE_THRESHOLD_MEDIUM: 75, 
    DELAY_BETWEEN_CHUNKS_MS: 0, 
};

const radaris = new RadarisScraper();
const spf = new SearchPeopleFreeScraper();
const enhanced = new EnhancedScraper();
const google = new GoogleHelper();

const profileCache = new Map();

async function cachedProfileFetch(url, source) {
    if (profileCache.has(url)) return profileCache.get(url);
    let profile = null;
    try {
        if (source === 'Radaris') profile = await radaris.getProfile(url);
        else if (source === 'CBC') profile = await enhanced.getDetailsCBC(url);
        else if (source === 'TPS') profile = await enhanced.getDetailsTPS(url);
        else if (source === 'WhitePages') profile = await WhitePagesScraper.scrapeWhitePagesProfile(url);
    } catch (e) {}
    profileCache.set(url, profile);
    return profile;
}

function parseAddress(address) {
    if (!address) return { city: '', state: 'WA' };
    const cleanAddr = address.replace(/\n/g, ', ').trim();
    const match = cleanAddr.match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})?/i);
    if (match) return { city: match[1].trim(), state: match[2].toUpperCase() };
    return { city: '', state: 'WA' };
}

async function tieredSearchPR(name, deceasedName, city, state, rowIndex) {
    let result = { name, phone: '', allPhones: '', source: 'None', confidence: 0, reasoning: 'Not searched', found: false };
    if (!name || name.toLowerCase().includes('dead') || name.toLowerCase().includes('probate')) return result;

    console.log(`[Row ${rowIndex}] 🔎 Mach 2 Parallel Search for ${name}...`);

    const [rW, rU, gItems] = await Promise.all([
        radaris.search(name, null, state, { maxPages: 1 }).catch(e => []),
        radaris.search(name, null, 'US', { maxPages: 1 }).catch(e => []),
        google.searchBroad(`${name} ${city} ${state} phone address`).catch(e => [])
    ]);

    const googleCandidates = gItems.map(item => {
        const snippetPhones = (item.snippet.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || []);
        return { fullName: item.title.split(' | ')[0].split(' - ')[0], phones: snippetPhones, detailLink: item.link, source: 'Google', snippet: item.snippet, relatives: [] };
    }).filter(c => c.phones.length > 0 || c.detailLink.includes('radaris.com') || c.detailLink.includes('whitepages.com'));

    const candidates = [...rW, ...rU, ...googleCandidates];

    if (candidates.length > 0) {
        let match = await matchProfile(deceasedName, `${city} ${state}`, name, candidates);
        if (match && match.bestMatchIndex !== -1 && match.confidence >= CONFIG.CONFIDENCE_THRESHOLD_MEDIUM) {
            const best = candidates[match.bestMatchIndex];
            const profile = await extractMergedPhones(best, candidates, rowIndex, name);
            if (profile && profile.found) {
                result = { ...profile, confidence: match.confidence, reasoning: `Parallel: ${match.reasoning}`, found: true };
            }
        }
    }

    if (result.confidence < CONFIG.CONFIDENCE_THRESHOLD_STRONG) {
        console.log(`[Row ${rowIndex}] ⚡ Tier 3: SPF/WhitePages Fallback...`);
        
        // Parallel SPF + WP Discovery
        const nameParts = name.split(/\s+/);
        const [rSPF, wpUrl] = await Promise.all([
            spf.search(name, city, state).catch(e => []),
            WhitePagesDiscovery.discoverProfileUrl(nameParts[0], nameParts[nameParts.length-1], city, state).catch(e => null)
        ]);

        // Evaluate SPF
        if (rSPF.length > 0) {
            const spfMatch = await matchProfile(deceasedName, `${city} ${state}`, name, rSPF);
            if (spfMatch && spfMatch.bestMatchIndex !== -1 && spfMatch.confidence > result.confidence) {
                const best = rSPF[spfMatch.bestMatchIndex];
                result = { name: best.fullName, phone: best.phones[0], allPhones: best.phones.join(' | '), source: 'SPF', confidence: spfMatch.confidence, reasoning: `SPF Fix: ${spfMatch.reasoning}`, found: true };
            }
        }

        // Evaluate WhitePages
        if (wpUrl && result.confidence < 85) {
            const wpResult = await cachedProfileFetch(wpUrl, 'WhitePages');
            if (wpResult && wpResult.phones && wpResult.phones.length > 0) {
                result = {
                    name: wpResult.fullName || name,
                    phone: wpResult.phones[0],
                    allPhones: wpResult.phones.join(' | '),
                    source: 'WhitePages',
                    confidence: 85,
                    reasoning: `WhitePages Premium Override: Found ${wpResult.phones.length} phones`,
                    found: true
                };
            }
        }
    }

    return result;
}

async function extractMergedPhones(best, pool, rowIndex, targetName) {
    let phones = new Set();
    
    // 1. Gather all unique detail links for high-confidence candidates
    const uniqueLinks = new Map();
    pool.forEach(c => {
        if (c.detailLink && !uniqueLinks.has(c.detailLink)) {
            uniqueLinks.set(c.detailLink, c);
        }
    });

    const candidateList = Array.from(uniqueLinks.values());
    const toFetch = [best, ...candidateList.filter(c => c.detailLink !== best.detailLink)].slice(0, CONFIG.MAX_DEEP_FETCHES);

    console.log(`[Row ${rowIndex}] 🔄 Merging data from ${toFetch.length} profiles...`);

    const deepResults = await Promise.all(toFetch.map(async (cand) => {
        if (!cand.detailLink || cand.source === 'Google') return cand.phones || [];
        const profile = await cachedProfileFetch(cand.detailLink, cand.source);
        return profile ? (profile.allPhones || profile.phones || []) : [];
    }));

    deepResults.flat().forEach(p => {
        const clean = p.replace(/\D/g, '');
        if (clean.length >= 10) {
            const formatted = `(${clean.slice(-10, -7)}) ${clean.slice(-7, -4)}-${clean.slice(-4)}`;
            phones.add(formatted);
        }
    });

    let phoneList = Array.from(phones);

    // V12 SMART: Prioritize WA Area Codes
    const waCodes = ['206', '253', '360', '425', '509'];
    phoneList.sort((a, b) => {
        const aWA = waCodes.some(code => a.includes(code)) ? 1 : 0;
        const bWA = waCodes.some(code => b.includes(code)) ? 1 : 0;
        return bWA - aWA;
    });

    if (phoneList.length > 0) {
        return { phone: phoneList[0], allPhones: phoneList.join(' | '), source: best.source, found: true };
    }
    return null;
}

let rowsProcessed = 0;
async function processRow(row, rowIndex) {
    const propertyAddress = row['Property Address'] || row['Pr operty Address'] || '';
    const ownerName = row['Owner Name'] || row['Own er Name'] || '';
    
    // Skip empty rows
    if (!ownerName || ownerName === 'null') {
        console.log(`[Row ${rowIndex}] Skipping empty row.`);
        return row;
    }

    const parsed = parseOwnerName(ownerName);
    // CRITICAL FIX: Use parsed PR name, not full ownerName (which includes deceased)
    const prList = parsed.pr_name ? extractPRs(parsed.pr_name) : [];
    const { city, state } = parseAddress(propertyAddress);

    let outputRow = { ...row, 'Deceased Name_PARSED': parsed.deceased_name, 'Is Probate': 'Yes' };

    // Process all PRs (up to 2)
    const prResults = await Promise.all(prList.slice(0, 2).map(name => 
        tieredSearchPR(name, parsed.deceased_name, city, state, rowIndex).catch(e => {
            console.error(`Error searching PR ${name}:`, e.message);
            return { name, phone: '', allPhones: '', source: 'Error', confidence: 0, reasoning: e.message, found: false };
        })
    ));

    prResults.forEach((res, idx) => {
        const p = `PR ${idx + 1}`;
        outputRow[`${p} Name`] = res.name;
        outputRow[`${p} Phone`] = res.phone;
        outputRow[`${p} All Phones`] = res.allPhones;
        outputRow[`${p} Source`] = res.source;
        outputRow[`${p} Match Confidence`] = res.confidence || 0;
        outputRow[`${p} Match Reasoning`] = res.reasoning;
    });

    rowsProcessed++;
    console.log(`[Progress] ${rowsProcessed} leads completed.`);
    return outputRow;
}

async function run() {
    const results = [];
    fs.createReadStream(CONFIG.INPUT_FILE)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            console.log(`Starting V12 processing...`);
            const finalResults = [];
            for (let i = 0; i < results.length; i += CONFIG.CONCURRENT_ROWS) {
                const chunk = results.slice(i, i + CONFIG.CONCURRENT_ROWS);
                const processed = await Promise.all(chunk.map((row, idx) => processRow(row, i + idx + 1).catch(e => {
                    console.error(`Fatal error in row ${i+idx+1}:`, e);
                    return row;
                })));
                finalResults.push(...processed);
                
                // Save incrementally
                const headers = Object.keys(finalResults[0]);
                const csvContent = [headers.join(','), ...finalResults.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n');
                fs.writeFileSync(CONFIG.OUTPUT_FILE, csvContent);

                if (i + CONFIG.CONCURRENT_ROWS < results.length) {
                    console.log(`[Batch Cooldown] Sleeping for ${CONFIG.DELAY_BETWEEN_CHUNKS_MS/1000}s...`);
                    await new Promise(r => setTimeout(r, CONFIG.DELAY_BETWEEN_CHUNKS_MS));
                }
            }
            console.log(`✅ V12 COMPLETE! Saved to ${CONFIG.OUTPUT_FILE}`);
        });
}

run().catch(console.error);
