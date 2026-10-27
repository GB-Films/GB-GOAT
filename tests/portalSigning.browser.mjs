// Start Vite on port 3000; PLAYWRIGHT_MODULE can point to the bundled runtime.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
await mkdir("test-results/portal-signing", { recursive: true });
const base = process.env.PORTAL_TEST_BASE || "http://127.0.0.1:3000";
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/tests/fixtures/portal-signing.html`);
    const viewer = page.getByTestId("pdf-viewport");
    await page.waitForFunction(() => document.querySelector('[data-testid="pdf-viewport"]')?.getAttribute("aria-busy") === "false");
    assert.equal(await page.locator('[data-signature-field-id="other"]').count(), 0);
    const geometry = await page.evaluate(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }; };
      const canvas = document.querySelector(".portal-pdf-sheet canvas");
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      return { viewer: box(".portal-pdf-viewport"), sheet: box(".portal-pdf-sheet"), details: box(".portal-sign-details"), document: box(".portal-sign-document"), overflow: document.documentElement.scrollWidth > innerWidth, painted: pixels.some((n, i) => i % 4 !== 3 && n < 100) };
    });
    assert.equal(geometry.overflow, false);
    assert.equal(geometry.painted, true, "PDF contains rendered text");
    assert.ok(geometry.sheet.width <= geometry.viewer.width - 30);
    assert.ok(geometry.sheet.height <= geometry.viewer.height - 30);
    if (viewport.width > 900) {
      assert.ok(geometry.viewer.height > viewport.height * .65, "document uses most of the screen height");
      assert.ok(geometry.details.x >= geometry.document.right - 1, "form is to the right");
    } else assert.ok(geometry.details.y >= geometry.document.y + geometry.document.height - 1, "form is below PDF on mobile");
    await page.screenshot({ path: `test-results/portal-signing/${viewport.width}-initial.png` });
    assert.equal(await page.locator("[data-pdf-page]").count(), 2, "all pages have continuous space in the viewer");
    const viewerBox = await viewer.boundingBox();
    await page.mouse.move(viewerBox.x + viewerBox.width / 2, viewerBox.y + viewerBox.height / 2);
    await page.mouse.wheel(0, geometry.sheet.height + 20);
    await page.getByText("Página 2 de 2", { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-pdf-page="2"]').getAttribute("aria-busy") === "false");
    assert.ok(await viewer.evaluate(el => el.scrollTop) > 100, "wheel scroll reaches the second page");
    assert.equal(await page.locator('[data-signature-field-id="second"]').getAttribute("aria-pressed"), "false");
    await page.screenshot({ path: `test-results/portal-signing/${viewport.width}-scrolled.png` });
    await page.getByRole("button", { name: "Página anterior", exact: true }).click();
    await page.getByText("Página 1 de 2", { exact: true }).waitFor();
    await viewer.focus();
    await page.keyboard.press("End");
    await page.getByText("Página 2 de 2", { exact: true }).waitFor();
    await page.keyboard.press("Home");
    await page.getByText("Página 1 de 2", { exact: true }).waitFor();
    const initialWidth = geometry.sheet.width;
    await page.getByRole("button", { name: "Acercar documento", exact: true }).click();
    await page.waitForFunction(initial => document.querySelector(".portal-pdf-sheet").getBoundingClientRect().width > initial * 1.2 && document.querySelector('[data-testid="pdf-viewport"]').getAttribute("aria-busy") === "false", initialWidth);
    await page.getByLabel("Ajuste del documento", { exact: true }).selectOption("width");
    await page.waitForFunction(() => document.querySelector('[data-testid="pdf-viewport"]').getAttribute("aria-busy") === "false");
    await page.getByLabel("Ajuste del documento", { exact: true }).selectOption("page");
    await page.waitForFunction(initial => Math.abs(document.querySelector(".portal-pdf-sheet").getBoundingClientRect().width - initial) < 1 && document.querySelector('[data-testid="pdf-viewport"]').getAttribute("aria-busy") === "false", initialWidth);
    const submit = page.getByRole("button", { name: "Firmar y confirmar" });
    await page.getByLabel("DNI", { exact: true }).fill("12.345.678");
    await page.getByLabel("Confirmo que el DNI ingresado me corresponde.", { exact: true }).check();
    await page.getByRole("button", { name: "Usar mi nombre", exact: true }).click();
    await page.getByLabel("Leí el documento", { exact: false }).check();
    assert.equal(await submit.isDisabled(), true, "explicit field click is required");
    await page.getByLabel("Ir a mi recuadro de firma", { exact: true }).selectOption("second");
    await page.waitForFunction(() => document.querySelector('[data-signature-field-id="second"]')?.getBoundingClientRect().width > 0);
    assert.equal(await submit.isDisabled(), true, "navigation does not select a field");
    await page.getByRole("button", { name: "Página anterior", exact: true }).click();
    await viewer.scrollIntoViewIfNeeded();
    const readBox = await viewer.boundingBox();
    await page.mouse.move(readBox.x + readBox.width / 2, readBox.y + readBox.height / 2);
    await page.mouse.wheel(0, geometry.sheet.height + 20);
    await page.getByText("Página 2 de 2", { exact: true }).waitFor();
    await page.locator('[data-signature-field-id="second"]').click();
    assert.equal(await submit.isEnabled(), true);
    await page.getByLabel("DNI", { exact: true }).fill("23.456.789");
    assert.equal(await page.getByLabel("Confirmo que el DNI ingresado me corresponde.", { exact: true }).isChecked(), false);
    assert.equal(await submit.isDisabled(), true);
    await page.getByLabel("Confirmo que el DNI ingresado me corresponde.", { exact: true }).check();
    await page.getByRole("button", { name: "Dibujar firma", exact: true }).click();
    assert.equal(await submit.isDisabled(), true, "blank pad cannot be signed");
    const pad = page.getByLabel("Dibujá tu firma", { exact: true });
    await pad.scrollIntoViewIfNeeded();
    let padBox = await pad.boundingBox();
    await page.mouse.click(padBox.x + 20, padBox.y + 20);
    assert.equal(await submit.isDisabled(), true, "a tap does not save a blank PNG");
    await page.mouse.move(padBox.x + 20, padBox.y + 40); await page.mouse.down();
    await page.mouse.move(padBox.x + 100, padBox.y + 75, { steps: 10 }); await page.mouse.up();
    assert.equal(await submit.isEnabled(), true);
    await page.getByRole("button", { name: "Usar mi nombre", exact: true }).click();
    await page.getByRole("button", { name: "Dibujar firma", exact: true }).click();
    assert.equal(await submit.isEnabled(), true, "signature survives switching modes");
    if (viewport.width === 1440) {
      await page.getByRole("button", { name: "Usar mi nombre", exact: true }).click();
      await page.getByLabel("Nombre para la firma", { exact: true }).fill("");
      assert.equal(await submit.isDisabled(), true);
      await page.getByLabel("Nombre para la firma", { exact: true }).fill("Persona de prueba");
    }
    await submit.click();
    await page.waitForFunction(() => window.submissions.length === 1);
    const [signed] = await page.evaluate(() => window.submissions);
    assert.equal(signed.fieldId, "second", "selected second field reaches the signing payload");
    assert.equal(signed.dni, "23456789");
    assert.equal(signed.signatureType, viewport.width === 1440 ? "typed" : "drawn");
    if (signed.signatureType === "drawn") assert.ok(signed.signatureImage.startsWith("data:image/png;base64,"));
    else { assert.equal(signed.typedName, "Persona de prueba"); assert.equal(signed.signatureImage, ""); }
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}x${viewport.height}: continuous wheel/keyboard scrolling, zoom, field selection, DNI, pad and exact payload`);
    await page.close();
  }
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/tests/fixtures/portal-signing.html?long`);
    await page.waitForFunction(() => document.querySelector('[data-testid="pdf-viewport"]')?.getAttribute("aria-busy") === "false");
    const viewer = page.getByTestId("pdf-viewport");
    await viewer.focus(); await page.keyboard.press("End");
    await page.getByText("Página 8 de 8", { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-pdf-page="8"]').getAttribute("aria-busy") === "false" && document.querySelector('[data-pdf-page="1"] canvas').width === 0);
    assert.ok(await page.locator(".portal-pdf-sheet canvas").evaluateAll(canvases => canvases.filter(c => c.width > 0).length) < 5, "distant pages release their canvas memory");
    await page.keyboard.press("Home");
    await page.getByText("Página 1 de 8", { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-pdf-page="1"]').getAttribute("aria-busy") === "false");
    assert.equal(await page.locator('[data-signature-field-id="first"]').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log("PASS eight pages: scrolling to the end and back restores released pages and signing fields");
    await page.close();
  }
  for (const query of ["broken", "foreign"]) {
    const page = await browser.newPage();
    await page.goto(`${base}/tests/fixtures/portal-signing.html?${query}`);
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("button", { name: "Firmar y confirmar" }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.submissions.length), 0);
    console.log(`PASS ${query}: signing blocked`);
    await page.close();
  }
} finally { await browser.close(); }
