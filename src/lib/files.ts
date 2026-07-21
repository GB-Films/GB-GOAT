export const sanitizeFileName = (fileName: string, maxLength = 120) => (
  fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
);

export const getFileExtension = (fileName: string) => (
  sanitizeFileName(fileName.split('.').pop() || '').toLowerCase()
);

const MAX_SPREADSHEET_IMPORT_BYTES = 5 * 1024 * 1024;
const SPREADSHEET_EXTENSIONS = ['csv', 'xlsx', 'xls'];

export const validateSpreadsheetImport = (file: File) => {
  if (!SPREADSHEET_EXTENSIONS.includes(getFileExtension(file.name))) {
    return 'El archivo debe ser CSV, XLSX o XLS.';
  }
  if (file.size > MAX_SPREADSHEET_IMPORT_BYTES) {
    return 'El archivo supera el límite de 5 MB.';
  }
  return '';
};
