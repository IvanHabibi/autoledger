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

`npm run bootstrap` only talks to Google, so it needs just `SPREADSHEET_ID` and
the credentials — you can prepare the sheet before the Telegram bot exists.

`npm run bootstrap` is safe to re-run — it never overwrites categories or member
names you've edited.

Finally, open the **Config** tab, fill columns C and D with each member's Telegram
ID and the name you want in the ledger's `payer` column, and adjust column E to the
accounts you actually use (or clear it — the account tag is optional).

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

### Moving money is not spending

Money that only moves between accounts you already own is recorded as a
`transfer` and kept out of both the income and expense totals:

| You type | Recorded as |
|---|---|
| `transfer ke rekening mandiri 1jt` | transfer — your BCA to your Mandiri |
| `tarik tunai 500rb` | transfer — your bank to your cash |
| `top up gopay 200rb` | transfer — your bank to your e-wallet |
| `transfer ke ibu 200rb` | **expense** — it left the household |

The test is whether the money is still yours afterwards. Without this, an ATM
withdrawal would show up as half a million rupiah of spending.

### Tagging the account (optional)

Mention a payment method and it gets tagged: `bayar listrik 350rb pake bca` →
account `BCA`. Say nothing and it stays blank; nothing depends on it. It exists so
you can later ask "berapa yang lewat GoPay bulan ini?" — it is a label for slicing,
never a balance.

Every entry comes with **↩️ Batalkan** (undo) and **🏷 Ganti kategori**.

**Commands**

| Command | Does |
|---|---|
| `/summary` | This month so far: income, expense, net, biggest categories, and transfers listed separately |
| `/summary lalu` | The whole previous month |
| `/categories` | The current category list |
| `/reload` | Re-read the Config tab immediately |
| `/help` | Usage |

## The sheet

**Transactions** — append-only, one row per entry:

| id | timestamp_utc | date | type | amount_idr | category | description | merchant | account | payer | source | raw_text |
|---|---|---|---|---|---|---|---|---|---|---|---|

`type` is `expense`, `income`, or `transfer`. `account` is an optional tag (see below).

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
| E | Account / payment-method names, used to normalise what the parser returns. Optional — leave it empty and the tag simply goes unused. |

You can edit rows in the sheet by hand. Anything with a broken amount, date or
type is skipped when reporting rather than counted wrongly.

## Why there are no balances

Deliberately, the ledger tracks **flows** (what came in, what went out) and never
**balances** (how much is in each account). This is a design decision, not a gap:

- A balance is an identity — `opening + Σincome − Σexpense` — so it is only true if
  every single movement is captured. A ledger you type into by choice cannot promise
  that: bank fees, interest, autodebits, a cash purchase you forgot.
- The two failure modes are not comparable. Miss an entry in a flow ledger and one
  month's total is slightly low; next month is unaffected. Miss one in a balance
  tracker and every balance after it is wrong, permanently, with nothing to correct
  it. A balance you trust but that is wrong is worse than no balance.
- Your bank and e-wallet apps already show exact balances, instantly and for free.

If you ever want a net-worth view, the pattern to use is a periodic **snapshot** —
record the real balance from the bank app once a month as an observation — never a
running total. Each snapshot corrects any drift by construction. That is not built
yet; the `account` tag above is intentionally just a label.

## Cost

Measured against the real prompt, not estimated:

| Model | Per entry | Per month @ 300 entries |
|---|---|---|
| `claude-opus-5` (default) | $0.0286 | **$8.58** |
| `claude-sonnet-5` | $0.0114 | $3.43 |
| `claude-haiku-4-5` | $0.0046 | $1.37 |

Set `CLAUDE_MODEL` in `.env` to switch. Measured against the 33-case eval:

| Model | Eval | Wall time | Verdict |
|---|---|---|---|
| `claude-opus-5` | 33/33 | ~96s | The repo default: highest accuracy. |
| `claude-sonnet-5` | 33/33 | 90s | **Recommended.** Same accuracy, no slower, 60% cheaper. |
| `claude-haiku-4-5` | 32/33 | 125s | Cheapest, but missed `thr 5jt` and is slower than Sonnet. |

Haiku's one miss returned `unclear` rather than a wrong row, so its failure mode
is safe — it just asks you to rephrase. Worth knowing that "THR" (the Indonesian
holiday bonus) is a large annual amount to have to retype.

Before trusting any cheaper model, run `npm run test:parse` against it; that eval
exists precisely to tell you whether the Indonesian shorthand and the
transfer-versus-expense distinction still hold. `deploy.sh` passes
`CLAUDE_MODEL` through, so export it before deploying to keep the same choice.

**The bill is input, not output.** One short sentence costs ~4,970 input tokens
against ~150 output: roughly 2,340 for the system prompt and 1,940 for the
structured-output schema, which is sent on every request. The category list alone
is 195 tokens and appears three times (once in the prompt, twice in the schema).
So the levers that matter are the ones that shrink or reuse the prefix.

**Prompt caching is not a free win here.** Marking the system prompt with
`cache_control` drops a cache *hit* to $0.0061 per entry — a 79% saving with no
change of model. But the default cache lifetime is five minutes, and a *miss*
costs $0.0348, which is 22% **more** than not caching at all. It therefore pays
only if entries arrive in bursts; logging one purchase every few hours would make
it more expensive. Measure your own pattern before enabling it.

**A note on `effort`.** The code sends `output_config.effort: "low"`, which
several models reject with a 400 — Haiku 4.5 and Sonnet 4.5 among them. It is
omitted automatically for those (`supportsEffort` in `src/parse/claude.ts`).

## Deployment

There are two modes, and they are mutually exclusive — Telegram either pushes
updates to you or you pull them.

### Long polling — a machine that stays on

```bash
npm start                                  # foreground
docker build -t autoledger . && \
  docker run -d --restart unless-stopped --env-file .env autoledger
```

Nothing to expose: no public URL, no certificate. Run **one instance only** —
two pollers on the same bot token fight over updates.

### Webhook on Cloud Functions — free tier, nothing always-on

A Cloud Function is request-triggered and scales to zero, so it cannot hold a
polling loop open. `src/webhook.ts` is the entrypoint for this mode; the bot and
all its handlers are identical, only the delivery differs.

```bash
# 1. Store the two real secrets in Secret Manager (not in the repo, not in
#    --set-env-vars, which would leave them readable in the function config).
printf '%s' "$ANTHROPIC_API_KEY" | gcloud secrets create anthropic-api-key --data-file=-
printf '%s' "$TELEGRAM_BOT_TOKEN" | gcloud secrets create telegram-bot-token --data-file=-
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create telegram-webhook-secret --data-file=-

# 2. Deploy, and register the webhook with Telegram.
export SPREADSHEET_ID=... ALLOWED_TELEGRAM_IDS=...
./deploy.sh
```

`npm run webhook:info` shows what Telegram currently has; `npm run webhook:delete`
removes it and returns you to polling.

**No Google key is stored.** The service account is attached to the function, so
Application Default Credentials resolve from the metadata server and
`GOOGLE_SERVICE_ACCOUNT_JSON` is left unset — there is no private key on disk, in
the repo, or in Secret Manager to leak or rotate. `src/sheets/client.ts` picks
this path automatically when the variable is absent.

**The webhook secret is not optional.** The function must be deployed
`--allow-unauthenticated`, because Telegram cannot present a Google identity
token. That makes the shared secret the only thing separating a public URL from
fabricated ledger entries, so the function refuses to start without it and
`test/unit/webhook-secret.test.ts` asserts the gate rejects requests lacking it.

**Cost.** A household bot sends a few hundred messages a month against a free
tier of 2M invocations and 200k vCPU-seconds, so this is free in practice. Note
that Google still requires a billing account on file to deploy a 2nd-gen
function, and `deploy.sh` caps `--max-instances 3` so a runaway cannot become a
bill.

**Two honest trade-offs:**

- *Cold starts.* The first message after an idle period waits ~1–3s extra while
  the instance boots. Subsequent messages are normal speed.
- *Possible duplicate entries.* Telegram redelivers an update if the webhook is
  too slow to answer. The handler returns 200 rather than an error on timeout,
  which avoids the common case, but exactly-once delivery would need shared
  state across instances — more machinery than this warrants. If a duplicate
  ever appears, the entry has an Undo button.

### Where secrets belong

| | Verdict |
|---|---|
| Google Secret Manager | **Yes** — what `deploy.sh` uses. Free at this scale. |
| GitHub repository, even private | **No.** A private repo is not a secret store: it stays in git history forever, is visible to every collaborator, and travels with clones and forks. Making a repo private does not un-leak something already pushed. |
| GitHub Actions secrets | Only for injecting at deploy time if Actions does the deploying. Not somewhere the running app reads from. |
| `.env` on your own machine | Fine for local development. Gitignored here. |

## Development

```bash
npm run dev         # watch mode
npm test            # unit tests: no network, no keys needed
npm run test:parse  # fixture eval against the real API (needs ANTHROPIC_API_KEY)
npm run typecheck
```

`npm test` covers the pure logic — date arithmetic, rupiah formatting, the
report aggregator, the sheet row coercions, the intent narrowing, callback-data
validation. It needs no keys and touches no network.

`npm run test:parse` is the one that proves the parser genuinely understands
`50rb`, `2,5jt`, `kemarin`, and the transfer-versus-expense distinction. It costs
a few cents to run and needs only **`ANTHROPIC_API_KEY`** — no Telegram token and
no Google credentials, since it exercises the parser alone. Put it in `.env`
(the suite loads dotenv itself) or export it.

If the key is missing, `npm run test:parse` **fails** rather than skipping
quietly. A skipped suite still exits 0, and since this is the only check that
tests the parser against reality, a silent green run would be worse than a red
one.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Google refused access to the spreadsheet` | The sheet isn't shared with the service account's `client_email` as Editor, or the Sheets API isn't enabled. |
| `No spreadsheet with that SPREADSHEET_ID` | Wrong id — take it from the sheet's own URL. |
| `has no tab named "Transactions"` | Run `npm run bootstrap`. |
| Bot ignores you completely | Your Telegram ID isn't in `ALLOWED_TELEGRAM_IDS`. The log line shows the id that was rejected. |
| `Anthropic rejected the API key` | Check `ANTHROPIC_API_KEY`. |
| Amounts land 1000× too small | The message used a bare number the parser read literally. Check the ⚠️ marker and use the category/undo buttons. |
| Spending looks too high | Check for money you only moved between your own accounts. It should be recorded as a `transfer`; if it landed as an `expense`, fix the `type` cell and phrase it more explicitly next time (`tarik tunai`, `pindah ke tabungan`). |
