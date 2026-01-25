const axios = require('axios');
require('dotenv').config();

async function test() {
    const apiKey = "11a569f0-3bbc-467c-be59-fe29afc7aa4c";
    const zone = 'web_unlocker1';
    
    try {
        const response = await axios.post('https://api.brightdata.com/request', {
            zone: zone,
            url: 'https://lumtest.com/myip.json',
            format: 'raw'
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`Status: ${response.status}`);
        console.log(`Data: ${JSON.stringify(response.data, null, 2)}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        if (error.response) {
            console.error(`Response Data: ${JSON.stringify(error.response.data, null, 2)}`);
        }
    }
}

test();
