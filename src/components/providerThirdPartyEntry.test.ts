import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProviderThirdPartyEntry, ProviderThirdPartyDialog } from "./ProviderThirdPartyDialog";
import { emptyThirdParty } from "../lib/providerThirdParty";
const noop = () => {};
test("only a person sees the billing exception and it never presents capture as authorization", () => {
  const props = { providerType: "persona", enabled: false, name: "Tercero", onOpen: noop, onOwn: noop };
  assert.match(renderToStaticMarkup(createElement(ProviderThirdPartyEntry, props)), /No puedo emitir factura/);
  assert.equal(renderToStaticMarkup(createElement(ProviderThirdPartyEntry, { ...props, providerType: "empresa", enabled: true })), "");
  const saved = renderToStaticMarkup(createElement(ProviderThirdPartyEntry, { ...props, enabled: true, name: "<img src=x>" }));
  assert.match(saved, /pendiente de tu firma y de revisión administrativa/);
  assert.match(saved, /&lt;img src=x&gt;/);
});
test("the dialog presents the saved draft, relationship, activity and separate third-party bank data", () => {
  const markup = renderToStaticMarkup(createElement(ProviderThirdPartyDialog, { draft: { ...emptyThirdParty, name: "Familiar", relationship: "Hermana", activity: "Fotografía", holder: "Titular del tercero" }, onChange: noop, onClose: noop, onSave: noop }));
  for (const text of ['role="dialog"', 'Relación con vos', 'Servicio o actividad', 'CUIT de quien factura', 'Titular de la cuenta del tercero', 'CBU/CVU del tercero', 'value="Hermana"', 'value="Fotografía"']) assert.ok(markup.includes(text), text);
  assert.match(markup, /todavía no autoriza facturación ni pagos/);
});
