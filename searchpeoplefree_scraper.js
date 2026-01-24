/**
 * SearchPeopleFree Scraper Module
 * Uses BrightData Site Unlocker for all requests
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { HttpsProxyAgent } = require('https-proxy-agent');
require('dotenv').config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const PROXY_URL = `http://${process.env.BRIGHTDATA_USER}:${process.env.BRIGHTDATA_PASS}@${process.env.BRIGHTDATA_HOST}:${process.env.BRIGHTDATA_PORT}`;
const HTTPS_AGENT = new HttpsProxyAgent(PROXY_URL, { rejectUnauthorized: false });

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
};

const TIMEOUT = 30000;

class SearchPeopleFreeScraper {
    constructor() {
        this.apiKey = process.env.BRIGHTDATA_API_KEY;
        this.zone = 'web_unlocker1';
        this.client = axios.create({
            timeout: TIMEOUT,
            validateStatus: () => true,
            maxRedirects: 5
        });
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async _makeRequest(targetUrl, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await this.client.post('https://api.brightdata.com/request', {
                    zone: this.zone,
                    url: targetUrl,
                    format: 'raw'
                }, {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (response.status === 200 && response.data && response.data.length > 0) {
                    return response;
                }
                
                await this.sleep(1000);
            } catch (error) {
                console.error(`[SearchPeopleFree] Request Error (Attempt ${i + 1}/${retries}): ${error.message}`);
                await this.sleep(1000);
            }
        }
        return { status: 500, data: '' };
    }

    async search(name, city, state) {
        const nameSlug = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '-');
        const citySlug = city.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '-');
        const stateSlug = state.toLowerCase().trim();
        
        const url = `https://www.searchpeoplefree.com/find/${nameSlug}/${stateSlug}/${citySlug}`;
        console.log(`[SearchPeopleFree] Searching: ${url}`);

        try {
            const response = await this._makeRequest(url);
            if (response.status !== 200) return [];

            const $ = cheerio.load(response.data);
            const candidates = [];

            $('.card').each((i, el) => {
                const name = $(el).find('h2').text().trim();
                const detailLink = $(el).find('a[href*="/find/"]').attr('href');
                const age = $(el).find('span:contains("Age")').text().replace(/Age\s*/i, '').trim();
                const location = $(el).find('address').text().replace(/\s+/g, ' ').trim();

                if (name && detailLink) {
                    candidates.push({
                        fullName: name,
                        age,
                        location,
                        detailLink: detailLink.startsWith('http') ? detailLink : `https://www.searchpeoplefree.com${detailLink}`,
                        source: 'SearchPeopleFree'
                    });
                }
            });

            return candidates;
        } catch (error) {
            console.error(`[SearchPeopleFree] Search error: ${error.message}`);
            return [];
        }
    }

    async getProfile(url) {
        console.log(`[SearchPeopleFree] Fetching profile: ${url}`);
        try {
            const response = await this._makeRequest(url);
            if (response.status !== 200) return null;

            const $ = cheerio.load(response.data);
            const phones = [];
            const relatives = [];

            // Extract phones
            $('a[href^="tel:"]').each((i, el) => {
                const phone = $(el).text().trim();
                if (phone && !phones.includes(phone)) {
                    phones.push(phone);
                }
            });

            // Extract relatives
            $('h3:contains("Relatives")').nextAll().find('a[href*="/find/"]').each((i, el) => {
                const relativeName = $(el).text().trim();
                if (relativeName) relatives.push(relativeName);
            });

            return {
                allPhones: phones,
                allRelatives: relatives,
                source: 'SearchPeopleFree',
                url
            };
        } catch (error) {
            console.error(`[SearchPeopleFree] Profile error: ${error.message}`);
            return null;
        }
    }
}

module.exports = SearchPeopleFreeScraper;
