import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { normalizeEmail, normalizeSearchText } from './identity';
import { buildAssistantCapabilities } from './assistantCapabilities';
import type { AssistantProjectContext, AssistantProvider } from './assistantTools';

export type AssistantProjectHandle = {
  id: string;
  name: string;
  clientName?: string;
};

// Lista los proyectos a los que el usuario tiene acceso, con las mismas dos
// consultas que usa la pantalla de Proyectos (dueño o colaborador invitado).
export const listAssistantProjects = async ({ uid, email }: { uid: string; email: string }): Promise<AssistantProjectHandle[]> => {
  const results = new Map<string, AssistantProjectHandle>();
  const normalizedEmail = normalizeEmail(email);
  const collect = (docs: Array<{ id: string; data: () => any }>) => {
    docs.forEach((entry) => {
      const data = entry.data() || {};
      results.set(entry.id, {
        id: entry.id,
        name: String(data.name || 'Proyecto sin nombre'),
        clientName: data.clientName || '',
      });
    });
  };

  if (uid) {
    try {
      const owned = await getDocs(query(collection(db, 'projects'), where('createdBy', '==', uid)));
      collect(owned.docs);
    } catch (error) {
      console.warn('No pude listar los proyectos propios para el asistente:', error);
    }
  }
  if (normalizedEmail) {
    try {
      const shared = await getDocs(query(collection(db, 'projects'), where('collaboratorEmails', 'array-contains', normalizedEmail)));
      collect(shared.docs);
    } catch (error) {
      console.warn('No pude listar los proyectos compartidos para el asistente:', error);
    }
  }

  return Array.from(results.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
};

const mapDocs = (docs: Array<{ id: string; data: () => any }>) => (
  docs.map((entry) => ({ id: entry.id, ...entry.data() }))
);

// Carga el contexto de un proyecto usando la sesión del usuario: las reglas de
// Firestore son las que deciden qué puede leer y qué no.
export const loadAssistantProjectContext = async ({
  projectId,
  uid,
  email,
  globalRole,
}: {
  projectId: string;
  uid: string;
  email: string;
  globalRole?: string | null;
}): Promise<AssistantProjectContext | null> => {
  try {
    const projectSnap = await getDoc(doc(db, 'projects', projectId));
    if (!projectSnap.exists()) return null;
    const project = projectSnap.data() || {};

    const normalizedEmail = normalizeEmail(email);
    let collaborator: any = null;
    try {
      const collaboratorSnap = await getDoc(doc(db, 'projects', projectId, 'collaborators', normalizedEmail));
      collaborator = collaboratorSnap.exists() ? collaboratorSnap.data() : null;
    } catch (error) {
      collaborator = null;
    }

    const capabilities = buildAssistantCapabilities({
      projectId,
      projectName: String(project.name || ''),
      projectCreatedBy: String(project.createdBy || ''),
      categories: project.categories,
      activeAreas: project.activeAreas,
      userId: uid,
      globalRole: globalRole || null,
      collaborator,
    });
    if (!capabilities.can.viewProject) return null;

    const [budgetSnap, areaSnap, cashSnap] = await Promise.all([
      getDocs(collection(db, 'projects', projectId, 'budgetItems')),
      getDocs(collection(db, 'projects', projectId, 'areaExpenses')),
      getDocs(collection(db, 'projects', projectId, 'cashMovements')),
    ]);

    const canSeeCollaborators = capabilities.can.manageCollaborators
      || capabilities.can.assignCollaboratorAreas
      || capabilities.tabs.includes('permisos');
    const collaborators = canSeeCollaborators
      ? mapDocs((await getDocs(collection(db, 'projects', projectId, 'collaborators'))).docs)
      : [];

    return {
      projectId,
      projectName: String(project.name || ''),
      userEmail: normalizedEmail,
      capabilities,
      categories: Array.isArray(project.categories) ? project.categories : [],
      activeAreas: Array.isArray(project.activeAreas) ? project.activeAreas : [],
      budgetItems: mapDocs(budgetSnap.docs),
      areaExpenses: mapDocs(areaSnap.docs),
      cashMovements: mapDocs(cashSnap.docs),
      collaborators,
    };
  } catch (error) {
    console.warn('No pude cargar el proyecto para el asistente:', error);
    return null;
  }
};

export const loadAssistantProviders = async (): Promise<AssistantProvider[]> => {
  try {
    const snapshot = await getDocs(collection(db, 'providers'));
    return mapDocs(snapshot.docs);
  } catch (error) {
    console.warn('No pude cargar los proveedores para el asistente:', error);
    return [];
  }
};

export const findProjectByReference = (
  projects: AssistantProjectHandle[],
  reference: unknown,
) => {
  const raw = String(reference || '').trim();
  if (!raw) return null;
  const direct = projects.find((project) => project.id === raw);
  if (direct) return direct;
  const text = normalizeSearchText(raw);
  return projects.find((project) => normalizeSearchText(project.name) === text)
    || projects.find((project) => normalizeSearchText(project.name).includes(text))
    || projects.find((project) => normalizeSearchText(project.clientName || '').includes(text) && text.length > 3)
    || null;
};
