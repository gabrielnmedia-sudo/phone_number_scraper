/**
 * WhitePages Full Search & Scrape
 * Uses BrightData Scraping Browser to search WhitePages and scrape the first result
 */

const puppeteer = require('puppeteer-core');
require('dotenv').config();

const SBR_WS_ENDPOINT = 'wss://brd-customer-hl_ee9970d7-zone-scraping_browser2:wftjnv7qkx3v@brd.superproxy.io:9222';

// Throttling: Minimum 30 seconds between WhitePages requests to avoid rate limiting
let lastRequestTime = 0;
const THROTTLE_MS = 30000; // 30 seconds

async function throttle() {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (lastRequestTime > 0 && elapsed < THROTTLE_MS) {
        const waitTime = THROTTLE_MS - elapsed;
        console.log(`[WP Throttle] Waiting ${Math.round(waitTime/1000)}s to avoid rate limits...`);
        await new Promise(r => setTimeout(r, waitTime));
    }
    lastRequestTime = Date.now();
}

/**
 * Search WhitePages and scrape the first matching profile
 */
async function searchAndScrapeWhitePages(firstName, lastName, state = 'WA') {
    // Apply throttling before making request
    await throttle();
    
    console.log(`[WP Search] Searching for ${firstName} ${lastName} in ${state}...`);
    
    const browser = await puppeteer.connect({
        browserWSEndpoint: SBR_WS_ENDPOINT,
    });
    
    const page = await browser.newPage();
    
    try {
        // Go directly to WhitePages search
        const searchUrl = `https://www.whitepages.com/name/${firstName}-${lastName}/${state}`;
        console.log(`[WP Search] Loading: ${searchUrl}`);
        
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('body', { timeout: 15000 });
        await new Promise(r => setTimeout(r, 3000));

        // Inject auth cookies
        await page.evaluate(() => {
            document.cookie = 'caa_auth=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYzVmZThmNjMtZjI2ZS00ZGEwLTgwNTUtYWVkZjk1OTY3MDViIiwiaWF0IjoxNzY5MjE4NDI5LjQyNTY3LCJ1c2VyX2FnZW50IjoiIn0.muhohoIqLstk9MjwbSgVzCEssDfn4PHeKVJxoo2P6v0; path=/; domain=.whitepages.com; secure';
            document.cookie = 'caa_auth_pnp=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYzVmZThmNjMtZjI2ZS00ZGEwLTgwNTUtYWVkZjk1OTY3MDViIiwiaWF0IjoxNzY5MjE4NDI5LjQyNTY3LCJ1c2VyX2FnZW50IjoiIn0.muhohoIqLstk9MjwbSgVzCEssDfn4PHeKVJxoo2P6v0; path=/; domain=.whitepages.com; secure';
        });
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));

        // Dismiss popup if present - click checkbox first, then Continue
        await page.evaluate(() => {
            // Find and click the checkbox
            const checkbox = document.querySelector('input[type="checkbox"]');
            if (checkbox && !checkbox.checked) checkbox.click();
        });
        await new Promise(r => setTimeout(r, 500));
        
        await page.evaluate(() => {
            // Now click the Continue button
            const continueBtn = Array.from(document.querySelectorAll('button')).find(b => 
                b.innerText.includes('Continue') && !b.disabled
            );
            if (continueBtn) continueBtn.click();
        });
        await new Promise(r => setTimeout(r, 3000));

        // Check if we're on a search results page or a profile
        const bodyText = await page.evaluate(() => document.body.innerText);
        const isSearchPage = bodyText.includes('people found') || bodyText.includes('person found');
        
        if (isSearchPage) {
            console.log('[WP Search] On search results page - finding first profile...');
            
            // Extract all profile links and filter out login redirects
            const profileLink = await page.evaluate(() => {
                const allLinks = Array.from(document.querySelectorAll('a[href*="/name/"]'));
                // Filter: must have person ID (? or long alphanumeric), must NOT be login redirect
                const validLinks = allLinks.filter(l => {
                    const href = l.href;
                    return (href.includes('?') || href.match(/\/[A-Za-z0-9]{8,}$/)) &&
                           !href.includes('/auth/') &&
                           !href.includes('login') &&
                           href.includes('/name/');
                }).map(l => l.href);
                return validLinks.length > 0 ? validLinks[0] : null;
            });
            
            if (profileLink) {
                console.log(`[WP Search] Navigating to profile: ${profileLink}`);
                await page.goto(profileLink, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await new Promise(r => setTimeout(r, 4000));
            } else {
                console.log('[WP Search] No direct profile link found, trying alternate approach...');
                // Try to get profile ID from page text and construct URL
                const pageHtml = await page.content();
                const idMatch = pageHtml.match(/\/name\/[A-Za-z-]+\/[A-Za-z-]+\/([A-Za-z0-9]+)/);
                if (idMatch) {
                    const directUrl = `https://www.whitepages.com/name/Allen-Sutjandra/Lynnwood-WA/${idMatch[1]}`;
                    console.log(`[WP Search] Trying direct: ${directUrl}`);
                    await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    await new Promise(r => setTimeout(r, 4000));
                }
            }
        }

        // Now extract phones from the profile page
        await page.waitForSelector('h1', { timeout: 10000 }).catch(() => {});
        
        // Click "See All Phones" if present
        try {
            const seeAll = await page.$('text/See All Phones');
            if (seeAll) {
                await seeAll.click();
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {}

        // Take debug screenshot
        await page.screenshot({ path: 'whitepages_search_debug.png' });

        // Extract data
        const result = await page.evaluate(() => {
            const data = {
                fullName: document.querySelector('h1')?.innerText?.trim() || '',
                phones: [],
                url: window.location.href
            };

            // Extract phones from tel: links
            document.querySelectorAll('a[href^="tel:"]').forEach(el => {
                const phone = el.href.replace('tel:', '').replace(/\D/g, '');
                if (phone.length >= 10) {
                    const formatted = `(${phone.slice(0,3)}) ${phone.slice(3,6)}-${phone.slice(6,10)}`;
                    if (!data.phones.includes(formatted)) data.phones.push(formatted);
                }
            });

            // Also look for phone patterns in text
            const bodyText = document.body.innerText;
            const phoneMatches = bodyText.match(/\(\d{3}\)\s*\d{3}[-.]?\d{4}/g) || [];
            phoneMatches.forEach(p => {
                if (!p.includes('*') && !data.phones.includes(p)) {
                    data.phones.push(p);
                }
            });

            return data;
        });

        console.log('\n--- Results:');
        console.log('Name:', result.fullName);
        console.log('URL:', result.url);
        console.log('Phones:', result.phones.length ? result.phones : '(none found)');

        await browser.close();
        return result;

    } catch (error) {
        console.error('Error:', error.message);
        await page.screenshot({ path: 'whitepages_search_error.png' }).catch(() => {});
        await browser.close();
        return null;
    }
}

module.exports = { searchAndScrapeWhitePages };

// CLI
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length >= 2) {
        searchAndScrapeWhitePages(args[0], args[1], args[2] || 'WA');
    } else {
        console.log('Usage: node whitepages_search.js <firstName> <lastName> [state]');
    }
}
