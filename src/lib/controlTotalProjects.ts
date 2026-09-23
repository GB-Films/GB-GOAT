export const CONTROL_TOTAL_SPREADSHEET_ID = '1YBEXhP3ZrcjW0DnvSVZyxVPTK4QLxrDVUu3ZMrpCdHY';
export const CONTROL_TOTAL_PROJECTS_SHEET_ID = 293971582;
export const CONTROL_TOTAL_PROJECTS_RANGE = "'Proyectos'!A4:P834";

export type ControlTotalProject = {
  projectCode: string;
  sourceProjectId: string;
  name: string;
  sourceRow: number;
  service: string;
  brand: string;
  company: string;
  client: string;
  ownerUnit: string;
  internalProviderUnit: string;
  condition: string;
  confirmationDate: string;
  deliveryDate: string;
  status: string;
  contractCurrency: 'ARS' | 'USD' | '';
  contractAmount: number | null;
};

const text = (value: unknown) => String(value ?? '').trim();
const amount = (value: unknown): number | null => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const sheetDate = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  return text(value);
};

export const parseControlTotalProjects = (rows: unknown[][]): ControlTotalProject[] => {
  if (!Array.isArray(rows) || !Array.isArray(rows[0]) || text(rows[0][0]) !== 'ProyectoID') {
    throw new Error('La estructura de la pestaña Proyectos cambió. Revisá sus columnas antes de importar.');
  }

  const header = rows[0].map(text);
  const required = ['ProyectoID', 'Servicio', 'Marca', 'Empresa', 'Cliente', 'Unidad dueña', 'Unidad prestadora interna', 'Condición', 'Fecha confirmación', 'Fecha entrega', 'Moneda contrato', 'Contrato ARS', 'Contrato USD', 'Estado'];
  for (const column of required) {
    if (!header.includes(column)) throw new Error(`Falta la columna ${column} en Control Total.`);
  }
  const at = (row: unknown[], column: string) => row[header.indexOf(column)];

  const projects: ControlTotalProject[] = [];
  const seenCodes = new Set<string>();
  rows.slice(1).forEach((row, index) => {
    if (!Array.isArray(row)) return;
    const sourceProjectId = text(at(row, 'ProyectoID'));
    if (!sourceProjectId.startsWith('G ')) return;
    const match = /^(G\s+\S+\s+\d+)\s+(.+)$/.exec(sourceProjectId);
    if (!match) throw new Error(`Código G no reconocido en la fila ${index + 5}.`);
    const projectCode = match[1].replace(/\s+/g, ' ');
    if (seenCodes.has(projectCode)) throw new Error(`El código ${projectCode} está repetido en Control Total.`);
    seenCodes.add(projectCode);
    const contractCurrency = text(at(row, 'Moneda contrato'));
    if (contractCurrency && contractCurrency !== 'ARS' && contractCurrency !== 'USD') {
      throw new Error(`Moneda no reconocida para ${projectCode}.`);
    }
    const contractAmount = contractCurrency === 'ARS'
      ? amount(at(row, 'Contrato ARS'))
      : contractCurrency === 'USD' ? amount(at(row, 'Contrato USD')) : null;
    projects.push({
      projectCode,
      sourceProjectId,
      name: match[2].trim(),
      sourceRow: index + 5,
      service: text(at(row, 'Servicio')),
      brand: text(at(row, 'Marca')),
      company: text(at(row, 'Empresa')),
      client: text(at(row, 'Cliente')),
      ownerUnit: text(at(row, 'Unidad dueña')),
      internalProviderUnit: text(at(row, 'Unidad prestadora interna')),
      condition: text(at(row, 'Condición')),
      confirmationDate: sheetDate(at(row, 'Fecha confirmación')),
      deliveryDate: sheetDate(at(row, 'Fecha entrega')),
      status: text(at(row, 'Estado')),
      contractCurrency: contractCurrency as ControlTotalProject['contractCurrency'],
      contractAmount,
    });
  });
  return projects;
};

export const controlTotalProjectUrl = (project: ControlTotalProject) =>
  `https://docs.google.com/spreadsheets/d/${CONTROL_TOTAL_SPREADSHEET_ID}/edit#gid=${CONTROL_TOTAL_PROJECTS_SHEET_ID}&range=A${project.sourceRow}:P${project.sourceRow}`;
