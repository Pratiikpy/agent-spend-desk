/**
 * A small CSV reader (RFC 4180): quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF or LF, an optional
 * byte-order mark. It returns every record with the 1-based line number where it starts, so a figure can be traced to its place
 * in the file. A blank line is skipped. It refuses a quote that is never closed instead of swallowing the rest of the file.
 */
export interface CsvRecord {
  line: number;
  fields: string[];
}

export class CsvError extends Error {}

export function parseCsv(text: string): CsvRecord[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let startLine = 1;
  let touched = false;
  const endField = (): void => {
    fields.push(field);
    field = "";
  };
  const endRecord = (): void => {
    endField();
    if (!(fields.length === 1 && fields[0] === "" && !touched)) out.push({ line: startLine, fields });
    fields = [];
    touched = false;
  };
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      touched = true;
    } else if (ch === ",") {
      endField();
      touched = true;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      endRecord();
      line += 1;
      startLine = line;
    } else {
      field += ch;
      touched = true;
    }
  }
  if (inQuotes) throw new CsvError(`a quoted field that starts on line ${startLine} is never closed`);
  if (field !== "" || fields.length > 0 || touched) endRecord();
  return out;
}
