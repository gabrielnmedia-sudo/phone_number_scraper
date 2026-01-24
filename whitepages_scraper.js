/**
 * WhitePages Scraper via BrightData Scraping Browser
 * Uses cloud browser with persistent session for authenticated scraping
 */

const puppeteer = require('puppeteer-core');
require('dotenv').config();

// BrightData Scraping Browser credentials
const SBR_WS_ENDPOINT = 'wss://brd-customer-hl_ee9970d7-zone-scraping_browser2:wftjnv7qkx3v@brd.superproxy.io:9222';

/**
 * Login to WhitePages (run once to establish session)
 */
async function loginToWhitePages(email, password) {
    console.log('[WhitePages] Connecting to BrightData Scraping Browser...');
    
    const browser = await puppeteer.connect({
        browserWSEndpoint: SBR_WS_ENDPOINT,
    });
    
    const page = await browser.newPage();
    
    try {
        console.log('[WhitePages] Navigating to login page...');
        await page.goto('https://www.whitepages.com/login', { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Check if already logged in
        const content = await page.content();
        if (content.includes('Sign Out') || content.includes('My Account')) {
            console.log('✅ Already logged in!');
            await browser.close();
            return true;
        }
        
        console.log('[WhitePages] Entering credentials...');
        
        // Wait for email input
        await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 15000 });
        await page.type('input[type="email"], input[name="email"]', email, { delay: 100 });
        
        // Enter password
        await page.type('input[type="password"], input[name="password"]', password, { delay: 100 });
        
        // Click login button
        await page.click('button[type="submit"]');
        
        // Wait for navigation
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        
        // Verify login success
        const afterContent = await page.content();
        if (afterContent.includes('Sign Out') || afterContent.includes('My Account')) {
            console.log('✅ Login successful!');
            await browser.close();
            return true;
        } else {
            console.log('❌ Login may have failed');
            await page.screenshot({ path: 'whitepages_login_debug.png' });
            await browser.close();
            return false;
        }
        
    } catch (error) {
        console.error('Login error:', error.message);
        await page.screenshot({ path: 'whitepages_login_error.png' });
        await browser.close();
        return false;
    }
}

/**
 * Scrape a WhitePages profile for phone numbers
 */
async function scrapeWhitePagesProfile(url) {
    console.log('[WhitePages] Scraping:', url);
    
    const browser = await puppeteer.connect({
        browserWSEndpoint: SBR_WS_ENDPOINT,
    });
    
    const page = await browser.newPage();
    
    try {
        // First navigate to establish domain context
        console.log('[WhitePages] Loading page...');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Wait a moment
        await new Promise(r => setTimeout(r, 2000));
        
        // Check if we're already authenticated
        let content = await page.content();
        const alreadyAuth = content.includes('Sign Out') || content.includes('My Account');
        
        if (!alreadyAuth) {
            console.log('[WhitePages] Not authenticated, attempting cookie injection...');
            // Try to add cookies via page.evaluate
            await page.evaluate(() => {
                document.cookie = 'caa_auth=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYzVmZThmNjMtZjI2ZS00ZGEwLTgwNTUtYWVkZjk1OTY3MDViIiwiaWF0IjoxNzY5MjE4NDI5LjQyNTY3LCJ1c2VyX2FnZW50IjoiIn0.muhohoIqLstk9MjwbSgVzCEssDfn4PHeKVJxoo2P6v0; path=/; domain=.whitepages.com; secure';
                document.cookie = 'caa_auth_pnp=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYzVmZThmNjMtZjI2ZS00ZGEwLTgwNTUtYWVkZjk1OTY3MDViIiwiaWF0IjoxNzY5MjE4NDI5LjQyNTY3LCJ1c2VyX2FnZW50IjoiIn0.muhohoIqLstk9MjwbSgVzCEssDfn4PHeKVJxoo2P6v0; path=/; domain=.whitepages.com; secure';
            });
            
            // Reload to apply cookies
            console.log('[WhitePages] Reloading with cookies...');
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
            
            // Check again
            await new Promise(r => setTimeout(r, 2000));
            content = await page.content();
            const stillNotAuth = !content.includes('Sign Out') && !content.includes('My Account');
            
            // If still not authenticated, try logging in with credentials
            if (stillNotAuth && process.env.WHITEPAGES_EMAIL && process.env.WHITEPAGES_PASSWORD) {
                console.log('[WhitePages] Cookies expired, attempting auto-login...');
                await browser.close();
                
                // Login first
                const loginSuccess = await loginToWhitePages(
                    process.env.WHITEPAGES_EMAIL,
                    process.env.WHITEPAGES_PASSWORD
                );
                
                if (loginSuccess) {
                    console.log('[WhitePages] Re-attempting scrape after login...');
                    // Recursive call to retry scrape after login
                    return scrapeWhitePagesProfile(url);
                } else {
                    console.log('❌ Auto-login failed. Please check credentials in .env');
                    return null;
                }
            }
        }
        
        // Wait for page content
        await page.waitForSelector('h1', { timeout: 15000 });
        await new Promise(r => setTimeout(r, 2000));

        // Dismiss any popups (cookie consent, etc.)
        try {
            const continueBtn = await page.$('button:has-text("Continue to Results")');
            if (continueBtn) {
                console.log('[WhitePages] Dismissing popup...');
                await continueBtn.click();
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {}

        // Check if this is a search results page (multiple people)
        const isSearchResults = await page.evaluate(() => 
            document.body.innerText.includes('person found') || 
            document.body.innerText.includes('people found')
        );

        if (isSearchResults) {
            console.log('[WhitePages] Search results page - clicking first result...');
            // Click the first "View Full Report" or profile link
            try {
                const firstResult = await page.$('a[href*="/name/"][href*="?"]:not([href*="login"])');
                if (firstResult) {
                    await firstResult.click();
                    await new Promise(r => setTimeout(r, 4000));
                }
            } catch (e) {
                console.log('[WhitePages] Could not click profile link');
            }
        }

        // Try to click "See All Phones" to expand the phone list
        try {
            const seeAllPhones = await page.$('text/See All Phones');
            if (seeAllPhones) {
                console.log('[WhitePages] Clicking "See All Phones"...');
                await seeAllPhones.click();
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {
            // Button might not exist, continue
        }

        // Take debug screenshot
        await page.screenshot({ path: 'whitepages_debug.png', fullPage: true });
        console.log('[WhitePages] Debug screenshot saved');
        
        const result = await page.evaluate(() => {
            const data = {
                fullName: document.querySelector('h1')?.innerText?.trim() || '',
                phones: [],
                isAuthenticated: false,
                isPremium: false
            };
            
            // Check if authenticated
            const bodyText = document.body.innerText;
            if (bodyText.includes('Sign Out') || bodyText.includes('My Account')) {
                data.isAuthenticated = true;
            }
            
            // Check for paywall
            if (!bodyText.includes('View Cell Phone') && !bodyText.includes('Unlock full report')) {
                data.isPremium = true;
            }
            
            // Extract phone numbers - look for tel: links
            document.querySelectorAll('a[href^="tel:"]').forEach(el => {
                const phone = el.href.replace('tel:', '').replace(/\D/g, '');
                if (phone.length >= 10) {
                    const formatted = `(${phone.slice(0,3)}) ${phone.slice(3,6)}-${phone.slice(6,10)}`;
                    if (!data.phones.includes(formatted)) data.phones.push(formatted);
                }
            });
            
            // Also look for visible phone patterns in the text
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
        console.log('Authenticated:', result.isAuthenticated);
        console.log('Premium Access:', result.isPremium);
        console.log('Phones:', result.phones.length ? result.phones : '(none found)');
        
        await browser.close();
        return result;
        
    } catch (error) {
        console.error('Scrape error:', error.message);
        await page.screenshot({ path: 'whitepages_scrape_error.png' });
        await browser.close();
        return null;
    }
}

// Export for use as module
module.exports = {
    scrapeWhitePagesProfile,
    loginToWhitePages,
    buildWhitePagesUrl
};

// Helper to build WhitePages search URL from name and location
function buildWhitePagesUrl(firstName, lastName, city, state) {
    // Use search format which is more flexible than direct profile URLs
    const name = `${firstName} ${lastName}`.trim();
    const location = state || 'WA';
    // WhitePages search URL - this will show all matches and we can pick the best
    return `https://www.whitepages.com/name/${firstName}-${lastName}/${location}`;
}

// CLI Interface - only run if called directly
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args[0] === 'login') {
        const email = args[1] || process.env.WHITEPAGES_EMAIL;
        const password = args[2] || process.env.WHITEPAGES_PASSWORD;
        
        if (!email || !password) {
            console.log('Usage: node whitepages_scraper.js login <email> <password>');
            console.log('Or set WHITEPAGES_EMAIL and WHITEPAGES_PASSWORD in .env');
            process.exit(1);
        }
        
        loginToWhitePages(email, password);
        
    } else if (args[0] === 'scrape' || args[0]) {
        const url = args[0] === 'scrape' ? args[1] : args[0];
        
        if (!url || !url.includes('whitepages.com')) {
            console.log('Usage: node whitepages_scraper.js scrape <whitepages-url>');
            console.log('Or: node whitepages_scraper.js <whitepages-url>');
            process.exit(1);
        }
        
        scrapeWhitePagesProfile(url);
        
    } else {
        console.log('WhitePages Scraper via BrightData Scraping Browser');
        console.log('');
        console.log('Commands:');
        console.log('  login <email> <password>  - Login to WhitePages (do this once)');
        console.log('  scrape <url>              - Scrape a WhitePages profile');
        console.log('  <url>                     - Same as scrape');
    }
}
