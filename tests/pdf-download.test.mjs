import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("PDF export downloads a real PDF without opening the print dialog", async () => {
  const [dashboard, exporter, regularFont, boldFont, fontLicense] =
    await Promise.all([
      readFile(new URL("app/dashboard-client.tsx", projectRoot), "utf8"),
      readFile(new URL("app/lib/pdf-report.ts", projectRoot), "utf8"),
      readFile(new URL("public/fonts/NotoSans-Regular.ttf", projectRoot)),
      readFile(new URL("public/fonts/NotoSans-Bold.ttf", projectRoot)),
      readFile(new URL("public/fonts/OFL.txt", projectRoot), "utf8"),
    ]);

  assert.match(dashboard, /"Tải PDF"/);
  assert.match(exporter, /anchor\.download = filename/);
  assert.match(exporter, /createPdf\(definition\)\.getBlob/);
  assert.doesNotMatch(`${dashboard}\n${exporter}`, /window\.print\s*\(/);
  assert.equal(regularFont.subarray(0, 4).toString("hex"), "00010000");
  assert.equal(boldFont.subarray(0, 4).toString("hex"), "00010000");
  assert.match(fontLicense, /SIL OPEN FONT LICENSE Version 1\.1/);
});
