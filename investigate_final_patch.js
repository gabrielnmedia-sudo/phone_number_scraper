const RadarisScraper = require('./radaris_scraper');
const EnhancedScraper = require('./enhanced_scraper');
const radaris = new RadarisScraper();
const enhanced = new EnhancedScraper();

async function run() {
    console.log("=== REGRESSION ANALYSIS PATCH ===");

    // 1. ERIC GLOMBECKI (Edmonds, WA)
    console.log("\n--- [1] Searching for ERIC GLOMBECKI (Edmonds, WA) ---");
    try {
        // Correct signature: firstName, lastName, state
        const candidates = await radaris.search("Eric", "Glombecki", "WA", { maxPages: 1 });
        if (candidates.length > 0) {
            console.log(`Found ${candidates.length} candidates for Eric Glombecki.`);
            // Look for the one with phone (206) 542-4412 if possible, or just the best match
            const best = candidates[0]; 
            console.log(`Fetching details for: ${best.name}, Age: ${best.age}, Link: ${best.detailLink}`);
            const profile = await radaris.getProfile(best.detailLink);
            
            // Check for relatives
            const relatives = profile.allRelatives.map(r => r.name);
            console.log("Relatives:", relatives.join(", "));
            
            // Check if Teresa is there
            const hasTeresa = relatives.some(r => r.toLowerCase().includes('teresa'));
            if (hasTeresa) {
                console.log("✅ CONFIRMED: Linked to Teresa!");
            }

            if (profile.allPhones.length > 0) {
                console.log(`✅ PHONES: ${profile.allPhones.join(' | ')}`);
            } else {
                console.log(`❌ No phones found on Radaris.`);
                // Try CBC for this specific name/loc if Radaris fails
                console.log("--> Trying CBC for Eric Glombecki in Edmonds...");
                const cbc = await enhanced.searchCBCWithPagination("Eric Glombecki", "Edmonds", "WA", {maxPages:1});
                if (cbc.length > 0) {
                     const cbcProf = await enhanced.getDetailsCBC(cbc[0].detailLink);
                     if (cbcProf && cbcProf.phones.length > 0) {
                         console.log(`✅ CBC PHONES: ${cbcProf.phones.join(' | ')}`);
                     }
                }
            }
        } else {
            console.log("❌ No candidates found for Eric Glombecki in Edmonds.");
        }
    } catch (e) {
        console.error("Error:", e.message);
    }

    // 2. ALLEN SUTJANDRA (Kent, WA) - The V2 address match
    // Address: 5819 S 232nd Pl #8-3 Kent, WA 98032
    console.log("\n--- [2] Searching for ALLEN SUTJANDRA (Kent, WA) ---");
    try {
        const candidates = await radaris.search("Allen", "Sutjandra", "WA", { maxPages: 1 });
        if (candidates.length > 0) {
            console.log(`Found ${candidates.length} candidates for Allen Sutjandra in Kent.`);
            const best = candidates[0];
            console.log(`Fetching details for: ${best.name}, Age: ${best.age}, Link: ${best.detailLink}`);
            const profile = await radaris.getProfile(best.detailLink);
            if (profile.allPhones.length > 0) {
                 console.log(`✅ PHONES: ${profile.allPhones.join(' | ')}`);
            } else {
                console.log("❌ No phones on Radaris.");
                // Try CBC
                console.log("--> Trying CBC for Allen Sutjandra in Kent...");
                const cbc = await enhanced.searchCBCWithPagination("Allen", "Sutjandra", "WA"); // Note: searchCBCWithPagination takes (name, city, state)
                // Actually searchCBCWithPagination signature is (name, city, state). "Allen Sutjandra" is better.
                const cbc2 = await enhanced.searchCBCWithPagination("Allen Sutjandra", "Kent", "WA");
                
                if (cbc2.length > 0) {
                     const cbcProf = await enhanced.getDetailsCBC(cbc2[0].detailLink);
                     if (cbcProf && cbcProf.phones.length > 0) {
                         console.log(`✅ CBC PHONES: ${cbcProf.phones.join(' | ')}`);
                     } else {
                         console.log("❌ No phones on CBC.");
                     }
                } else {
                    console.log("❌ No candidates on CBC.");
                }

                // Try TPS
                console.log("--> Trying TPS for Allen Sutjandra in Kent...");
                try {
                     const tps = await enhanced.searchTPSWithPagination("Allen Sutjandra", "Kent", "WA", {maxPages:1});
                    if (tps.length > 0) {
                        console.log(`Found ${tps.length} TPS candidates.`);
                        console.log(`First TPS Phones: ${tps[0].phones.join(' | ')}`);
                    } else {
                        console.log("❌ No candidates on TPS.");
                    }
                } catch(e) { console.log("TPS Error:", e.message); }

                // Try SearchPeopleFree (SPF)
                console.log("--> Trying SearchPeopleFree (SPF) for Allen Sutjandra in Kent...");
                const SearchPeopleFreeScraper = require('./searchpeoplefree_scraper');
                const spf = new SearchPeopleFreeScraper();
                try {
                     const spfCandidates = await spf.search("Allen Sutjandra", "Kent", "WA");
                     if (spfCandidates.length > 0) {
                         console.log(`Found ${spfCandidates.length} SPF candidates.`);
                         const spfProf = await spf.getProfile(spfCandidates[0].detailLink);
                         if (spfProf && spfProf.phones.length > 0) {
                             console.log(`✅ SPF PHONES: ${spfProf.phones.join(' | ')}`);
                         } else {
                             console.log("❌ No phones on SPF.");
                         }
                     } else {
                         console.log("❌ No candidates on SPF.");
                     }
                } catch(e) { console.log("SPF Error:", e.message); }

            } // Close if others failed
        } // Close else
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
