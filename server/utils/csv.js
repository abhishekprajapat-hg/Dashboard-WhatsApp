// Every value is quoted and internal quotes doubled - safe for values containing commas, newlines,
// or embedded JSON (e.g. a JSON.stringify'd diff cell).
function escapeCsvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

// `headers` lets a caller with zero rows still produce a real header line (column names can't be
// inferred from rows[0] when there are no rows) - omit it to keep the original behavior exactly,
// including the "metric,value\nNo data,0\n" fallback every existing analytics export call site
// already depends on.
export function jsonCsv(rows = [], headers) {
  if (!rows.length) {
    if (headers) return headers.join(",") + "\n";
    return "metric,value\nNo data,0\n";
  }

  const keys = headers || Object.keys(rows[0]);
  return [keys.join(","), ...rows.map((row) => keys.map((key) => escapeCsvValue(row[key])).join(","))].join("\n");
}
