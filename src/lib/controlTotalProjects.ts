export const CONTROL_TOTAL_SPREADSHEET_ID = '1YBEXhP3ZrcjW0DnvSVZyxVPTK4QLxrDVUu3ZMrpCdHY';
export const CONTROL_TOTAL_PROJECTS_SHEET_ID = 293971582;
export const CONTROL_TOTAL_PROJECT_IDS_RANGE = "'Proyectos'!A4:A";
export const CONTROL_TOTAL_PROJECT_HEADER_RANGE = "'Proyectos'!A4:P4";
export const controlTotalProjectRowRange = (row: number) => `'Proyectos'!A${row}:P${row}`;

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
  contractArs?: number | null;
  contractUsd?: number | null;
  sourceWarning?: string;
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
  const required = ['ProyectoID', 'Servicio', 'Marca', 'Empresa', 'Cliente', 'Unidad dueña', 'Unidad prestadora interna', 'Condición', 'Fecha confirmación', 'Fecha entrega', 'Contrato ARS', 'Contrato USD', 'Estado'];
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
    const hasLegacyHeader = header.includes('Moneda contrato');
    const legacyRow = !hasLegacyHeader && ['ARS', 'USD'].includes(text(row[10]));
    const legacyCurrency = hasLegacyHeader ? text(at(row, 'Moneda contrato')) : legacyRow ? text(row[10]) : '';
    const readAmount = (value: unknown) => {
      const parsed = amount(value);
      if (parsed === null && value !== '' && value !== null && value !== undefined) {
        throw new Error(`Importe de contrato no reconocido para ${projectCode} (fila ${index + 5}). Revisá Control Total.`);
      }
      return parsed;
    };
    const contractArs = readAmount(legacyRow ? row[11] : at(row, 'Contrato ARS'));
    const contractUsd = readAmount(legacyRow ? row[12] : at(row, 'Contrato USD'));
    const shiftedStatus = !hasLegacyHeader && typeof at(row, 'Estado') !== 'string'
      && ['Activo', 'Migrado', 'Finalizado', 'Cerrado', 'Cancelado', 'Presupuesto', 'En curso'].includes(text(row[15]));
    // Current CT has independent currency components, which may coexist.
    // Keep the legacy single-currency fields only when unambiguous.
    const hasArs = contractArs !== null && contractArs > 0;
    const hasUsd = contractUsd !== null && contractUsd > 0;
    const contractCurrency = hasArs && hasUsd ? '' : hasArs ? 'ARS' : hasUsd ? 'USD' : legacyCurrency;
    if (legacyCurrency && legacyCurrency !== 'ARS' && legacyCurrency !== 'USD') {
      throw new Error(`Moneda no reconocida para ${projectCode}.`);
    }
    const contractAmount = contractCurrency === 'ARS'
      ? contractArs
      : contractCurrency === 'USD' ? contractUsd : null;
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
      status: text(legacyRow || shiftedStatus ? row[15] : at(row, 'Estado')),
      contractCurrency: contractCurrency as ControlTotalProject['contractCurrency'],
      contractAmount,
      contractArs,
      contractUsd,
      ...(legacyRow || shiftedStatus ? { sourceWarning: 'Esta fila conserva columnas del formato anterior de Control Total. Se preservaron los importes identificables por moneda; revisá la fila de origen antes de confirmar el presupuesto.' } : {}),
    });
  });
  return projects;
};

export const controlTotalProjectUrl = (project: ControlTotalProject) =>
  `https://docs.google.com/spreadsheets/d/${CONTROL_TOTAL_SPREADSHEET_ID}/edit#gid=${CONTROL_TOTAL_PROJECTS_SHEET_ID}&range=A${project.sourceRow}:P${project.sourceRow}`;

export const controlTotalContractLabel = (project: ControlTotalProject) => {
  const components = [
    project.contractArs != null && project.contractArs > 0 ? `ARS ${project.contractArs.toLocaleString('es-AR')}` : '',
    project.contractUsd != null && project.contractUsd > 0 ? `USD ${project.contractUsd.toLocaleString('es-AR')}` : '',
  ].filter(Boolean);
  return components.join(' + ') || (project.contractAmount !== null && project.contractCurrency
    ? `${project.contractCurrency} ${project.contractAmount.toLocaleString('es-AR')}` : 'Sin importe');
};

export const controlTotalArsBudget = (project: ControlTotalProject) =>
  project.contractArs ?? (project.contractCurrency === 'ARS' ? project.contractAmount ?? 0 : 0);
