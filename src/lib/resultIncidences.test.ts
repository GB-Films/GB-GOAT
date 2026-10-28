import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RESULT_INCIDENCES, resolveResultIncidences } from './resultIncidences';
import { calculateProjectResult } from './projectFinance';

test('proyectos sin configuración usan los cinco porcentajes y el cálculo coincide con Resultado', () => {
  assert.deepEqual(resolveResultIncidences(undefined), { imprevistos: 1, impuestos: 4.5, financiacion: 2, administracion: 8, margen: 10 });
  const result = calculateProjectResult({ budgetTotal: 1000 }, [{ area: 'Producción', total: 500 }], []);
  assert.equal(result.expenseIncidenceTotal, 155);
  assert.equal(result.marginIncidence, 100);
  assert.equal(result.totalCost, 655);
  assert.equal(result.margin, 445);
});

test('conserva porcentajes guardados, incluso cero, y completa los que faltan sin mutar el proyecto', () => {
  const stored = { impuestos: 0, imprevistos: 3, margen: 0 };
  assert.deepEqual(resolveResultIncidences(stored), { imprevistos: 3, impuestos: 0, financiacion: 2, administracion: 8, margen: 0 });
  assert.deepEqual(stored, { impuestos: 0, imprevistos: 3, margen: 0 });
  assert.equal(DEFAULT_RESULT_INCIDENCES.imprevistos, 1);
  assert.equal(calculateProjectResult({ budgetTotal: 1000, resultIncidences: stored }, [], []).expenseIncidenceTotal, 130);
});
