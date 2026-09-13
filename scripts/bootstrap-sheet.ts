/**
 * Prepares the spreadsheet: creates the Transactions and Config tabs, writes
 * headers, seeds the category list, and applies the number formats that keep
 * amounts and dates behaving like real numbers and dates.
 *
 * Safe to re-run. Existing categories and member mappings are never
 * overwritten, so this can be used to repair a sheet as well as create one.
 */
import { loadConfig } from "../src/config.js";
import {
  createSheetsContext,
  describeSheetsError,
  quoteSheetName,
  type SheetsContext,
} from "../src/sheets/client.js";
import { CONFIG_HEADERS, DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES } from "../src/sheets/config.js";
import { HEADERS } from "../src/sheets/transactions.js";

async function existingTabs(ctx: SheetsContext): Promise<Map<string, number>> {
  const res = await ctx.api.spreadsheets.get({
    spreadsheetId: ctx.spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const tabs = new Map<string, number>();
  for (const sheet of res.data.sheets ?? []) {
    const title = sheet.properties?.title;
    const id = sheet.properties?.sheetId;
    if (title && id !== null && id !== undefined) tabs.set(title, id);
  }
  return tabs;
}

async function createTab(ctx: SheetsContext, title: string): Promise<number> {
  const res = await ctx.api.spreadsheets.batchUpdate({
    spreadsheetId: ctx.spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title } } }] },
  });
  const sheetId = res.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (sheetId === null || sheetId === undefined) {
    throw new Error(`Created "${title}" but Google did not return its sheetId.`);
  }
  return sheetId;
}

/** Bold, frozen header row; real number and date formats on the data columns. */
function formatTransactions(sheetId: number) {
  return [
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat.bold",
      },
    },
    {
      // Column C — date.
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 },
        cell: {
          userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } },
        },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    {
      // Column E — amount in whole rupiah.
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: 4, endColumnIndex: 5 },
        cell: {
          userEnteredFormat: {
            numberFormat: { type: "NUMBER", pattern: '"Rp"#,##0' },
          },
        },
        fields: "userEnteredFormat.numberFormat",
      },
    },
    { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS" } } },
  ];
}

async function main(): Promise<void> {
  const config = loadConfig();
  const ctx = createSheetsContext(config);

  console.log(`Preparing spreadsheet ${config.spreadsheetId}`);
  console.log(
    `Identity: ${
      config.serviceAccount?.client_email ??
      "Application Default Credentials (no key file)"
    }`,
  );
  console.log("Share the sheet with that identity as an Editor, or this will 403.\n");

  const tabs = await existingTabs(ctx);

  // --- Transactions tab -----------------------------------------------------
  let transactionsId = tabs.get(config.transactionsSheet);
  if (transactionsId === undefined) {
    transactionsId = await createTab(ctx, config.transactionsSheet);
    console.log(`✓ created tab "${config.transactionsSheet}"`);
  } else {
    console.log(`· tab "${config.transactionsSheet}" already exists`);
  }

  await ctx.api.spreadsheets.values.update({
    spreadsheetId: ctx.spreadsheetId,
    range: `${quoteSheetName(config.transactionsSheet)}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [[...HEADERS]] },
  });
  console.log(`✓ wrote ${HEADERS.length} headers`);

  // --- Config tab -----------------------------------------------------------
  let configId = tabs.get(config.configSheet);
  if (configId === undefined) {
    configId = await createTab(ctx, config.configSheet);
    console.log(`✓ created tab "${config.configSheet}"`);
  } else {
    console.log(`· tab "${config.configSheet}" already exists`);
  }

  await ctx.api.spreadsheets.values.update({
    spreadsheetId: ctx.spreadsheetId,
    range: `${quoteSheetName(config.configSheet)}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [[...CONFIG_HEADERS]] },
  });

  const existingCategories = await ctx.api.spreadsheets.values.get({
    spreadsheetId: ctx.spreadsheetId,
    range: `${quoteSheetName(config.configSheet)}!A2:A`,
  });
  const alreadySeeded = (existingCategories.data.values ?? []).some(
    (row) => String(row[0] ?? "").trim() !== "",
  );

  if (alreadySeeded) {
    console.log("· categories already present — left untouched");
  } else {
    await ctx.api.spreadsheets.values.update({
      spreadsheetId: ctx.spreadsheetId,
      range: `${quoteSheetName(config.configSheet)}!A2`,
      valueInputOption: "RAW",
      requestBody: { values: DEFAULT_CATEGORIES.map((c) => [c]) },
    });
    console.log(`✓ seeded ${DEFAULT_CATEGORIES.length} categories`);
  }

  const existingAccounts = await ctx.api.spreadsheets.values.get({
    spreadsheetId: ctx.spreadsheetId,
    range: `${quoteSheetName(config.configSheet)}!E2:E`,
  });
  const accountsSeeded = (existingAccounts.data.values ?? []).some(
    (row) => String(row[0] ?? "").trim() !== "",
  );

  if (accountsSeeded) {
    console.log("· accounts already present — left untouched");
  } else {
    await ctx.api.spreadsheets.values.update({
      spreadsheetId: ctx.spreadsheetId,
      range: `${quoteSheetName(config.configSheet)}!E2`,
      valueInputOption: "RAW",
      requestBody: { values: DEFAULT_ACCOUNTS.map((a) => [a]) },
    });
    console.log(`✓ seeded ${DEFAULT_ACCOUNTS.length} accounts (edit or delete as you like)`);
  }

  // --- Cosmetics ------------------------------------------------------------
  await ctx.api.spreadsheets.batchUpdate({
    spreadsheetId: ctx.spreadsheetId,
    requestBody: {
      requests: [
        ...formatTransactions(transactionsId),
        {
          updateSheetProperties: {
            properties: { sheetId: configId, gridProperties: { frozenRowCount: 1 } },
            fields: "gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: { sheetId: configId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat.textFormat.bold",
          },
        },
      ],
    },
  });
  console.log("✓ applied formats\n");

  console.log("Done. Next steps:");
  console.log(`  1. Open https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/edit`);
  console.log(
    `  2. In the "${config.configSheet}" tab, fill columns C and D with each member's ` +
      "Telegram ID and name, and adjust column E to the accounts you actually use.",
  );
  console.log("  3. Start the bot with `npm start`.");
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error && error.name === "SheetStructureError"
      ? error.message
      : describeSheetsError(error);
  console.error(`\n✖ ${message}\n`);
  process.exitCode = 1;
});
