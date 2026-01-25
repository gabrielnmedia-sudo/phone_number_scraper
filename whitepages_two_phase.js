/**
 * WhitePages Two-Phase Automation
 * Phase 1: Search to find profile URL (uses 1-2 navigations)
 * Phase 2: Scrape profile in separate session (uses 1-2 navigations)
 * 
 * This avoids BrightData's navigation limit by using separate browser sessions
 */

const puppeteer = require('puppeteer-core');
require('dotenv').config();

const SBR_WS_ENDPOINT = 'wss://brd-customer-hl_ee9970d7-zone-scraping_browser2:wftjnv7qkx3v@brd.superproxy.io:9222';

// Throttling: 10 seconds between requests (separate sessions avoid nav limits)
let lastRequestTime = 0;
const THROTTLE_MS = 10000; // 10 seconds

async function throttle() {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (lastRequestTime > 0 && elapsed < THROTTLE_MS) {
        const waitTime = THROTTLE_MS - elapsed;
        console.log(`[WP] Throttle: waiting ${Math.round(waitTime/1000)}s...`);
        await new Promise(r => setTimeout(r, waitTime));
    }
    lastRequestTime = Date.now();
}

/**
 * Phase 1: Find the WhitePages profile URL
 */
async function findProfileUrl(firstName, lastName, state = 'WA') {
    await throttle();
    console.log(`[WP Phase 1] Finding profile for ${firstName} ${lastName}...`);
    
    const browser = await puppeteer.connect({ browserWSEndpoint: SBR_WS_ENDPOINT });
    const page = await browser.newPage();
    
    try {
        const searchUrl = `https://www.whitepages.com/name/${firstName}-${lastName}/${state}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 4000));
        
        // Inject cookies and reload
        await page.evaluate(() => {
            document.cookie = 'caa_auth=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYzVmZThmNjMtZjI2ZS00ZGEwLTgwNTUtYWVkZjk1OTY3MDViIiwiaWF0IjoxNzY5MjE4NDI5LjQyNTY3LCJ1c2VyX2FnZW50IjoiIn0.muhohoIqLstk9MjwbSgVzCEssDfn4PHeKVJxoo2P6v0; path=/; domain=.whitepages.com; secure';
        });
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));
        
        // Dismiss popup
        await page.evaluate(() => {
            const cb = document.querySelector('input[type="checkbox"]');
            if (cb && !cb.checked) cb.click();
        });
        await new Promise(r => setTimeout(r, 500));
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Continue'));
            if (btn) btn.click();
        });
        await new Promise(r => setTimeout(r, 2000));
        
        // Extract profile URL
        const profileUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/name/"]'));
            const valid = links.find(l => 
                l.href.includes('?') && 
                !l.href.includes('/auth/') && 
                !l.href.includes('login')
            );
            return valid ? valid.href : null;
        });
        
        await browser.close();
        
        if (profileUrl) {
            console.log(`[WP Phase 1] Found: ${profileUrl}`);
        } else {
            console.log(`[WP Phase 1] No profile found`);
        }
        
        return profileUrl;
        
    } catch (error) {
        console.error(`[WP Phase 1] Error: ${error.message}`);
        await browser.close();
        return null;
    }
}

/**
 * Phase 2: Scrape phone numbers from profile
 */
async function scrapeProfile(profileUrl) {
    await throttle();
    console.log(`[WP Phase 2] Scraping: ${profileUrl}`);
    
    const browser = await puppeteer.connect({ browserWSEndpoint: SBR_WS_ENDPOINT });
    const page = await browser.newPage();
    
    try {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));
        
        // Inject cookies
        await page.evaluate(() => {
            document.cookie = 'caa_auth=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYzVmZThmNjMtZjI2ZS00ZGEwLTgwNTUtYWVkZjk1OTY3MDViIiwiaWF0IjoxNzY5MjE4NDI5LjQyNTY3LCJ1c2VyX2FnZW50IjoiIn0.muhohoIqLstk9MjwbSgVzCEssDfn4PHeKVJxoo2P6v0; path=/; domain=.whitepages.com; secure';
        });
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 3000));
        
        // Click "See All Phones"
        try {
            const seeAll = await page.$('text/See All Phones');
            if (seeAll) {
                await seeAll.click();
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {}
        
        // Extract phones
        const result = await page.evaluate(() => {
            const data = {
                fullName: document.querySelector('h1')?.innerText?.trim() || '',
                phones: []
            };
            
            // From tel: links
            document.querySelectorAll('a[href^="tel:"]').forEach(el => {
                const phone = el.href.replace('tel:', '').replace(/\D/g, '');
                if (phone.length >= 10) {
                    const fmt = `(${phone.slice(0,3)}) ${phone.slice(3,6)}-${phone.slice(6,10)}`;
                    if (!data.phones.includes(fmt)) data.phones.push(fmt);
                }
            });
            
            // From text patterns
            const matches = document.body.innerText.match(/\(\d{3}\)\s*\d{3}[-.]?\d{4}/g) || [];
            matches.forEach(p => {
                if (!p.includes('*') && !data.phones.includes(p)) data.phones.push(p);
            });
            
            return data;
        });
        
        await browser.close();
        console.log(`[WP Phase 2] Found phones: ${result.phones.join(', ') || 'none'}`);
        return result;
        
    } catch (error) {
        console.error(`[WP Phase 2] Error: ${error.message}`);
        await browser.close();
        return null;
    }
}

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry(fn, maxRetries = 3, baseDelay = 5000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await fn();
            return result;
        } catch (error) {
            lastError = error;
            console.log(`[WP Retry] Attempt ${attempt}/${maxRetries} failed: ${error.message}`);
            if (attempt < maxRetries) {
                const delay = baseDelay * Math.pow(2, attempt - 1);
                console.log(`[WP Retry] Waiting ${delay/1000}s before retry...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    console.error(`[WP Retry] All ${maxRetries} attempts failed`);
    return null;
}

/**
 * Full two-phase search and scrape with retry logic
 */
async function twoPhaseWhitePages(firstName, lastName, state = 'WA') {
    // Phase 1: Find profile URL (with retry)
    const profileUrl = await withRetry(async () => {
        const url = await findProfileUrl(firstName, lastName, state);
        if (!url) throw new Error('No profile URL found');
        return url;
    }, 2, 5000);
    
    if (!profileUrl) {
        console.log(`[WP] Failed to find profile for ${firstName} ${lastName}`);
        return null;
    }
    
    // Phase 2: Scrape profile (with retry)
    const result = await withRetry(async () => {
        const data = await scrapeProfile(profileUrl);
        if (!data || !data.phones || data.phones.length === 0) {
            throw new Error('No phones found in profile');
        }
        return data;
    }, 2, 5000);
    
    return result;
}

module.exports = { twoPhaseWhitePages, findProfileUrl, scrapeProfile };

// CLI
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length >= 2) {
        twoPhaseWhitePages(args[0], args[1], args[2] || 'WA').then(result => {
            console.log('\n--- Final Result:');
            console.log(result);
        });
    } else {
        console.log('Usage: node whitepages_two_phase.js <firstName> <lastName> [state]');
    }
}
