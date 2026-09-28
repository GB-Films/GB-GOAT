import { getFileExtension, validateSpreadsheetImport } from './files';

export type AssistantSpreadsheet = {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
  truncated: boolean;
  source: 'file' | 'paste';
};

export const ASSISTANT_SPREADSHEET_MAX_ROWS = 250;
export const ASSISTANT_SPREADSHEET_MAX_CHARS = 80_000;

const cleanCell = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

const rowHasContent = (row: string[]) => row.some((cell) => cell.length > 0);

// Lee la planilla en el navegador: no se sube ni se guarda en ningún lado.
export const readAssistantSpreadsheet = async (file: File): Promise<AssistantSpreadsheet> => {
  const validationError = validateSpreadsheetImport(file);
  if (validationError) throw new Error(validationError);

  const extension = getFileExtension(file.name);
  const buffer = await file.arrayBuffer();
  // Se carga sólo cuando el usuario adjunta una planilla, para no engordar el bundle.
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'array', raw: false, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('La planilla está vacía.');

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  }) as unknown as unknown[][];

  const allRows = matrix.map((row) => (Array.isArray(row) ? row.map(cleanCell) : []))
    .filter(rowHasContent);
  if (allRows.length === 0) throw new Error('No encontré filas con datos en la planilla.');

  const headerRow = allRows[0];
  const dataRows = allRows.slice(1);
  const truncated = dataRows.length > ASSISTANT_SPREADSHEET_MAX_ROWS;

  return {
    fileName: file.name,
    sheetName,
    headers: headerRow,
    rows: truncated ? dataRows.slice(0, ASSISTANT_SPREADSHEET_MAX_ROWS) : dataRows,
    totalRows: dataRows.length + 1,
    truncated: truncated || extension === 'xls',
    source: 'file',
  };
};

// Detecta una tabla copiada de Excel o Google Sheets (texto con tabulaciones).
export const parsePastedTable = (rawText: string): AssistantSpreadsheet | null => {
  const text = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!text.includes('\t')) return null;

  const lines = text.split('\n').map((line) => line.replace(/\n+$/g, ''));
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) return null;

  const linesWithTabs = nonEmptyLines.filter((line) => line.includes('\t')).length;
  if (nonEmptyLines.length > 1 && linesWithTabs / nonEmptyLines.length < 0.5) return null;

  const matrix = nonEmptyLines.map((line) => line.split('\t').map(cleanCell));
  const width = Math.max(...matrix.map((row) => row.length));
  if (width < 2) return null;
  if (matrix.length === 1 && width < 3) return null;

  const padded = matrix.map((row) => {
    const next = [...row];
    while (next.length < width) next.push('');
    return next;
  });

  const hasHeaderRow = padded.length > 1;
  const headers = hasHeaderRow
    ? padded[0].map((cell, index) => cell || `Columna ${index + 1}`)
    : padded[0].map((_, index) => `Columna ${index + 1}`);
  const dataRows = hasHeaderRow ? padded.slice(1) : padded;
  const truncated = dataRows.length > ASSISTANT_SPREADSHEET_MAX_ROWS;

  return {
    fileName: 'Tabla pegada',
    sheetName: 'Pegado',
    headers,
    rows: truncated ? dataRows.slice(0, ASSISTANT_SPREADSHEET_MAX_ROWS) : dataRows,
    totalRows: dataRows.length + 1,
    truncated,
    source: 'paste',
  };
};

// Texto compacto (TSV) para mandarle al modelo junto con el mensaje del usuario.
export const formatSpreadsheetForAssistant = (spreadsheet: AssistantSpreadsheet) => {
  const lines = [
    `${spreadsheet.source === 'paste' ? 'Tabla pegada desde una planilla' : 'Planilla adjunta'}: ${spreadsheet.fileName} (${spreadsheet.totalRows} filas con encabezado).`,
    'Columnas y filas (separadas por tabulaciones, la primera fila son los títulos):',
    spreadsheet.headers.join('\t'),
    ...spreadsheet.rows.map((row) => row.join('\t')),
  ];
  if (spreadsheet.truncated) {
    lines.push(`(La planilla tenía más filas: se muestran las primeras ${ASSISTANT_SPREADSHEET_MAX_ROWS}.)`);
  }
  const text = lines.join('\n');
  return text.length > ASSISTANT_SPREADSHEET_MAX_CHARS
    ? `${text.slice(0, ASSISTANT_SPREADSHEET_MAX_CHARS)}\n(El contenido se cortó por tamaño.)`
    : text;
};
