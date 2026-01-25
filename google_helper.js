/**
 * Google Search Helper
 * Uses Serper.dev or similar API (if available) or direct scraping if needed
 * For this implementation, we will use a Serper.dev API key if provided, or fallback to direct search
 */

const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

class GoogleHelper {
    constructor() {
        this.apiKey = process.env.BRIGHTDATA_API_KEY;
    }

    async searchBroad(query) {
        console.log(`[Google] Broad Searching: ${query}`);
        return this._searchDirect(query);
    }

    async searchQuoted(name1, name2) {
        const query = `"${name1}" "${name2}"`;
        console.log(`[Google] Searching: ${query}`);
        return this._searchDirect(query);
    }

    async _searchDirect(query) {
        console.log('[Google] Accessing BrightData SERP API (Zone: serp_api2)...');
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us`;
        
        try {
            const response = await axios.post('https://api.brightdata.com/request', {
                zone: 'serp_api2',
                url: searchUrl,
                format: 'json'
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status !== 200) {
                console.error(`[Google] API Status ${response.status}. Falling back...`);
                return this._searchDirectRaw(query);
            }

            if (response.data && response.data.organic) {
                console.log(`[Google] SERP API (JSON) found ${response.data.organic.length} results.`);
                return response.data.organic.map(item => ({
                    title: item.title,
                    link: item.link,
                    snippet: item.snippet || item.description
                }));
            }
            
            if (typeof response.data === 'string' && response.data.includes('<html')) {
                return this._parseHtml(response.data);
            }

            return [];
        } catch (error) {
            console.error(`[Google] SERP API Attempt failed: ${error.message}. Falling back...`);
            return this._searchDirectRaw(query);
        }
    }

    async _searchDirectRaw(query) {
        console.log('[Google] Using Raw Scrape Fallback (web_unlocker1)...');
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us`;
        
        try {
            const response = await axios.post('https://api.brightdata.com/request', {
                zone: 'web_unlocker1',
                url: searchUrl,
                format: 'raw'
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status !== 200) return [];
            return this._parseHtml(response.data);
        } catch (error) {
            console.error(`[Google] Raw scrape error: ${error.message}`);
            return [];
        }
    }

    _parseHtml(html) {
        const $ = cheerio.load(html);
        const items = [];
        const results = $('.g, .yuRUbf, .tF2Cxc, .MjjYud').has('h3');
        
        results.each((i, el) => {
            const title = $(el).find('h3').first().text();
            const link = $(el).find('a').first().attr('href');
            const snippet = $(el).find('.VwiC3b, .yXK7lf, .st, .kb0PBd').text();
            
            if (title && link && link.startsWith('http')) {
                items.push({ title, link, snippet });
            }
        });

        if (items.length === 0) {
            $('h3').each((i, el) => {
                const a = $(el).closest('a');
                if (a.length > 0) {
                    const title = $(el).text();
                    const link = a.attr('href');
                    if (title && link && link.startsWith('http')) {
                         items.push({ title, link, snippet: "" });
                    }
                }
            });
        }
        return items;
    }
}

module.exports = GoogleHelper;
