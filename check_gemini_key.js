const axios = require('axios');
require('dotenv').config();

async function check() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) { console.error("No API Key found"); return; }
    
    console.log(`Checking key: ${key.substring(0, 5)}...`);
    try {
        const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        console.log("Status:", response.status);
        if (response.data && response.data.models) {
            console.log("Models found:", response.data.models.map(m => m.name).join(', '));
        } else {
            console.log("No models returned in response data");
        }
    } catch (e) {
        console.error("Check failed:", e.response ? e.response.data : e.message);
    }
}

check();
