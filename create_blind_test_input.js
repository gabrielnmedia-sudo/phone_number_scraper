/**
 * create_blind_test_input.js
 * 
 * Strips phone numbers and status from benchmark CSV to simulate production environment.
 * This creates a "blind" test input where the system cannot know correct answers.
 */

const fs = require('fs');
const csv = require('csv-parser');

const CONFIG = {
    INPUT_FILE: './test_run_results_v2 - test_run_results_v2 (1).csv',
    OUTPUT_FILE: './blind_test_input.csv',
    // Columns to strip (these contain "answers" we want to hide)
    COLUMNS_TO_STRIP: [
        'PR Phone_FOUND',
        'All Phones',
        'Match Confidence',
        'Source',
        'Detail URL',
        'Match Reasoning',
        'Status',
        'Needs Manual Skiptrace'
    ]
};

async function main() {
    console.log('='.repeat(60));
    console.log('BLIND TEST INPUT GENERATOR');
    console.log('='.repeat(60));
    console.log(`Input:  ${CONFIG.INPUT_FILE}`);
    console.log(`Output: ${CONFIG.OUTPUT_FILE}`);
    console.log(`Stripping columns: ${CONFIG.COLUMNS_TO_STRIP.join(', ')}`);
    console.log('');

    const rows = [];

    await new Promise((resolve, reject) => {
        fs.createReadStream(CONFIG.INPUT_FILE)
            .pipe(csv())
            .on('data', row => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
    });

    if (rows.length === 0) {
        console.error('No rows found in input file');
        return;
    }

    // Filter out empty rows
    const validRows = rows.filter(row => {
        const ownerName = row['Owner Name'] || '';
        return ownerName.trim() !== '';
    });

    console.log(`Total rows: ${rows.length}`);
    console.log(`Valid rows (with Owner Name): ${validRows.length}`);

    // Get headers, excluding stripped columns
    const allHeaders = Object.keys(rows[0]);
    const outputHeaders = allHeaders.filter(h => !CONFIG.COLUMNS_TO_STRIP.includes(h));

    console.log(`\nOriginal headers: ${allHeaders.length}`);
    console.log(`Output headers: ${outputHeaders.length}`);

    // Write output CSV
    const csvRows = [outputHeaders.join(',')];

    for (const row of validRows) {
        const values = outputHeaders.map(h => {
            let v = row[h] || '';
            // Escape CSV values
            if (typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))) {
                v = `"${v.replace(/"/g, '""')}"`;
            }
            return v;
        });
        csvRows.push(values.join(','));
    }

    fs.writeFileSync(CONFIG.OUTPUT_FILE, csvRows.join('\n'));
    console.log(`\n✅ Created blind test input: ${CONFIG.OUTPUT_FILE}`);
    console.log(`   ${validRows.length} leads ready for testing`);
}

main().catch(console.error);
