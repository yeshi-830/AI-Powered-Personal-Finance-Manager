export function serializeCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value);
          const safeText = /^[\t\r\n ]*[=+\-@]/.test(text)
            ? `'${text}`
            : text;
          return `"${safeText.replaceAll('"', '""')}"`;
        })
        .join(",")
    )
    .join("\r\n");
}
