import Papa from "papaparse";

export type CsvParseResult<T = Record<string, string>> = {
  headers: string[];
  rows: T[];
  errors: Papa.ParseError[];
};

export function parseCsvFile<T = Record<string, string>>(file: File): Promise<CsvParseResult<T>> {
  return new Promise((resolve, reject) => {
    Papa.parse<T>(file, {
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
