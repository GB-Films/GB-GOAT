// Run with Vite on port 3000. PLAYWRIGHT_MODULE may point to a bundled runtime.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const nested of [false, true]) {
    for (const name of ['Subcategoria', 'Honorarios', 'Post']) {
      const page = await browser.newPage({ viewport: { width: 1298, height: 974 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`http://localhost:3000/tests/fixtures/structure-drag.html${nested ? '?nested' : ''}`);
      const handle = page.getByLabel(`Mover ${name}`, { exact: true });
      await handle.waitFor();
      await handle.evaluate((element, nested) => {
        const top = element.getBoundingClientRect().top - 226;
        if (nested) document.getElementById('scroll-container').scrollTop += top;
        else window.scrollBy(0, top);
      }, nested);
      const scroll = () => page.evaluate(nested => nested ? document.getElementById('scroll-container').scrollTop : window.scrollY, nested);
      const before = await scroll();
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 7, { steps: 3 });
      await page.waitForSelector('[data-dragging="true"]');
      await page.waitForTimeout(150);
      assert.ok(Math.abs(await scroll() - before) < 1, `${name}: scroll changed at lift (${nested})`);
      const dragged = await handle.boundingBox();
      assert.ok(Math.abs(dragged.y - box.y) <= 7, `${name}: pointer offset at lift (${nested}): ${dragged.y - box.y}`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 27);
      await page.waitForTimeout(100);
      const moved = await handle.boundingBox();
      assert.ok(Math.abs(moved.y - dragged.y - 20) < 2, `${name}: drag does not follow pointer (${nested})`);
      await page.mouse.move(box.x + box.width / 2, 960, { steps: 8 });
      await page.waitForTimeout(250);
      assert.ok(Math.abs(await scroll() - before) < 1, `${name}: unwanted edge auto-scroll (${nested})`);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('[data-structure-drag-list]').evaluate(el => el.style.minHeight), '');
      assert.ok(Math.abs(await scroll() - before) < 1, `${name}: scroll changed after cancel (${nested})`);
      // A second gesture must also work, commit its order and release the spacer.
      const repeat = await handle.boundingBox();
      const direction = name === 'Post' ? -1 : 1;
      await page.mouse.move(repeat.x + repeat.width / 2, repeat.y + repeat.height / 2);
      await page.mouse.down();
      await page.mouse.move(repeat.x + repeat.width / 2, repeat.y + repeat.height / 2 + direction * 7, { steps: 3 });
      await page.waitForSelector('[data-dragging="true"]');
      await page.mouse.move(repeat.x + repeat.width / 2, repeat.y + repeat.height / 2 + direction * 65, { steps: 8 });
      await page.waitForTimeout(100);
      await page.mouse.up();
      await page.waitForTimeout(400);
      const order = await page.locator('[data-structure-drag-id]').evaluateAll(elements => elements.map(el => el.dataset.structureDragId));
      assert.equal(order.indexOf(name), ['Subcategoria', 'Honorarios', 'Produccion', 'Post'].indexOf(name) + direction);
      assert.equal(await page.locator('[data-structure-drag-list]').evaluate(el => el.style.minHeight), '');
      assert.deepEqual(errors, []);
      console.log(`PASS ${name}: stable lift, pointer, edge, cancel and reorder; ${nested ? 'nested' : 'window'} scroll`);
      await page.close();
    }
  }
} finally { await browser.close(); }
