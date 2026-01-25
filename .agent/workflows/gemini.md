---
description: Phone Number Finder Project Context for Gemini Chat
---

# Project Overview

The **Phone Number Finder** project is a Node.js based data processing pipeline that extracts personal representative (PR) phone numbers from probate records. It reads CSV input files, performs parallel searches on Radaris, Google (via BrightData SERP API), and WhitePages, merges results, and outputs a processed CSV.

# Key Files & Directories

- `process_universal_v12.js` – Main V12 processing script (high concurrency, deep fetches).
- `process_universal_v11.js` – Legacy V11 script used for audits.
- `v11_audit.js` – Audits V11 performance against benchmark.
- `whitepages_search_optimized.js` – Handles WhitePages discovery (now uses BrightData).
- `rate_limiter.js`, `merge_remediation.js`, `process_enhanced.js` – Supporting utilities.
- `Fresh_Test_Run.csv` – Sample input dataset.
- `Final_Benchmark_Audit_V12.csv` – Latest benchmark output.

# Current Configuration (as of 2026‑01‑24)

```javascript
const CONFIG = {
  INPUT_FILE: "./test_run_results_v2 - test_run_results_v2 (1).csv",
  OUTPUT_FILE: "./Final_Benchmark_Audit_V12.csv",
  CONCURRENT_ROWS: 25, // Ultimate Mach speed
  MAX_DEEP_FETCHES: 8,
  CONFIDENCE_THRESHOLD_PERFECT: 99,
  CONFIDENCE_THRESHOLD_STRONG: 75,
  CONFIDENCE_THRESHOLD_MEDIUM: 40,
  DELAY_BETWEEN_CHUNKS_MS: 0,
};
```

- Concurrency is set to **25 rows** processed in parallel.
- Deep fetches are increased to **8** profiles per lead.
- No artificial delay between chunks.

# Recent Changes

1. **Increased concurrency** from 10 → 25 to speed up final benchmark run.
2. **Switched WhitePages discovery** to BrightData SERP API for reliability.
3. **Added empty‑row skipping** in `process_universal_v12.js`.
4. **Adjusted audit script** (`v11_audit.js`) to handle both `PR 1` and generic `All Phones` columns.
5. Completed the final benchmark run (`Final_Benchmark_Audit_V12.csv`) with **100 % retention**.

# Known Issues / Open Items

- Some leads still report mismatched or missing phone numbers due to outdated source data.
- WhitePages authentication still falls back to cookie injection; a paid account would improve reliability.
- The `process_universal_v12.js` run can be long for very large CSVs; consider further chunking or a distributed approach.

# Quality Assurance & Scoring Methodology (90%+ Target)

## The Production Reality Problem

In production, the system **does NOT know** if phone numbers are correct or incorrect. Therefore, the scoring logic must be **unbiased** and cannot rely on ground truth labels. The goal is to **calibrate confidence thresholds** so that high-confidence predictions correlate strongly with correctness.

## Unbiased Confidence Scoring Strategy

### 1. **Confidence as the Production Metric**

The `matcher.js` AI matcher outputs a `confidence` score (0-100) based on:

- Direct family link (95+)
- Shared unusual surname (85+)
- Historical location match (70+)
- Exact name + local geography (75-85)

This score is computed **before** knowing correctness, making it the valid production metric.

### 2. **Threshold Calibration for 90%+ Accuracy**

| Confidence Range       | Expected Accuracy | Action                             |
| ---------------------- | ----------------- | ---------------------------------- |
| 85-100 (VERIFIED/HIGH) | 95%+              | Accept as primary match            |
| 70-84 (PROBABLE)       | 85%+              | Accept with secondary verification |
| 40-69 (PLAUSIBLE)      | 60-85%            | Flag for review, return anyway     |
| <40 (LOW)              | <60%              | Return but mark as low-confidence  |

### 3. **Quality Signals (No Bias)**

The system uses these **pre-verification signals** to estimate quality:

- **Match Type**: `VERIFIED` > `HIGHLY_PROBABLE` > `PLAUSIBLE_GUESS` > `NONE`
- **Source Tier**: Tier 1 Speed (direct match) > Tier 2 Deep > Tier 3 (Greedy/Pivot)
- **Phone Count**: More phones = higher reliability
- **Family Link Detected**: Explicit relative connection in data

### 4. **Avoiding Bias in Production**

**DO NOT**:

- Penalize or boost based on historical correct/incorrect rates per source
- Train thresholds on labeled data that won't exist in production
- Assume geographic location = correctness

**DO**:

- Trust the AI matcher's reasoning when family links are detected
- Use confidence thresholds calibrated from benchmark runs
- Return all results with confidence scores, letting downstream processes filter

## Audit Metrics (Benchmark Only)

The `v11_audit.js` uses labeled benchmark data to validate threshold calibration:

- **Retention Rate**: % of confirmed-correct leads that retain their correct phone (target: 100%)
- **Correction Rate**: % of confirmed-incorrect leads that find a new (different) phone (target: 50%+)

These metrics are for **tuning only** — the production system operates without labels.

## Production Output Recommendations

Each result should include:

```javascript
{
  phone: "2061234567",
  confidence: 87,
  matchType: "HIGHLY_PROBABLE",
  reasoning: "Shares unusual surname 'Stordahl' with deceased, lives in WA",
  source: "Radaris (Tier 1 Speed)"
}
```

Downstream systems can filter by `confidence >= 85` for 90%+ expected accuracy.

# Suggested Next Steps

- Review mismatched leads and decide if manual verification is required.
- Explore adding a caching layer for Radaris profile fetches to reduce duplicate network calls.
- If the dataset grows, consider moving the pipeline to a cloud function or container with auto‑scaling.
- Document the full end‑to‑end workflow in a separate `.agent/workflows` markdown file for future collaborators.
- **NEW**: Run a calibration audit to validate that `confidence >= 85` achieves 90%+ accuracy on benchmark data.

---

_Generated for use in future Gemini‑powered chats to quickly re‑establish project context._
