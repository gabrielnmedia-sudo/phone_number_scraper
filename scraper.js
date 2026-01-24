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
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache'
};

const TIMEOUT = 30000;

class Scraper {
    constructor() {
        this.client = axios.create({
            httpsAgent: HTTPS_AGENT,
            headers: HEADERS,
            timeout: TIMEOUT,
            validateStatus: () => true
        });
    }

    async searchCBC(name, city, state) {
        // Format: /people/diane-k-martin/wa/seattle
        const nameSlug = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '-');
        const citySlug = city.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '-');
        const stateSlug = state.toLowerCase().trim();
        
        const url = `https://www.cyberbackgroundchecks.com/people/${nameSlug}/${stateSlug}/${citySlug}`;
        console.log(`[CBC] Searching: ${url}`);

        try {
            const response = await this.client.get(url);
            if (response.status !== 200) {
                console.warn(`[CBC] Failed to fetch results. Status: ${response.status}`);
                return [];
            }

            const $ = cheerio.load(response.data);
            const candidates = [];

            $('.card').each((i, el) => {
                const nameNode = $(el).find('.name-searched-on');
                // Filter out ads that look like cards but don't have the main name class
                if (nameNode.length === 0) return;

                const fullName = nameNode.text().trim();
                const age = $(el).find('.age').text().trim();
                const location = $(el).find('.address-current .address').text().trim();
                const livesAt = $(el).find('.address-current').text().replace(/\s+/g, ' ').trim();
                
                // Relatives
                const relatives = [];
                $(el).find('.relative').each((j, rel) => {
                    relatives.push($(rel).text().trim());
                });

                // Phones (visible on card)
                const visiblePhones = [];
                $(el).find('.phone').each((k, ph) => {
                    visiblePhones.push($(ph).text().trim());
                });

                // Detail Link
                const detailLink = $(el).find('a.btn-primary').attr('href'); // Main 'View Details' button

                candidates.push({
                    source: 'CBC',
                    fullName,
                    age,
                    location,
                    livesAt,
                    relatives,
                    visiblePhones,
                    detailLink: detailLink ? `https://www.cyberbackgroundchecks.com${detailLink}` : null
                });
            });

            return candidates;

        } catch (error) {
            console.error(`[CBC] Error searching ${name}:`, error.message);
            return [];
        }
    }

    async getDetailsCBC(detailUrl) {
        console.log(`[CBC] Fetching Details: ${detailUrl}`);
        try {
            const response = await this.client.get(detailUrl);
            if (response.status !== 200) {
                console.warn(`[CBC] Failed to fetch details. Status: ${response.status}`);
                return null;
            }

            const $ = cheerio.load(response.data);
            const phones = [];

            // Phones on details page usually in a specific section. 
            // Based on dump structure, they have class .phone inside cards or lists.
            // A common pattern in these sites:
            // Look for all 'a[href^="/phone/"]'
            $('a[href^="/phone/"]').each((i, el) => {
                const num = $(el).text().trim();
                if (num && !phones.includes(num)) {
                    phones.push(num);
                }
            });

            return {
                phones
            };

        } catch (error) {
            console.error(`[CBC] Error scraping details:`, error.message);
            return null;
        }
    }

    async searchTPS(name, city, state) {
        // Fallback or secondary
        // URL: https://www.truepeoplesearch.com/results?name=Diane%20K%20Martin&citystatezip=Seattle,%20WA
        const queryName = encodeURIComponent(name);
        const queryLoc = encodeURIComponent(`${city}, ${state}`);
        const url = `https://www.truepeoplesearch.com/results?name=${queryName}&citystatezip=${queryLoc}`;
        
        console.log(`[TPS] Searching: ${url}`);
        
        try {
             const response = await this.client.get(url);
             if (response.status !== 200) {
                 console.warn(`[TPS] HTTP ${response.status}`);
                 return [];
             }
             
             const $ = cheerio.load(response.data);
             const candidates = [];
             
             // TPS structure usually has cards. Let's assume standard 'card' or similar if we can find it.
             // Without a dump, this is a guess, but keys are usually:
             // Name in h4 or span with data-detail-link
             // We will try to grab minimal data to see if it works.
             
             $('.card-summary').each((i, el) => {
                 const fullName = $(el).find('.h4').text().trim();
                 const age = $(el).find('[data-age]').text().trim() || $(el).find('.content-label:contains("Age")').next().text().trim();
                 const loc = $(el).find('.content-label:contains("Lives in")').next().text().trim();
                 const detailLink = $(el).find('a.btn-success').attr('href'); // Usually green button 'View Details'

                 if (fullName) {
                     candidates.push({
                         source: 'TPS',
                         fullName,
                         age,
                         location: loc,
                         detailLink: detailLink ? `https://www.truepeoplesearch.com${detailLink}` : null
                     });
                 }
             });
             
             return candidates;

        } catch (error) {
            console.error(`[TPS] Error: ${error.message}`);
            return [];
        }
    }
}

module.exports = Scraper;
