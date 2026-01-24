/**
 * Column Separation Utility
 * 
 * This script ONLY separates the Owner Name column into separate
 * Deceased Name and PR Name columns WITHOUT scraping.
 * 
 * Use this to:
 * 1. Review the parsing quality before running the full scraper
 * 2. Create a clean CSV with separated columns for other purposes
 */

const fs = require('fs');
const csv = require('csv-parser');
const { parseOwnerName, extractPRs } = require('./name_parser');

const INPUT_FILE = './Data Tracking - NEW LEADS COMING IN.csv';
const OUTPUT_FILE = './Data_Tracking_Columns_Separated.csv';

async function separateColumns() {
    console.log('='.repeat(60));
    console.log('COLUMN SEPARATION UTILITY');
    console.log('='.repeat(60));
    console.log(`Input:  ${INPUT_FILE}`);
    console.log(`Output: ${OUTPUT_FILE}`);
    console.log('');
    
    // Read CSV
    const rows = [];
    await new Promise((resolve, reject) => {
        fs.createReadStream(INPUT_FILE)
            .pipe(csv())
            .on('data', row => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
    });
    
    console.log(`📂 Read ${rows.length} rows`);
    
    // Get headers
    const inputHeaders = Object.keys(rows[0] || {});
    
    // Find position of Owner Name column to insert new columns after it
    const ownerNameIndex = inputHeaders.indexOf('Owner Name');
    
    // New columns to add
    const newColumns = ['Deceased Name_PARSED', 'PR Name_PARSED', 'Is Probate', 'PR List'];
    
    // Create output headers - insert new columns after Owner Name
    const outputHeaders = [
        ...inputHeaders.slice(0, ownerNameIndex + 1),
        ...newColumns,
        ...inputHeaders.slice(ownerNameIndex + 1)
    ];
    
    // Process stats
    let stats = {
        total: 0,
        probate: 0,
        nonProbate: 0,
        empty: 0,
        bothParsed: 0,
        onlyDeceased: 0,
        onlyPR: 0,
        noParsed: 0
    };
    
    // Process each row
    const processedRows = rows.map((row, i) => {
        stats.total++;
        const ownerName = row['Owner Name'] || '';
        
        if (!ownerName.trim()) {
            stats.empty++;
            return {
                ...row,
                'Deceased Name_PARSED': '',
                'PR Name_PARSED': '',
                'Is Probate': '',
                'PR List': ''
            };
        }
        
        const parsed = parseOwnerName(ownerName);
        
        // Track parsing quality
        if (parsed.is_probate) stats.probate++;
        else stats.nonProbate++;
        
        if (parsed.deceased_name && parsed.pr_name) stats.bothParsed++;
        else if (parsed.deceased_name && !parsed.pr_name) stats.onlyDeceased++;
        else if (!parsed.deceased_name && parsed.pr_name) stats.onlyPR++;
        else stats.noParsed++;
        
        // Extract multiple PRs if present
        const prList = extractPRs(parsed.pr_name || '').join('; ');
        
        return {
            ...row,
            'Deceased Name_PARSED': parsed.deceased_name || '',
            'PR Name_PARSED': parsed.pr_name || '',
            'Is Probate': parsed.is_probate ? 'Yes' : 'No',
            'PR List': prList
        };
    });
    
    // Write output CSV
    const lines = [outputHeaders.join(',')];
    
    for (const row of processedRows) {
        const csvRow = outputHeaders.map(header => {
            let val = row[header] || '';
            if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
                val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        }).join(',');
        lines.push(csvRow);
    }
    
    fs.writeFileSync(OUTPUT_FILE, lines.join('\n'));
    
    // Print summary
    console.log('');
    console.log('📊 Parsing Statistics:');
    console.log('─'.repeat(40));
    console.log(`   Total Rows:           ${stats.total}`);
    console.log(`   Empty Owner Names:    ${stats.empty}`);
    console.log(`   Probate Records:      ${stats.probate}`);
    console.log(`   Non-Probate Records:  ${stats.nonProbate}`);
    console.log('');
    console.log('   Parsing Quality:');
    console.log(`   ✅ Both Parsed:       ${stats.bothParsed}`);
    console.log(`   ⚠️  Only Deceased:     ${stats.onlyDeceased}`);
    console.log(`   ⚠️  Only PR:           ${stats.onlyPR}`);
    console.log(`   ❌ Neither Parsed:    ${stats.noParsed}`);
    console.log('');
    console.log(`📁 Output saved to: ${OUTPUT_FILE}`);
    console.log('');
    console.log('💡 Tip: Open the output CSV to review the parsed columns.');
    console.log('        Look for rows where Is Probate = "Yes" but names are empty.');
    
    // Print some examples
    console.log('');
    console.log('📝 Sample Parsed Records:');
    console.log('─'.repeat(40));
    
    let exampleCount = 0;
    for (const row of processedRows) {
        if (row['Is Probate'] === 'Yes' && row['Deceased Name_PARSED'] && row['PR Name_PARSED']) {
            if (exampleCount >= 5) break;
            console.log(`   Original: "${row['Owner Name']?.substring(0, 60)}..."`);
            console.log(`   Deceased: ${row['Deceased Name_PARSED']}`);
            console.log(`   PR:       ${row['PR Name_PARSED']}`);
            console.log('');
            exampleCount++;
        }
    }
}

separateColumns().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
