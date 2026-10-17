// Minimal RFC 4180 CSV reader for spreadsheet exports (Google Sheets "Download as CSV", Excel).
// Handles quoted fields with commas, quotes ("") and line breaks, a UTF-8 BOM, CRLF, and a
// semicolon delimiter (French Excel). Never throws on content; an unclosed quote is reported.

export interface CsvResult {
  rows: string[][];
  /** Problems with the file as a whole (e.g. an unclosed quote). */
  problems: string[];
}

/** Picks ',' or ';' from the first line (outside quotes), whichever appears more. */
export function detectDelimiter(text: string): ',' | ';' {
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch === ',') commas++;
    else if (!quoted && ch === ';') semis++;
  }
  return semis > commas ? ';' : ',';
}

export function parseCsv(input: string): CsvResult {
  const text = input.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  const problems: string[] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  // Nothing but spaces in the field so far (a quote here opens a quoted field). A flag, not
  // field.trim(), so a long field never makes each character cost its length.
  let blank = true;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
    blank = true;
  };
  const endRow = () => {
    endField();
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && blank) {
      field = '';
      quoted = true;
      blank = false;
    } else if (ch === delimiter) endField();
    else if (ch === '\r' && text[i + 1] === '\n') {
      endRow();
      i++;
    } else if (ch === '\n' || ch === '\r') endRow();
    else {
      field += ch;
      if (ch !== ' ' && ch !== '\t') blank = false;
    }
    i++;
  }
  if (quoted) problems.push('The file ends inside a quoted field; the last row may be incomplete.');
  if (field !== '' || row.length > 0) endRow();
  return { rows, problems };
}
