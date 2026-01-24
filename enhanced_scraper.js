/**
 * Enhanced Scraper with Pagination and View Details Support
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

const TIMEOUT = 15000; // Reduced timeout for speed
const MAX_PAGES = 3; // Maximum pages to scrape per person
const RATE_LIMIT_MS = 500; // Faster rate limit

class EnhancedScraper {
    constructor() {
        this.apiKey = process.env.BRIGHTDATA_API_KEY;
        this.zone = 'web_unlocker1';
        this.client = axios.create({
            timeout: 10000, // Apex Speed timeout
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

                if (response.status === 200 && response.data) return response;
                await this.sleep(1000);
            } catch (error) {
                if (i === retries - 1) return { status: 500, data: '' };
                await this.sleep(1000);
            }
        }
        return { status: 500, data: '' };
    }

    /**
     * Search CyberBackgroundChecks with pagination support
     * Returns ALL candidates across ALL pages
     */
    async searchCBCWithPagination(name, city, state, options = {}) {
        const { maxPages = MAX_PAGES, includeDetails = false } = options;
        
        const nameSlug = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '-');
        const citySlug = city ? city.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '-') : '';
        const stateSlug = state ? state.toLowerCase().trim() : '';
        
        const baseUrl = citySlug 
            ? `https://www.cyberbackgroundchecks.com/people/${nameSlug}/${stateSlug}/${citySlug}`
            : `https://www.cyberbackgroundchecks.com/people/${nameSlug}/${stateSlug}`;
        
        let allCandidates = [];
        let currentPage = 1;
        let hasMorePages = true;
        
        while (hasMorePages && currentPage <= maxPages) {
            const pageUrl = currentPage === 1 ? baseUrl : `${baseUrl}?page=${currentPage}`;
            const response = await this._makeRequest(pageUrl);
            
            if (response.status !== 200) break;
            
            const $ = cheerio.load(response.data);
            const pageCandidates = this._parseCBCResultsPage($);
            
            if (pageCandidates.length === 0) {
                hasMorePages = false;
            } else {
                allCandidates = allCandidates.concat(pageCandidates);
                const nextPageLink = $('a.page-link[aria-label="Next"]').length > 0;
                if (!nextPageLink) hasMorePages = false;
            }
            currentPage++;
            if (hasMorePages) await this.sleep(500);
        }
        return allCandidates;
    }

    /**
     * Parse CBC results page and extract candidate cards
     */
    _parseCBCResultsPage($) {
        const candidates = [];
        
        // Find all person cards
        $('.card').each((i, el) => {
            const nameNode = $(el).find('.name-searched-on');
            if (nameNode.length === 0) return; // Skip non-person cards
            
            const fullName = nameNode.text().trim();
            const age = $(el).find('.age').text().trim();
            const location = $(el).find('.address-current .address').text().trim();
            const livesAt = $(el).find('.address-current').text().replace(/\s+/g, ' ').trim();
            
            // Relatives
            const relatives = [];
            $(el).find('.relative').each((j, rel) => {
                const relName = $(rel).text().trim();
                if (relName) relatives.push(relName);
            });
            
            // Previous locations/addresses
            const pastAddresses = [];
            $(el).find('.address-past .address, .previous-address').each((k, addr) => {
                const addrText = $(addr).text().trim();
                if (addrText) pastAddresses.push(addrText);
            });
            
            // Visible phone numbers
            const visiblePhones = [];
            $(el).find('.phone, a[href^="tel:"]').each((l, ph) => {
                const phone = $(ph).text().trim().replace(/[^\d()-]/g, '');
                if (phone && phone.length >= 10 && !visiblePhones.includes(phone)) {
                    visiblePhones.push(phone);
                }
            });
            
            // Detail link (View Details button)
            const detailLink = $(el).find('a.btn-primary, a[href*="/person/"]').attr('href');
            
            candidates.push({
                source: 'CBC',
                fullName,
                age,
                location,
                livesAt,
                relatives,
                pastAddresses,
                visiblePhones,
                detailLink: detailLink ? 
                    (detailLink.startsWith('http') ? detailLink : `https://www.cyberbackgroundchecks.com${detailLink}`) 
                    : null,
                detailsFetched: false
            });
        });
        
        return candidates;
    }

    /**
     * Fetch detailed profile page from CBC
     * "Clicks" View Details by navigating to the detail URL
     */
    async getDetailsCBC(detailUrl) {
        try {
            const response = await this._makeRequest(detailUrl);
            if (response.status !== 200) return null;
            
            const $ = cheerio.load(response.data);
            const details = {
                detailsFetched: true,
                allPhones: [],
                allAddresses: [],
                allRelatives: []
            };
            
            // Extract phones
            $('a[href^="/phone/"], a[href^="tel:"], .phone-number, .phone').each((i, el) => {
                const phone = $(el).text().trim().replace(/[^\d]/g, '');
                if (phone.length >= 10 && !details.allPhones.includes(phone)) details.allPhones.push(phone);
            });
            
            // Relatives
            $('.relative, [class*="relative"] a').each((i, el) => {
                const rel = $(el).text().trim();
                if (rel && !details.allRelatives.includes(rel)) details.allRelatives.push(rel);
            });
            
            return details;
        } catch (error) {
            return null;
        }
    }

    async getDetailsTPS(detailUrl) {
        try {
            const response = await this._makeRequest(detailUrl);
            if (response.status !== 200) return null;
            
            const $ = cheerio.load(response.data);
            const details = {
                detailsFetched: true,
                allPhones: [],
                allRelatives: []
            };
            
            // Extract phones from TPS profile
            $('a[href^="tel:"], .phone, [data-link-to-more="phone"]').each((i, el) => {
                const phone = $(el).text().trim().replace(/\D/g, '');
                if (phone.length >= 10 && !details.allPhones.includes(phone)) details.allPhones.push(phone);
            });
            
            // Relatives
            $('a[href*="/find/person/"], .relative').each((i, el) => {
                const rel = $(el).text().trim();
                if (rel && rel.length > 3 && !details.allRelatives.includes(rel)) details.allRelatives.push(rel);
            });
            
            return details;
        } catch (error) {
            return null;
        }
    }

    /**
     * Search TruePeopleSearch with pagination support
     */
    async searchTPSWithPagination(name, city, state, options = {}) {
        const { maxPages = MAX_PAGES } = options;
        const queryName = encodeURIComponent(name);
        const queryLoc = encodeURIComponent(`${city}, ${state}`);
        
        let allCandidates = [];
        let currentPage = 1;
        let hasMorePages = true;
        
        while (hasMorePages && currentPage <= maxPages) {
            const pageOffset = (currentPage - 1) * 10;
            const url = currentPage === 1 
                ? `https://www.truepeoplesearch.com/results?name=${queryName}&citystatezip=${queryLoc}`
                : `https://www.truepeoplesearch.com/results?name=${queryName}&citystatezip=${queryLoc}&offset=${pageOffset}`;
            
            const response = await this._makeRequest(url);
            if (response.status !== 200) break;
            
            const $ = cheerio.load(response.data);
            const pageCandidates = this._parseTPSResultsPage($);
            
            if (pageCandidates.length === 0) {
                hasMorePages = false;
            } else {
                allCandidates = allCandidates.concat(pageCandidates);
                const hasNextPage = $('.pagination').find('a:contains("Next")').length > 0;
                if (!hasNextPage) hasMorePages = false;
            }
            currentPage++;
            if (hasMorePages) await this.sleep(500);
        }
        return allCandidates;
    }

    /**
     * Parse TPS results page
     */
    _parseTPSResultsPage($) {
        const candidates = [];
        
        $('.card-summary, [class*="card"]').each((i, el) => {
            const fullName = $(el).find('.h4, h4, .name').first().text().trim();
            if (!fullName) return;
            
            const age = $(el).find('[data-age]').text().trim() || 
                       $(el).find('.age').text().trim() ||
                       $(el).text().match(/Age:\s*(\d+)/i)?.[1] || '';
            
            const location = $(el).find('.content-label:contains("Lives in")').next().text().trim() ||
                            $(el).find('[class*="address"]').first().text().trim();
            
            const detailLink = $(el).find('a[href*="/find/person/"]').attr('href') ||
                              $(el).find('a.btn-success').attr('href');
            
            const visiblePhones = [];
            $(el).find('a[href^="tel:"], .phone').each((j, ph) => {
                const phone = $(ph).text().trim();
                if (phone && !visiblePhones.includes(phone)) {
                    visiblePhones.push(phone);
                }
            });
            
            candidates.push({
                source: 'TPS',
                fullName,
                age,
                location,
                visiblePhones,
                detailLink: detailLink ? 
                    (detailLink.startsWith('http') ? detailLink : `https://www.truepeoplesearch.com${detailLink}`)
                    : null
            });
        });
        
        return candidates;
    }

    /**
     * Intelligent search that tries multiple strategies
     */
    async intelligentSearch(name, city, state, options = {}) {
        const { maxPages = 3 } = options;
        
        // Try CBC first - DON'T fetch details, just use visible phones for speed
        let candidates = await this.searchCBCWithPagination(name, city, state, { 
            maxPages, 
            includeDetails: false  // Skip View Details - use visible phones only
        });
        
        // If no results, try searching without city (statewide) - skip TPS, it's too slow
        if (candidates.length === 0) {
            console.log('[SEARCH] No results. Trying statewide search...');
            await this.sleep(RATE_LIMIT_MS);
            candidates = await this.searchCBCWithPagination(name, '', state, { 
                maxPages: 2,
                includeDetails: false  // Skip View Details for speed
            });
        }
        
        return candidates;
    }
}

module.exports = EnhancedScraper;
