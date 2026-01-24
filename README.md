# Phone Number Scraper

This tool scrapes `cyberbackgroundchecks.com` for Personal Representative (PR) phone numbers based on a Google Sheet of probate data. It uses:

- **Bright Data** for proxies.
- **Gemini AI** for intelligent profile matching.
- **Google Sheets API** for reading/writing data.

## Setup

1.  **Dependencies**:

    ```bash
    npm install
    ```

2.  **Environment Variables (`.env`)**:
    The `.env` file is pre-filled with your Proxy and Gemini keys.
    **YOU MUST ADD GOOGLE SHEETS CREDENTIALS**:

    ```env
    # ... existing keys ...
    SPREADSHEET_ID=your_google_sheet_id_from_url
    GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
    GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
    ```

    _Note: Ensure the Service Account has "Editor" access to your Google Sheet._

3.  **Google Sheet Columns**:
    The script expects the following column headers (case-sensitive) in your sheet. You can change these mapping in `index.js`:
    - `Deceased Name`
    - `Deceased Address` (Must contain "City, State", e.g., "123 Main St, Seattle, WA")
    - `PR Name`

    The script will write to:
    - `PR Phone Number`
    - `Match Confidence`
    - `Match Reasoning`
      _(Make sure these columns exist or the script will create/append to them depending on library behavior, best to create header row first)_

## Usage

Run the scraper:

```bash
node index.js
```

## How it Works

1.  Reads a row from the Google Sheet.
2.  Searches CyberBackgroundChecks for the PR's Name + Deceased's City/State.
3.  Sends the list of found candidates to Gemini AI.
4.  Gemini picks the best match based on:
    - Relatives matching the Deceased Name.
    - Location history matching the Deceased's area.
5.  If a high-confidence match is found, fetches the details page to get phone numbers.
6.  Saves the phone numbers back to the sheet.

## Troubleshooting

- **No matches found**: The PR might live in a different city than the deceased. The current logic uses the deceased's city for the initial search.
- **Proxy Errors**: Ensure your Bright Data bandwidth is active.
- **Gemini Errors**: Check API quota or model availability (currently using `gemini-2.5-flash`).
