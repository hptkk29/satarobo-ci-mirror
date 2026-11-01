#!/usr/bin/env node
// scripts/ai-lead/chay-contract-http.mjs — CHẠY PROVIDER CONTRACT CỦA AI LEAD GATEWAY QUA HTTP THẬT (L1 phía Admin).
//
// Làm gì: tạo một DB NHÁP riêng (tên bắt đầu `satarobo_test_ailead_http_`), migrate, mở cổng PROD trong DB nháp, dựng `next` THẬT trỏ vào nó, rồi chạy
//   · lượt 1 (server giả lập TEST/preview): tests/ai-lead/provider-contract.spec.ts (phát lại MỌI fixture của gói bàn giao) + provider-contract-http.spec.ts (ca chỉ-HTTP, bộ ký ĐỘC LẬP);
//   · lượt 2 (server giả lập PROD: VERCEL_ENV=production): chỉ ca [AIL-HTTP-FIX03] — Agent TEST trên máy chủ PROD bị 401 AGENT_DISABLED.
// Xong (kể cả lỗi) luôn tắt server và XOÁ DB nháp.
//
// An toàn: CHỈ tạo/xoá DB do chính script đặt tên (tiền tố ở trên + pid). KHÔNG bao giờ chạm satarobo_local / satarobo_test / ci_test / DB của người khác.
// Cấu hình: ADMIN_DB_URL (mặc định postgresql://postgres:postgres@127.0.0.1:5432/postgres) · AI_LEAD_HTTP_PORT (mặc định 3197) · AI_LEAD_HTTP_MODE=dev|start (mặc định dev; `start` đòi đã `pnpm build`).
// Không bí mật thật nào ở đây: khoá gốc là chuỗi TEST công khai, trùng với tests/ai-lead/_nen.ts.
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { setTimeout as nghi } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const ADMIN_DB = process.env.ADMIN_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const CONG = Number(process.env.AI_LEAD_HTTP_PORT ?? 3197);
const CHE_DO = process.env.AI_LEAD_HTTP_MODE ?? "dev";
const TEN_DB = `satarobo_test_ailead_http_${process.pid}`;
const URL_DB = ADMIN_DB.replace(/\/[^/?]*(\?|$)/, `/${TEN_DB}$1`);
const MASTER_TEST = "master-key-test-ai-lead-db-0123456789abcdef-xyz"; // trùng tests/ai-lead/_nen.ts (chuỗi TEST công khai)
const BASE = `http://127.0.0.1:${CONG}`;
const LA_WINDOWS = process.platform === "win32";

if (!/^satarobo_test_ailead_http_\d+$/.test(TEN_DB)) throw new Error("tên DB nháp không hợp lệ");

const envChung = {
  ...process.env,
  DATABASE_URL: URL_DB,
  DIRECT_URL: URL_DB,
  TEST_DATABASE_URL: URL_DB,
  AI_LEAD_GATEWAY_ENABLED: "true",
  AI_LEAD_AGENT_MASTER_KEY: MASTER_TEST,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "ci-build-only-secret-do-not-use-in-prod-32chars",
  AUTH_SECRET: process.env.AUTH_SECRET ?? "ci-build-only-secret-do-not-use-in-prod-32chars",
  NEXTAUTH_URL: BASE,
  NEXT_PUBLIC_APP_URL: BASE,
};

const chay = (lenh, tham, env, opts = {}) =>
  spawnSync(lenh, tham, { env, stdio: "inherit", shell: LA_WINDOWS, ...opts });

let maThoat = 1;
let server = null;

function tatServer() {
  if (!server) return;
  try {
    if (LA_WINDOWS) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-server.pid, "SIGTERM");
  } catch {
    /* đã tắt */
  }
  server = null;
}

async function sanSang() {
  for (let i = 0; i < 180; i++) {
    try {
      const r = await fetch(`${BASE}/api/ai-lead-agent/v1/catalog`);
      const ct = r.headers.get("content-type") ?? "";
      const j = ct.includes("json") ? await r.json().catch(() => null) : null;
      if (i % 15 === 0) console.log(`[ai-lead-http] thăm dò #${i}: ${r.status} ${ct} ${j ? JSON.stringify(j).slice(0, 120) : ""}`);
      // Request KHÔNG ký ⇒ 400/401 + khung JSON `{ok:false}` = route có + cờ BẬT; 404 + JSON = cờ TẮT; 200 + HTML = sai đường dẫn (CLAUDE.md luật 12).
      if ((r.status === 400 || r.status === 401) && j && j.ok === false) return;
      if (r.status === 404 && j) throw new Error("Cổng AI Lead trả 404 JSON: cờ AI_LEAD_GATEWAY_ENABLED chưa có hiệu lực ở server");
    } catch (e) {
      if (String(e?.message ?? "").startsWith("Cổng AI Lead")) throw e;
    }
    await nghi(1000);
  }
  throw new Error("Server không sẵn sàng sau 180 giây");
}

async function batServer(vercelEnv) {
  const tham = CHE_DO === "start" ? ["exec", "next", "start", "-p", String(CONG)] : ["exec", "next", "dev", "-p", String(CONG)];
  server = spawn("pnpm", tham, { env: { ...envChung, VERCEL_ENV: vercelEnv }, stdio: "inherit", shell: LA_WINDOWS, detached: !LA_WINDOWS });
  await sanSang();
  await lamNong();
}

/**
 * LÀM NÓNG mọi đường mà bộ test chạm (không ký, bỏ kết quả): `next dev` biên dịch từng route ở lần gọi ĐẦU, mất tới hàng chục giây dưới tải; để việc đó rơi vào trong một ca (trần 60 s) là nguồn flake
 * đã đo (hai lần đỏ `Test timed out` ngay sau các cổng nặng, xanh khi chạy lại trên máy rảnh). Làm nóng KHÔNG thay đổi điều bộ test khẳng định — chỉ dời chi phí biên dịch ra ngoài ca.
 */
const DUONG_LAM_NONG = [
  "/api/ai-lead-agent/v1/catalog", "/api/ai-lead-agent/v1/lead-intakes", "/api/ai-lead-agent/v1/handoffs", "/api/ai-lead-agent/v1/incidents", "/api/ai-lead-agent/v1/heartbeats",
  "/api/ai-lead-agent", "/api/ai-lead-agent/v1", "/api/ai-lead-agent/v2/catalog", "/api/ai-lead-agent/v1/leads", "/api/ai-lead-agent/v1/%2e%2e/leads", "/api/ai-lead", "/api/leads", "/api/admin/leads", "/ai-lead", "/admin/ai-lead",
];
async function lamNong() {
  const t0 = Date.now();
  for (const duong of DUONG_LAM_NONG) {
    for (const method of ["GET", "POST"]) {
      try {
        await fetch(`${BASE}${duong}`, { method, ...(method === "POST" ? { body: "{}", headers: { "content-type": "application/json" } } : {}), redirect: "manual", signal: globalThis.AbortSignal.timeout(240_000) });
      } catch {
        /* lỗi mạng khi làm nóng không phải điều cần khẳng định */
      }
    }
  }
  console.log(`[ai-lead-http] làm nóng ${DUONG_LAM_NONG.length} đường × 2 phương thức: ${Math.round((Date.now() - t0) / 1000)} giây`);
}

async function main() {
  const admin = new PrismaClient({ datasourceUrl: ADMIN_DB });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEN_DB}"`);
    console.log(`[ai-lead-http] DB nháp: ${TEN_DB}`);
    const m = chay("pnpm", ["exec", "prisma", "migrate", "deploy"], envChung);
    if (m.status !== 0) throw new Error("prisma migrate deploy lỗi");

    // Mở cổng PROD trong DB nháp để fixture 97 (agent PROD) tới được bước 13; server đọc cài đặt từ DB nên không cần vi.mock.
    const nhap = new PrismaClient({ datasourceUrl: URL_DB });
    for (const [key, valueJson] of [["ai.prodEnabled", true], ["ai.consentPolicyStatus", "APPROVED"]]) {
      await nhap.systemSetting.upsert({ where: { key }, update: { valueJson }, create: { key, valueJson, updatedByName: "chay-contract-http" } });
    }
    await nhap.$disconnect();

    const vitest = (extra, env) =>
      chay("pnpm", ["exec", "vitest", "run", "-c", "vitest.db.config.ts", ...extra], { ...envChung, ...env, AI_LEAD_HTTP_BASE: BASE });

    // ── Lượt 1: server TEST/preview ──
    await batServer("preview");
    const l1 = vitest(["tests/ai-lead/provider-contract.spec.ts", "tests/ai-lead/provider-contract-http.spec.ts", "tests/ai-lead/smoke-goi-ban-giao.spec.ts"], {});
    tatServer();
    if (l1.status !== 0) throw new Error("lượt 1 (server TEST) đỏ");

    // ── Lượt 2: server giả lập PROD ──
    await batServer("production");
    const l2 = vitest(["tests/ai-lead/provider-contract-http.spec.ts", "-t", "AIL-HTTP-FIX03"], { AI_LEAD_HTTP_SERVER_PROD: "1" });
    tatServer();
    if (l2.status !== 0) throw new Error("lượt 2 (server PROD) đỏ");
    maThoat = 0;
  } finally {
    tatServer();
    try {
      await admin.$executeRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEN_DB}'`);
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEN_DB}"`);
      console.log(`[ai-lead-http] đã xoá DB nháp ${TEN_DB}`);
    } catch (e) {
      console.error(`[ai-lead-http] KHÔNG xoá được DB nháp ${TEN_DB}: ${e?.message ?? e}`);
    }
    await admin.$disconnect();
  }
}

main()
  .catch((e) => {
    console.error(`[ai-lead-http] LỖI: ${e?.message ?? e}`);
  })
  .finally(() => process.exit(maThoat));
