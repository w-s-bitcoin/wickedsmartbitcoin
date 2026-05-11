# UoA Webapp Data

This folder holds historical conversion-rate datasets for Unit of Account dashboard expansion.

Current dashboard implementation reads from `assets/daily_price.csv` (Bitcoin/USD prices) as primary reference.

## Datasets

### `daily_price.csv`
Bitcoin historical daily prices in USD:
- Columns: `date`, `price`, `block_height`
- ~2000 rows covering relevant Bitcoin history
- Source: Historical BTC/USD price data

### `daily_fx_rates.csv`
Multi-currency FX rates in wide format:
- First column: `date` (continuous calendar days 1999-01-04 to 2026-05-11)
- Additional columns: one per currency pair vs USD
  - `eurusd`: EUR/USD rate (Euro / US Dollar)
  - `gbpusd`: GBP/USD rate (British Pound / US Dollar)
  - `jpyusd`: JPY/USD rate (Japanese Yen / US Dollar)
  - `chfusd`: CHF/USD rate (Swiss Franc / US Dollar)
  - `cadusd`: CAD/USD rate (Canadian Dollar / US Dollar)
  - `audusd`: AUD/USD rate (Australian Dollar / US Dollar)
  - `nzdusd`: NZD/USD rate (New Zealand Dollar / US Dollar)
  - `cnyusd`: CNY/USD rate (Chinese Yuan / US Dollar)
  - `inrusd`: INR/USD rate (Indian Rupee / US Dollar)
  - `iskusd`: ISK/USD rate (Icelandic Krona / US Dollar)
  - `sekusd`: SEK/USD rate (Swedish Krona / US Dollar)
  - `nokusd`: NOK/USD rate (Norwegian Krone / US Dollar)
  - `dkkusd`: DKK/USD rate (Danish Krone / US Dollar)
  - `plnusd`: PLN/USD rate (Polish Zloty / US Dollar)
  - `hufusd`: HUF/USD rate (Hungarian Forint / US Dollar)
  - `czkusd`: CZK/USD rate (Czech Koruna / US Dollar)
  - `ronusd`: RON/USD rate (Romanian Leu / US Dollar)
  - `tryusd`: TRY/USD rate (Turkish Lira / US Dollar)
  - `ilsusd`: ILS/USD rate (Israeli New Shekel / US Dollar)
  - `mxnusd`: MXN/USD rate (Mexican Peso / US Dollar)
  - `sgdusd`: SGD/USD rate (Singapore Dollar / US Dollar)
  - `zarusd`: ZAR/USD rate (South African Rand / US Dollar)
  - `hkdusd`: HKD/USD rate (Hong Kong Dollar / US Dollar)
  - `krwusd`: KRW/USD rate (South Korean Won / US Dollar)
  - `thbusd`: THB/USD rate (Thai Baht / US Dollar)
  - `phpusd`: PHP/USD rate (Philippine Peso / US Dollar)
  - `brlusd`: BRL/USD rate (Brazilian Real / US Dollar)
  - `idrusd`: IDR/USD rate (Indonesian Rupiah / US Dollar)
  - `myrusd`: MYR/USD rate (Malaysian Ringgit / US Dollar)

**Details:**
- 9,990 rows (continuous calendar days with forward-filled missing weekends/holidays)
- Trading days sourced from Frankfurter API (ECB reference rates)
- Missing dates forward-filled for continuous daily charting

### `uoa_pairs.json`
Metadata for supported currencies:

**Structure:**
- `source`: Data source attribution (Frankfurter API, ECB reference rates)
- `currencies`: Dictionary of currency definitions
  - Fields per currency: `name`, `code`, `symbol`, `symbol_position` (left|right), `minor_unit` (decimal places)
  - Example: `EUR` has symbol `€`, positioned left, 2 minor units
  - Example: `JPY` has symbol `¥`, positioned left, 0 minor units
- `pairs`: List of supported FX pairs with column mappings

**Supported Currencies (31 total):**
1. BTC - Bitcoin
2. USD - US Dollar ($)
3. EUR - Euro (€)
4. GBP - British Pound (£)
5. JPY - Japanese Yen (¥)
6. CHF - Swiss Franc
7. CAD - Canadian Dollar (C$)
8. AUD - Australian Dollar (A$)
9. NZD - New Zealand Dollar (NZ$)
10. CNY - Chinese Yuan (¥)
11. INR - Indian Rupee (₹)
12. SEK - Swedish Krona
13. NOK - Norwegian Krone
14. DKK - Danish Krone
15. PLN - Polish Zloty
16. HUF - Hungarian Forint
17. CZK - Czech Koruna
18. RON - Romanian Leu
19. ISK - Icelandic Krona
20. TRY - Turkish Lira
21. ILS - Israeli New Shekel
22. MXN - Mexican Peso
23. SGD - Singapore Dollar
24. ZAR - South African Rand
25. HKD - Hong Kong Dollar
26. KRW - South Korean Won
27. THB - Thai Baht
28. PHP - Philippine Peso
29. BRL - Brazilian Real
30. IDR - Indonesian Rupiah
31. MYR - Malaysian Ringgit

## Data Pipeline

**Currency coverage behavior:**

1. `uoa_webapp_data_update.py` automatically discovers all currently supported Frankfurter currencies.
2. Existing columns are refreshed incrementally from the latest saved date to today.
3. Newly discovered currency columns are backfilled from full history and then forward-filled for non-trading days.
4. `uoa_pairs.json` currencies/pairs are regenerated from discovered source coverage (plus BTC/USD metadata).

**See:** `uoa_webapp_data_update.py` for automated batch update script

## Usage in Dashboard

The dashboard (`dashboard_app.js`) dynamically:
- Loads available currencies from `uoa_pairs.json`
- Populates dropdown menus with currency options
- Fetches FX rates from `daily_fx_rates.csv` as needed
- Converts any BTC pair via USD using rates from matching columns
- Formats values with correct symbols, placement, and decimal precision per metadata

No hardcoding required; new currencies are automatically supported once CSV and JSON are updated.

