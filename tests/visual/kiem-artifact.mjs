#!/usr/bin/env node
// Khói: mở từng trang artifact qua máy chủ :4800 và báo trang nào KHÔNG dựng được (runtime lỗi, trống, ảnh thiếu).
//   node tests/visual/kiem-artifact.mjs [Main,About,...]
/* global window, document */
import { chromium } from "@playwright/test";
import { startArtifactServer, listPages } from "./artifact-server.mjs";

const only = process.argv[2] ? process.argv[2].split(",") : null;
const srv = await startArtifactServer({ port: 4802, quiet: true });
const browser = await chromium.launch();
let bad = 0;
for (const name of listPages().filter((n) => !only || only.includes(n))) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => (window.__sataLite = true));
  const page = await ctx.newPage();
  const errs = [];
  const miss = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  page.on("response", (r) => r.headers()["x-harness-missing"] && miss.push(r.url().slice(-32)));
  try {
    await page.goto(`${srv.url}/${name}.dc.html`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => document.querySelector("#dc-root")?.children.length > 0, null, { timeout: 20000 });
    await page.waitForTimeout(600);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    const sv = await page.evaluate(() => document.querySelectorAll(".sv").length);
    const ok = h > 600 && !errs.length;
    if (!ok) bad++;
    console.log(`${ok ? "OK " : "LỖI"} ${name.padEnd(48)} cao ${String(h).padStart(6)}  .sv=${String(sv).padStart(3)}  ảnh-thiếu=${miss.length}${errs.length ? "  lỗi JS: " + errs[0] : ""}`);
  } catch (e) {
    bad++;
    console.log(`LỖI ${name.padEnd(48)} ${String(e).slice(0, 120)}`);
  }
  await ctx.close();
}
await browser.close();
await srv.close();
process.exit(bad ? 1 : 0);
