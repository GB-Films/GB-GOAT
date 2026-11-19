import { readProjectCashMovements } from './projectCashQueries';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { normalizeEmail, normalizeSearchText } from './identity';
import { buildAssistantCapabilities } from './assistantCapabilities';
import type { AssistantProjectContext, AssistantProvider } from './assistantTools';
import { calculateProjectFinance, getItemTotal, getPaymentTotal, getStandaloneBudgetItems } from './projectFinance';
import { getReimbursedCents, isThirdPartyPayment } from './reimbursements';
import { readAuthorizedProject, readProjectCommercial } from './projectCommercial';
import { readProjectSummaries, readScopedCash, readScopedProject, readScopedProviders } from './projectScopedData';

export type AssistantProjectHandle = {
  id: string;
  name: string;
  clientName?: string;
};

export type AssistantProjectFinance = {
  projectId: string;
  name: string;
  status: string;
  clientName: string;
  budgetTotal: number;
  spent: number;
  paid: number;
  margin: number;
  debt: number;
  pendingLines: number;
  usagePercent: number;
  overBudget: number;
  payableLines: AssistantPayableLine[];
};

export type AssistantPayableLine = {
  id: string;
  projectId: string;
  projectName: string;
  area: string;
  providerName: string;
  description: string;
  total: number;
  paid: number;
  debt: number;
  paymentDate: string;
  source: 'area' | 'budget' | 'reimbursement';
};

// Lista los proyectos a los que el usuario tiene acceso, con las mismas dos
// consultas que usa la pantalla de Proyectos (dueño o colaborador invitado).
export const listAssistantProjects = async ({
  uid,
  email,
  isAppAdmin = false,
}: {
  uid: string;
  email: string;
  isAppAdmin?: boolean;
}): Promise<AssistantProjectHandle[]> => {
  const results = new Map<string, AssistantProjectHandle>();
  const collect = async (docs: Array<{ id: string; data: () => any }>) => {
    await Promise.all(docs.map(async entry => {
      const data = await readAuthorizedProject(db, { ...entry.data(), id: entry.id }, { uid, email, isAppAdmin });
      results.set(entry.id, {
        id: entry.id,
        name: String(data.name || 'Proyecto sin nombre'),
        clientName: data.clientName || '',
      });
    }));
  };

  if (isAppAdmin) await collect((await getDocs(collection(db, 'projects'))).docs);
  else for (const project of await readProjectSummaries()) results.set(project.id, {
    id: project.id, name: String(project.name || 'Proyecto sin nombre'), clientName: project.clientName || '',
  });

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
    const scoped = globalRole === 'admin' ? null : await readScopedProject(projectId);
    const normalizedEmail = normalizeEmail(email);
    let project = scoped?.project || (await getDoc(doc(db, 'projects', projectId))).data();
    if (!project) return null;
    const collaborator = scoped?.permissions || null;

    const capabilities = buildAssistantCapabilities({
      projectId,
      projectName: String(project.name || ''),
      projectCreatedBy: String(scoped?.admin ? uid : project.createdBy || ''),
      categories: project.categories,
      activeAreas: project.activeAreas,
      userId: uid,
      userEmail: normalizedEmail,
      globalRole: globalRole || null,
      collaborator,
    });
    if (!capabilities.can.viewProject) return null;
    project = await readProjectCommercial(db, { ...project, id: projectId }, capabilities.isProjectAdmin);

    const [budgetItems, areaExpenses, cashSnap] = await Promise.all([
      scoped ? scoped.budgetItems : getDocs(collection(db, 'projects', projectId, 'budgetItems')).then(snap => mapDocs(snap.docs)),
      scoped ? scoped.areaExpenses : getDocs(collection(db, 'projects', projectId, 'areaExpenses')).then(snap => mapDocs(snap.docs)),
      scoped && !scoped.admin ? readScopedCash(projectId) : readProjectCashMovements(db, projectId, normalizedEmail),
    ]);

    const canSeeCollaborators = capabilities.can.manageCollaborators
      || capabilities.can.assignCollaboratorAreas
      || capabilities.tabs.includes('permisos');
    const collaborators = canSeeCollaborators
      ? scoped?.collaborators || mapDocs((await getDocs(collection(db, 'projects', projectId, 'collaborators'))).docs)
      : [];
    const documents = capabilities.tabs.includes('documentos')
      ? scoped?.documents || mapDocs((await getDocs(collection(db, 'projects', projectId, 'projectDocuments'))).docs)
      : [];

    return {
      projectId,
      projectName: String(project.name || ''),
      userEmail: normalizedEmail,
      capabilities,
      meta: {
        clientName: String(project.clientName || ''),
        companyName: String(project.companyName || ''),
        brandName: String(project.brandName || ''),
        status: String(project.status || ''),
        budgetTotal: Number(project.budgetTotal) || 0,
        budgetRevision: Number(project.budgetRevision) || 0,
        shootingStartDate: String(project.shootingStartDate || ''),
        shootingEndDate: String(project.shootingEndDate || ''),
        location: String(project.location || ''),
        projectCode: String(project.projectCode || ''),
        areaExpenseSubcategories: project.areaExpenseSubcategories && typeof project.areaExpenseSubcategories === 'object'
          ? project.areaExpenseSubcategories
          : {},
        categoryBudgets: project.categoryBudgets || {},
        areaExpenseSubcategoryBudgets: project.areaExpenseSubcategoryBudgets && typeof project.areaExpenseSubcategoryBudgets === 'object'
          ? project.areaExpenseSubcategoryBudgets
          : {},
        resultIncidences: project.resultIncidences && typeof project.resultIncidences === 'object'
          ? project.resultIncidences
          : {},
      },
      categories: Array.isArray(project.categories) ? project.categories : [],
      activeAreas: Array.isArray(project.activeAreas) ? project.activeAreas : [],
      budgetItems,
      areaExpenses,
      cashMovements: cashSnap,
      collaborators,
      documents,
    };
  } catch (error) {
    console.warn('No pude cargar el proyecto para el asistente:', error);
    return null;
  }
};

// Cálculo liviano por proyecto para el resumen general (mismo criterio que el Dashboard).
export const loadAssistantProjectFinance = async (projectId: string, actor: { uid: string; email: string; isAppAdmin: boolean }): Promise<AssistantProjectFinance | null> => {
  try {
    const scoped = actor.isAppAdmin ? null : await readScopedProject(projectId, 'resumen');
    const projectData = scoped?.project || (await getDoc(doc(db, 'projects', projectId))).data();
    if (!projectData) return null;
    const project = scoped?.project || await readAuthorizedProject(db, { ...projectData, id: projectId }, actor);
    const [budgetItems, areaExpenses] = await Promise.all([
      scoped ? scoped.budgetItems : getDocs(collection(db, 'projects', projectId, 'budgetItems')).then(snap => mapDocs(snap.docs)),
      scoped ? scoped.areaExpenses : getDocs(collection(db, 'projects', projectId, 'areaExpenses')).then(snap => mapDocs(snap.docs)),
    ]);
    const finance = calculateProjectFinance(project, budgetItems, areaExpenses);
    const projectName = String(project.name || 'Proyecto sin nombre');
    const payableLines: AssistantPayableLine[] = [
      ...areaExpenses.map((item) => ({
        id: item.id,
        projectId,
        projectName,
        area: String(item.area || 'Sin area'),
        providerName: String(item.providerName || ''),
        description: String(item.description || ''),
        total: getItemTotal(item),
        paid: getPaymentTotal(item),
        debt: Math.max(0, getItemTotal(item) - getPaymentTotal(item)),
        paymentDate: String(item.paymentDate || ''),
        source: 'area' as const,
      })),
      ...getStandaloneBudgetItems(project, budgetItems).map((item: any) => ({
        id: item.id,
        projectId,
        projectName,
        area: String(item.area || 'Sin area'),
        providerName: String(item.providerName || ''),
        description: String(item.description || ''),
        total: getItemTotal(item),
        paid: getPaymentTotal(item),
        debt: Math.max(0, getItemTotal(item) - getPaymentTotal(item)),
        paymentDate: String(item.paymentDate || ''),
        source: 'budget' as const,
      })),
    ];
    // Reintegros a terceros: deuda con la persona que adelantó el pago.
    [...areaExpenses, ...getStandaloneBudgetItems(project, budgetItems)].forEach((item: any) => {
      (Array.isArray(item.paymentHistory) ? item.paymentHistory : []).forEach((payment: any, index: number) => {
        if (!isThirdPartyPayment(payment)) return;
        const total = Number(payment.amount) || 0;
        const paid = getReimbursedCents(payment) / 100;
        payableLines.push({
          id: `${item.id}-reintegro-${payment.id || index}`,
          projectId,
          projectName,
          area: String(item.area || 'Sin area'),
          providerName: String(payment.thirdPartyPayerName || 'Persona sin identificar'),
          description: `Reintegro por ${item.description || 'gasto'}`,
          total,
          paid,
          debt: Math.max(0, total - paid),
          paymentDate: String(payment.date || ''),
          source: 'reimbursement',
        });
      });
    });
    return {
      projectId,
      name: projectName,
      status: String(project.status || ''),
      clientName: String(project.clientName || ''),
      budgetTotal: Number(finance.budgetTotal) || 0,
      spent: Number(finance.spent) || 0,
      paid: Number(finance.paid) || 0,
      margin: Number(finance.margin) || 0,
      debt: Number(finance.debt) || 0,
      pendingLines: Number(finance.unpaidLines) || 0,
      usagePercent: Number(finance.usagePercent) || 0,
      overBudget: Number(finance.overBudget) || 0,
      payableLines,
    };
  } catch (error) {
    console.warn('No pude calcular las finanzas del proyecto para el asistente:', error);
    return null;
  }
};

export const loadAssistantProviders = async (): Promise<AssistantProvider[]> => {
  try {
    try { return mapDocs((await getDocs(collection(db, 'providers'))).docs); }
    catch { return await readScopedProviders(); }
  } catch (error) {
    console.warn('No pude cargar los proveedores para el asistente:', error);
    return [];
  }
};

export type AssistantClient = {
  id: string;
  businessName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  cuit?: string;
};

export type AssistantUser = {
  id: string;
  email?: string;
  displayName?: string;
  role?: string;
};

export const loadAssistantClients = async (): Promise<AssistantClient[]> => {
  try {
    const snapshot = await getDocs(collection(db, 'clients'));
    return mapDocs(snapshot.docs);
  } catch (error) {
    console.warn('No pude cargar los clientes para el asistente:', error);
    return [];
  }
};

export const loadAssistantUsers = async (): Promise<AssistantUser[]> => {
  try {
    const snapshot = await getDocs(collection(db, 'users'));
    return mapDocs(snapshot.docs);
  } catch (error) {
    console.warn('No pude cargar los usuarios para el asistente:', error);
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
