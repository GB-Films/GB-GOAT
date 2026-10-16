export function ProjectCommercialSummary({ project, isProjectAdmin }: { project: any; isProjectAdmin: boolean }) {
  // Defense in depth: protected fields are hydrated from an admin-only record.
  if (!isProjectAdmin) return null;
  const contracts = [
    Number(project.controlTotalContractArs) > 0 ? `ARS ${Number(project.controlTotalContractArs).toLocaleString('es-AR')}` : '',
    Number(project.controlTotalContractUsd) > 0 ? `USD ${Number(project.controlTotalContractUsd).toLocaleString('es-AR')}` : '',
  ].filter(Boolean).join(' + ');
  const legacyContract = project.controlTotalContractCurrency && project.controlTotalContractAmount != null
    ? `${project.controlTotalContractCurrency} ${Number(project.controlTotalContractAmount).toLocaleString('es-AR')}` : '';
  return <div aria-label="Datos comerciales del proyecto" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
    {project.projectCode && <span className="font-bold">{project.projectCode}</span>}
    {project.clientName && <span>Cliente: {project.clientName}</span>}
    {project.brandName && <span>Marca: {project.brandName}</span>}
    {project.companyName && <span>Empresa: {project.companyName}</span>}
    {project.serviceName && <span>Servicio: {project.serviceName}</span>}
    {(contracts || legacyContract) && <span>Contrato al importar: {contracts || legacyContract}</span>}
    {project.controlTotalUrl && <a href={project.controlTotalUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Ver en Control Total</a>}
  </div>;
}
