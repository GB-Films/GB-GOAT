const SPREADSHEET_ID = '1YBEXhP3ZrcjW0DnvSVZyxVPTK4QLxrDVUu3ZMrpCdHY';
const HEADER_RANGE = "'Proyectos'!A4:P4";
const IDS_RANGE = "'Proyectos'!A4:A";
const text = value => String(value ?? '').trim();

function parseProjects(rows) {
  const header = rows[0];
  if (!Array.isArray(header) || text(header[0]) !== 'ProyectoID') {
    throw new Error('La estructura de Proyectos cambió. No se publicó el catálogo.');
  }
  const columns = ['ProyectoID', 'Servicio', 'Marca', 'Empresa', 'Cliente', 'Unidad dueña',
    'Unidad prestadora interna', 'Condición', 'Fecha confirmación', 'Fecha entrega',
    'Moneda contrato', 'Contrato ARS', 'Contrato USD', 'Estado'];
  if (columns.some(column => !header.includes(column))) {
    throw new Error('Faltan columnas de Proyectos. No se publicó el catálogo.');
  }
  const at = (row, column) => row[header.indexOf(column)];
  const amount = value => {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Importe de contrato inválido.');
    return parsed;
  };
  const date = value => typeof value === 'number' && Number.isFinite(value)
    ? new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10)
    : text(value);
  const seen = new Set();
  const projects = [];
  rows.slice(1).forEach((row, index) => {
    if (!Array.isArray(row)) return;
    const sourceProjectId = text(at(row, 'ProyectoID'));
    if (!sourceProjectId.startsWith('G ')) return;
    const match = /^(G\s+\S+\s+\d+)\s+(.+)$/.exec(sourceProjectId);
    if (!match) throw new Error(`Código G no reconocido en la fila ${index + 5}.`);
    const projectCode = match[1].replace(/\s+/g, ' ');
    if (seen.has(projectCode)) throw new Error(`Código G repetido: ${projectCode}.`);
    seen.add(projectCode);
    const contractCurrency = text(at(row, 'Moneda contrato'));
    if (!['', 'ARS', 'USD'].includes(contractCurrency)) throw new Error(`Moneda no reconocida: ${projectCode}.`);
    projects.push({
      projectCode, sourceProjectId, name: match[2].trim(), sourceRow: index + 5,
      service: text(at(row, 'Servicio')), brand: text(at(row, 'Marca')),
      company: text(at(row, 'Empresa')), client: text(at(row, 'Cliente')),
      ownerUnit: text(at(row, 'Unidad dueña')),
      internalProviderUnit: text(at(row, 'Unidad prestadora interna')),
      condition: text(at(row, 'Condición')),
      confirmationDate: date(at(row, 'Fecha confirmación')),
      deliveryDate: date(at(row, 'Fecha entrega')),
      status: text(at(row, 'Estado')),
      contractCurrency,
      contractAmount: contractCurrency === 'ARS' ? amount(at(row, 'Contrato ARS'))
        : contractCurrency === 'USD' ? amount(at(row, 'Contrato USD')) : null,
    });
  });
  if (projects.length === 0 || projects.length > 500) {
    throw new Error('Cantidad de proyectos G inesperada. No se publicó el catálogo.');
  }
  return projects;
}

async function fetchProjects(getJson) {
  const idsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(IDS_RANGE)}?valueRenderOption=UNFORMATTED_VALUE`;
  const ids = (await getJson(idsUrl)).values || [];
  if (text(ids[0]?.[0]) !== 'ProyectoID') throw new Error('La columna ProyectoID cambió.');
  const gRows = ids.slice(1).map((row, index) => ({ rowNumber: index + 5, id: text(row?.[0]) }))
    .filter(row => row.id.startsWith('G '));
  if (gRows.length === 0 || gRows.length > 500) throw new Error('Cantidad de proyectos G inesperada.');
  const rows = Array.from({ length: ids.length }, () => []);
  for (let offset = 0; offset < gRows.length; offset += 50) {
    const chunk = gRows.slice(offset, offset + 50);
    const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE' });
    if (offset === 0) params.append('ranges', HEADER_RANGE);
    chunk.forEach(row => params.append('ranges', `'Proyectos'!A${row.rowNumber}:P${row.rowNumber}`));
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?${params}`;
    const valueRanges = (await getJson(url)).valueRanges || [];
    const expected = chunk.length + (offset === 0 ? 1 : 0);
    if (valueRanges.length !== expected) throw new Error('Faltan filas G en la respuesta de Sheets.');
    if (offset === 0) rows[0] = valueRanges[0].values?.[0] || [];
    chunk.forEach((row, index) => {
      const values = valueRanges[index + (offset === 0 ? 1 : 0)].values?.[0] || [];
      if (text(values[0]) !== row.id) throw new Error('Control Total cambió durante la lectura.');
      rows[row.rowNumber - 4] = values;
    });
  }
  return parseProjects(rows);
}

function canRefresh(auth) {
  const email = text(auth?.token?.email).toLowerCase();
  if (!auth?.uid || !['info@granbertafilms.com', 'tomas@granberta.com'].includes(email)) return false;
  return auth.token.email_verified === true;
}

module.exports = { SPREADSHEET_ID, fetchProjects, parseProjects, canRefresh };
