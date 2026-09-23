import { GoogleAuthProvider, reauthenticateWithPopup, type User } from 'firebase/auth';
import {
  CONTROL_TOTAL_PROJECTS_RANGE,
  CONTROL_TOTAL_SPREADSHEET_ID,
  parseControlTotalProjects,
  type ControlTotalProject,
} from './controlTotalProjects';

// Only called by an admin who explicitly opens the import picker. The access token
// stays in memory for this request; GOAT never stores it or the full sheet contents.
export const readControlTotalProjects = async (user: User): Promise<ControlTotalProject[]> => {
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/spreadsheets.readonly');
  if (user.email) provider.setCustomParameters({ login_hint: user.email });
  const result = await reauthenticateWithPopup(user, provider);
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new Error('Google no entregó acceso de lectura a la planilla.');

  const range = encodeURIComponent(CONTROL_TOTAL_PROJECTS_RANGE);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONTROL_TOTAL_SPREADSHEET_ID}/values/${range}?valueRenderOption=UNFORMATTED_VALUE`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    if (response.status === 403) throw new Error('Tu cuenta de Google no puede leer Control Total o la API de Sheets no está habilitada para GOAT.');
    if (response.status === 404) throw new Error('No se encontró la pestaña Proyectos en Control Total.');
    throw new Error(`No se pudo leer Control Total (error ${response.status}).`);
  }
  const body = await response.json() as { values?: unknown[][] };
  return parseControlTotalProjects(body.values || []);
};
