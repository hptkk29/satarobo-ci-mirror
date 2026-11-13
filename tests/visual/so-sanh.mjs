#!/usr/bin/env node
/* global window, document, fetch, URL, setTimeout, getComputedStyle, requestAnimationFrame, localStorage */
// So pixel bản artifact (máy chủ tĩnh :4800) với bản Next.js (:3000).
//
//   node tests/visual/so-sanh.mjs <TênTrangArtifact> <routeNext> [--theme light|dark] [--w 1440|390] [--fold]
//   node tests/visual/so-sanh.mjs --all [--only Main,About] [--theme ..] [--w ..]
//   node tests/visual/so-sanh.mjs --list
//
// Mặc định: cả sáng + tối × 1440 + 390, ảnh TOÀN TRANG (`--full` chỉ là bí danh rõ nghĩa; `--fold` = chỉ màn hình đầu).
// Tuỳ chọn khác: --next <URL> (mặc định http://localhost:3000) · --art <URL> (mặc định http://localhost:4800, tự bật
// nếu chưa chạy) · --props k=v,k=v (đặt prop cho trang artifact, vd manHinh=banNhap) · --threshold 0.5 · --out <thư mục>
// Thoát 1 nếu có cặp lệch > ngưỡng, còn `.sv` kẹt, tràn ngang, hoặc không chụp được.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { PAGES } from "./pages.mjs";
import { startArtifactServer } from "./artifact-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- tham số ----------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const VALUE_FLAGS = new Set(["--theme", "--w", "--next", "--art", "--props", "--threshold", "--out", "--only"]);
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    if (VALUE_FLAGS.has(argv[i])) i++;
    continue;
  }
  positional.push(argv[i]);
}

if (flag("--list")) {
  console.log(Object.keys(PAGES).join("\n"));
  process.exit(0);
}

const NEXT = opt("--next", "http://localhost:3000").replace(/\/$/, "");
let ART = opt("--art", "http://localhost:4800").replace(/\/$/, "");
const THEMES = opt("--theme") ? [opt("--theme")] : ["light", "dark"];
const WIDTHS = opt("--w") ? [Number(opt("--w"))] : [1440, 390];
const FOLD = flag("--fold");
const THRESHOLD = Number(opt("--threshold", "0.5"));
const OUT = path.resolve(opt("--out", path.join(HERE, "out")));
const PROPS = Object.fromEntries((opt("--props", "") || "").split(",").filter(Boolean).map((kv) => kv.split("=")));
const HEIGHT = { 1440: 900, 390: 844 };

let jobs;
if (flag("--all")) {
  const only = opt("--only") ? new Set(opt("--only").split(",")) : null;
  jobs = Object.entries(PAGES).filter(([n]) => !only || only.has(n)).map(([art, route]) => ({ art, route }));
} else {
  if (positional.length < 2) {
    console.error("Cách dùng: so-sanh.mjs <TênTrangArtifact> <routeNext> [--theme light|dark] [--w 1440|390] [--fold]\n           so-sanh.mjs --all [--only a,b]   |   so-sanh.mjs --list");
    process.exit(2);
  }
  // Git Bash đổi "/x" thành "C:/Program Files/Git/x" nếu thiếu MSYS_NO_PATHCONV=1: gỡ lại cho khỏi vấp.
  const route = positional[1].replace(/^[A-Za-z]:[/\\]+Program Files[/\\]+Git/i, "") || "/";
  jobs = [{ art: positional[0], route: route.startsWith("/") ? route : "/" + route }];
}

// ---------- thư viện so pixel ----------
let PNG, pixelmatch;
try {
  ({ PNG } = await import("pngjs"));
  pixelmatch = (await import("pixelmatch")).default;
} catch {
  console.error("Thiếu pixelmatch/pngjs: chạy `pnpm add -D pixelmatch pngjs` (qua cổng gate.sh).");
  process.exit(2);
}

// ---------- đảm bảo máy chủ artifact ----------
function portOpen(url) {
  const u = new URL(url);
  return new Promise((res) => {
    const s = net.connect(Number(u.port || 80), u.hostname, () => (s.destroy(), res(true)));
    s.on("error", () => res(false));
    s.setTimeout(1500, () => (s.destroy(), res(false)));
  });
}
let ownServer = null;
if (!(await portOpen(ART))) {
  ownServer = await startArtifactServer({ port: Number(new URL(ART).port || 4800), quiet: true });
}

// ---------- chụp ----------
// Cùng MỘT đoạn init cho cả hai bên: mọi nguồn ngẫu nhiên / hẹn giờ dài đều bị khoá.
function initScript(cfg) {
  const seed = (s) => () => ((s = (s + 0x6d2b79f5) | 0), (s = Math.imul(s ^ (s >>> 15), s | 1)), (s ^= s + Math.imul(s ^ (s >>> 7), s | 61)), ((s ^ (s >>> 14)) >>> 0) / 4294967296);
  Math.random = seed(20261102);
  const st = window.setTimeout.bind(window);
  // popup đặt lịch 20 s / 60 s, banner hẹn giờ dài: không cho chạy
  window.setTimeout = (fn, ms, ...a) => (Number(ms) >= 15000 ? 0 : st(fn, ms, ...a));
  window.__sataLite = true; // cả hai bên chỉ hiện poster, không tải 3D
  try {
    localStorage.setItem("sata-theme", cfg.theme);
    localStorage.setItem("auth-theme", cfg.theme);
    localStorage.setItem("satarobo:consent:v1", JSON.stringify({ version: "2026-05-17", acceptedAt: "2026-11-02T00:00:00.000Z", categories: { necessary: true, analytics: false, marketing: false } }));
  } catch { /* localStorage bị chặn: bỏ qua */ }
}
const HIDE_CSS = `nextjs-portal,[data-nextjs-toast],[data-nextjs-dialog-overlay],#__next-build-watcher,[data-testid="cookie-consent"],#webpack-dev-server-client-overlay{display:none!important}
html{scroll-behavior:auto!important}`;
const STUCK_SELECTOR = ".sv,.a-mask,.a-flip,.a-slideL,.a-slideR,.a-pop,.a-deal,.a-blur,.a-iris,.a-curtain,.a-tilt,.a-acc,.a-form";

async function captureOnce(browser, url, { theme, w, kind }) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: HEIGHT[w] || 900 },
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
    colorScheme: theme,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
  });
  const info = { status: 0, navigated: 0, errors: [] };
  try {
    await ctx.addInitScript(initScript, { theme });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => info.errors.push(String(e).slice(0, 160)));
    page.on("response", (r) => {
      if (r.url().startsWith("http") && r.status() >= 400 && /\.(png|jpe?g|webp|svg)(\?|$)|_blob|\/_next\/image/.test(r.url())) info.errors.push(`${r.status()} ${r.url().slice(-80)}`);
    });
    await page.clock.setFixedTime(new Date("2026-11-02T10:00:00+07:00"));
    const resp = await page.goto(url, { waitUntil: "load", timeout: 90000 });
    info.status = resp ? resp.status() : 0;
    // `load` chỉ nổ khi TÀI LIỆU tải lại (HMR full reload / redirect), không nổ với pushState/replaceState của router
    page.on("load", () => info.navigated++);
    if (kind === "art") {
      if (Object.keys(PROPS).length) {
        await page.waitForFunction(() => typeof window.__dcRootName === "function" && window.__dcRootName() !== "Root", null, { timeout: 15000 }).catch(() => {});
        await page.evaluate((props) => window.__dcSetProps && window.__dcSetProps(window.__dcRootName(), props), PROPS);
      }
      // runtime canvas dựng nội dung sau khi React tải: chờ có nội dung
      await page.waitForFunction(() => document.querySelector("#dc-root") && document.querySelector("#dc-root").children.length > 0, null, { timeout: 30000 }).catch(() => info.errors.push("runtime artifact không dựng được #dc-root"));
    }
    await page.addStyleTag({ content: HIDE_CSS });
    await page.waitForTimeout(800);
    // ảnh lazy -> eager, rồi cuộn từng đoạn ~600px cho IntersectionObserver gắn data-fx-sv
    await page.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach((i) => (i.loading = "eager")));
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
        window.scrollTo(0, y);
        await sleep(170);
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(300);
    });
    // vòng 2: máy tải nặng có thể làm IntersectionObserver bỏ lỡ phần tử khi cuộn nhanh ⇒ đưa từng phần tử chưa hiện vào giữa màn hình
    await page.evaluate(async (sel) => {
      for (const el of document.querySelectorAll(sel)) {
        if (el.hasAttribute("data-fx-sv")) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        el.scrollIntoView({ block: "center", inline: "nearest" });
        await new Promise((res) => setTimeout(res, 160));
      }
    }, STUCK_SELECTOR);
    await page.waitForTimeout(2200); // count-up / decrypt chạy xong
    const checks = await page.evaluate((sel) => {
      const de = document.documentElement;
      const stuck = [];
      const loops = [];
      for (const el of document.querySelectorAll(sel)) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.display === "none" || cs.visibility === "hidden" || (r.width === 0 && r.height === 0)) continue;
        if (Number(cs.opacity) >= 1) continue;
        const name = ((el.className && String(el.className).slice(0, 40)) || el.tagName) + (el.hasAttribute("data-fx-sv") ? "" : " [chưa được IO gắn data-fx-sv]");
        // Phần tử vẫn đang chạy hoạt ảnh VÔ HẠN (vd `.iri` ghi đè animation-iteration-count của .sv) thì opacity dao động mãi:
        // đó là lỗi CSS của thiết kế chứ không phải "kẹt" — báo riêng dưới dạng cảnh báo.
        const inf = el.getAnimations().some((a) => a.effect && a.effect.getTiming().iterations === Infinity && /^(flipIn|slide|mask|pop|deal|blur|iris|curtain|tilt|acc|form|fade)/i.test(a.animationName || ""));
        (inf ? loops : stuck).push(name);
      }
      return { stuck: stuck.length, stuckSample: stuck.slice(0, 3), loops: loops.length, loopSample: loops.slice(0, 3), overflowX: de.scrollWidth - de.clientWidth, height: de.scrollHeight };
    }, STUCK_SELECTOR);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.evaluate(() => document.fonts && document.fonts.ready);
    // ảnh phải TẢI XONG và GIẢI MÃ xong (decoding=async + máy tải nặng ⇒ ảnh có thể chưa vẽ khi chụp)
    await page.evaluate(async () => {
      const imgs = [...document.images];
      await Promise.all(imgs.map(async (im) => {
        if (!im.complete) await new Promise((r) => { im.addEventListener("load", r, { once: true }); im.addEventListener("error", r, { once: true }); setTimeout(r, 15000); });
        try { await Promise.race([im.decode(), new Promise((r) => setTimeout(r, 8000))]); } catch { /* ảnh lỗi: bỏ qua */ }
      }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await page.waitForTimeout(300);
    const png = await page.screenshot({ fullPage: !FOLD, animations: "disabled", caret: "hide" });
    return { ok: true, png, checks, info };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200), info };
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function capture(browser, url, opts) {
  // Trang tự tải lại giữa lúc chụp (HMR do agent khác sửa mã, hoặc dev server vừa biên dịch) ⇒ chụp lại, tối đa 3 lần.
  let r;
  for (let i = 0; i < 3; i++) {
    r = await captureOnce(browser, url, opts);
    const reloaded = r.ok ? r.info.navigated > 0 : /navigation|context was destroyed/i.test(r.error || "");
    if (!reloaded) return r;
    await new Promise((res) => setTimeout(res, 1500));
  }
  r.unstable = true;
  return r;
}

// ---------- so ----------
function crop(png, w, h) {
  const o = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) png.data.copy(o.data, y * w * 4, y * png.width * 4, y * png.width * 4 + w * 4);
  return o;
}
function compare(bufA, bufB) {
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  const W = Math.max(a.width, b.width), H = Math.max(a.height, b.height);
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const diff = new PNG({ width: W, height: H });
  for (let i = 0; i < diff.data.length; i += 4) { diff.data[i] = 255; diff.data[i + 1] = 0; diff.data[i + 2] = 255; diff.data[i + 3] = 255; } // phần thừa = hồng
  const ca = crop(a, w, h), cb = crop(b, w, h);
  const d = new PNG({ width: w, height: h });
  const common = pixelmatch(ca.data, cb.data, d.data, w, h, { threshold: 0.1 });
  for (let y = 0; y < h; y++) d.data.copy(diff.data, y * W * 4, y * w * 4, y * w * 4 + w * 4);
  const padded = W * H - w * h;
  return { pct: ((common + padded) / (W * H)) * 100, common, padded, art: [a.width, a.height], next: [b.width, b.height], diff: PNG.sync.write(diff) };
}

// ---------- chạy ----------
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const job of jobs) {
    let route = job.route;
    if (route.includes(":first")) {
      const list = route.replace("/:first", "");
      try {
        const html = await (await fetch(NEXT + list)).text();
        const m = new RegExp(`href="(${list}/[^"/?#]+)"`).exec(html);
        route = m ? m[1] : list;
      } catch {
        route = list;
      }
    }
    for (const theme of THEMES) for (const w of WIDTHS) {
      const tag = `${job.art}-${theme}-${w}`;
      const a = await capture(browser, `${ART}/${job.art}.dc.html`, { theme, w, kind: "art" });
      const n = await capture(browser, NEXT + route, { theme, w, kind: "next" });
      const row = { page: job.art, route, theme, w, pct: null, problems: [], warnings: [] };
      if (!a.ok) row.problems.push("artifact: " + a.error);
      if (!n.ok) row.problems.push("next: " + n.error);
      if (a.ok) fs.writeFileSync(path.join(OUT, `${tag}-art.png`), a.png);
      if (n.ok) fs.writeFileSync(path.join(OUT, `${tag}-next.png`), n.png);
      if (a.ok && n.ok) {
        const c = compare(a.png, n.png);
        fs.writeFileSync(path.join(OUT, `${tag}-diff.png`), c.diff);
        Object.assign(row, { pct: c.pct, art: c.art, next: c.next, padded: c.padded });
        if (c.pct > THRESHOLD) row.problems.push(`lệch ${c.pct.toFixed(2)}% > ${THRESHOLD}%`);
        for (const [k, r] of [["artifact", a], ["next", n]]) {
          if (r.checks.stuck) row.problems.push(`${k}: ${r.checks.stuck} phần tử hiện-dần kẹt opacity<1 (${r.checks.stuckSample.join(" | ")})`);
          if (r.checks.overflowX) row.problems.push(`${k}: cuộn ngang ${r.checks.overflowX}px`);
          if (r.checks.loops) row.warnings.push(`${k}: ${r.checks.loops} phần tử hiện-dần LẶP VÔ HẠN (${r.checks.loopSample.join(" | ")})`);
          if (r.unstable) row.problems.push(`${k}: trang tự tải lại khi chụp (không ổn định)`);
        }
        if (n.info.status >= 400 && job.art !== "NotFound") row.problems.push(`next: HTTP ${n.info.status}`);
        row.checks = { art: a.checks, next: n.checks };
        row.errors = { art: a.info.errors.slice(0, 5), next: n.info.errors.slice(0, 5) };
      }
      results.push(row);
      const hs = row.art ? `art ${row.art.join("×")} · next ${row.next.join("×")}` : "";
      console.log(`${job.art.padEnd(34)} ${theme.padEnd(5)} ${String(w).padStart(4)}  ${row.pct == null ? "  —   " : row.pct.toFixed(2).padStart(6) + "%"}  ${row.problems.length ? "✗ " + row.problems.join("; ") : "✓"}${row.warnings.length ? "  ⚠ " + row.warnings.join("; ") : ""}  ${hs}`);
    }
  }
} finally {
  await browser.close();
  if (ownServer) await ownServer.close();
}

// bảng tổng
if (results.length > 1) {
  console.log("\n=== TỔNG (% điểm ảnh lệch; ngưỡng " + THRESHOLD + "%) ===");
  const cols = THEMES.flatMap((t) => WIDTHS.map((w) => `${t}-${w}`));
  console.log("trang".padEnd(34) + cols.map((c) => c.padStart(12)).join(""));
  for (const page of [...new Set(results.map((r) => r.page))]) {
    const cells = cols.map((c) => {
      const r = results.find((x) => x.page === page && `${x.theme}-${x.w}` === c);
      return (r && r.pct != null ? r.pct.toFixed(2) + (r.problems.length ? "*" : "") : "—").padStart(12);
    });
    console.log(page.padEnd(34) + cells.join(""));
  }
  console.log("(* = có vấn đề kèm theo: vượt ngưỡng, .sv kẹt, tràn ngang hoặc lỗi chụp)");
}
fs.writeFileSync(path.join(OUT, "tong-hop.json"), JSON.stringify(results, null, 1));
process.exit(results.some((r) => r.problems.length) ? 1 : 0);
