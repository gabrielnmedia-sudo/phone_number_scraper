const fs = require('fs');
const csv = require('csv-parser');

const annotatedFile = './test_run_results_v2 - test_run_results_v2 (1).csv';
const resultsFile = './Data_Tracking_Processed_Universal_V11.csv';

async function readCSV(path) {
    return new Promise((resolve) => {
        const results = [];
        if (!fs.existsSync(path)) return resolve([]);
        fs.createReadStream(path)
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', () => resolve(results));
    });
}

function normalizePhone(p) {
    if (!p) return '';
    return p.replace(/\D/g, '').slice(-10);
}

async function compare() {
    const annotatedRows = await readCSV(annotatedFile);
    const resultRows = await readCSV(resultsFile);

    console.log(`📂 Loaded ${annotatedRows.length} annotated rows and ${resultRows.length} result rows.\n`);

    const resultStore = new Map();
    resultRows.forEach(row => {
        const key = `${row['Owner Name']}|${row['Property Address']}`.toLowerCase().trim();
        resultStore.set(key, row);
    });

    const report = {
        stillCorrect: 0,
        nowDifferent: 0,
        newFoundForIncorrect: 0,
        newFoundForNoResult: 0,
        details: []
    };

    annotatedRows.forEach(aRow => {
        const ownerName = aRow['Owner Name'];
        const address = aRow['Property Address'];
        if (!ownerName || ownerName === '') return;

        const key = `${ownerName}|${address}`.toLowerCase().trim();
        const rRow = resultStore.get(key);
        const status = aRow['Status'];

        if (!rRow) return;

        const oldPhone = normalizePhone(aRow['PR Phone_FOUND']);
        const newPhone = normalizePhone(rRow['PR 1 Phone']);

        if (status === 'Correct') {
            if (oldPhone === newPhone) {
                report.stillCorrect++;
            } else {
                report.nowDifferent++;
                report.details.push({
                    ownerName,
                    type: 'Correct row changed',
                    oldPhone: aRow['PR Phone_FOUND'],
                    newPhone: rRow['PR 1 Phone'],
                    reason: rRow['PR 1 Match Reasoning']
                });
            }
        } else if (status === 'Incorrect') {
            if (newPhone && newPhone !== oldPhone) {
                report.newFoundForIncorrect++;
                report.details.push({
                    ownerName,
                    type: 'Incorrect row updated',
                    oldPhone: aRow['PR Phone_FOUND'],
                    newPhone: rRow['PR 1 Phone'],
                    reason: rRow['PR 1 Match Reasoning']
                });
            }
        } else if (status === 'No result') {
            if (newPhone) {
                report.newFoundForNoResult++;
                report.details.push({
                    ownerName,
                    type: 'No Result row found info',
                    newPhone: rRow['PR 1 Phone'],
                    reason: rRow['PR 1 Match Reasoning']
                });
            }
        }
    });

    console.log('=== FINAL AUDIT REPORT (V3) ===');
    console.log(`✅ STILL CORRECT: ${report.stillCorrect}`);
    console.log(`⚠️  REJECTED/CHANGED (STRICTER): ${report.nowDifferent}`);
    console.log(`✨ RECOVERED (PREV INCORRECT): ${report.newFoundForIncorrect}`);
    console.log(`⭐ RECOVERED (PREV NO RESULT): ${report.newFoundForNoResult}`);
    console.log('===============================\n');

    console.log('--- Regression Analysis (REJECTED/CHANGED) ---');
    report.details.filter(d => d.type === 'Correct row changed').forEach(d => {
        console.log(`[REGRESSION] ${d.ownerName}`);
        console.log(`   Old Phone: ${d.oldPhone}`);
        console.log(`   New Phone: ${d.newPhone || 'NONE'}`);
        console.log(`   V3 Reasoning: ${d.reason}\n`);
    });

    console.log('--- Recovery Details ---');
    report.details.filter(d => d.type.includes('Incorrect') || d.type.includes('No Result')).forEach(d => {
        console.log(`[RECOVERED] ${d.ownerName} -> ${d.newPhone}`);
    });
}

compare();
