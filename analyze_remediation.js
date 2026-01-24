const fs = require('fs');
const parse = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

// Files
const APEX_RESULTS_FILE = 'Data_Tracking_Processed_Universal_V8.csv';
const V2_RESULTS_FILE = 'test_run_results_v2 - test_run_results_v2 (1).csv'; // Ground Truth
const OUTPUT_REMEDIATION_FILE = 'leads_to_remediate.csv';

async function readCSV(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(parse({ columns: true, skip_empty_lines: true })) // Treat headers as keys
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (err) => reject(err));
    });
}

async function analyze() {
    console.log("Reading CSVs...");
    const apexData = await readCSV(APEX_RESULTS_FILE);
    const v2Data = await readCSV(V2_RESULTS_FILE);

    // Create a map of V2 data
    const truthMap = {};
    for (const row of v2Data) {
        // Normalizing key access
        const name = row['Deceased Name_PARSED'] || row['Owner Name'];
        if (name) {
            truthMap[name.trim().toLowerCase()] = {
                status: row['Status'] || row['Correct'] || '',
                phone: row['PR Phone_FOUND'] || row['Phone'] || ''
            };
        }
    }

    const toRemediate = [];
    let retainCount = 0;
    let fixCount = 0;
    let noResultCount = 0;
    let regressionCount = 0;
    let newResultCount = 0;

    for (const row of apexData) {
        const name = row['Deceased Name_PARSED'] || row['Owner Name']; // Use same fallback
        const apexPhone = row['PR 1 Phone'] ? row['PR 1 Phone'].trim() : '';
        const apexStatus = row['PR 1 Match Reasoning'] || '';
        
        const normName = name ? name.trim().toLowerCase() : '';
        const v2Datum = truthMap[normName];

        // 1. NO RESULT
        if (!apexPhone || apexStatus.includes('Exhausted') || apexPhone === '') {
            noResultCount++;
            row.Remediation_Type = 'NO_RESULT';
            // We want to verify if this is a regression (i.e., V2 had a correct result)
            if (v2Datum && v2Datum.status.toLowerCase().includes('correct') && v2Datum.phone) {
                 row.Remediation_Type = 'REGRESSION_LOST_LEAD'; 
                 regressionCount++;
            }
            toRemediate.push(row);
            continue;
        }

        // 2. HAS RESULT
        if (v2Datum) {
            const v2Phone = v2Datum.phone ? v2Datum.phone.trim() : '';
            const isV2Correct = v2Datum.status.toLowerCase().includes('correct');
            const isV2Incorrect = v2Datum.status.toLowerCase().includes('incorrect');

            // Compare Phones (simple string matching for now, maybe strip non-digits)
            const p1 = apexPhone.replace(/\D/g, '');
            const p2 = v2Phone.replace(/\D/g, '');
            const phonesMatch = p1 === p2 && p1.length > 0;

            if (phonesMatch) {
                if (isV2Correct) {
                    retainCount++; // Good job
                } else if (isV2Incorrect) {
                     fixCount++;
                     row.Remediation_Type = 'FIX_REPEATED_ERROR';
                     toRemediate.push(row);
                } else {
                    // Ambiguous V2 status but same result? Retain.
                    retainCount++;
                }
            } else {
                // Different Results
                if (isV2Correct) {
                    // We have a result, but V2 had a DIFFERENT correct result? 
                    // Or maybe we have a result and V2 had NO result/Incorrect?
                    // If V2 was Correct and we don't match it -> Regression or Alternative Number
                    regressionCount++;
                    row.Remediation_Type = 'REGRESSION_MISMATCHED_CORRECT'; // Potentially wrong number found
                    row.V2_Expected_Phone = v2Phone; // Save for debugging
                    toRemediate.push(row);
                } else {
                    // V2 was Incorrect or Empty, and we have a New Number -> New Result
                    newResultCount++;
                    // Ideally we verify this new result, but for now it's not a remediation target unless we want to "Different Result" check
                    // User said "get different results from the incorrect ones", which implies if we found a new one, we are good?
                    // We'll mark it as 'VERIFY_NEW' if we want, or skip.
                    // Let's assume these are GOOD for now.
                }
            }
        } else {
            // No V2 history for this name? (Maybe new file has more rows?)
            // Just count as New Result
            newResultCount++;
        }
    }

    console.log(`\nAnalysis Complete:`);
    console.log(`- Retain (Validated): ${retainCount}`);
    console.log(`- New Results (Potential Improvement): ${newResultCount}`);
    console.log(`- Fix (Repeated Incorrect): ${fixCount}`);
    console.log(`- Find (No Result): ${noResultCount}`);
    console.log(`- Regression (Lost/Changed Correct): ${regressionCount}`);
    console.log(`Total Remediation Targets (Fix + NoResult + Regression): ${toRemediate.length}`);

    // Write Remediation CSV
    if (toRemediate.length > 0) {
        const csvWriter = createCsvWriter({
            path: OUTPUT_REMEDIATION_FILE,
            header: Object.keys(toRemediate[0]).map(id => ({id, title: id}))
        });
        await csvWriter.writeRecords(toRemediate);
        console.log(`\nWritten remediation targets to: ${OUTPUT_REMEDIATION_FILE}`);
    }
}

analyze();
