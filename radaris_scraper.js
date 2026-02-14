/**
 * Radaris Scraper Module
 * Uses ScraperAPI for all requests
 */

const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();
const { globalLimiter } = require('./request_limiter');

const SCRAPERAPI_KEY = process.env.SCRAPERAPI_KEY;
const TIMEOUT = 60000; // ScraperAPI needs more time

class RadarisScraper {
    constructor() {
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
                const response = await globalLimiter.run(async () => {
                    const scraperUrl = `http://api.scraperapi.com?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(targetUrl)}&premium=true&country_code=us`;
                    return this.client.get(scraperUrl);
                });

                if (response.status === 200 && response.data && response.data.length > 0) {
                    return response;
                } else if (response.status === 500 || response.status === 502 || response.status === 503 || response.status === 429) {
                    console.warn(`[Radaris] Status ${response.status} on attempt ${i + 1}/${retries}. Retrying...`);
                    await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i)));
                    continue;
                }
                
                return response;
            } catch (error) {
                const isRetryable = error.message.includes('429') || error.message.includes('timeout') || error.message.includes('ECONNRESET');
                console.error(`[Radaris] Request Error (Attempt ${i + 1}/${retries}): ${error.message}`);
                
                if (i < retries - 1 && isRetryable) {
                    const delay = 2000 * Math.pow(2, i);
                    console.log(`[Radaris] Retrying in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
                }
                
                if (i === retries - 1) return { status: 500, data: '' };
            }
        }
        return { status: 500, data: '' };
    }

    /**
     * Search Radaris for a name in a state with pagination support
     */
    async search(firstName, lastName, state, options = {}) {
        const { maxPages = 3 } = options;
        
        // Handle name splitting if provided as a single string
        if (!lastName && firstName.includes(' ')) {
            const parts = firstName.trim().split(/\s+/);
            firstName = parts[0];
            lastName = parts[parts.length - 1];
        } else if (lastName && lastName.includes(' ')) {
            const parts = lastName.trim().split(/\s+/);
            lastName = parts[parts.length - 1];
        }

        const fullState = state ? this.fullStateName(state) : null;
        let allCandidates = [];
        let currentPage = 1;
        let hasMore = true;

        while (hasMore && currentPage <= maxPages) {
            const stateParam = fullState ? `&fs=${encodeURIComponent(fullState)}` : '';
            const url = `https://radaris.com/ng/search?ff=${encodeURIComponent(firstName)}&fl=${encodeURIComponent(lastName)}${stateParam}${currentPage > 1 ? `&page=${currentPage}` : ''}`;
            console.log(`[Radaris] Searching (Page ${currentPage}, State: ${state || 'NATIONWIDE'}): ${url}`);

            try {
                const response = await this._makeRequest(url);
                if (response.status !== 200) {
                    console.warn(`[Radaris] Search failed on page ${currentPage} with status ${response.status}`);
                    break;
                }

                let html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
                let $ = cheerio.load(html);
                
                // DEBUG: Log what we got back
                const title = $('title').text();
                const htmlLen = html.length;
                console.log(`[Radaris] Got HTML: ${htmlLen} chars, title: "${title}"`);
                
                // Detect anti-bot homepage redirect and retry once
                if (title.includes('Background Check') && title.includes('Radaris') && !title.includes('people found')) {
                    console.log(`[Radaris] ⚠️ Got homepage redirect. Retrying with fresh IP...`);
                    await this.sleep(1000);
                    const retryResponse = await this._makeRequest(url);
                    if (retryResponse.status === 200) {
                        const retryHtml = typeof retryResponse.data === 'string' ? retryResponse.data : JSON.stringify(retryResponse.data);
                        const $retry = cheerio.load(retryHtml);
                        const retryTitle = $retry('title').text();
                        console.log(`[Radaris] Retry result: "${retryTitle}"`);
                        if (retryTitle.includes('people found') && !retryTitle.includes('0 people found')) {
                            // Retry succeeded — swap variables and fall through to normal parsing
                            html = retryHtml;
                            $ = $retry;
                        } else {
                            break; // Retry also got homepage or no results
                        }
                    } else {
                        break;
                    }
                }

                if ($('title').text().includes('0 people found') || $('title').text().includes('Page not found')) {
                    console.log(`[Radaris] No results found in title. Breaking.`);
                    break;
                }

                const pageCandidates = [];
                // Look for cards, teaser-cards, or anything with a blocks-name inside
                const cardSelector = '.teaser-card, .card, .blocks-wrapper, .teaser-profile';
                const cardCount = $(cardSelector).length;
                console.log(`[Radaris] Cards found with selector '${cardSelector}': ${cardCount}`);
                
                // DEBUG: If no cards found, dump all class names to find the right selectors
                if (cardCount === 0) {
                    const allClasses = new Set();
                    $('[class]').each((i, el) => {
                        $(el).attr('class').split(/\s+/).forEach(c => allClasses.add(c));
                    });
                    const classArr = [...allClasses].sort();
                    console.log(`[Radaris] DEBUG - All CSS classes on page (${classArr.length}): ${classArr.slice(0, 80).join(', ')}`);
                    // Also look for any links that might be person profile links
                    const profileLinks = $('a[href*="/p/"], a[href*="/ng/"], a[href*="/~"]');
                    console.log(`[Radaris] DEBUG - Profile-like links found: ${profileLinks.length}`);
                    profileLinks.each((i, el) => {
                        if (i < 5) console.log(`[Radaris] DEBUG - Link ${i}: href=${$(el).attr('href')} text="${$(el).text().trim().substring(0, 60)}"`);
                    });
                }
                $(cardSelector).each((i, el) => {
                    const $el = $(el);
                    
                    // Name fallbacks
                    const nameNode = $el.find('.blocks-name, .card-title, h3').first();
                    const name = nameNode.text().trim().replace(/\s+/g, ' ');

                    // Detail link fallbacks
                    const detailNode = $el.find('.view-all-details, .card-title, a[data-href], .blocks-name').first();
                    const detailLink = detailNode.attr('data-href-target-blank') || detailNode.attr('data-href') || detailNode.attr('href');
                    
                    // Age fallbacks
                    let age = $el.find('.age, .blocks-right span.gray-text').text().trim();
                    if (age) age = age.replace(/[^0-9]/g, '');

                    // Location fallbacks
                    let location = $el.find('.many-links-item').first().text().trim();
                    if (!location) {
                        $el.find('.text-item').each((j, item) => {
                            if ($(item).find('.text-item_caption').text().includes('Lived in')) {
                                location = $(item).find('.text-item_content').text().trim();
                            }
                        });
                    }

                    if (name && detailLink && name.length > 3) {
                        pageCandidates.push({
                            fullName: name,
                            age: age || 'Unknown',
                            location: location || 'Unknown',
                            detailLink: detailLink.startsWith('http') ? detailLink : `https://radaris.com${detailLink}`,
                            source: 'Radaris'
                        });
                    }
                });

                if (pageCandidates.length === 0) {
                    hasMore = false;
                } else {
                    allCandidates = allCandidates.concat(pageCandidates);
                    // Simple check for next page: look for pagination links
                    const nextLink = $(`.pagination a[href*="page=${currentPage + 1}"]`);
                    if (nextLink.length === 0) hasMore = false;
                }

                currentPage++;
                if (hasMore) await this.sleep(500);

            } catch (error) {
                console.error(`[Radaris] Search error on page ${currentPage}: ${error.message}`);
                break;
            }
        }

        return allCandidates;
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

            // Check if deceased
            const pageText = $('body').text().toUpperCase();
            const isDeceased = pageText.includes('DECEASED') || 
                              pageText.includes('IN MEMORIAM') || 
                              pageText.includes('DIED ON') ||
                              $('.deceased-label').length > 0;

            console.log(`[Radaris] Profile deceased check: ${isDeceased}`);

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

            // Extract full name from profile page
            const fullNameOnPage = $('h1').first().text().trim();

            return {
                fullName: fullNameOnPage,
                allPhones: phones,
                allRelatives: relatives,
                isDeceased,
                url
            };
        } catch (error) {
            console.error(`[Radaris] Profile error: ${error.message}`);
            return null;
        }
    }
}

module.exports = RadarisScraper;
