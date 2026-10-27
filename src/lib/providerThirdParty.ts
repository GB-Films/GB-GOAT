export const emptyThirdParty = { name: "", relationship: "", activity: "", cuit: "", holder: "", cbu: "", alias: "" };
export type ThirdPartyDraft = typeof emptyThirdParty;
export type ThirdPartyCapture = { draft: ThirdPartyDraft; open: boolean; enabled: boolean };
export type ThirdPartyCaptureAction = { type: "open" | "close" | "save" | "own" | "changeType" } | { type: "edit"; draft: ThirdPartyDraft };
export const initialThirdPartyCapture: ThirdPartyCapture = { draft: emptyThirdParty, open: false, enabled: false };
export function thirdPartyCapture(state: ThirdPartyCapture, action: ThirdPartyCaptureAction): ThirdPartyCapture {
  switch (action.type) {
    case "open": return { ...state, open: true };
    case "close": return { ...state, open: false };
    case "edit": return { ...state, draft: action.draft };
    case "save": return Object.keys(thirdPartyDraftErrors(state.draft)).length ? state : { ...state, enabled: true, open: false };
    case "own": return { ...state, enabled: false };
    case "changeType": return { ...state, enabled: false, open: false };
  }
}
export function providerFiscalErrors(values: { type: string; cuit: string; bankAccount_cbu: string; bankAccount_alias: string }, useThirdParty: boolean, draft: ThirdPartyDraft, duplicateCuit = false) {
  const errors: Partial<Record<"cuit" | "bankAccount" | "bankAccount_cbu" | "thirdParty", string>> = {};
  const exception = useThirdParty && values.type === "persona";
  const cuit = values.cuit.replace(/\D/g, "");
  if (!cuit && !exception) errors.cuit = "Falta completar este campo obligatorio.";
  else if (cuit && cuit.length !== 11) errors.cuit = "El CUIT/CUIL debe tener 11 números.";
  else if (duplicateCuit && cuit) errors.cuit = "Ya existe un proveedor registrado con este CUIT/CUIL.";
  if (!values.bankAccount_cbu.trim() && !values.bankAccount_alias.trim() && !exception) errors.bankAccount = "Completá al menos un CBU o un Alias.";
  else if (values.bankAccount_cbu && !/^\d{22}$/.test(values.bankAccount_cbu.replace(/\D/g, ""))) errors.bankAccount_cbu = "El CBU debe tener exactamente 22 números consecutivos.";
  if (useThirdParty && values.type !== "persona") errors.thirdParty = "Esta alternativa es sólo para personas físicas.";
  else if (exception && Object.keys(thirdPartyDraftErrors(draft)).length) errors.thirdParty = "Revisá los datos de quien va a facturar.";
  return errors;
}
export function thirdPartyDraftErrors(draft: ThirdPartyDraft): Partial<Record<keyof ThirdPartyDraft, string>> {
  const errors: Partial<Record<keyof ThirdPartyDraft, string>> = {};
  const limits = { name: 160, relationship: 300, activity: 500, cuit: 30, holder: 160, cbu: 22, alias: 100 };
  for (const key of ["name", "relationship", "activity", "cuit", "holder"] as const) if (!draft[key].trim()) errors[key] = "Completá este dato.";
  for (const key of Object.keys(limits) as (keyof ThirdPartyDraft)[]) if (draft[key].length > limits[key]) errors[key] = `Usá hasta ${limits[key]} caracteres.`;
  if (draft.cuit && !/^\d{11}$/.test(draft.cuit.replace(/\D/g, ""))) errors.cuit = "El CUIT debe tener 11 números.";
  if (!draft.cbu.trim() && !draft.alias.trim()) errors.cbu = "Ingresá un CBU/CVU o alias del tercero.";
  if (draft.cbu && !/^\d{22}$/.test(draft.cbu)) errors.cbu = "El CBU/CVU debe tener 22 números.";
  return errors;
}
