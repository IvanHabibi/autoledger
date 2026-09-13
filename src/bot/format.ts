import type { AggregateResult, LedgerRow, QuerySpec } from "../types.js";
import type { Summary } from "../report/aggregate.js";
import { formatIdr } from "../util/money.js";

/** Indonesian month abbreviations, fixed rather than from Intl so that output
 *  is identical on every machine and testable. */
const MONTHS_ID = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

/** "2026-09-13" → "13 Sep 2026". */
export function formatDateId(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  const monthIndex = Number(m) - 1;
  const month = MONTHS_ID[monthIndex] ?? m;
  return `${Number(d)} ${month} ${y}`;
}

/** Messages go out as HTML, so anything the user typed has to be escaped. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Same period on both ends reads better as a single date. */
export function formatRange(startDate: string, endDate: string): string {
  return startDate === endDate
    ? formatDateId(startDate)
    : `${formatDateId(startDate)} – ${formatDateId(endDate)}`;
}

export function renderEntry(row: LedgerRow): string {
  const heading = row.type === "income" ? "✅ Pemasukan dicatat" : "✅ Pengeluaran dicatat";
  const lines = [
    `<b>${heading}</b>`,
    `<b>${escapeHtml(formatIdr(row.amountIdr))}</b> · ${escapeHtml(row.category)}`,
  ];

  const detail = row.merchant
    ? `${escapeHtml(row.description)} — ${escapeHtml(row.merchant)}`
    : escapeHtml(row.description);
  if (detail.trim() !== "") lines.push(detail);

  lines.push(
    `<i>${formatDateId(row.date)} · ${escapeHtml(row.payer)}</i>`,
  );

  if (row.confidence === "low") {
    lines.push("", "⚠️ <i>Kurang yakin dengan nominal atau tanggalnya — cek dulu ya.</i>");
  }
  return lines.join("\n");
}

export function renderUndone(row: LedgerRow | null): string {
  if (!row) return "🗑 <b>Dibatalkan.</b> Baris sudah dihapus dari sheet.";
  return [
    "🗑 <b>Dibatalkan</b>",
    `<s>${escapeHtml(formatIdr(row.amountIdr))} · ${escapeHtml(row.category)}</s>`,
    "<i>Baris sudah dihapus dari sheet.</i>",
  ].join("\n");
}

export function renderReport(query: QuerySpec, result: AggregateResult): string {
  const what =
    query.scope === "income" ? "Pemasukan" : query.scope === "expense" ? "Pengeluaran" : "Mutasi";

  const lines = [
    `📊 <b>${what} ${escapeHtml(query.label)}</b>`,
    `<i>${formatRange(query.startDate, query.endDate)}</i>`,
    "",
    `Total: <b>${escapeHtml(formatIdr(result.total))}</b> · ${result.count} transaksi`,
  ];

  if (result.count === 0) {
    lines.push("", "<i>Belum ada catatan untuk periode ini.</i>");
    return lines.join("\n");
  }

  if (query.groupBy !== "none" && result.groups.length > 1) {
    lines.push("");
    for (const group of result.groups.slice(0, 12)) {
      const share = result.total > 0 ? Math.round((group.total / result.total) * 100) : 0;
      lines.push(
        `• ${escapeHtml(group.key)} — <b>${escapeHtml(formatIdr(group.total))}</b> (${share}%)`,
      );
    }
    if (result.groups.length > 12) {
      lines.push(`<i>…dan ${result.groups.length - 12} kategori lain</i>`);
    }
  }

  return lines.join("\n");
}

export function renderSummary(summary: Summary): string {
  const netPrefix = summary.net >= 0 ? "+" : "−";
  const lines = [
    `📊 <b>Ringkasan ${formatRange(summary.startDate, summary.endDate)}</b>`,
    "",
    `Masuk: <b>${escapeHtml(formatIdr(summary.income))}</b>`,
    `Keluar: <b>${escapeHtml(formatIdr(summary.expense))}</b>`,
    `Selisih: <b>${netPrefix}${escapeHtml(formatIdr(Math.abs(summary.net)))}</b>`,
    `<i>${summary.count} transaksi</i>`,
  ];

  if (summary.expenseByCategory.length > 0) {
    lines.push("", "<b>Pengeluaran terbesar</b>");
    for (const group of summary.expenseByCategory.slice(0, 8)) {
      lines.push(`• ${escapeHtml(group.key)} — ${escapeHtml(formatIdr(group.total))}`);
    }
  }

  return lines.join("\n");
}

export const HELP_TEXT = [
  "<b>AutoLedger</b> — catat keuangan rumah tangga lewat chat.",
  "",
  "<b>Mencatat</b> — tulis biasa saja:",
  "• <code>beli beras 50rb di indomaret</code>",
  "• <code>bensin 100k</code>",
  "• <code>gaji 15jt</code>",
  "• <code>kemarin makan siang 45rb</code>",
  "Atau kirim <b>foto struk</b>, nanti dibaca otomatis.",
  "",
  "<b>Bertanya</b>:",
  "• <code>berapa pengeluaran makanan bulan ini?</code>",
  "• <code>total belanja bulan lalu</code>",
  "",
  "<b>Perintah</b>:",
  "• /summary — ringkasan bulan ini",
  "• /summary lalu — ringkasan bulan lalu",
  "• /categories — daftar kategori",
  "• /help — pesan ini",
  "",
  "Setiap catatan punya tombol <b>Batalkan</b> dan <b>Ganti kategori</b>.",
].join("\n");
