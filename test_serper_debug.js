const axios = require('axios');
require('dotenv').config();

async function test() {
    const name = "WILLIAM DEAN FRANCIS";
    const city = "Kent";
    const state = "WA";
    const query = `${name} ${city} ${state} phone address`;
    
    console.log('Testing Serper with:', query);
    console.log('API Key:', process.env.SERPER_API_KEY ? 'Present' : 'MISSING');
    
    try {
        const response = await axios.post('https://google.serper.dev/search', {
            q: query,
            num: 10
        }, {
            headers: {
                'X-API-KEY': process.env.SERPER_API_KEY,
                'Content-Type': 'application/json'
            }
        });
        console.log('Success! Results count:', response.data.organic?.length);
    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response headers:', error.response.headers);
        }
    }
}
test();
