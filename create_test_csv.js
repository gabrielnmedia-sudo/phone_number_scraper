const fs = require('fs');
const csv = require('csv-parser');

const inputFile = './test_run_results_v2 - test_run_results_v2.csv';
const outputFile = './Fresh_Test_Run.csv';

const inputHeaders = [
    'County Name',
    'Record Type',
    'Property Address',
    'Owner Name',
    'Call Attempts',
    'Document Number',
    'Notes'
];

async function createCleanCSV() {
    const rows = [];
    
    if (!fs.existsSync(inputFile)) {
        console.error(`Input file not found: ${inputFile}`);
        return;
    }

    fs.createReadStream(inputFile)
        .pipe(csv())
        .on('data', (row) => {
            // Only take non-empty rows with an Owner Name
            if (row['Owner Name'] && row['Owner Name'].trim() !== '') {
                const cleanRow = {};
                inputHeaders.forEach(header => {
                    cleanRow[header] = row[header] || '';
                });
                rows.push(cleanRow);
            }
        })
        .on('end', () => {
            // Write headers
            const headerLine = inputHeaders.join(',') + '\n';
            fs.writeFileSync(outputFile, headerLine);
            
            // Write data rows
            rows.forEach(row => {
                const csvRow = inputHeaders.map(header => {
                    let val = row[header] || '';
                    // Escape quotes and handle commas/newlines
                    if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
                        val = `"${val.replace(/"/g, '""')}"`;
                    }
                    return val;
                }).join(',');
                fs.appendFileSync(outputFile, csvRow + '\n');
            });
            
            console.log(`Created ${outputFile} with ${rows.length} rows.`);
        });
}

createCleanCSV();
