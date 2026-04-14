import { google } from "googleapis";
import { Macros, ItemBreakdown } from "./types";

const SHEET_NAME = "Meals";
const RANGE = `${SHEET_NAME}!A:G`;

function getSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) {
    throw new Error("GOOGLE_SHEET_ID environment variable is not set");
  }
  return id;
}

function buildAuth(): InstanceType<typeof google.auth.GoogleAuth> {
  const base64Creds = process.env.GOOGLE_CREDENTIALS_BASE64;
  if (base64Creds) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(Buffer.from(base64Creds, "base64").toString("utf-8"));
    } catch {
      throw new Error("GOOGLE_CREDENTIALS_BASE64 is not valid base64-encoded JSON");
    }
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  return new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

const auth = buildAuth();

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

const TZ = "America/New_York";

function todayEST(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
  return parts; // "YYYY-MM-DD"
}

function nowEST(): string {
  return new Date().toLocaleString("en-US", { timeZone: TZ });
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
  // Parse date from "M/D/YYYY, H:MM:SS AM/PM" (en-US) format
  const datePart = row[0].split(",")[0]; // "M/D/YYYY"
  const dateMatch = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  let dateStr: string;
  if (dateMatch) {
    const [, m, d, y] = dateMatch;
    dateStr = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  } else {
    // Fallback: try ISO format (legacy rows)
    dateStr = row[0].slice(0, 10);
  }
  return {
    date: dateStr,
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

function isSubRow(row: string[]): boolean {
  return row.length >= 2 && row[1].trimStart().startsWith("→");
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
  macros: Macros,
  items?: ItemBreakdown[]
): Promise<void> {
  if (typeof description !== "string" || description.trim().length === 0) {
    throw new Error("Meal description must be a non-empty string");
  }
  validateMacros(macros);

  const spreadsheetId = getSheetId();
  const rows: (string | number)[][] = [
    [
      nowEST(),
      sanitize(description.trim()),
      macros.calories,
      macros.protein_g,
      macros.carbs_g,
      macros.fat_g,
      macros.fiber_g,
    ],
  ];

  if (items && items.length > 1) {
    for (const item of items) {
      rows.push([
        "",
        sanitize(`→ ${item.name}`),
        item.calories,
        item.protein_g,
        item.carbs_g,
        item.fat_g,
        item.fiber_g,
      ]);
    }
  }

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: RANGE,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Unknown Google Sheets API error";
    throw new Error(`Failed to log meal: ${message}`);
  }
}

export async function getTodayTotals(): Promise<Macros> {
  const rows = await fetchAllRows();
  const today = todayEST();
  const todayMacros: Macros[] = [];

  for (const row of rows) {
    if (isSubRow(row)) continue;
    const parsed = parseRow(row);
    if (parsed && parsed.date === today) {
      todayMacros.push(parsed.macros);
    }
  }

  return sumMacros(todayMacros);
}

export async function getWeekTotals(): Promise<Macros> {
  const rows = await fetchAllRows();
  const todayStr = todayEST();
  const todayDate = new Date(todayStr + "T00:00:00");

  // Find Monday of the current week (Mon=start, Sun=end)
  const day = todayDate.getDay(); // 0=Sun, 1=Mon, ...
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(todayDate);
  monday.setDate(monday.getDate() - diffToMonday);
  const mondayStr = monday.toISOString().slice(0, 10);

  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const sundayStr = sunday.toISOString().slice(0, 10);

  const weekMacros: Macros[] = [];

  for (const row of rows) {
    if (isSubRow(row)) continue;
    const parsed = parseRow(row);
    if (parsed && parsed.date >= mondayStr && parsed.date <= sundayStr) {
      weekMacros.push(parsed.macros);
    }
  }

  return sumMacros(weekMacros);
}
