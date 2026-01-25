/**
 * calibration_audit.js
 * 
 * Validates confidence-to-accuracy correlation using the benchmark file.
 * The benchmark has both results (PR Phone_FOUND, Match Confidence) and ground truth (Status).
 * 
 * Usage: node calibration_audit.js [benchmark_file]
 */

const fs = require('fs');
const csv = require('csv-parser');

const CONFIG = {
    BENCHMARK_FILE: process.argv[2] || './test_run_results_v2 - test_run_results_v2 (1).csv',
    
    TIERS: [
        { name: 'VERIFIED (85-100)', min: 85, max: 100, targetAccuracy: 90 },
        { name: 'PROBABLE (70-84)', min: 70, max: 84, targetAccuracy: 80 },
        { name: 'PLAUSIBLE (40-69)', min: 40, max: 69, targetAccuracy: 60 },
        { name: 'LOW (<40)', min: 0, max: 39, targetAccuracy: 0 }
    ]
};

async function loadCSV(filePath) {
    const rows = [];
    await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', row => rows.push(row))
            .on('end', resolve)
            .on('error', reject);
    });
    return rows;
}

async function main() {
    console.log('='.repeat(70));
    console.log('CALIBRATION AUDIT: Confidence-to-Accuracy Validation');
    console.log('='.repeat(70));
    console.log(`Benchmark file: ${CONFIG.BENCHMARK_FILE}`);
    console.log('');

    if (!fs.existsSync(CONFIG.BENCHMARK_FILE)) {
        console.error(`ERROR: Benchmark file not found: ${CONFIG.BENCHMARK_FILE}`);
        return;
    }

    const data = await loadCSV(CONFIG.BENCHMARK_FILE);
    console.log(`Total records: ${data.length}`);

    // Initialize tier stats
    const tierStats = CONFIG.TIERS.map(t => ({
        ...t,
        total: 0,
        correct: 0,
        incorrect: 0,
        examples: []
    }));

    let totalWithConfidence = 0;
    let totalCorrect = 0;
    let totalIncorrect = 0;

    for (const row of data) {
        const status = (row['Status'] || '').trim().toLowerCase();
        const confidence = parseInt(row['Match Confidence'] || '0', 10);
        const phone = row['PR Phone_FOUND'] || '';
        const ownerName = row['Owner Name'] || '';

        // Skip rows without a clear status or confidence
        if (!status || status === 'no result' || !phone) continue;

        totalWithConfidence++;

        // Find tier
        const tier = tierStats.find(t => confidence >= t.min && confidence <= t.max);
        if (!tier) continue;

        tier.total++;

        if (status === 'correct') {
            tier.correct++;
            totalCorrect++;
        } else if (status === 'incorrect') {
            tier.incorrect++;
            totalIncorrect++;
            // Track examples of high-confidence incorrect predictions
            if (confidence >= 70) {
                tier.examples.push({
                    name: ownerName.substring(0, 50),
                    confidence,
                    phone: phone.substring(0, 15)
                });
            }
        }
    }

    // Print results
    console.log('\n' + '='.repeat(70));
    console.log('ACCURACY BY CONFIDENCE TIER');
    console.log('='.repeat(70));

    for (const tier of tierStats) {
        if (tier.total === 0) continue;

        const accuracy = tier.correct + tier.incorrect > 0 
            ? Math.round(tier.correct / (tier.correct + tier.incorrect) * 100) 
            : 0;
        const meetsTarget = accuracy >= tier.targetAccuracy;
        const status = meetsTarget ? '✅' : '❌';

        console.log(`\n${tier.name}`);
        console.log(`  Total predictions: ${tier.total}`);
        console.log(`  Correct: ${tier.correct}`);
        console.log(`  Incorrect: ${tier.incorrect}`);
        console.log(`  ${status} Accuracy: ${accuracy}% (target: ${tier.targetAccuracy}%)`);

        if (tier.examples.length > 0 && tier.min >= 70) {
            console.log(`\n  ⚠️  High-confidence errors:`);
            tier.examples.slice(0, 3).forEach(ex => {
                console.log(`     - ${ex.name}... (conf: ${ex.confidence})`);
            });
        }
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));

    const verifiedTier = tierStats.find(t => t.name.includes('VERIFIED'));
    const probableTier = tierStats.find(t => t.name.includes('PROBABLE'));

    const verifiedAcc = verifiedTier && verifiedTier.total > 0
        ? Math.round(verifiedTier.correct / verifiedTier.total * 100) : 0;
    const probableAcc = probableTier && probableTier.total > 0
        ? Math.round(probableTier.correct / probableTier.total * 100) : 0;

    console.log(`Total analyzed: ${totalWithConfidence}`);
    console.log(`Total correct: ${totalCorrect}`);
    console.log(`Total incorrect: ${totalIncorrect}`);
    console.log(`\n🎯 VERIFIED (85-100): ${verifiedAcc}% accuracy (${verifiedTier?.correct || 0}/${verifiedTier?.total || 0})`);
    console.log(`🎯 PROBABLE (70-84): ${probableAcc}% accuracy (${probableTier?.correct || 0}/${probableTier?.total || 0})`);
    
    if (verifiedAcc >= 90) {
        console.log('\n✅ SUCCESS: High-confidence (85+) predictions meet 90% target!');
    } else if (verifiedAcc >= 80) {
        console.log('\n⚠️  CLOSE: High-confidence predictions at ' + verifiedAcc + '%, below 90% target');
    } else {
        console.log('\n❌ WARNING: High-confidence predictions below target');
    }

    // Save report
    const report = {
        timestamp: new Date().toISOString(),
        file: CONFIG.BENCHMARK_FILE,
        totalAnalyzed: totalWithConfidence,
        totalCorrect,
        totalIncorrect,
        tierStats: tierStats.map(t => ({
            name: t.name,
            total: t.total,
            correct: t.correct,
            incorrect: t.incorrect,
            accuracy: t.total > 0 ? Math.round(t.correct / t.total * 100) : 0
        }))
    };

    fs.writeFileSync('calibration_audit_report.json', JSON.stringify(report, null, 2));
    console.log('\n📄 Report saved to: calibration_audit_report.json');
}

main().catch(console.error);
