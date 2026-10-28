import { PROVIDER_DATA_HEADERS, providerDataRow, selectedExportProviders } from './providerDataExport';

export async function buildProviderDataWorkbook(providers: any[], template: ArrayBuffer, exportedAt = new Date()) {
  const selected = selectedExportProviders(providers, providers.map(provider => provider.id));
  if (!selected.length) throw Error('Seleccioná al menos una persona.');
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(template);
  const sheet = workbook.getWorksheet('Personas');
  if (!sheet || sheet.getImages().length !== 1 || sheet.getCell('A7').value !== PROVIDER_DATA_HEADERS[0]) throw Error('No se pudo cargar el membrete.');
  workbook.creator = 'Gran Berta Films'; workbook.lastModifiedBy = 'GB GOAT'; workbook.created = exportedAt; workbook.modified = exportedAt;
  sheet.getCell('B4').value = `Exportado el ${exportedAt.toLocaleDateString('es-AR')} · ${selected.length} ${selected.length === 1 ? 'persona' : 'personas'}`;
  const header = sheet.getRow(7);
  header.height = 30;
  PROVIDER_DATA_HEADERS.forEach((label, index) => {
    const cell = header.getCell(index + 1); cell.value = label;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  selected.forEach((provider, index) => {
    const values = providerDataRow(provider), row = sheet.getRow(index + 8);
    row.height = values.some(value => typeof value === 'string' && value.length > 46) ? 44 : 34;
    values.forEach((value, column) => {
      const cell = row.getCell(column + 1), missing = typeof value === 'string' && (/^No informad[oa]$/.test(value) || value.startsWith('Revisar:'));
      cell.value = value;
      cell.font = { name: 'Arial', size: 10, color: { argb: missing ? 'FF92400E' : 'FF1E293B' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: missing ? 'FFFFF3CD' : index % 2 ? 'FFF1F5F9' : 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: column >= 1 && column <= 3 ? 'center' : 'left', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
      cell.numFmt = value instanceof Date ? 'dd/mm/yyyy' : '@';
    });
  });
  const lastRow = selected.length + 7;
  sheet.autoFilter = `A7:H${lastRow}`;
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 7, topLeftCell: 'B8', showGridLines: false }];
  sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printArea: `A1:H${lastRow}`, printTitlesRow: '1:7', margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.1, footer: 0.15 } };
  sheet.headerFooter = { oddFooter: '&LGran Berta Films&R&P / &N' };
  return workbook;
}

export async function downloadProviderData(providers: any[]) {
  const base = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';
  const response = await fetch(`${base}templates/proveedores-datos.xlsx`);
  if (!response.ok) throw Error('No se pudo cargar el membrete.');
  const workbook = await buildProviderDataWorkbook(providers, await response.arrayBuffer());
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const url = URL.createObjectURL(new Blob([bytes.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a'); link.href = url;
  const today = new Date();
  link.download = `Gran_Berta_Proveedores_${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
