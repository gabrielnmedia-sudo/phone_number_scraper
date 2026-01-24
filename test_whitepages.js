/**
 * WhitePages Scraper Test - Using Web Unlocker API
 * Same approach as radaris_scraper.js
 */

const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const API_KEY = process.env.BRIGHTDATA_API_KEY;
const ZONE = process.env.BRIGHTDATA_ZONE || 'web_unlocker1';

async function scrapeWhitePages(url) {
    console.log('[WhitePages] Fetching via Web Unlocker API...');
    console.log('[WhitePages] URL:', url);
    console.log('[WhitePages] Zone:', ZONE);
    
    try {
        const response = await axios.post('https://api.brightdata.com/request', {
            zone: ZONE,
            url: url,
            format: 'raw'
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });

        console.log('\n--- Response Status:', response.status);
        console.log('--- Content Length:', response.data?.length || 0);

        if (response.status !== 200 || !response.data || response.data.length < 500) {
            console.log('--- Low/No content. Preview:', response.data?.substring(0, 500));
            return null;
        }

        const $ = cheerio.load(response.data);
        
        // Extract data
        const result = {
            fullName: $('h1').first().text().trim(),
            phones: [],
            addresses: [],
            relatives: []
        };

        // Look for phone numbers - various methods
        console.log('\n--- Extracting data...');

        // Method 1: tel: links
        $('a[href^="tel:"]').each((i, el) => {
            const phone = $(el).attr('href').replace('tel:', '');
            if (phone && !result.phones.includes(phone)) result.phones.push(phone);
        });

        // Method 2: Regex on body text
        const bodyText = $('body').text();
        const phoneMatches = bodyText.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [];
        phoneMatches.forEach(p => {
            const clean = p.replace(/\D/g, '');
            if (clean.length >= 10 && !result.phones.some(ex => ex.replace(/\D/g, '') === clean)) {
                result.phones.push(p);
            }
        });

        // Method 3: Look for premium paywall indicators
        if (bodyText.includes('Unlock full report') || bodyText.includes('unlock report')) {
            console.log('⚠️ Premium paywall detected - phone may be hidden');
        }

        // Check for CAPTCHA or block
        if (bodyText.includes('CAPTCHA') || bodyText.includes('captcha') || bodyText.includes('robot')) {
            console.log('⚠️ CAPTCHA/Bot check detected');
        }

        console.log('Full Name:', result.fullName);
        console.log('Phones Found:', result.phones.length);
        result.phones.forEach(p => console.log('  -', p));

        // Save HTML for inspection
        const fs = require('fs');
        fs.writeFileSync('whitepages_response.html', response.data);
        console.log('\n--- Full HTML saved to whitepages_response.html');

        return result;

    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
        return null;
    }
}

const testUrl = process.argv[2] || 'https://www.whitepages.com/name/Allen-Sutjandra/Lynnwood-WA/PJyqjX5PX3Q?is_best_match=true';
scrapeWhitePages(testUrl);
