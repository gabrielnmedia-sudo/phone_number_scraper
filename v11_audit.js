const fs = require('fs');
const parse = require('csv-parser');

async function auditV11(resultsFile) {
    const truthFile = 'test_run_results_v2 - test_run_results_v2 (1).csv';
    const truth = [];
    const results = [];

    if (!fs.existsSync(resultsFile)) {
        console.log(`Results file ${resultsFile} does not exist yet.`);
        return;
    }

    await new Promise(res => fs.createReadStream(truthFile).pipe(parse()).on('data', r => truth.push(r)).on('end', res));
    await new Promise(res => fs.createReadStream(resultsFile).pipe(parse()).on('data', r => results.push(r)).on('end', res));

    const confirmedCorrect = truth.filter(r => (r.Status || '').toLowerCase().trim() === 'correct');
    const confirmedIncorrect = truth.filter(r => (r.Status || '').toLowerCase().trim() === 'incorrect');

    let correctRetained = 0;
    let incorrectFixed = 0;
    let totalProcessed = results.length;
    let totalFound = results.filter(r => r['PR 1 Phone'] && r['PR 1 Phone'].trim() !== '').length;

    console.log(`\n=== V11 PERFORMANCE AUDIT: ${resultsFile} ===`);
    console.log(`Total Leads Processed: ${totalProcessed}`);
    console.log(`Total Matches Found:   ${totalFound} (${Math.round(totalFound/totalProcessed*100)}%)`);

    console.log(`\n--- BENCHMARK: 27 CONFIRMED CORRECT LEADS ---`);
    confirmedCorrect.forEach(t => {
        const name = (t['Deceased Name_PARSED'] || t['Owner Name']).trim().toLowerCase();
        const r = results.find(res => (res['Deceased Name_PARSED'] || res['Owner Name'] || '').trim().toLowerCase() === name);
        
        const truthPhone = (t['PR Phone_FOUND'] || t['Phone'] || '').replace(/\D/g, '');
        const foundPhone = (r ? (r['PR 1 Phone'] || '').replace(/\D/g, '') : '');
        const allFoundPhones = (r ? (r['PR 1 All Phones'] || '').replace(/\D/g, '') : '');

        if (truthPhone && (foundPhone === truthPhone || allFoundPhones.includes(truthPhone))) {
            correctRetained++;
        } else if (truthPhone) {
            if (foundPhone) {
                console.log(`⚠️ MISMATCH for ${t['Owner Name']}: Expected ${truthPhone}, Found primary ${foundPhone}`);
            } else {
                console.log(`❌ MISSING for ${t['Owner Name']}: Expected ${truthPhone}`);
            }
        }
    });

    console.log(`\nRETENTION RATE: ${correctRetained}/27 (${Math.round(correctRetained/27*100)}%)`);

    console.log(`\n--- BENCHMARK: 17 CONFIRMED INCORRECT LEADS ---`);
    confirmedIncorrect.forEach(t => {
        const name = (t['Deceased Name_PARSED'] || t['Owner Name']).trim().toLowerCase();
        const r = results.find(res => (res['Deceased Name_PARSED'] || res['Owner Name'] || '').trim().toLowerCase() === name);
        
        const oldBadPhone = (t['PR Phone_FOUND'] || t['Phone'] || '').replace(/\D/g, '');
        if (r && r['PR 1 Phone']) {
            const foundPhone = r['PR 1 Phone'].replace(/\D/g, '');
            if (foundPhone !== oldBadPhone && foundPhone.length >= 10) {
                incorrectFixed++;
            }
        }
    });

    const stats = {
        totalProcessed,
        totalFound,
        correctRetained,
        incorrectFixed,
        totalTruthCorrect: confirmedCorrect.length,
        totalTruthIncorrect: confirmedIncorrect.length
    };
    fs.writeFileSync('v11_audit_summary.json', JSON.stringify(stats, null, 2));

    console.log(`CORRECTION RATE: ${incorrectFixed}/${confirmedIncorrect.length} (${Math.round(incorrectFixed/confirmedIncorrect.length*100)}%)`);
    console.log(`==========================================\n`);
}

const target = process.argv[2] || 'Data_Tracking_Processed_Universal_V11.csv';
auditV11(target);
