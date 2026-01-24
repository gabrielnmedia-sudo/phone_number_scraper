const { parseOwnerName, extractPRs } = require('./name_parser');

const testCases = [
    "THOMAS R MARTIN (Dead) Diane K Martin (PR)",
    "ROBERT A GRUBE & LINDA F GRUBE (BOTH DEAD) & MICHELLE M JONES (PR)",
    "NAME (DEAD) & PR1, PR2 (PRs)",
    "STACY LEE HANDLER & SHARRON PATRICIA LASWELL (PRs)",
    "ESTATE OF JOHN DOE, JANE DOE (PR)"
];

console.log("=== Name Parser Test ===");
testCases.forEach(name => {
    const parsed = parseOwnerName(name);
    const prs = extractPRs(parsed.pr_name || name);
    console.log(`Raw: ${name}`);
    console.log(`Deceased: ${parsed.deceased_name}`);
    console.log(`PRs: ${JSON.stringify(prs)}`);
    console.log('---');
});
