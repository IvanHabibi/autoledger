# AutoLedger

Household income and expense ledger you drive from Telegram. Type a sentence the
way you'd say it; it lands as a row in your Google Sheet.

```
you  ▸ beli beras 50rb di indomaret
bot  ▸ ✅ Pengeluaran dicatat
       Rp 50.000 · Belanja Harian
       beli beras — Indomaret
       13 Sep 2026 · Ivan
       [ ↩️ Batalkan ]  [ 🏷 Ganti kategori ]

you  ▸ gaji 15jt
bot  ▸ ✅ Pemasukan dicatat
       Rp 15.000.000 · Gaji

you  ▸ berapa pengeluaran makanan bulan ini?
bot  ▸ 📊 Pengeluaran bulan ini
       Total: Rp 1.240.000 · 18 transaksi
       • Makanan & Minuman — Rp 1.240.000 (100%)
```

Send a photo of a receipt and it reads the total, merchant and date for you.

## How it works

```
Telegram ──getUpdates (long poll)──▶ AutoLedger ──▶ Claude
                                          │         sentence → transaction
                                          │         question → query spec
                                          ▼
                                  Google Sheets API
```

Two things are worth knowing about the design:

- **Claude never does arithmetic.** For a question, Claude only works out *what*
  to measure — the date range, direction, category, keyword. The filtering and
  the sums happen in TypeScript over rows read from the sheet. A ledger that
  quietly mis-adds is worse than no ledger.
- **Long polling, so no server exposed to the internet.** The bot calls out to
  Telegram; nothing calls in. No public URL, no TLS certificate, no tunnel. It
  runs just as happily on a laptop or a Raspberry Pi as on a cloud host.

## Setup

Five things have to be done by hand. Nothing else needs configuring.

### 1. Create the Telegram bot

Message [@BotFather](https://t.me/BotFather), send `/newbot`, follow the prompts,
and copy the token it gives you.

### 2. Find your Telegram user IDs

Each person who will use the bot messages [@userinfobot](https://t.me/userinfobot)
and notes the numeric id it replies with.

**This list is the only thing keeping your ledger private.** A bot token is
effectively public — anyone who finds the bot's username can message it — so
AutoLedger ignores every account not on the list, silently and without spending
an API call.

### 3. Create a Google service account

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project.
2. Enable the **Google Sheets API** for it (*APIs & Services → Library*).
3. *IAM & Admin → Service Accounts → Create service account*. No roles are needed.
4. On the new account: *Keys → Add key → Create new key → JSON*. Download it.
5. Note the account's `client_email` — it looks like
   `autoledger@your-project.iam.gserviceaccount.com`.

### 4. Create the spreadsheet and share it

1. Create a new Google Sheet.
2. **Share** it with the `client_email` from step 3, as an **Editor**. Without
   this the bot gets a 403 and nothing works.
3. Copy the spreadsheet id out of the URL:
   `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

### 5. Configure and bootstrap

```bash
cp .env.example .env
$EDITOR .env          # fill in all five values
npm install
npm run bootstrap     # creates the tabs, headers and starting categories
npm start
```

`npm run bootstrap` is safe to re-run — it never overwrites categories or member
names you've edited.

Finally, open the **Config** tab and fill columns C and D with each member's
Telegram ID and the name you want in the ledger's `payer` column.

## Using it

Just write naturally. Indonesian, English, or a mix:

| You type | Recorded as |
|---|---|
| `beli beras 50rb di indomaret` | expense, Rp 50.000, merchant Indomaret |
| `bensin 100k` | expense, Rp 100.000 |
| `bayar listrik 350.000` | expense, Rp 350.000 |
| `setengah juta buat servis motor` | expense, Rp 500.000 |
| `kemarin makan siang 45rb` | expense, Rp 45.000, dated yesterday |
| `gaji 15jt` | income, Rp 15.000.000 |
| `dapat bonus 2,5jt` | income, Rp 2.500.000 |

A bare number under 1000 is read as thousands (`beras 50` → Rp 50.000) and the
reply is marked ⚠️ so you can correct it.

Every entry comes with **↩️ Batalkan** (undo) and **🏷 Ganti kategori**.

**Commands**

| Command | Does |
|---|---|
| `/summary` | This month so far: income, expense, net, biggest categories |
| `/summary lalu` | The whole previous month |
| `/categories` | The current category list |
| `/reload` | Re-read the Config tab immediately |
| `/help` | Usage |

## The sheet

**Transactions** — append-only, one row per entry:

| id | timestamp_utc | date | type | amount_idr | category | description | merchant | payer | source | raw_text |
|---|---|---|---|---|---|---|---|---|---|---|

Amounts are written as real numbers and dates as real dates, so your own
`SUMIF`s, pivot tables and charts work normally.

`raw_text` keeps your original message. If something is ever parsed wrongly you
can see exactly what you wrote, instead of guessing.

`id` is a [ULID](https://github.com/ulid/spec). It is how Undo finds the right
row again: row numbers go stale the moment the other person adds an entry, so
every edit re-resolves the row by id first.

**Config** — edit freely, no restart needed (cached for 5 minutes, or `/reload`):

| Column | Holds |
|---|---|
| A | Categories. The parser is told to use only these; anything else it returns is mapped to the catch-all (`Lain-lain`) rather than written through. |
| B | Free notes, ignored by the bot. |
| C, D | Telegram ID → member name, used for the `payer` column. |

You can edit rows in the sheet by hand. Anything with a broken amount, date or
type is skipped when reporting rather than counted wrongly.

## Cost

About **$0.005 per entry** with the default `claude-opus-5` — roughly **$1.70 a
month** at ten entries a day. Set `CLAUDE_MODEL=claude-haiku-4-5` in `.env` to
cut that by about 5× in exchange for slightly weaker parsing of unusual phrasing.

## Deployment

Long polling means there is nothing to expose. Any of these work:

```bash
npm start                                  # foreground
docker build -t autoledger . && \
  docker run -d --restart unless-stopped --env-file .env autoledger
```

For a cloud host (Fly.io, Railway, a small VPS), deploy the Docker image and set
the same environment variables. Run **one instance only** — two pollers on the
same bot token will fight over updates.

## Development

```bash
npm run dev         # watch mode
npm test            # unit tests: no network, no keys needed
npm run test:parse  # fixture eval against the real API (needs ANTHROPIC_API_KEY)
npm run typecheck
```

`npm test` covers the pure logic — date arithmetic, rupiah formatting, the
report aggregator, the sheet row coercions, the intent narrowing, callback-data
validation. `npm run test:parse` is the one that proves the parser genuinely
understands `50rb`, `2,5jt` and `kemarin`; it costs a few cents to run.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Google refused access to the spreadsheet` | The sheet isn't shared with the service account's `client_email` as Editor, or the Sheets API isn't enabled. |
| `No spreadsheet with that SPREADSHEET_ID` | Wrong id — take it from the sheet's own URL. |
| `has no tab named "Transactions"` | Run `npm run bootstrap`. |
| Bot ignores you completely | Your Telegram ID isn't in `ALLOWED_TELEGRAM_IDS`. The log line shows the id that was rejected. |
| `Anthropic rejected the API key` | Check `ANTHROPIC_API_KEY`. |
| Amounts land 1000× too small | The message used a bare number the parser read literally. Check the ⚠️ marker and use the category/undo buttons. |
