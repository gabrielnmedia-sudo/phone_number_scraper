const RadarisScraper = require('./radaris_scraper');

async function main() {
    const url = process.argv[2];
    if (!url) {
        console.log('Usage: node dump_profile.js <url>');
        return;
    }
    const radaris = new RadarisScraper();
    const profile = await radaris.getProfile(url);
    console.log(JSON.stringify(profile, null, 2));
}

main().catch(console.error);
