import { google } from "googleapis";
import { Macros } from "./types";

const SHEET_NAME = "Meals";
const RANGE = `${SHEET_NAME}!A:G`;

function getSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) {
    throw new Error("GOOGLE_SHEET_ID environment variable is not set");
  }
  return id;
}

const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

/** Prevent formula injection by prefixing dangerous leading characters with a single quote. */
function sanitize(value: string): string {
  if (/^[=+\-@]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function validateMacros(macros: Macros): void {
  const fields: (keyof Macros)[] = [
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
    "fiber_g",
  ];
  for (const field of fields) {
    const v = macros[field];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`Invalid macro value for ${field}: must be a finite number`);
    }
  }
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseRow(row: string[]): { date: string; macros: Macros } | null {
  if (row.length < 7) return null;
  const calories = Number(row[2]);
  const protein_g = Number(row[3]);
  const carbs_g = Number(row[4]);
  const fat_g = Number(row[5]);
  const fiber_g = Number(row[6]);
  if (
    [calories, protein_g, carbs_g, fat_g, fiber_g].some(
      (n) => !Number.isFinite(n)
    )
  ) {
    return null;
  }
  return {
    date: row[0].slice(0, 10),
    macros: { calories, protein_g, carbs_g, fat_g, fiber_g },
  };
}

function sumMacros(items: Macros[]): Macros {
  const totals: Macros = {
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
  };
  for (const m of items) {
    totals.calories += m.calories;
    totals.protein_g += m.protein_g;
    totals.carbs_g += m.carbs_g;
    totals.fat_g += m.fat_g;
    totals.fiber_g += m.fiber_g;
  }
  return totals;
}

async function fetchAllRows(): Promise<string[][]> {
  const spreadsheetId = getSheetId();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: RANGE,
    });
    return (res.data.values as string[][] | undefined) ?? [];
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown Google Sheets API error";
    throw new Error(`Failed to read sheet data: ${message}`);
  }
}

export async function logMeal(
  description: string,
  macros: Macros
): Promise<void> {
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error("Meal description must be a non-empty string");
  }
  validateMacros(macros);

  const spreadsheetId = getSheetId();
  const row = [
    new Date().toISOString(),
    sanitize(description.trim()),
    macros.calories,
    macros.protein_g,
    macros.carbs_g,
    macros.fat_g,
    macros.fiber_g,
  ];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: RANGE,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown Google Sheets API error";
    throw new Error(`Failed to log meal: ${message}`);
  }
}

export async function getTodayTotals(): Promise<Macros> {
  const rows = await fetchAllRows();
  const today = todayUTC();
  const todayMacros: Macros[] = [];

  for (const row of rows) {
    const parsed = parseRow(row);
    if (parsed && parsed.date === today) {
      todayMacros.push(parsed.macros);
    }
  }

  return sumMacros(todayMacros);
}

export async function getWeekTotals(): Promise<Macros> {
  const rows = await fetchAllRows();
  const now = new Date();
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6)
  );
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const weekMacros: Macros[] = [];

  for (const row of rows) {
    const parsed = parseRow(row);
    if (parsed && parsed.date >= cutoffStr) {
      weekMacros.push(parsed.macros);
    }
  }

  return sumMacros(weekMacros);
}
