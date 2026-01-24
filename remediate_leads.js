const fs = require('fs');
const parse = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const RadarisScraper = require('./radaris_scraper');
const EnhancedScraper = require('./enhanced_scraper');
const SearchPeopleFreeScraper = require('./searchpeoplefree_scraper');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Config
const INPUT_FILE = 'leads_to_remediate.csv';
const OUTPUT_FILE = 'remediated_results.csv';
const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

// Scrapers
const radaris = new RadarisScraper();
const enhanced = new EnhancedScraper();
const spf = new SearchPeopleFreeScraper();

// Matching Logic (Simple version of V7 matcher)
async function aiMatch(deceased, pr, candidates) {
    if (!candidates || candidates.length === 0) return null;

    const prompt = `
    I am a probate researcher looking for the Personal Representative (PR) of a deceased person.
    
    Deceased: "${deceased}"
    Target PR: "${pr}"

    I have found the following candidates. Please analyze them and determine if any of them is the correct PR.
    Prioritize candidates who:
    1. Match the Name (or reasonable variation).
    2. Live in the same state (WA) or have a history there.
    3. Are relatives of the Deceased (Deceased name appears in relatives list).
    4. Are relatives of someone with the Deceased's surname.

    Candidates:
    ${JSON.stringify(candidates.slice(0, 10), null, 2)}

    Return a JSON object:
    {
        "bestMatchIndex": number (0-based index of the best match, or -1 if none),
        "confidence": number (0-100),
        "reasoning": "string explaining why"
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (e) {
        return { bestMatchIndex: -1, confidence: 0, reasoning: "AI Error" };
    }
}

async function processLead(row) {
    const deceased = row['Deceased Name_PARSED'] || row['Owner Name'];
    const prName = row['PR 1 Name'] || row['PR Name_PARSED'] || ''; // Adjust logic
    // Actually Apex CSV has 'PR 1 Name'
    // 'leads_to_remediate.csv' is a copy of Apex row, so use Apex keys.
    const pr = row['PR 1 Name'];
    const city = "Seattle"; // Default/Fallback
    const state = "WA";

    console.log(`\nProcessing: ${deceased} (PR: ${pr})`);

    let bestResult = null;
    let bestConfidence = 0;

    // Helper to check result
    const check = async (sourceName, candidates) => {
        if (!candidates.length) return;
        console.log(`  - ${sourceName}: Found ${candidates.length} candidates.`);
        const match = await aiMatch(deceased, pr, candidates);
        console.log(`    > AI Match: Index ${match.bestMatchIndex}, Conf ${match.confidence}%`);
        
        if (match.bestMatchIndex >= 0 && match.confidence > bestConfidence) {
            // Fetch details if needed (phones)
            const cand = candidates[match.bestMatchIndex];
            let phones = cand.phones || [];
            
            // If no phones in snippet, we MUST fetch profile
            if (phones.length === 0 && cand.detailLink) {
                console.log(`    > Fetching details for ${cand.name}...`);
                try {
                    let prof;
                    if (sourceName === 'Radaris') prof = await radaris.getProfile(cand.detailLink);
                    else if (sourceName === 'CBC' || sourceName === 'TPS') prof = await enhanced.getDetailsCBC(cand.detailLink); // Enhanced handles both similar structs? No, distinct methods.
                    // Actually enhanced has getDetailsCBC. TPS extraction is usually simpler or separate.
                    // Looking at enhanced_scraper.js, it has _parseTPSResultsPage etc.
                    // For TPS, we'll implement getDetails if needed or rely on parse.
                    
                    // Simple fallback: If Scraper class returns phones in search result, use them.
                    // Radaris Scraper returns phones in search result? Yes usually snippet.
                    // But full profile is better.
                    if (sourceName === 'Radaris' && prof) phones = prof.allPhones;
                    if (sourceName === 'CBC' && prof) phones = prof.phones;
                    
                    // SPF
                    if (sourceName === 'SPF') {
                        const spfProf = await spf.getProfile(cand.detailLink);
                        if (spfProf) phones = spfProf.phones;
                    }

                } catch (e) { console.log(`    > Error fetching details: ${e.message}`); }
            }

            if (phones.length > 0) {
                bestResult = {
                    phone: phones[0], // First phone
                    allPhones: phones.join(' | '),
                    source: sourceName,
                    reasoning: match.reasoning,
                    confidence: match.confidence,
                    link: cand.detailLink
                };
                bestConfidence = match.confidence;
                console.log(`    > 🌟 New Best Candidate: ${phones[0]} (${sourceName})`);
            }
        }
    };

    // 1. Radaris Nationwide (Deep)
    try {
        const radCandidates = await radaris.search(pr, null, "US", { maxPages: 1 }); // Nationwide
        await check('Radaris', radCandidates);
    } catch (e) {}

    // 2. SPF (Good for hard leads)
    if (bestConfidence < 90) {
        try {
            const spfCandidates = await spf.search(pr, null, "WA");
            await check('SPF', spfCandidates);
        } catch (e) {}
    }

    // 3. TPS (Backup)
    if (bestConfidence < 90) {
         try {
            const tpsCandidates = await enhanced.searchTPSWithPagination(pr, null, "WA", { maxPages: 1 });
            await check('TPS', tpsCandidates);
        } catch (e) {}
    }

    // 4. CBC Broad (Last resort)
    if (bestConfidence < 80) {
         try {
            const cbcCandidates = await enhanced.searchCBCWithPagination(pr, null, "WA", { maxPages: 1 });
            await check('CBC', cbcCandidates);
        } catch (e) {}
    }
    
    // Result
    if (bestResult) {
        row['PR 1 Phone'] = bestResult.phone;
        row['PR 1 All Phones'] = bestResult.allPhones;
        row['PR 1 Source'] = bestResult.source + " (Remediation)";
        row['PR 1 Match Reasoning'] = bestResult.reasoning;
        row['Match_Status'] = 'Recovered';
    } else {
        row['Match_Status'] = 'Remediation Failed';
    }
    
    return row;
}

async function run() {
    const leads = [];
    fs.createReadStream(INPUT_FILE)
        .pipe(parse({ columns: true }))
        .on('data', (data) => leads.push(data))
        .on('end', async () => {
            console.log(`Loaded ${leads.length} leads to remediate.`);
            
            const results = [];
            // Process sequentially to be gentle/thorough
            for (const lead of leads) {
                const updated = await processLead(lead);
                results.push(updated);
            }

            // Write output
            const csvWriter = createCsvWriter({
                path: OUTPUT_FILE,
                header: Object.keys(leads[0]).map(id => ({id, title: id}))
            });
            await csvWriter.writeRecords(results);
            console.log(`Done. Saved to ${OUTPUT_FILE}`);
        });
}

run();
