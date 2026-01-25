const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function matchProfile(deceasedName, deceasedLocation, prName, candidates) {
    if (!candidates || candidates.length === 0) return null;

    // Filter clearly wrong names if possible (basic fuzzy check could go here, but AI is better)

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
    I am looking for the phone number of a Personal Representative (PR) named "${prName}".
    This PR is handling the estate of a deceased person named "${deceasedName}" who lived in "${deceasedLocation}".
    
    I have scraped the following candidate profiles for "${prName}".
    Identify the most likely match, even if the data is incomplete. Prioritize "educated guesses" over rejection.
    
    HIERARCHY OF MATCHING (Highest to Lowest):
    1. Direct Link: Profile explicitly lists "${deceasedName}" as a relative. (VERIFIED MATCH - 95+ Confidence)
    2. Shared Unusual Surname: The PR and Deceased share an unusual last name (e.g. "Stordahl", "Maccracken", "Refsdal"). This is almost 100% proof of family. (HIGH CONFIDENCE - 85+)
    3. Historical Location: Candidate is currently out-of-state but shows a past residence in "${deceasedLocation.split(',')[0]}" or Washington. (MEDIUM CONFIDENCE - 70+)
    4. Exact Name Match: Candidate matches "${prName}".

    CRITICAL RULES:
    1. REJECT if clearly deceased.
    2. ZERO BIAS: Do NOT reject or penalize a candidate solely because they are currently in a different state. Many PRs move away or are out-of-state family members.
    3. FAMILY LINK IS STRONG: If the candidate is explicitly linked to "${deceasedName}" or shares a rare surname, this is a HIGH CONFIDENCE match (85-100%).
    4. PR-CENTRIC SEARCH: We are looking for the PR. If a candidate matches the PR's name and has a link to the deceased, they are the target.
    5. GEOGRAPHIC PROXIMITY: If the candidate has the correct name and lives in "${deceasedLocation.split(',')[0]}", this is a STRONG match (75-85%) even without a recorded relative link. Public records often miss relationship data.
    6. RELATIONAL LINKAGE: If a candidate has the correct name but NO evidence of a link AND is in a different state, then cap confidence at 60%. If they are local, prioritize the name/location match.
    7. PHONE PREFERENCE: Favor candidates that have phone numbers listed in the scraped data. If multiple candidates are otherwise equal, pick the one with the most phone numbers.
    8. ATTORNEY DETECTION: If ANY candidate profile or snippet contains keywords like "Attorney", "Law Firm", "Esquire", "JD", "Lawyer", "Law Office", or "Counsel", mark them as a potential PROFESSIONAL PR. This should be returned in an "isAttorney": true field.

    Candidates:
    ${JSON.stringify(candidates, null, 2)}

    Return a JSON object with:
    - "bestMatchIndex": The index of the best matching candidate (0-based). If no candidates show any plausible connection to the name or family, return -1.
    - "confidence": Score from 0 to 100.
    - "reasoning": Brief explanation. Mention if it's a family connection, shared name, or geographic proximity. If an attorney is detected, add "Caution: Professional PR detected." to the end of reasoning.
    - "matchType": "VERIFIED", "HIGHLY_PROBABLE", "PLAUSIBLE_GUESS", or "NONE".
    - "isAttorney": true if the matched candidate appears to be an attorney/professional, false otherwise.

    Return ONLY raw JSON, no markdown formatting.
    `;

    async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const result = await model.generateContent(prompt);
            const response = result.response;
            const text = response.text();
            
            // Clean markdown if present
            const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const analysis = JSON.parse(jsonStr);
            
            return analysis;

        } catch (error) {
            console.error(`[AI Matcher] Error (Attempt ${attempt}/3):`, error.message);
            if (attempt < 3) await sleep(1000 * attempt); // Exponential backoff
            else return { bestMatchIndex: -1, confidence: 0, reasoning: "AI Error: " + error.message };
        }
    }
}

module.exports = { matchProfile };
