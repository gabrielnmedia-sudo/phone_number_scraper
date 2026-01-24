const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const axios = require('axios');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function parseCSVRow(rowContent) {
    // Regex-First Approach for Speed
    // Patterns: 
    // 1. "DECEASED (Dead) PR (PR)"
    // 2. "DECEASED (Dead) & PR (PR)"
    
    let deceased = null;
    let pr = null;
    let isProbate = false;

    const deadMatch = rowContent.match(/(.*?)\s*\(Dead\)/i);
    if (deadMatch) {
        deceased = deadMatch[1].trim();
        isProbate = true;
        
        // Try to find PR
        let prPart = rowContent.replace(deadMatch[0], '').trim();
        // Remove Leading & / and / ,
        prPart = prPart.replace(/^[,&]|\s+and\s+/i, '').trim();
        
        // Check for (PR)
        const prMatch = prPart.match(/(.*?)\s*\(PR\)/i);
        if (prMatch) {
            pr = prMatch[1].trim();
        } else {
            // Assume rest is PR if not empty
            if (prPart.length > 2) pr = prPart; 
        }
    } else if (rowContent.toUpperCase().includes("ESTATE OF")) {
         // "ESTATE OF XYZ"
         isProbate = true;
         deceased = rowContent.replace(/ESTATE OF/i, '').trim();
         pr = "Unknown";
    }

    if (isProbate) {
         return { deceased_name: deceased, pr_name: pr, is_probate: true };
    }

    // Default: Not probate
    return { deceased_name: null, pr_name: rowContent, is_probate: false }; 
}

// We need a separate script to initially split the columns or we just do it on the fly.
// Given the CSV file provided ("Data Tracking - NEW LEADS COMING IN.csv"), the column is "Owner Name".
// Let's create a script that reads the CSV, adds/fills "Deceased Name" and "PR Name" columns, and saves it.
// Wait, the user wants to populate a Google Sheet. Are we migrating the CSV to GSheets first? 
// The user said: "The intention, however, is to extract phone numbers from cyberbackgroundchecks.com and truepeoplesearch.com and populate a Google Sheet."
// And now: "I'll put the CSV in the project."
// So likely I should parse the CSV, find phone numbers, and output a NEW CSV or update the CSV.
// Let's stick to CSV for now since that's what I have local access to.

const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Main processing function for CSV
async function processLocalCSV() {
    const INPUT_FILE = '../Data Tracking - NEW LEADS COMING IN.csv';
    const OUTPUT_FILE = '../Data_Tracking_Processed.csv';
    
    const rows = [];
    
    // Read CSV
    console.log("Reading CSV...");
    await new Promise((resolve, reject) => {
        fs.createReadStream(INPUT_FILE)
            .pipe(csv())
            .on('data', (data) => rows.push(data))
            .on('end', resolve)
            .on('error', reject);
    });

    console.log(`Read ${rows.length} rows.`);

    // Prepare matching and scraping
    const Scraper = require('./scraper');
    const { matchProfile } = require('./matcher');
    const scraper = new Scraper();

    // We will process a subset for testing or all? The user says "The deceased and all the PRs are in the same column."
    // That column is "Owner Name" based on the view_file.

    // Let's add new fields to rows
    // Write Header
    const headers = Object.keys(rows[0]).concat(['Deceased Name_EXTRACTED', 'PR Name_EXTRACTED', 'PR Phone_FOUND', 'Match Confidence']);
    fs.writeFileSync(OUTPUT_FILE, headers.join(',') + '\n');

    for (let i = 0; i < rows.length; i++) {
        // limit for test?
        // if (i > 5) break; 
        
        let row = rows[i];
        const ownerNameRaw = row['Owner Name'];
        const propertyAddress = row['Property Address'];
        
        // Ensure new fields exist to keep CSV structure consistent
        row['Deceased Name_EXTRACTED'] = '';
        row['PR Name_EXTRACTED'] = '';
        row['PR Phone_FOUND'] = '';
        row['Match Confidence'] = '';

        if (!ownerNameRaw) {
             // Just write it out
        } else {
            console.log(`\nProcessing Row ${i+1}: ${ownerNameRaw}`);

            // 1. Separate Names
            const parsedNames = await parseCSVRow(ownerNameRaw);
            console.log("Parsed:", parsedNames);

            row['Deceased Name_EXTRACTED'] = parsedNames.deceased_name || '';
            row['PR Name_EXTRACTED'] = parsedNames.pr_name || '';
            
            // 2. If Probate, Scrape
            if (parsedNames.is_probate && parsedNames.pr_name && parsedNames.deceased_name) {
                // Address parsing
                let city = '', state = '';
                if (propertyAddress) {
                    const parts = propertyAddress.split(',');
                    if (parts.length >= 2) {
                        const stateZip = parts[parts.length - 1].trim();
                        const stateParts = stateZip.split(' ');
                        state = stateParts[0]; // WA
                        city = parts[parts.length - 2].trim();
                    }
                }

                console.log(`Searching for PR: ${parsedNames.pr_name} in ${city}, ${state}`);
                
                const prTarget = parsedNames.pr_name.split(',')[0].trim();
                const candidates = await scraper.searchCBC(prTarget, city, state);
                
                if (candidates.length > 0) {
                        const match = await matchProfile(parsedNames.deceased_name, `${city}, ${state}`, prTarget, candidates);
                        if (match.bestMatchIndex !== -1 && match.confidence >= 50) {
                            const best = candidates[match.bestMatchIndex];
                            console.log(`Match: ${best.fullName}`);
                            let phones = best.visiblePhones;
                            row['PR Phone_FOUND'] = phones.join(' | '); // Use pipe for CSV safety inside column
                            row['Match Confidence'] = match.confidence;
                        } else {
                            row['PR Phone_FOUND'] = 'No High Conf Match';
                            row['Match Confidence'] = match.confidence;
                        }
                } else {
                    row['PR Phone_FOUND'] = 'No Candidates';
                }

            } else {
                console.log("Not a probate record or missing names, skipping scrape.");
            }
        
        }

        // CSV Stringify Row
        const csvRow = headers.map(header => {
            let val = row[header] || '';
            if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
                val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        }).join(',');

        fs.appendFileSync(OUTPUT_FILE, csvRow + '\n');

        // Rate limit
        await new Promise(r => setTimeout(r, 1000));
    }
    console.log(`Finished processing ${rows.length} rows.`);
}

processLocalCSV();
