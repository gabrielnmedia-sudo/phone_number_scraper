const fs = require('fs');
const csv = require('csv-parser');

const BENCHMARK_FILE = 'test_run_results_v2 - test_run_results_v2 (1).csv';
const NEW_FILE = 'Data_Tracking_Processed_Universal_V11.csv';

async function loadCsv(filePath) {
    const rows = [];
    return new Promise((resolve) => {
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                if (data['Owner Name'] && data['Owner Name'].trim() !== '') {
                    rows.push(data);
                }
            })
            .on('end', () => resolve(rows));
    });
}

function cleanPhone(p) {
    if (!p) return '';
    return p.replace(/\D/g, '').slice(-10);
}

async function runComparison() {
    console.log('--- Skip Tracing Audit: V11.12 vs Benchmark ---');
    
    const benchmarkRows = await loadCsv(BENCHMARK_FILE);
    const newRows = await loadCsv(NEW_FILE);

    console.log(`Loaded ${benchmarkRows.length} benchmark rows.`);
    console.log(`Loaded ${newRows.length} new result rows.`);

    const newMap = new Map();
    newRows.forEach(row => {
        const key = row['Owner Name'].trim().toLowerCase();
        newMap.set(key, row);
    });

    let stats = {
        correct_total: 0,
        correct_retained: 0,
        correct_lost: 0,
        correct_changed: 0,
        incorrect_total: 0,
        incorrect_fixed_new_phone: 0,
        incorrect_still_same: 0,
        incorrect_now_empty: 0,
        newly_found: 0,
        total_leads_compared: 0
    };

    benchmarkRows.forEach(bench => {
        const ownerName = bench['Owner Name'].trim();
        const key = ownerName.toLowerCase();
        const status = bench['Status'];
        const oldPhone = bench['PR Phone_FOUND'];
        const cleanOld = cleanPhone(oldPhone);

        const newRow = newMap.get(key);
        if (!newRow) return;

        stats.total_leads_compared++;
        const newPhone = newRow['PR 1 Phone'];
        const cleanNew = cleanPhone(newPhone);

        if (status === 'Correct') {
            stats.correct_total++;
            if (!cleanNew) {
                stats.correct_lost++;
                console.log(`[-] LOST CORRECT: ${ownerName} (Old: ${oldPhone}, New: NONE)`);
            } else if (cleanNew === cleanOld) {
                stats.correct_retained++;
            } else {
                stats.correct_changed++;
                console.log(`[!] CHANGED CORRECT: ${ownerName} (Old: ${oldPhone}, New: ${newPhone})`);
            }
        } else if (status === 'Incorrect') {
            stats.incorrect_total++;
            if (!cleanNew) {
                stats.incorrect_now_empty++;
            } else if (cleanNew === cleanOld) {
                stats.incorrect_still_same++;
                console.log(`[x] STILL WRONG: ${ownerName} (Phone: ${oldPhone})`);
            } else {
                stats.incorrect_fixed_new_phone++;
                console.log(`[+] FIXED INCORRECT: ${ownerName} (Old: ${oldPhone}, New: ${newPhone})`);
            }
        } else {
            // Previously NO status or something else
            if (cleanNew && !cleanOld) {
                stats.newly_found++;
                console.log(`[*] NEWLY FOUND: ${ownerName} (New: ${newPhone})`);
            }
        }
    });

    console.log('\n--- SUMMARY ---');
    console.log(`Total Leads Compared: ${stats.total_leads_compared}`);
    console.log(`\nCORRECT LEADS (${stats.correct_total}):`);
    console.log(`  Retained: ${stats.correct_retained} (${Math.round(stats.correct_retained/stats.correct_total*100)}%)`);
    console.log(`  Lost:     ${stats.correct_lost}`);
    console.log(`  Changed:  ${stats.correct_changed}`);
    
    console.log(`\nINCORRECT LEADS (${stats.incorrect_total}):`);
    console.log(`  Fixed (New Phone): ${stats.incorrect_fixed_new_phone}`);
    console.log(`  Still Same:        ${stats.incorrect_still_same}`);
    console.log(`  Now Empty:         ${stats.incorrect_now_empty}`);

    console.log(`\nNEW FINDINGS:`);
    console.log(`  Newly Found:       ${stats.newly_found}`);
    
    const accuracy = ((stats.correct_retained + stats.incorrect_fixed_new_phone) / stats.total_leads_compared * 100).toFixed(1);
    console.log(`\nInferred Quality Score: ${accuracy}%`);
}

runComparison().catch(console.error);
