/**
 * Radaris Scraper Module
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

class RadarisScraper {
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

    fullStateName(code) {
        if (!code) return '';
        const states = {
            'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
            'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
            'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
            'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
            'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
            'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
            'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
            'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
            'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
            'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
        };
        return states[code.toUpperCase()] || code;
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
                } else if (response.status === 500 || response.status === 502 || response.status === 503) {
                    console.warn(`[Radaris] Status ${response.status} on attempt ${i + 1}/${retries}. Retrying...`);
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }
                
                return response;
            } catch (error) {
                console.error(`[Radaris] Request Error (Attempt ${i + 1}/${retries}): ${error.message}`);
                if (i === retries - 1) return { status: 500, data: '' };
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        return { status: 500, data: '' };
    }

    /**
     * Search Radaris for a name in a state
     */
    async search(firstName, lastName, state) {
        // Handle name splitting if provided as a single string
        if (!lastName && firstName.includes(' ')) {
            const parts = firstName.trim().split(/\s+/);
            firstName = parts[0];
            // Use only the LAST part as last name (strip all middle names)
            lastName = parts[parts.length - 1];
        } else if (lastName && lastName.includes(' ')) {
            // If lastName has multiple parts, use only the last one
            const parts = lastName.trim().split(/\s+/);
            lastName = parts[parts.length - 1];
        }

        const fullState = this.fullStateName(state);
        
        const url = `https://radaris.com/ng/search?ff=${encodeURIComponent(firstName)}&fl=${encodeURIComponent(lastName)}&fs=${encodeURIComponent(fullState)}`;
        console.log(`[Radaris] Searching: ${url}`);

        try {
            const response = await this._makeRequest(url);
            
            if (response.status !== 200) {
                console.warn(`[Radaris] Search failed with status ${response.status}`);
                return [];
            }

            const $ = cheerio.load(response.data);
            const candidates = [];
            
            // If the title says "0 people found", don't bother parsing
            const title = $('title').text();
            if (title.includes('0 people found') || title.includes('Page not found')) {
                return [];
            }

            // Parse search results
            $('.card').each((i, el) => {
                const nameNode = $(el).find('.card-title').first();
                const name = nameNode.text().trim();
                const detailLink = nameNode.attr('data-href') || $(el).find('[data-href]').first().attr('data-href');
                
                let age = $(el).find('.age').text().trim();
                if (age) {
                    age = age.replace(/Age\s*/i, '').split('/')[0].trim();
                }
                
                const location = $(el).find('.res-in').text().trim();

                if (name && detailLink) {
                    candidates.push({
                        fullName: name,
                        age,
                        location,
                        detailLink: detailLink.startsWith('http') ? detailLink : `https://radaris.com${detailLink}`,
                        source: 'Radaris'
                    });
                }
            });

            // If only one exact match redirect happens, candidates might be empty but we could be on the profile
            if (candidates.length === 0 && response.data.includes('SUMMARY')) {
                // We might be directly on a profile page
                console.log(`[Radaris] Redirected or direct profile found`);
                const name = $('h1').first().text().trim();
                return [{
                    fullName: name,
                    detailLink: response.request.res.responseUrl || url,
                    source: 'Radaris',
                    isDirect: true
                }];
            }

            return candidates;
        } catch (error) {
            console.error(`[Radaris] Search error: ${error.message}`);
            return [];
        }
    }

    /**
     * Fetch detailed profile information
     */
    async getProfile(url) {
        console.log(`[Radaris] Fetching profile: ${url}`);
        try {
            const response = await this._makeRequest(url);
            if (response.status !== 200) return null;

            const $ = cheerio.load(response.data);
            const phones = [];
            const relatives = [];

            // Extract phones
            const BLACKLIST = ['(855) 723-2747', '8557232747', '855-723-2747'];
            const phoneRegex = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;

            $('a[href^="/ng/phone/"], a[href^="tel:"], span.truncate-text').each((i, el) => {
                const text = $(el).text().trim();
                const match = text.match(phoneRegex);
                
                if (match) {
                    const phone = match[0];
                    // Skip if empty or blacklisted
                    if (!phones.includes(phone) && !BLACKLIST.some(b => phone.includes(b))) {
                        phones.push(phone);
                    }
                }
            });

            // Extract relatives from "RELATED TO" section with URLs
            $('.related-to .item a, .related-to a[href*="/~"]').each((i, el) => {
                const relativeName = $(el).text().trim().replace(/,\s*\d+$/, ''); // Remove age
                const relativeUrl = $(el).attr('href');
                if (relativeName && relativeName.length > 3) {
                    const fullUrl = relativeUrl && relativeUrl.startsWith('/') 
                        ? `https://radaris.com${relativeUrl}` 
                        : relativeUrl;
                    relatives.push({ name: relativeName, url: fullUrl });
                }
            });

            // Fallback for relatives if specific class not found
            if (relatives.length === 0) {
                $('h2:contains("RELATED TO")').nextAll().find('a[href*="/~"]').each((i, el) => {
                    const relativeName = $(el).text().trim();
                    const relativeUrl = $(el).attr('href');
                    if (relativeName && relativeName.length > 3) {
                        const fullUrl = relativeUrl && relativeUrl.startsWith('/') 
                            ? `https://radaris.com${relativeUrl}` 
                            : relativeUrl;
                        relatives.push({ name: relativeName, url: fullUrl });
                    }
                });
            }

            return {
                allPhones: phones,
                allRelatives: relatives,
                url
            };
        } catch (error) {
            console.error(`[Radaris] Profile error: ${error.message}`);
            return null;
        }
    }
}

module.exports = RadarisScraper;
