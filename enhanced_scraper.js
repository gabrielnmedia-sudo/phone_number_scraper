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
        this.client = axios.create({
            httpsAgent: HTTPS_AGENT,
            headers: HEADERS,
            timeout: TIMEOUT,
            validateStatus: () => true,
            maxRedirects: 5
        });
    }

    /**
     * Sleep utility for rate limiting
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Search CyberBackgroundChecks with pagination support
     * Returns ALL candidates across ALL pages
     */
    async searchCBCWithPagination(name, city, state, options = {}) {
        const { maxPages = MAX_PAGES, includeDetails = false } = options;
        
        const nameSlug = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '-');
        const citySlug = city.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '-');
        const stateSlug = state.toLowerCase().trim();
        
        const baseUrl = `https://www.cyberbackgroundchecks.com/people/${nameSlug}/${stateSlug}/${citySlug}`;
        
        let allCandidates = [];
        let currentPage = 1;
        let hasMorePages = true;
        
        console.log(`[CBC] Starting paginated search for: ${name} in ${city}, ${state}`);
        
        while (hasMorePages && currentPage <= maxPages) {
            const pageUrl = currentPage === 1 ? baseUrl : `${baseUrl}?page=${currentPage}`;
            console.log(`[CBC] Fetching page ${currentPage}: ${pageUrl}`);
            
            try {
                const response = await this.client.get(pageUrl);
                
                if (response.status !== 200) {
                    console.warn(`[CBC] Page ${currentPage} returned status ${response.status}`);
                    break;
                }
                
                const $ = cheerio.load(response.data);
                const pageCandidates = this._parseCBCResultsPage($);
                
                if (pageCandidates.length === 0) {
                    console.log(`[CBC] No more candidates on page ${currentPage}. Stopping.`);
                    hasMorePages = false;
                } else {
                    console.log(`[CBC] Found ${pageCandidates.length} candidates on page ${currentPage}`);
                    allCandidates = allCandidates.concat(pageCandidates);
                }
                
                // Check for next page link
                const nextPageLink = $('a.page-link[aria-label="Next"]').attr('href') ||
                                     $('a:contains("Next")').attr('href') ||
                                     $('li.page-item:not(.disabled) a.page-link').last().attr('href');
                
                if (!nextPageLink || nextPageLink === '#') {
                    hasMorePages = false;
                }
                
                currentPage++;
                
                // Rate limiting
                if (hasMorePages) {
                    await this.sleep(RATE_LIMIT_MS);
                }
                
            } catch (error) {
                console.error(`[CBC] Error on page ${currentPage}:`, error.message);
                hasMorePages = false;
            }
        }
        
        console.log(`[CBC] Total candidates found across ${currentPage - 1} page(s): ${allCandidates.length}`);
        
        // Optionally fetch details for top candidates only (limit to 3 for speed)
        if (includeDetails && allCandidates.length > 0) {
            const topCandidates = allCandidates.slice(0, 3); // Only top 3
            console.log(`[CBC] Fetching details for ${topCandidates.length} candidates (limited to 3)...`);
            for (let i = 0; i < topCandidates.length; i++) {
                const candidate = topCandidates[i];
                if (candidate.detailLink) {
                    const details = await this.getDetailsCBC(candidate.detailLink);
                    if (details) {
                        allCandidates[i] = { ...candidate, ...details };
                    }
                    await this.sleep(RATE_LIMIT_MS);
                }
            }
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
        console.log(`[CBC] Fetching details: ${detailUrl}`);
        
        try {
            const response = await this.client.get(detailUrl);
            
            if (response.status !== 200) {
                console.warn(`[CBC] Detail page returned status ${response.status}`);
                return null;
            }
            
            const $ = cheerio.load(response.data);
            const details = {
                detailsFetched: true,
                allPhones: [],
                allAddresses: [],
                allEmails: [],
                allRelatives: [],
                possibleAssociates: []
            };
            
            // Extract ALL phone numbers from detail page
            $('a[href^="/phone/"], a[href^="tel:"], .phone-number, .phone').each((i, el) => {
                const phoneText = $(el).text().trim();
                const phoneNum = phoneText.replace(/[^\d]/g, '');
                if (phoneNum.length >= 10 && !details.allPhones.includes(phoneText)) {
                    details.allPhones.push(phoneText);
                }
            });
            
            // Also look for phone patterns in text
            const pageText = $('body').text();
            const phoneMatches = pageText.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [];
            phoneMatches.forEach(phone => {
                const cleaned = phone.trim();
                if (!details.allPhones.includes(cleaned)) {
                    details.allPhones.push(cleaned);
                }
            });
            
            // All addresses
            $('.address, [class*="address"]').each((i, el) => {
                const addr = $(el).text().replace(/\s+/g, ' ').trim();
                if (addr && addr.length > 10 && !details.allAddresses.includes(addr)) {
                    details.allAddresses.push(addr);
                }
            });
            
            // All relatives
            $('.relative, [class*="relative"] a').each((i, el) => {
                const rel = $(el).text().trim();
                if (rel && !details.allRelatives.includes(rel)) {
                    details.allRelatives.push(rel);
                }
            });
            
            // Possible associates
            $('[class*="associate"] a, .associate').each((i, el) => {
                const assoc = $(el).text().trim();
                if (assoc && !details.possibleAssociates.includes(assoc)) {
                    details.possibleAssociates.push(assoc);
                }
            });
            
            // Emails
            $('a[href^="mailto:"]').each((i, el) => {
                const email = $(el).text().trim();
                if (email && !details.allEmails.includes(email)) {
                    details.allEmails.push(email);
                }
            });
            
            console.log(`[CBC] Details extracted: ${details.allPhones.length} phones, ${details.allRelatives.length} relatives`);
            
            return details;
            
        } catch (error) {
            console.error(`[CBC] Error fetching details:`, error.message);
            return null;
        }
    }

    /**
     * Search TruePeopleSearch with pagination support
     */
    async searchTPSWithPagination(name, city, state, options = {}) {
        const { maxPages = MAX_PAGES, includeDetails = false } = options;
        
        const queryName = encodeURIComponent(name);
        const queryLoc = encodeURIComponent(`${city}, ${state}`);
        
        let allCandidates = [];
        let currentPage = 1;
        let hasMorePages = true;
        
        console.log(`[TPS] Starting paginated search for: ${name} in ${city}, ${state}`);
        
        while (hasMorePages && currentPage <= maxPages) {
            const pageOffset = (currentPage - 1) * 10; // TPS uses offset
            const url = currentPage === 1 
                ? `https://www.truepeoplesearch.com/results?name=${queryName}&citystatezip=${queryLoc}`
                : `https://www.truepeoplesearch.com/results?name=${queryName}&citystatezip=${queryLoc}&offset=${pageOffset}`;
            
            console.log(`[TPS] Fetching page ${currentPage}: ${url}`);
            
            try {
                const response = await this.client.get(url);
                
                if (response.status !== 200) {
                    console.warn(`[TPS] Page ${currentPage} returned status ${response.status}`);
                    break;
                }
                
                const $ = cheerio.load(response.data);
                const pageCandidates = this._parseTPSResultsPage($);
                
                if (pageCandidates.length === 0) {
                    hasMorePages = false;
                } else {
                    console.log(`[TPS] Found ${pageCandidates.length} candidates on page ${currentPage}`);
                    allCandidates = allCandidates.concat(pageCandidates);
                }
                
                // Check for pagination
                const hasNextPage = $('.pagination').find('a:contains("Next")').length > 0 ||
                                   $('a[aria-label="next"]').length > 0;
                if (!hasNextPage) {
                    hasMorePages = false;
                }
                
                currentPage++;
                
                if (hasMorePages) {
                    await this.sleep(RATE_LIMIT_MS);
                }
                
            } catch (error) {
                console.error(`[TPS] Error on page ${currentPage}:`, error.message);
                hasMorePages = false;
            }
        }
        
        console.log(`[TPS] Total candidates: ${allCandidates.length}`);
        
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
