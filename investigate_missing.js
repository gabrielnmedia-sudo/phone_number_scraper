const RadarisScraper = require('./radaris_scraper');
const EnhancedScraper = require('./enhanced_scraper');
const radaris = new RadarisScraper();
const enhanced = new EnhancedScraper();

async function run() {
    const targets = [
        { d: "JASAWIDYA SUTJANDRA", pr: "ALLEN SUTJANDRA" },
        { d: "TERESA ANN BLADINE-GLOMBECKI", pr: "ERIC THOMAS BLADINE-GLOMBECKI" }
    ];

    for (const t of targets) {
        console.log(`\n--- Investigating ${t.d} ---`);
        
        // 1. Radaris Search
        console.log(`[Investigation] Searching Radaris for Deceased...`);
        const candidates = await radaris.search(t.d, null, "WA", { maxPages: 1 });
        if (candidates.length > 0) {
            console.log(`Found ${candidates.length} candidates for ${t.d}`);
            const profile = await radaris.getProfile(candidates[0].detailLink);
            if (profile) {
                console.log(`Relatives for ${t.d}:`, profile.allRelatives.map(r => r.name).join(', '));
                const match = profile.allRelatives.find(r => 
                    r.name.toLowerCase().includes(t.pr.split(' ')[0].toLowerCase())
                ) || profile.allRelatives.find(r => 
                    r.name.toLowerCase().includes(t.pr.split(' ').pop().toLowerCase())
                );
                if (match) {
                    console.log(`✅ FOUND FAMILY LINK ON RADARIS: ${match.name}`);
                    if (match.url) {
                        const prProfile = await radaris.getProfile(match.url);
                        if (prProfile && prProfile.allPhones.length > 0) {
                            console.log(`Phones for ${match.name} (Radaris):`, prProfile.allPhones.join(' | '));
                        } else {
                            console.log(`❌ No phones for ${match.name} on Radaris.`);
                        }
                    }
                }
            }
        }

        // 2. CBC Search for PR directly
        console.log(`[Investigation] Searching CBC for PR ${t.pr}...`);
        const cbcPRCandidates = await enhanced.searchCBCWithPagination(t.pr, null, "WA", { maxPages: 1 });
        if (cbcPRCandidates.length > 0) {
            console.log(`Found ${cbcPRCandidates.length} candidates for PR ${t.pr} on CBC`);
            const cbcProfile = await enhanced.getDetailsCBC(cbcPRCandidates[0].detailLink);
            if (cbcProfile && cbcProfile.phones && cbcProfile.phones.length > 0) {
                console.log(`Phones for ${t.pr} (CBC):`, cbcProfile.phones.join(' | '));
            } else {
                console.log(`❌ No phones for ${t.pr} on CBC.`);
            }
        } else {
            console.log(`❌ No profile found for PR ${t.pr} on CBC`);
        }

        // 3. CBC Search for Deceased directly (to find relatives with phones)
        console.log(`[Investigation] Searching CBC for Deceased ${t.d}...`);
        const cbcDCandidates = await enhanced.searchCBCWithPagination(t.d, null, "WA", { maxPages: 1 });
        if (cbcDCandidates.length > 0) {
            console.log(`Found ${cbcDCandidates.length} candidates for Deceased ${t.d} on CBC`);
            const cbcProfile = await enhanced.getDetailsCBC(cbcDCandidates[0].detailLink);
            if (cbcProfile && cbcProfile.relatives && cbcProfile.relatives.length > 0) {
                console.log(`Relatives for ${t.d} (CBC):`, cbcProfile.relatives.map(r => r.name).join(', '));
                const match = cbcProfile.relatives.find(r => 
                    r.name.toLowerCase().includes(t.pr.split(' ')[0].toLowerCase())
                );
                if (match) {
                    console.log(`✅ FOUND FAMILY LINK ON CBC: ${match.name}`);
                    // CBC doesn't give us the profile URL for relatives easily in the same pass usually,
                    // but we can search for the match name now.
                    console.log(`[Investigation] Searching CBC for discovered relative: ${match.name}`);
                    const relCandidates = await enhanced.searchCBCWithPagination(match.name, null, "WA", { maxPages: 1 });
                    if (relCandidates.length > 0) {
                        const relProfile = await enhanced.getDetailsCBC(relCandidates[0].detailLink);
                        if (relProfile && relProfile.phones && relProfile.phones.length > 0) {
                            console.log(`Phones for ${match.name} (CBC):`, relProfile.phones.join(' | '));
                        }
                    }
                }
            }
        }

        // 5. TPS Search for PR (Fallback)
        console.log(`[Investigation] Searching TPS for PR ${t.pr}...`);
        try {
            const tpsCandidates = await enhanced.searchTPSWithPagination(t.pr, null, "WA", { maxPages: 1 });
            if (tpsCandidates.length > 0) {
                console.log(`Found ${tpsCandidates.length} candidates for PR ${t.pr} on TPS`);
                // TPS parsing in enhanced_scraper might not be fully fleshed out for details in this script context,
                // but let's try to see what we got.
                 for (const c of tpsCandidates) {
                    console.log(`[TPS] Candidate: ${c.fullName}, ${c.age}, ${c.location}, Phones: ${c.phones ? c.phones.join('|') : 'None'}`);
                }
            } else {
                console.log(`❌ No profile found for PR ${t.pr} on TPS`);
            }
        } catch (e) {
            console.log(`[TPS] Error searching TPS: ${e.message}`);
        }

        // 4. Broad CBC Search for last name (if needed)
        if (t.pr.includes('-')) {
            const lastName = t.pr.split(' ').pop();
            console.log(`[Investigation] Broad CBC search for last name: ${lastName}`);
            const broadCandidates = await enhanced.searchCBCWithPagination(lastName, null, "WA", { maxPages: 1 });
            for (const c of broadCandidates) {
                console.log(`Inspecting candidate: ${c.fullName}, ${c.age}, ${c.location}`);
                // Fetch details for ALL candidates with this rare last name
                 const prof = await enhanced.getDetailsCBC(c.detailLink);
                if (prof && prof.phones && prof.phones.length > 0) {
                    console.log(`Phones for ${c.fullName} (Broad CBC):`, prof.phones.join(' | '));
                }
            }
        }
    }
}

run();
