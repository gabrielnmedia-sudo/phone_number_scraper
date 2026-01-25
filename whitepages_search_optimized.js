/**
 * WhitePages Discovery & Scraper (Optimized)
 * Tiered: 
 * 1. Find Profile URL via Serper (Fast/Cheap)
 * 2. Scrape via Scraping Browser (Authenticated)
 */

const axios = require('axios');
const WhitePagesScraper = require('./whitepages_scraper');
require('dotenv').config();

const SERPER_API_KEY = process.env.SERPER_API_KEY;

/**
 * Finds the correct WhitePages URL using BrightData Google Search
 */
async function discoverProfileUrl(firstName, lastName, city, state) {
    const query = `"${firstName} ${lastName}" ${city} ${state} site:whitepages.com`;
    console.log(`[WP Discovery] Searching Google via BrightData for: ${query}`);

    try {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us`;
        const response = await axios.post('https://api.brightdata.com/request', {
            zone: 'serp_api2',
            url: searchUrl,
            format: 'json'
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.BRIGHTDATA_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000
        });

        const results = response.data.organic || [];
        const wpResult = results.find(r => r.link && r.link.includes('whitepages.com/name/'));
        
        if (wpResult) {
            console.log(`[WP Discovery] Found URL: ${wpResult.link}`);
            return wpResult.link;
        }
    } catch (e) {
        console.error(`[WP Discovery] BrightData Error: ${e.message}`);
    }
    
    // Fallback to building a guess URL if search fails
    return WhitePagesScraper.buildWhitePagesUrl(firstName, lastName, city, state);
}

/**
 * Combined Optimized Search
 */
async function smartScrape(firstName, lastName, city, state) {
    const url = await discoverProfileUrl(firstName, lastName, city, state);
    if (!url) return null;
    
    return await WhitePagesScraper.scrapeWhitePagesProfile(url);
}

module.exports = { smartScrape, discoverProfileUrl };
