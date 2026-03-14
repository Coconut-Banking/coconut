# Plaid Transaction Metadata — Full Field Reference

This document lists all metadata fields Plaid returns for a transaction via the `/transactions/sync` API. Coconut maps a subset into its `transactions` table.

---

## Plaid Raw Transaction Object (from `/transactions/sync`)

| Field | Type | Description |
|-------|------|-------------|
| **transaction_id** | string | Unique identifier for the transaction |
| **pending_transaction_id** | string \| null | ID of matching pending transaction (when a pending posts) |
| **account_id** | string | Plaid account ID |
| **amount** | number | Amount (Plaid: positive = debit/expense, negative = credit) |
| **iso_currency_code** | string | e.g. "USD" |
| **unofficial_currency_code** | string \| null | For non-ISO currencies |
| **date** | string | YYYY-MM-DD — posted date (or pending date if pending) |
| **authorized_date** | string \| null | YYYY-MM-DD — when transaction was authorized |
| **name** | string | Raw bank description (e.g. "PROGENY COFFEE", "UBER *TRIP") |
| **merchant_name** | string \| null | Standardized merchant name (when available) |
| **pending** | boolean | true if transaction is pending |
| **category** | string[] | Legacy category array (e.g. ["Food and Drink", "Restaurants"]) |
| **category_id** | string | Plaid category ID |
| **personal_finance_category** | object | **Primary categorization** |
| ↳ **primary** | string | e.g. "FOOD_AND_DRINK", "TRANSPORTATION" |
| ↳ **detailed** | string | e.g. "RESTAURANTS", "RIDESHARE" |
| ↳ **confidence_level** | string | "VERY_HIGH", "HIGH", "MEDIUM", "LOW" |
| **payment_channel** | string | "in store", "online", "other" |
| **payment_meta** | object | Payment details |
| ↳ **payment_processor** | string \| null | e.g. "stripe", "square" |
| ↳ **payer** | string \| null | |
| ↳ **payee** | string \| null | |
| ↳ **payment_method** | string \| null | |
| ↳ **reference_number** | string \| null | |
| ↳ **reason** | string \| null | |
| **location** | object | Geographic (when available) |
| ↳ **address** | string \| null | |
| ↳ **city** | string \| null | |
| ↳ **region** | string \| null | |
| ↳ **postal_code** | string \| null | |
| ↳ **country** | string \| null | |
| **counterparties** | array | Payees/payers (e.g. merchant info) |
| ↳ **name** | string | |
| ↳ **type** | string | "merchant", "financial_institution", etc. |
| **merchant_entity_id** | string \| null | Plaid merchant ID |
| **check_number** | string \| null | For check transactions |
| **datetime** | string \| null | ISO 8601 timestamp |
| **transaction_code** | string \| null | Bank-specific code |
| **personal_finance_category_icon** | string | Emoji or icon URL |
| **sic_code** | string \| null | Industry classification |
| **website** | string \| null | Merchant website |

---

## What Coconut Stores (Supabase `transactions`)

| Column | Source |
|--------|--------|
| `plaid_transaction_id` | transaction_id |
| `account_id` | account_id (mapped to our UUID) |
| `date` | date |
| `amount` | amount (flipped: negative = expense) |
| `iso_currency_code` | iso_currency_code |
| `raw_name` | name |
| `merchant_name` | merchant_name ?? name |
| `normalized_merchant` | lowercased, punctuation-stripped merchant |
| `primary_category` | personal_finance_category.primary ?? category[0] ?? "OTHER" |
| `detailed_category` | personal_finance_category.detailed ?? category[1] |
| `is_pending` | pending |
| `embedding` | Generated from merchant + category + amount + date (OpenAI) |

---

## Not Currently Stored (available from Plaid)

- `authorized_date`
- `payment_channel`
- `payment_meta` (processor, payer, payee)
- `location` (address, city, region, country)
- `counterparties`
- `merchant_entity_id`
- `check_number`
- `datetime` (full timestamp)
- `transaction_code`
- `sic_code`
- `website`
- `confidence_level` (categorization confidence)

---

## Reference

- [Plaid Transactions API](https://plaid.com/docs/api/products/transactions/)
- [Transaction data structure](https://plaid.com/docs/transactions/transactions-data)
- Coconut sync: `lib/transaction-sync.ts`
