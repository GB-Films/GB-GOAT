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
const canReadDocument = (access, item) => !!item && canReadTab(access, 'documentos') && (
  access.admin || !!item.area && item.area !== 'General'
    && (item.subcategory ? canReadArea(access, item.area, item.subcategory) : fullArea(access, item.area))
);

module.exports = { deny, projectTabs, canReadTab, fullArea, canReadArea, canReadExpenseArea, canReadExpense, canReadDocument };
