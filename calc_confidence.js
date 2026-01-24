const fs = require('fs');
const csv = require('csv-parser');

let totalConfidence = 0;
let count = 0;
let highConfCount = 0;
let veryHighConfCount = 0;

fs.createReadStream('Data_Tracking_Processed_Universal_V11.csv')
    .pipe(csv())
    .on('data', (row) => {
        const conf = parseInt(row['PR 1 Match Confidence']);
        if (!isNaN(conf) && conf > 0) {
            totalConfidence += conf;
            count++;
            if (conf >= 85) highConfCount++;
            if (conf >= 95) veryHighConfCount++;
        }
    })
    .on('end', () => {
        const avg = count > 0 ? (totalConfidence / count).toFixed(2) : 0;
        console.log(`Average Confidence: ${avg}`);
        console.log(`High Confidence (85+): ${highConfCount} (${Math.round(highConfCount/count*100)}%)`);
        console.log(`Very High Confidence (95+): ${veryHighConfCount} (${Math.round(veryHighConfCount/count*100)}%)`);
        console.log(`Total Matches: ${count}`);
    });
