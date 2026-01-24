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
    Please analyze them and identify which one is the most likely match.
    
    Strong indicators of a match:
    1. The candidate lists "${deceasedName}" (or similar last name) as a Relative or Associate.
    2. The candidate has lived in or near "${deceasedLocation}".
    3. The candidate shares the same unusual last name as the deceased.

    Candidates:
    ${JSON.stringify(candidates, null, 2)}

    Return a JSON object with:
    - "bestMatchIndex": The index of the best matching candidate in the array (0-based). If none are good matches, return -1.
    - "confidence": A score from 0 to 100.
    - "reasoning": A brief explanation of why this candidate was chosen.

    Return ONLY raw JSON, no markdown formatting.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();
        
        // Clean markdown if present
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const analysis = JSON.parse(jsonStr);
        
        return analysis;

    } catch (error) {
        console.error("Gemini Error Details:", error);
        return { bestMatchIndex: -1, confidence: 0, reasoning: "AI Error: " + error.message };
    }
}

module.exports = { matchProfile };
