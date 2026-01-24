/**
 * Enhanced CSV Processor for Probate Phone Number Scraping
 * 
 * Features:
 * 1. Intelligently separates Deceased and PR names from combined column
 * 2. Handles multiple pages of search results
 * 3. Automatically clicks "View Details" for each candidate
 * 4. Robust matching with confidence scoring
 */

const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { parseOwnerName, extractPRs } = require('./name_parser');
const EnhancedScraper = require('./enhanced_scraper');
const { matchProfile } = require('./matcher');
require('dotenv').config();

// Configuration
const CONFIG = {
    INPUT_FILE: './Data Tracking - NEW LEADS COMING IN.csv',
    OUTPUT_FILE: './Data_Tracking_Processed_Enhanced.csv',
    OWNER_NAME_COLUMN: 'Owner Name',
    PROPERTY_ADDRESS_COLUMN: 'Property Address',
    RECORD_TYPE_COLUMN: 'Record Type',
    
    // Processing options
    MAX_PAGES_PER_SEARCH: 3,
    CONFIDENCE_THRESHOLD: 50,
    RATE_LIMIT_MS: 500,
    
    // Set to true to only process probate records
    PROBATE_ONLY: true, // Only process Probate records
    
    // Set to a number to limit processing (for testing)
    MAX_ROWS: null, // null = process all rows
    
    // Set to true to skip rows that already have contact info
    SKIP_WITH_CONTACT: true // Skip rows that already have contact info
};

/**
 * Parse city and state from a property address
 */
function parseAddress(address) {
    if (!address) return { city: '', state: '' };
    
    // Handle multi-line addresses (some have newlines)
    const cleanAddr = address.replace(/\n/g, ', ').trim();
    
    // Try to parse "City, State ZIP" pattern
    const match = cleanAddr.match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})?/i);
    if (match) {
        return {
            city: match[1].trim(),
            state: match[2].toUpperCase()
        };
    }
    
    // Fallback: split by comma and take last parts
    const parts = cleanAddr.split(',').map(p => p.trim());
    if (parts.length >= 2) {
        const lastPart = parts[parts.length - 1];
        const stateMatch = lastPart.match(/([A-Z]{2})/i);
        return {
            city: parts[parts.length - 2] || '',
            state: stateMatch ? stateMatch[1].toUpperCase() : ''
        };
    }
    
    return { city: '', state: 'WA' }; // Default to WA
}

/**
 * Main processing function
 */
async function processEnhancedCSV() {
    console.log('='.repeat(60));
    console.log('ENHANCED PROBATE PHONE NUMBER SCRAPER');
    console.log('='.repeat(60));
    console.log(`Input:  ${CONFIG.INPUT_FILE}`);
    console.log(`Output: ${CONFIG.OUTPUT_FILE}`);
    console.log('');
    
    // Read CSV
    console.log('📂 Reading CSV file...');
    const rows = await readCSV(CONFIG.INPUT_FILE);
    console.log(`   Found ${rows.length} total rows`);
    
    // Initialize scraper
    const scraper = new EnhancedScraper();
    
    // Prepare output headers
    const inputHeaders = Object.keys(rows[0] || {});
    const outputHeaders = [
        ...inputHeaders,
        'Deceased Name_PARSED',
        'PR Name_PARSED',
        'Is Probate',
        'PR Phone_FOUND',
        'All Phones',
        'Match Confidence',
        'Match Reasoning',
        'Source',
        'Detail URL'
    ];
    
    // Initialize output file with headers
    fs.writeFileSync(CONFIG.OUTPUT_FILE, outputHeaders.join(',') + '\n');
    
    // Process statistics
    let stats = {
        total: 0,
        probate: 0,
        nonProbate: 0,
        skipped: 0,
        searched: 0,
        found: 0,
        noMatch: 0,
        errors: 0
    };
    
    const maxRows = CONFIG.MAX_ROWS || rows.length;
    
    for (let i = 0; i < Math.min(rows.length, maxRows); i++) {
        const row = rows[i];
        stats.total++;
        
        const ownerName = row[CONFIG.OWNER_NAME_COLUMN];
        const address = row[CONFIG.PROPERTY_ADDRESS_COLUMN];
        const recordType = row[CONFIG.RECORD_TYPE_COLUMN];
        const existingContact = row['Contact Info'];
        
        // Skip empty rows
        if (!ownerName || ownerName.trim() === '') {
            stats.skipped++;
            continue;
        }
        
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`📋 Row ${i + 1}/${rows.length}: ${ownerName.substring(0, 50)}...`);
        
        // Parse the owner name to separate deceased and PR
        const parsed = parseOwnerName(ownerName);
        
        // Prepare output row
        const outputRow = {
            ...row,
            'Deceased Name_PARSED': parsed.deceased_name || '',
            'PR Name_PARSED': parsed.pr_name || '',
            'Is Probate': parsed.is_probate ? 'Yes' : 'No',
            'PR Phone_FOUND': '',
            'All Phones': '',
            'Match Confidence': '',
            'Match Reasoning': '',
            'Source': '',
            'Detail URL': ''
        };
        
        // Skip non-probate if configured - don't write to output
        if (CONFIG.PROBATE_ONLY && !parsed.is_probate) {
            stats.nonProbate++;
            continue;  // Skip entirely, don't write to output
        }
        
        // Skip if already has contact info
        if (CONFIG.SKIP_WITH_CONTACT && existingContact && existingContact.trim() !== '') {
            console.log('   ⏭️  Skipping (already has contact info)');
            stats.skipped++;
            if (parsed.is_probate) stats.probate++;
            writeRow(CONFIG.OUTPUT_FILE, outputHeaders, outputRow);
            continue;
        }
        
        // For Probate records: Search for PR name
        stats.probate++;
        let searchName = '';
        
        if (!parsed.pr_name || parsed.pr_name === 'Unknown') {
            console.log('   ⚠️  No PR name found');
            outputRow['Match Reasoning'] = 'No PR name extracted from Owner Name';
            writeRow(CONFIG.OUTPUT_FILE, outputHeaders, outputRow);
            stats.noMatch++;
            continue;
        }
        searchName = parsed.pr_name;
        
        // Parse address for city/state
        const { city, state } = parseAddress(address);
        console.log(`   👤 PR: ${searchName}`);
        console.log(`   📍 Location: ${city}, ${state}`);
        
        stats.searched++;
        
        try {
            // Search with pagination and view details
            console.log(`   🔍 Searching for: ${searchName}`);
            const candidates = await scraper.intelligentSearch(
                searchName, 
                city, 
                state,
                { maxPages: CONFIG.MAX_PAGES_PER_SEARCH }
            );
            
            if (candidates.length === 0) {
                console.log('   ❌ No candidates found');
                outputRow['Match Reasoning'] = 'No candidates found in search';
                writeRow(CONFIG.OUTPUT_FILE, outputHeaders, outputRow);
                stats.noMatch++;
                continue;
            }
            
            console.log(`   📊 Found ${candidates.length} candidate(s)`);
            
            // Match against candidates
            const match = await matchProfile(
                parsed.deceased_name || searchName, // Use searchName if no deceased (for APT)
                `${city}, ${state}`,
                searchName,
                candidates
            );
            
            outputRow['Match Confidence'] = match.confidence || 0;
            outputRow['Match Reasoning'] = match.reasoning || '';
            
            if (match.bestMatchIndex !== -1 && match.confidence >= CONFIG.CONFIDENCE_THRESHOLD) {
                const best = candidates[match.bestMatchIndex];
                
                // Collect all phones
                const allPhones = new Set([
                    ...(best.visiblePhones || []),
                    ...(best.allPhones || [])
                ]);
                
                const phoneList = [...allPhones].filter(p => p && p.length >= 10);
                
                if (phoneList.length > 0) {
                    outputRow['PR Phone_FOUND'] = phoneList[0];
                    outputRow['All Phones'] = phoneList.join(' | ');
                    outputRow['Source'] = best.source;
                    outputRow['Detail URL'] = best.detailLink || '';
                    
                    console.log(`   ✅ MATCH: ${best.fullName} (${match.confidence}%)`);
                    console.log(`   📞 Phones: ${phoneList.join(', ')}`);
                    stats.found++;
                } else {
                    console.log(`   ⚠️  Match found but no phone numbers`);
                    outputRow['Match Reasoning'] = 'Match found but no phone numbers on profile';
                    stats.noMatch++;
                }
            } else {
                console.log(`   ❌ No high-confidence match (best: ${match.confidence || 0}%)`);
                stats.noMatch++;
            }
            
        } catch (error) {
            console.error(`   💥 Error: ${error.message}`);
            outputRow['Match Reasoning'] = `Error: ${error.message}`;
            stats.errors++;
        }
        
        // Write row to output
        writeRow(CONFIG.OUTPUT_FILE, outputHeaders, outputRow);
        
        // Rate limiting between rows
        await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_MS));
    }
    
    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('PROCESSING COMPLETE');
    console.log('='.repeat(60));
    console.log(`📊 Statistics:`);
    console.log(`   Total Rows:      ${stats.total}`);
    console.log(`   Probate Records: ${stats.probate}`);
    console.log(`   Non-Probate:     ${stats.nonProbate}`);
    console.log(`   Skipped:         ${stats.skipped}`);
    console.log(`   Searched:        ${stats.searched}`);
    console.log(`   Found Phones:    ${stats.found} (${((stats.found/stats.searched)*100).toFixed(1)}%)`);
    console.log(`   No Match:        ${stats.noMatch}`);
    console.log(`   Errors:          ${stats.errors}`);
    console.log(`\n📁 Output saved to: ${CONFIG.OUTPUT_FILE}`);
}

/**
 * Read CSV file into array of objects
 */
function readCSV(filepath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(filepath)
            .pipe(csv())
            .on('data', row => rows.push(row))
            .on('end', () => resolve(rows))
            .on('error', reject);
    });
}

/**
 * Write a row to the output CSV
 */
function writeRow(filepath, headers, rowData) {
    const csvRow = headers.map(header => {
        let val = rowData[header] || '';
        if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
            val = `"${val.replace(/"/g, '""')}"`;
        }
        return val;
    }).join(',');
    
    fs.appendFileSync(filepath, csvRow + '\n');
}

// Run the processor
processEnhancedCSV().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
