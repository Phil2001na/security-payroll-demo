import Papa from "papaparse";
import * as XLSX from "xlsx";

export type CsvParseResult<T = Record<string, string>> = {
  headers: string[];
  rows: T[];
  errors: Papa.ParseError[];
};

const EXCEL_EXT = /\.(xlsx|xlsm|xlsb|xls|ods)$/i;
const CSV_EXT = /\.(csv|tsv|txt)$/i;

export function parseCsvFile<T = Record<string, string>>(file: File): Promise<CsvParseResult<T>> {
  // Route Excel-family files through SheetJS, CSV through PapaParse.
  if (EXCEL_EXT.test(file.name)) return parseExcelFile<T>(file);
  // If extension is missing/unknown, try to sniff: Excel files start with PK or D0CF.
  if (!CSV_EXT.test(file.name)) {
    return file.arrayBuffer().then((buf) => {
      const head = new Uint8Array(buf.slice(0, 4));
      const isZip = head[0] === 0x50 && head[1] === 0x4b; // xlsx
      const isOle = head[0] === 0xd0 && head[1] === 0xcf; // xls
      if (isZip || isOle) return parseExcelBuffer<T>(buf);
      return parseCsvText<T>(new TextDecoder().decode(buf));
    });
  }
  return parseCsvText<T>(file);
}

function parseCsvText<T>(input: File | string): Promise<CsvParseResult<T>> {
  return new Promise((resolve, reject) => {
    Papa.parse<T>(input as never, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        resolve({
          headers: results.meta.fields ?? [],
          rows: results.data,
          errors: results.errors,
        });
      },
      error: (err) => reject(err),
    });
  });
}

async function parseExcelFile<T>(file: File): Promise<CsvParseResult<T>> {
  const buf = await file.arrayBuffer();
  return parseExcelBuffer<T>(buf);
}

function parseExcelBuffer<T>(buf: ArrayBuffer): CsvParseResult<T> {
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return { headers: [], rows: [], errors: [] };
  const sheet = wb.Sheets[firstSheet];
  // Read as array-of-arrays so we control header normalisation, then map to objects.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (!matrix.length) return { headers: [], rows: [], errors: [] };
  const headers = (matrix[0] as unknown[]).map((h) => String(h ?? "").trim()).filter((h) => h.length > 0);
  const rows: T[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i] as unknown[];
    if (!r || r.every((v) => v === "" || v == null)) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = String(r[idx] ?? "").trim();
    });
    rows.push(obj as unknown as T);
  }
  return { headers, rows, errors: [] };
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
