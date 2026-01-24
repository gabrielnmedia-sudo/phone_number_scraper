/**
 * WhitePages Profile Finder
 * Uses Google SERP to find WhitePages profile URLs with person IDs
 */

const axios = require('axios');
require('dotenv').config();

const SERPER_API_KEY = process.env.SERPER_API_KEY;

/**
 * Search Google for a WhitePages profile URL
 */
async function findWhitePagesProfileUrl(firstName, lastName, state = 'WA') {
    console.log(`[WP Finder] Searching for ${firstName} ${lastName} in ${state}...`);
    
    try {
        const query = `"${firstName} ${lastName}" site:whitepages.com ${state}`;
        
        const response = await axios.post('https://google.serper.dev/search', {
            q: query,
            num: 5
        }, {
            headers: {
                'X-API-KEY': SERPER_API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        const results = response.data.organic || [];
        
        // Find the first WhitePages profile URL with a person ID
        for (const result of results) {
            const url = result.link || '';
            // Profile URLs look like: whitepages.com/name/First-Last/City-ST/PERSONID
            if (url.includes('whitepages.com/name/') && url.match(/\/[A-Za-z0-9]{8,}/)) {
                console.log(`[WP Finder] Found profile: ${url}`);
                return url;
            }
        }

        // If no profile with ID found, try the first search result anyway
        for (const result of results) {
            const url = result.link || '';
            if (url.includes('whitepages.com/name/')) {
                console.log(`[WP Finder] Found search page: ${url}`);
                return url;
            }
        }

        console.log(`[WP Finder] No WhitePages results found`);
        return null;

    } catch (error) {
        console.error(`[WP Finder] Error: ${error.message}`);
        return null;
    }
}

// Export for module use
module.exports = { findWhitePagesProfileUrl };

// CLI test
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length >= 2) {
        findWhitePagesProfileUrl(args[0], args[1], args[2] || 'WA').then(url => {
            console.log('Result:', url || 'Not found');
        });
    } else {
        console.log('Usage: node whitepages_finder.js <firstName> <lastName> [state]');
    }
}
