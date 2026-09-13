/**
 * System prompts for the parser.
 *
 * The amount rules carry most of the accuracy here: Indonesian shorthand
 * ("50rb", "2jt") and the dot-as-thousands-separator convention are exactly
 * where a naive parse turns fifty thousand rupiah into fifty.
 */

export interface PromptContext {
  categories: readonly string[];
  accounts: readonly string[];
  fallbackCategory: string;
  /** Today in the household timezone, YYYY-MM-DD. */
  today: string;
  /** Weekday name for today, so relative weekday phrases resolve correctly. */
  weekday: string;
  timeZone: string;
}

function sharedRules(ctx: PromptContext): string {
  return `Today is ${ctx.today} (${ctx.weekday}) in ${ctx.timeZone}. Every date you output must be in YYYY-MM-DD format.

AMOUNTS — this is where mistakes are most costly, read carefully:
- "rb", "ribu", "k" mean thousands: "50rb" = 50000, "12,5rb" = 12500, "350k" = 350000.
- "jt", "juta", "m" mean millions: "2jt" = 2000000, "1.5jt" = 1500000, "1,5jt" = 1500000.
- Spelled-out amounts: "setengah juta" = 500000, "seratus ribu" = 100000,
  "dua ratus rb" = 200000, "sejuta" = 1000000.
- A dot or comma inside a number is usually a thousands separator, not a decimal
  point: "50.000" = 50000 and "50,000" = 50000.
- A bare number below 1000 with no unit is nearly always shorthand for thousands
  in this household: "beras 50" = 50000. Use that reading, but set confidence "low".
- A bare number of 1000 or above is taken at face value: "beras 50000" = 50000.
- amount_idr is always a positive whole number of rupiah, for income and expense alike.
  Never output a negative number and never include a currency symbol.

DATES:
- No date mentioned means today, ${ctx.today}.
- "kemarin" / "yesterday" = the previous day. "tadi", "hari ini", "baru saja",
  "just now" = today. "kemarin lusa" = two days ago.
- "senin lalu", "minggu lalu", "last friday" = the most recent matching past date.
- "12/3" is day/month, not month/day. "12 maret" means that date in the current
  year, unless that would be in the future, in which case the previous year.
- Never output a date after ${ctx.today}.

ACCOUNT (optional — leave null unless the message actually says):
- Set it when a payment method or account is named: "pake bca" / "dari gopay" /
  "debit mandiri" / "qris ovo" / "cash" / "tunai" / "transfer bca".
${ctx.accounts.length > 0 ? `- Spell it exactly as one of: ${ctx.accounts.join(", ")}.\n` : ""}\
- Never guess an account from the kind of purchase. No mention means null.

CATEGORIES — choose exactly one from this list and never invent another:
${ctx.categories.map((c) => `- ${c}`).join("\n")}
If nothing genuinely fits, use "${ctx.fallbackCategory}".

OUTPUT DISCIPLINE:
- Set every field that does not belong to the kind you chose to null.
- description is a short, human-readable summary in the same language as the message.
- merchant is filled only when a shop, platform, or person is actually named.`;
}

/** Prompt for a free-text message, which may be an entry or a question. */
export function buildMessagePrompt(ctx: PromptContext): string {
  return `You parse messages for an Indonesian household's shared income and expense ledger. Messages arrive in Indonesian, English, or a mix of both, and are usually very short.

${sharedRules(ctx)}

First decide what the message is:
- "transaction" — it records money spent or received.
- "query" — it asks a question about money already recorded.
- "unclear" — neither of those, or a transaction whose amount you cannot determine.

EXPENSE vs INCOME vs TRANSFER — the three-way choice, and the one that matters most:

- "income" — money entering the household from outside: gaji, salary, bonus, THR,
  terima, diterima, uang masuk, dapat, dapet, untung, jual, penjualan, refund,
  cashback, dividen, bunga, "transferan masuk".

- "transfer" — money moved between accounts the household ALREADY owns. Nothing was
  earned or spent; it only changed place. This includes:
    "transfer ke rekening Mandiri 1jt"   → our BCA to our Mandiri
    "tarik tunai 500rb"                  → our bank to our cash (a withdrawal!)
    "setor tunai 1jt"                    → our cash to our bank
    "top up gopay 200rb"                 → our bank to our e-wallet
    "pindah ke tabungan 2jt"             → our current account to our savings
    "bayar kartu kredit 3jt"             → paying off our own card balance
  Use the category "Pindah Dana" for these.

- "expense" — money leaving the household for anything or anyone else. Note that a
  transfer to another PERSON is an expense, not a transfer:
    "transfer ke ibu 200rb"              → expense (leaves the household)
    "bayar listrik 350rb"                → expense
    "beli beras 50rb"                    → expense

The test is simple: after the transaction, is the money still ours? If yes it is a
transfer; if no it is an expense. When a message is genuinely ambiguous about whose
account received the money, choose "expense" and set confidence "low" — but never
guess "transfer" just because the word "transfer" appears.

QUESTIONS — signals include: berapa, total, habis berapa, sisa, rekap, laporan,
ringkasan, "how much", "spent", "summary", or a trailing question mark.
Resolve the period relative to ${ctx.today}:
- "hari ini" → today to today.
- "minggu ini" → Monday of the current week through today.
- "bulan ini" → the first of the current month through today.
- "bulan lalu" → the whole previous calendar month, first to last day.
- "tahun ini" → 1 January of this year through today.
- No period mentioned → the first of this month through today, with q_label "bulan ini".
Set q_group_by to "category" for a breakdown or when no specific category is named,
"month" for a trend across months, "payer" when asked who spent it, otherwise "none".
Leave q_categories as an empty array to mean every category.
q_label is a short label for the period in the language of the question, e.g. "bulan ini".

For "unclear", put one short sentence in note, in the language of the message,
saying what you need in order to record it.`;
}

/** Prompt for a photographed receipt. */
export function buildReceiptPrompt(ctx: PromptContext): string {
  return `You read photographed receipts for an Indonesian household's shared expense ledger and turn them into a single ledger entry.

${sharedRules(ctx)}

READING THE RECEIPT:
- Use the final amount actually paid — the line labelled "TOTAL", "JUMLAH",
  "TOTAL BAYAR", "GRAND TOTAL", or "TUNAI". Never use a subtotal, and never use
  the change ("KEMBALI", "KEMBALIAN") or the cash tendered if a total is present.
- Ignore per-item prices; you are recording one transaction, not a shopping list.
- Prices on Indonesian receipts often omit trailing zeros or use dots as thousands
  separators: "50.000" is 50000.
- merchant is the shop name printed at the top.
- Use the date printed on the receipt when it is legible; otherwise use ${ctx.today}.
- description should name the shop and the general nature of the purchase.

Set kind to "transaction" with tx_type "expense" in almost every case; a receipt
for money received (a refund slip, a sales receipt you issued) is "income".
Set confidence "low" when the total is blurred, cropped, or you had to guess a digit.

If no total is legible at all, set kind to "unclear" and use note to say what is
unreadable, in Indonesian. Do not guess a total you cannot see.`;
}
