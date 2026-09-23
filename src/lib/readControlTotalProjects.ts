import { GoogleAuthProvider, reauthenticateWithPopup, type User, type UserCredential } from 'firebase/auth';
import {
  CONTROL_TOTAL_PROJECT_IDS_RANGE,
  CONTROL_TOTAL_PROJECT_HEADER_RANGE,
  CONTROL_TOTAL_SPREADSHEET_ID,
  controlTotalProjectRowRange,
  parseControlTotalProjects,
  type ControlTotalProject,
} from './controlTotalProjects';

// Only called by an admin who explicitly opens the import picker. The access token
// stays in memory for this request; GOAT never stores it or a sheet export.
export const readControlTotalProjects = async (user: User): Promise<ControlTotalProject[]> => {
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/spreadsheets.readonly');
  if (user.email) provider.setCustomParameters({ login_hint: user.email });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: UserCredential;
  try {
    result = await Promise.race([
      reauthenticateWithPopup(user, provider),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('GOOGLE_POPUP_TIMEOUT')), 45000);
      }),
    ]);
  } catch (error) {
    const code = (error as { code?: string })?.code || (error as Error)?.message;
    if (code === 'GOOGLE_POPUP_TIMEOUT' || code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      throw new Error('La ventana de Google no respondió. Abrí GOAT en Chrome o Safari, permití ventanas emergentes y reintentá.');
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Se canceló el permiso de lectura. Podés reintentar cuando quieras.');
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new Error('Google no entregó acceso de lectura a la planilla.');

  const getJson = async <T>(url: string): Promise<T> => {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      if (response.status === 403) throw new Error('Tu cuenta de Google no puede leer Control Total o la API de Sheets no está habilitada para GOAT.');
      if (response.status === 404) throw new Error('No se encontró la pestaña Proyectos en Control Total.');
      throw new Error(`No se pudo leer Control Total (error ${response.status}).`);
    }
    return response.json() as Promise<T>;
  };

  // First read only the identity column, with an open-ended range so future
  // projects remain visible. Then fetch details only for G rows, never B rows.
  const idsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${CONTROL_TOTAL_SPREADSHEET_ID}/values/${encodeURIComponent(CONTROL_TOTAL_PROJECT_IDS_RANGE)}?valueRenderOption=UNFORMATTED_VALUE`;
  const idBody = await getJson<{ values?: unknown[][] }>(idsUrl);
  const idRows = idBody.values || [];
  if (String(idRows[0]?.[0] || '').trim() !== 'ProyectoID') {
    throw new Error('La columna ProyectoID de Control Total cambió. Revisá el maestro antes de importar.');
  }
  const gRows = idRows.slice(1)
    .map((row, index) => ({ rowNumber: index + 5, projectId: String(row?.[0] || '').trim() }))
    .filter(row => row.projectId.startsWith('G '));

  const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE' });
  params.append('ranges', CONTROL_TOTAL_PROJECT_HEADER_RANGE);
  gRows.forEach(row => params.append('ranges', controlTotalProjectRowRange(row.rowNumber)));
  const detailsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${CONTROL_TOTAL_SPREADSHEET_ID}/values:batchGet?${params}`;
  const details = await getJson<{ valueRanges?: Array<{ values?: unknown[][] }> }>(detailsUrl);
  const ranges = details.valueRanges || [];
  if (ranges.length !== gRows.length + 1) throw new Error('No se recibieron todas las filas G de Control Total. Reintentá.');

  const rows: unknown[][] = Array.from({ length: idRows.length }, () => []);
  rows[0] = ranges[0].values?.[0] || [];
  gRows.forEach((row, index) => {
    const values = ranges[index + 1].values?.[0] || [];
    if (String(values[0] || '').trim() !== row.projectId) {
      throw new Error('Control Total cambió mientras se leían los proyectos. Reintentá.');
    }
    rows[row.rowNumber - 4] = values;
  });
  return parseControlTotalProjects(rows);
};
