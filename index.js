const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const Scraper = require('./scraper');
const { matchProfile } = require('./matcher');
require('dotenv').config();

// Configuration: Adjust column names as needed
const COLUMNS = {
    DECEASED_NAME: 'Deceased Name',
    DECEASED_ADDRESS: 'Deceased Address', // Assumed to contain City, State
    PR_NAME: 'PR Name',
    // Output columns
    OUTPUT_PHONE: 'PR Phone Number',
    OUTPUT_CONFIDENCE: 'Match Confidence',
    OUTPUT_REASONING: 'Match Reasoning'
};

async function main() {
    console.log('Starting Phone Number Scraper...');

    // 1. Auth with Google Sheets
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.SPREADSHEET_ID) {
        console.error('Missing Google Sheet credentials in .env (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, SPREADSHEET_ID)');
        process.exit(1);
    }

    const serviceAccountAuth = new JWT({
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    console.log(`Loaded Sheet: ${doc.title}`);

    const sheet = doc.sheetsByIndex[0]; // Assume first sheet
    const rows = await sheet.getRows();
    console.log(`Found ${rows.length} rows to process.`);

    const scraper = new Scraper();

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const deceasedName = row.get(COLUMNS.DECEASED_NAME);
        const deceasedAddress = row.get(COLUMNS.DECEASED_ADDRESS);
        const prNameRaw = row.get(COLUMNS.PR_NAME);
        
        // Skip if already processed (optional check)
        if (row.get(COLUMNS.OUTPUT_PHONE)) {
             console.log(`Skipping Row ${i + 1}: Already has phone number.`);
             continue;
        }

        if (!deceasedName || !deceasedAddress || !prNameRaw) {
            console.warn(`Skipping Row ${i + 1}: Missing required data.`);
            continue;
        }

        console.log(`\n--- Processing Row ${i + 1} ---`);
        console.log(`Target: PR "${prNameRaw}" for Deceased "${deceasedName}" (${deceasedAddress})`);

        // Basic Address Parsing (assumes "City, State" or similar is present in the address string)
        // This is a naive split, might need improvement based on actual data format
        let city = '';
        let state = '';
        
        const addrParts = deceasedAddress.split(',');
        if (addrParts.length >= 2) {
             state = addrParts[addrParts.length - 1].trim().split(' ')[0]; // Extract State (WA)
             city = addrParts[addrParts.length - 2].trim(); // Extract City
        } else {
            console.warn(`Could not parse city/state from address: "${deceasedAddress}". Using whole string as location hint.`);
            city = deceasedAddress;
            state = ''; // CBC requires specific city/state path format, might fail if empty
        }

        // Handle multiple PRs if comma separated? User said "PR or PR's".
        // Taking the first one for simplicity or split?
        // Let's assume one PR name per cell for now or take the first.
        const prName = prNameRaw.split(',')[0].trim();

        // 1. Scrape
        let candidates = await scraper.searchCBC(prName, city, state);
        
        if (candidates.length === 0) {
            console.log('No candidates found via CBC.');
             // Fallback to searching without strict city/state? 
             // Or try TPS (scraper.searchTPS) if enabled.
             // candidates = await scraper.searchTPS(prName, city, state);
        }

        if (candidates.length === 0) {
            row.set(COLUMNS.OUTPUT_REASONING, 'No candidates found');
            await row.save();
            continue;
        }

        // 2. Match
        const match = await matchProfile(deceasedName, deceasedAddress, prName, candidates);
        
        if (match.bestMatchIndex !== -1 && match.confidence >= 50) { // Threshold 50
             const bestCandidate = candidates[match.bestMatchIndex];
             console.log(`Match Found: ${bestCandidate.fullName} (Confidence: ${match.confidence})`);
             row.set(COLUMNS.OUTPUT_CONFIDENCE, match.confidence);
             row.set(COLUMNS.OUTPUT_REASONING, match.reasoning);

             // 3. Get Details
             let phones = bestCandidate.visiblePhones || [];
             if (bestCandidate.detailLink) {
                 const details = await scraper.getDetailsCBC(bestCandidate.detailLink);
                 if (details && details.phones && details.phones.length > 0) {
                     phones = [...new Set([...phones, ...details.phones])];
                 }
             }

             if (phones.length > 0) {
                 row.set(COLUMNS.OUTPUT_PHONE, phones.join(', '));
                 console.log(`Saved Phones: ${phones.join(', ')}`);
             } else {
                 row.set(COLUMNS.OUTPUT_PHONE, 'No phones found');
                 console.log('No phones found on profile.');
             }

        } else {
            console.log('No high-confidence match.');
            row.set(COLUMNS.OUTPUT_CONFIDENCE, match.confidence || 0);
            row.set(COLUMNS.OUTPUT_REASONING, match.reasoning || 'Low confidence');
        }

        await row.save();
        // Be nice to the server
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log('\nDone!');
}

main();
