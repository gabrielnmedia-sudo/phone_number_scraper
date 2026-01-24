/**
 * Intelligent Name Parser for Probate Records
 * Separates Deceased and PR names from combined "Owner Name" column
 */

// Common patterns for deceased indicators
const DECEASED_PATTERNS = [
    /\(Dead\)/i,
    /\(Deceased\)/i,
    /\(DEAD\)/i,
    /ESTATE OF/i
];

// Common patterns for PR indicators
const PR_PATTERNS = [
    /\(PR\)/i,
    /\(PR\s*&\s*Owner\)/i,
    /\(PR\s*&\s*OWNER\)/i,
    /\(Owner\s*&\s*PR\)/i,
    /\(OWNER\s*&\s*PR\)/i,
    /\(PR\s*and\s*Owner\)/i,
    /\(Owner\s*and\s*PR\)/i
];

/**
 * Parse a combined Owner Name field into separate deceased and PR names
 * @param {string} rawOwnerName - The raw Owner Name from the CSV
 * @returns {Object} - { deceased_name, pr_name, is_probate, raw }
 */
function parseOwnerName(rawOwnerName) {
    if (!rawOwnerName || typeof rawOwnerName !== 'string') {
        return {
            deceased_name: null,
            pr_name: null,
            is_probate: false,
            raw: rawOwnerName
        };
    }

    const trimmed = rawOwnerName.trim();
    let deceased = null;
    let pr = null;
    let isProbate = false;

    // Pattern 1: "NAME (Dead) & NAME (PR)" or variants
    // Match: THOMAS R MARTIN (Dead) Diane K Martin (PR)
    const deadWithPRMatch = trimmed.match(/^(.+?)\s*\(Dead\)\s*(?:&|and|,)?\s*(.+?)\s*\(PR(?:\s*&?\s*Owner)?\)/i);
    if (deadWithPRMatch) {
        deceased = cleanName(deadWithPRMatch[1]);
        pr = cleanName(deadWithPRMatch[2]);
        isProbate = true;
        return { deceased_name: deceased, pr_name: pr, is_probate: isProbate, raw: rawOwnerName };
    }

    // Pattern 2: "NAME (Dead)" without explicit PR marker - PR follows after
    const deadOnlyMatch = trimmed.match(/^(.+?)\s*\(Dead\)\s*(?:&|and|,)?\s*(.+?)$/i);
    if (deadOnlyMatch) {
        deceased = cleanName(deadOnlyMatch[1]);
        // Check if second part has any indicator
        let remainder = deadOnlyMatch[2].trim();
        // Remove trailing indicators like (PR), (Owner), (PR&Owner)
        remainder = remainder.replace(/\s*\((?:PR|Owner|PR\s*&\s*Owner|Owner\s*&\s*PR|PR\s*and\s*Owner)\)\s*/gi, '').trim();
        if (remainder.length > 2) {
            pr = cleanName(remainder.split('(')[0]); // Take part before any parentheses
        }
        isProbate = true;
        return { deceased_name: deceased, pr_name: pr, is_probate: isProbate, raw: rawOwnerName };
    }

    // Pattern 3: "ESTATE OF NAME"
    const estateMatch = trimmed.match(/ESTATE\s+OF\s+(.+)/i);
    if (estateMatch) {
        deceased = cleanName(estateMatch[1]);
        pr = 'Unknown';
        isProbate = true;
        return { deceased_name: deceased, pr_name: pr, is_probate: isProbate, raw: rawOwnerName };
    }

    // Pattern 4: "NAME (Deceased)" variants
    const deceasedMatch = trimmed.match(/^(.+?)\s*\(Deceased\)/i);
    if (deceasedMatch) {
        deceased = cleanName(deceasedMatch[1]);
        isProbate = true;
        // Look for PR after
        let remainder = trimmed.replace(deceasedMatch[0], '').trim();
        remainder = remainder.replace(/^[,&]|and\s+/i, '').trim();
        if (remainder.length > 2) {
            pr = cleanName(remainder.replace(/\(.*?\)/g, '').trim());
        }
        return { deceased_name: deceased, pr_name: pr, is_probate: isProbate, raw: rawOwnerName };
    }

    // Pattern 5: Complex - "BOTH DEAD" cases
    // ROBERT A GRUBE & LINDA F GRUBE (BOTH DEAD) & MICHELLE M JONES (PR)
    const bothDeadMatch = trimmed.match(/^(.+?)\s*\(BOTH\s*DEAD\)\s*(?:&|and|,)?\s*(.+?)\s*\(PR\)/i);
    if (bothDeadMatch) {
        deceased = cleanName(bothDeadMatch[1]);
        pr = cleanName(bothDeadMatch[2]);
        isProbate = true;
        return { deceased_name: deceased, pr_name: pr, is_probate: isProbate, raw: rawOwnerName };
    }

    // Pattern 6: Multiple PRs - "NAME (DEAD) & PR1, PR2 (PRs)"
    const multiplePRsMatch = trimmed.match(/^(.+?)\s*\((?:Dead|DEAD|Deceased)\)\s*(?:&|and|,)?\s*(.+?)\s*\(PRs?\)/i);
    if (multiplePRsMatch) {
        deceased = cleanName(multiplePRsMatch[1]);
        pr = cleanName(multiplePRsMatch[2]);
        isProbate = true;
        return { deceased_name: deceased, pr_name: pr, is_probate: isProbate, raw: rawOwnerName };
    }

    // Not a probate record - just a regular owner name
    // Could be APT type record with regular owner
    return {
        deceased_name: null,
        pr_name: cleanName(trimmed),
        is_probate: false,
        raw: rawOwnerName
    };
}

/**
 * Clean up a name: remove extra whitespace, leading/trailing punctuation
 */
function cleanName(name) {
    if (!name) return null;
    return name
        .replace(/^\s*[,&]\s*|\s*[,&]\s*$/g, '') // Remove leading/trailing & or ,
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/\(.*?\)/g, '') // Remove parenthetical notes
        .trim();
}

/**
 * Extract individual PR names from a potentially multi-PR field
 * @param {string} prField - The PR name(s) field
 * @returns {string[]} - Array of individual PR names
 */
function extractPRs(prField) {
    if (!prField) return [];
    
    // Common separators: comma, &, "and", slash
    const names = prField
        .split(/[,&/]|\s+and\s+/i)
        .map(n => cleanName(n))
        .filter(n => n && n.length > 2);
    
    return names;
}

/**
 * Process a full CSV and separate the Owner Name column
 * @param {Array} rows - Array of row objects from CSV
 * @param {string} ownerNameColumn - Name of the column containing combined names
 * @returns {Array} - Rows with added deceased_name_parsed and pr_name_parsed fields
 */
function processCSVRows(rows, ownerNameColumn = 'Owner Name') {
    return rows.map(row => {
        const rawOwnerName = row[ownerNameColumn];
        const parsed = parseOwnerName(rawOwnerName);
        
        return {
            ...row,
            'Deceased Name_PARSED': parsed.deceased_name || '',
            'PR Name_PARSED': parsed.pr_name || '',
            'Is Probate': parsed.is_probate ? 'Yes' : 'No'
        };
    });
}

module.exports = {
    parseOwnerName,
    cleanName,
    extractPRs,
    processCSVRows
};
