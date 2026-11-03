import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AccountMenu} from './AccountMenu';

test('desktop and compact account menus identify the current account and offer an explicit logout action',()=>{
  for(const compact of [false,true]){
    const html=renderToStaticMarkup(createElement(AccountMenu,{name:'Persona de prueba',email:'current@example.test',role:'Administrador',compact,onSignOut(){}}));
    assert.match(html,/current@example.test/);
    assert.match(html,/Persona de prueba/);
    assert.match(html,/<button[^>]*>.*Cerrar sesión<\/button>/);
    if(compact) assert.match(html,/<summary[^>]*>.*Cuenta<\/summary>/);
  }
});
test('long account identities remain available in full and markup is escaped',()=>{
  const email='very.long.current.account@example.test';
  const html=renderToStaticMarkup(createElement(AccountMenu,{name:'<Persona>',email,role:'Proveedor',onSignOut(){}}));
  assert.match(html,/title="very.long.current.account@example.test"/);
  assert.match(html,/&lt;Persona&gt;/);
  assert.doesNotMatch(html,/<Persona>/);
});
