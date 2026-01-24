const RadarisScraper = require('./radaris_scraper');
const radaris = new RadarisScraper();

async function test() {
    const url = 'https://radaris.com/~Kathryn-Adolphsen/1230841637';
    const profile = await radaris.getProfile(url);
    console.log(JSON.stringify(profile, null, 2));
}
test();
