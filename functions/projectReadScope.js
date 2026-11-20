const { HttpsError } = require('firebase-functions/v2/https');
const { list } = require('./providerPortalModel');
const areaTabs = ['resumen', 'areas', 'saldos', 'proveedores'];
const budgetTabs = [...areaTabs, 'presupuesto'];
const defaultTabs = [...areaTabs, 'cajas', 'documentos'];
const cleanSubcategory = value => String(value ?? '').trim() === 'Sin subcategoria' ? '' : String(value ?? '').trim();
const keyFor = (area, sub) => `${String(area ?? '').trim()}||${cleanSubcategory(sub)}`;
const deny = () => { throw new HttpsError('permission-denied', 'No tenés acceso a esos datos del proyecto.'); };

function projectTabs({ collaborator }) {
  if (!collaborator) return [];
  if (Array.isArray(collaborator.allowedTabs)) return [...new Set(collaborator.allowedTabs)];
  return [...defaultTabs, ...(collaborator.role === 'jefe_produccion' ? ['permisos'] : [])];
}

const canReadTab = (access, ...tabs) => access.admin || tabs.some(tab => projectTabs(access).includes(tab));
const hasAreaEditGrant = access => access.collaborator?.canEditBudgetAreas === true
  && list(access.collaborator.allowedTabs).includes('areas');
const fullArea = (access, area) => access.admin || list(access.collaborator?.allowedCategories).includes(area)
  && !list(access.collaborator?.excludedSubcategories).some(key => typeof key === 'string' && key.split('||')[0] === area);

function canReadArea(access, area, sub) {
  if (access.admin) return true;
  if (typeof area !== 'string' || !area.trim()) return false;
  const key = keyFor(area, sub);
  return !list(access.collaborator?.excludedSubcategories).includes(key)
    && (list(access.collaborator?.allowedCategories).includes(area)
      || Boolean(cleanSubcategory(sub)) && list(access.collaborator?.allowedSubcategories).includes(key));
}

const canReadExpenseArea = (access, collectionName, item) => !!item && (
  collectionName === 'budgetItems' && (item.subcategory ? canReadArea(access, item.area, item.subcategory) : fullArea(access, item.area))
  || collectionName === 'areaExpenses' && canReadArea(access, item.area, item.subcategory)
);
const canReadExpense = (access, collectionName, item) => canReadTab(access, ...(collectionName === 'budgetItems' ? budgetTabs : areaTabs))
  && canReadExpenseArea(access, collectionName, item);
const canEditAreaExpense = (access, item) => !!item && (access.admin
  || hasAreaEditGrant(access) && canReadExpenseArea(access, 'areaExpenses', item));
const canReadDocumentArea = (access, item) => !!item && (
  access.admin || !!item.area && item.area !== 'General'
    && (item.subcategory ? canReadArea(access, item.area, item.subcategory) : fullArea(access, item.area))
);

const canReadDocument = (access, item) => canReadTab(access, 'documentos') && canReadDocumentArea(access, item);

function assignedAreaNames({ collaborator, project }) {
  const parentAreas = list(collaborator?.allowedCategories).filter(area => typeof area === 'string' && area.trim());
  const subAreas = new Set(list(collaborator?.allowedSubcategories).filter(key => typeof key === 'string' && key.includes('||'))
    .map(key => key.split('||')[0]).filter(Boolean));
  // Retain the stored spelling of categories in older projects.
  const storedAreas = [...list(project?.categories), ...list(project?.activeAreas)]
    .filter(area => typeof area === 'string' && subAreas.has(area.trim()));
  return [...new Set([...parentAreas, ...subAreas, ...storedAreas])];
}

module.exports = { deny, projectTabs, canReadTab, fullArea, canReadArea, canReadExpenseArea, canReadExpense, canEditAreaExpense, canReadDocumentArea, canReadDocument, hasAreaEditGrant, assignedAreaNames };
