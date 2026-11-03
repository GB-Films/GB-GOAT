import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderAdministrationControls } from './ProviderAdministrationPanel';
const render=(active:boolean,canEnable=true,busy=false)=>renderToStaticMarkup(createElement(ProviderAdministrationControls,{state:{providerId:'institution',active,canEnable,contactEmail:'staff@example.test'},email:'staff@example.test',onEmail(){},busy,onSave(){}}));
test('administrative classification clearly separates internal contact from company representation',()=>{
  const html=render(true);
  for(const copy of ['Ficha administrativa · no requiere alta','Contacto interno','no habilita a representar','Volver a alta por proveedor','no asigna cuentas ni permisos']) assert.ok(html.includes(copy),copy);
  assert.doesNotMatch(html,/Revisar y firmar|Declaración aplicada|Alta completada|Aprobar/);
  assert.match(render(true,true,true),/fieldset disabled/);
});
test('classification must be selected explicitly and existing personal intakes are not silently replaced',()=>{
  assert.match(render(false),/Usar ficha administrativa/);
  assert.doesNotMatch(render(false,false),/Usar ficha administrativa|type="email"/);
  assert.match(render(false,false),/ya tiene un alta propia/);
});
