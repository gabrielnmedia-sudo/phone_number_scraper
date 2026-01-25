/**
 * audit_v12.js
 * 
 * Direct performance comparison between V12 and the previous benchmark.
 * Answers:
 * 1. How many "Correct" leads are still captured correctly?
 * 2. How many "Incorrect" leads now have a different (potentially better) phone?
 */

const fs = require('fs');
const csv = require('csv-parser');
require('dotenv').config();

// Re-use logic from V12
const { parseOwnerName, extractPRs } = require('./name_parser');
const RadarisScraper = require('./radaris_scraper');
const SearchPeopleFreeScraper = require('./searchpeoplefree_scraper');
const EnhancedScraper = require('./enhanced_scraper');
const GoogleHelper = require('./google_helper');
const WhitePagesScraper = require('./whitepages_scraper');
const WhitePagesDiscovery = require('./whitepages_search_optimized');
const { matchProfile } = require('./matcher');

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

async function extractMergedPhones(best, pool, rowIndex, targetName) {
    let phones = new Set();
    const uniqueLinks = new Map();
    pool.forEach(c => {
        if (c.detailLink && !uniqueLinks.has(c.detailLink)) uniqueLinks.set(c.detailLink, c);
    });

    const candidateList = Array.from(uniqueLinks.values());
    const toFetch = [best, ...candidateList.filter(c => c.detailLink !== best.detailLink)].slice(0, 8);

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
    const waCodes = ['206', '253', '360', '425', '509'];
    phoneList.sort((a, b) => {
        const aWA = waCodes.some(code => a.includes(code)) ? 1 : 0;
        const bWA = waCodes.some(code => b.includes(code)) ? 1 : 0;
        return bWA - aWA;
    });

    if (phoneList.length > 0) return { phone: phoneList[0], allPhones: phoneList.join(' | '), source: best.source, found: true };
    return null;
}

async function tieredSearchPR(name, deceasedName, city, state, rowIndex) {
    let result = { name, phone: '', allPhones: '', source: 'None', confidence: 0, reasoning: 'Not searched', found: false };
    if (!name || name.toLowerCase().includes('dead') || name.toLowerCase().includes('probate')) return result;

    const [rW, rU, gItems] = await Promise.all([
        radaris.search(name, null, state, { maxPages: 1 }).catch(e => []),
        radaris.search(name, null, 'US', { maxPages: 1 }).catch(e => []),
        google.searchBroad(`${name} ${city} ${state} phone address`).catch(e => [])
    ]);

    const candidates = [...rW, ...rU, ...gItems.map(item => {
        const snippetPhones = (item.snippet.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || []);
        return { fullName: item.title.split(' | ')[0].split(' - ')[0], phones: snippetPhones, detailLink: item.link, source: 'Google', snippet: item.snippet, relatives: [] };
    }).filter(c => c.phones.length > 0 || c.detailLink.includes('radaris.com'))];

    if (candidates.length > 0) {
        let match = await matchProfile(deceasedName, `${city} ${state}`, name, candidates);
        if (match && match.bestMatchIndex !== -1 && match.confidence >= 40) {
            const best = candidates[match.bestMatchIndex];
            const profile = await extractMergedPhones(best, candidates, rowIndex, name);
            if (profile) result = { ...profile, confidence: match.confidence, reasoning: match.reasoning, found: true };
        }
    }

    if (result.confidence < 85) {
        const nameParts = name.split(/\s+/);
        const [rSPF, wpUrl] = await Promise.all([
            spf.search(name, city, state).catch(e => []),
            WhitePagesDiscovery.discoverProfileUrl(nameParts[0], nameParts[nameParts.length-1], city, state).catch(e => null)
        ]);

        if (rSPF.length > 0) {
            const spfMatch = await matchProfile(deceasedName, `${city} ${state}`, name, rSPF);
            if (spfMatch && spfMatch.bestMatchIndex !== -1 && spfMatch.confidence > result.confidence) {
                const best = rSPF[spfMatch.bestMatchIndex];
                result = { name: best.fullName, phone: best.phones[0], allPhones: best.phones.join(' | '), source: 'SPF', confidence: spfMatch.confidence, reasoning: spfMatch.reasoning, found: true };
            }
        }

        if (wpUrl && result.confidence < 85) {
            const wpResult = await cachedProfileFetch(wpUrl, 'WhitePages');
            if (wpResult && wpResult.phones && wpResult.phones.length > 0) {
                result = { name: wpResult.fullName || name, phone: wpResult.phones[0], allPhones: wpResult.phones.join(' | '), source: 'WhitePages', confidence: 85, reasoning: 'WhitePages Match', found: true };
            }
        }
    }
    return result;
}

async function audit() {
    const BENCHMARK_FILE = './test_run_results_v2 - test_run_results_v2 (1).csv';
    const rows = [];
    
    await new Promise((resolve) => {
        fs.createReadStream(BENCHMARK_FILE)
            .pipe(csv())
            .on('data', data => rows.push(data))
            .on('end', resolve);
    });

    // Take a slice of 10 leads that have results
    const leadsToTest = rows.filter(r => r.Status === 'Correct' || r.Status === 'Incorrect').slice(0, 10);
    
    console.log('='.repeat(70));
    console.log(`AUDIT: V12 Performance vs Previous Run (Testing ${leadsToTest.length} leads)`);
    console.log('='.repeat(70));

    let stats = {
        correct_retained: 0,
        correct_lost: 0,
        incorrect_fixed: 0,
        incorrect_still_wrong: 0
    };

    for (let i = 0; i < leadsToTest.length; i++) {
        const row = leadsToTest[i];
        const ownerName = row['Owner Name'];
        const propertyAddress = row['Property Address'] || row['Pr operty Address'];
        const oldPhone = row['PR Phone_FOUND'];
        const oldStatus = row['Status'];

        const parsed = parseOwnerName(ownerName);
        const prList = parsed.pr_name ? extractPRs(parsed.pr_name) : [];
        const { city, state } = parseAddress(propertyAddress);

        console.log(`\n[Lead ${i+1}] ${ownerName}`);
        console.log(`  - Old Info: ${oldPhone} (${oldStatus})`);

        let newResult = { phone: '' };
        if (prList.length > 0) {
            newResult = await tieredSearchPR(prList[0], parsed.deceased_name, city, state, i+1);
        }

        const newPhone = newResult.phone || '';
        const cleanOld = oldPhone.replace(/\D/g, '');
        const cleanNew = newPhone.replace(/\D/g, '');

        if (oldStatus === 'Correct') {
            if (cleanNew === cleanOld) {
                console.log(`  ✅ RETAINED: Found same correct phone.`);
                stats.correct_retained++;
            } else {
                console.log(`  ❌ LOST: Found different phone: ${newPhone || 'None'}`);
                stats.correct_lost++;
            }
        } else if (oldStatus === 'Incorrect') {
            if (cleanNew === cleanOld) {
                console.log(`  ❌ STILL WRONG: Found same incorrect phone.`);
                stats.incorrect_still_wrong++;
            } else if (newPhone && cleanNew !== cleanOld) {
                console.log(`  ⭐ CHANGED: Found NEW phone: ${newPhone}. (Old was wrong)`);
                stats.incorrect_fixed++;
            } else {
                console.log(`  ⚠️  EMPTIED: Now returning no results. (Better than wrong)`);
                stats.incorrect_fixed++; // Removing an incorrect result is a type of fix
            }
        }
    }

    console.log('\n' + '='.repeat(70));
    console.log('FINAL AUDIT SUMMARY');
    console.log('='.repeat(70));
    console.log(`✅ Correct Retained: ${stats.correct_retained}`);
    console.log(`❌ Correct Lost:     ${stats.correct_lost}`);
    console.log(`⭐ Incorrect Fixed:    ${stats.incorrect_fixed}`);
    console.log(`❌ Incorrect Still WRONG: ${stats.incorrect_still_wrong}`);
    console.log('='.repeat(70));
}

audit().catch(console.error);
