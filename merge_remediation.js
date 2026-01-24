const fs = require('fs');
const parse = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const MASTER_FILE = 'Data_Tracking_Processed_Parallel_Apex.csv';
const REMEDIATION_FILE = 'remediated_results.csv';
const OUTPUT_FILE = 'Data_Tracking_Processed_Parallel_Finale.csv';

async function readCSV(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(parse({ columns: true, skip_empty_lines: true }))
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results))
            .on('error', (err) => reject(err));
    });
}

async function merge() {
    console.log("Reading files...");
    const master = await readCSV(MASTER_FILE);
    let remediation = [];
    try {
        remediation = await readCSV(REMEDIATION_FILE);
    } catch (e) {
        console.log("No remediation file found yet, or empty.");
    }

    // Create lookup for remediation
    const remediationMap = {};
    for (const row of remediation) {
        const name = row['Deceased Name_PARSED'] || row['Owner Name'];
        if (name) remediationMap[name.trim().toLowerCase()] = row;
    }

    let recoveredCount = 0;
    const finalData = master.map(row => {
        const name = row['Deceased Name_PARSED'] || row['Owner Name'];
        if (!name) return row;

        const key = name.trim().toLowerCase();
        const fix = remediationMap[key];

        if (fix && fix['Match_Status'] === 'Recovered') {
            // Apply fix
            recoveredCount++;
            return {
                ...row,
                'PR 1 Phone': fix['PR 1 Phone'],
                'PR 1 All Phones': fix['PR 1 All Phones'],
                'PR 1 Source': fix['PR 1 Source'],
                'PR 1 Match Reasoning': fix['PR 1 Match Reasoning'],
                'Match_Status': 'Recovered (Tier 2 Scrape)'
            };
        }
        return row;
    });

    console.log(`Merged ${recoveredCount} recovered leads into final dataset.`);

    const csvWriter = createCsvWriter({
        path: OUTPUT_FILE,
        header: Object.keys(finalData[0]).map(id => ({id, title: id}))
    });
    await csvWriter.writeRecords(finalData);
    console.log(`Saved final dataset to: ${OUTPUT_FILE}`);
}

merge();
