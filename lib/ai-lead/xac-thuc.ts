import "server-only";
// lib/ai-lead/xac-thuc.ts — XÁC THỰC một yêu cầu MÁY của cổng AI Lead + vỏ chạy endpoint (idempotency, lỗi lạ).
//
// Nguồn thứ tự: error-codes.md §3 ⇒ `THU_TU_KIEM` (hop-dong.ts) — tệp này PHẢI đi đúng thứ tự đó (lưới [AIL-XT-*] đo từng cặp bước liền kề).
//
//   1  cờ cổng + master key            (404 JSON khi cờ tắt · NOT_CONFIGURED)
//   2  X-AiLead-Contract = 1           (UNSUPPORTED_CONTRACT)
//   3  query · định dạng header        (BAD_REQUEST)
//   4  thân ≤ ai.bodyMaxBytes          (BODY_TOO_LARGE)   ← ĐỨNG TRƯỚC bước 5: đọc thân (có trần) rồi mới xét Content-Type
//   5  POST: Content-Type JSON         (UNSUPPORTED_MEDIA_TYPE)
//   ·  hạn mức theo IP (trước tra DB)  (RATE_LIMITED)
//   6  agent + chữ ký                  (BAD_SIGNATURE — cùng mã, cùng câu cho "agent lạ" và "chữ ký sai")
//   7  lệch giờ ≤ ai.clockSkewMs       (CLOCK_SKEW)
//   8  agent đang bật                  (AGENT_DISABLED)
//   ·  cổng PROD (OD-08)               (NOT_CONFIGURED) — SAU chữ ký/active để người lạ không dò được trạng thái cổng
//   9  hạn mức theo NHÓM endpoint      (RATE_LIMITED)
//   10 nonce                           (NONCE_REUSED) — CHỈ ghi sau 6–9
//   11 JSON strict + zod               (PAYLOAD_INVALID + field)
//   12 environment của heartbeat       (ENVIRONMENT_MISMATCH)
//   13 testRunId trên agent PROD       (TEST_ONLY_FIELD)
//   14 Page ∈ allowlist · Page tạm dừng(PAGE_NOT_ALLOWED · PAGE_PAUSED — PAGE_PAUSED CHỈ /lead-intakes)
//   15 công tắc INCOMPATIBLE           (UNSUPPORTED_CONTRACT — CHỈ /lead-intakes)
//   16 hạn mức theo (agent, psid)      (RATE_LIMITED — CHỈ /lead-intakes)
//   17 idempotency                     (phát lại / IDEMPOTENCY_CONFLICT) — `chayEndpointAgent`
//   18 lỗi lạ                          (TEMP_UNAVAILABLE / INTERNAL_ERROR)
//
// BA ĐIỀU CỐ Ý, đừng "sửa":
//  1. Bước 6 LUÔN tra agent MỘT lần + dẫn xuất/ký HMAC MỘT lần + so `safeEqual` MỘT lần, rồi mới từ chối bằng `!agent || !khop` — agent lạ đi đúng chuỗi lời gọi ấy
//     (khoá GIẢ) nên không phân biệt được với chữ ký sai qua mã, câu, header hay thời gian.
//  2. Nonce ghi SAU chữ ký/giờ/active/PROD/hạn mức: request lạ không đẻ dòng. Khoá chính (agentId, nonce) là cái gác thật (đúng cả khi nhiều tiến trình).
//  3. Chuỗi ký dùng `DUONG_DAN[endpoint]` (hằng hợp đồng), không dùng đường dẫn đọc từ request.
//
// ⚠️ Log CHỈ ghi `requestId` + mã (Prisma code / tên lỗi) — KHÔNG ghi message của lỗi (lỗi Prisma có thể kèm giá trị cột), KHÔNG ghi header/thân/PSID.
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { fail, ok } from "@/lib/api/response";
import { rateLimit } from "@/lib/rate-limit";
import { ipChoRateLimit } from "@/lib/security/client-ip";
import { safeEqual } from "@/lib/security/safe-equal";
import { isAiLeadGatewayEnabled } from "@/lib/flags";
import { agentTestDuocChayTrenMayChu, congProd, docCaiDat, tranThanHieuLuc, type CaiDatAiLead } from "./cai-dat";
import { AN_TOAN_CUNG, DUONG_DAN, NHOM_HAN_MUC, type MaLoi, type NhomHanMuc, type TenEndpoint } from "./hop-dong";
import { daoKhoaAgent, khoaGiaChoAgentLa, masterKeyCoSan } from "./khoa";
import { bamThan, chuoiKy, kiemDinhDangHeader, kiemHopDong, kiemLechGio, kyChuoi } from "./ky";
import { dauChung, phanHoiLoi, taoRequestId } from "./phan-hoi";
import { ghiNhanTuChoi } from "./tu-choi";
import {
  handoffRequestSchema,
  heartbeatRequestSchema,
  incidentRequestSchema,
  leadIntakeRequestSchema,
  moTaTruongLoi,
  occurredAtTrongHanMuc,
  testRunIdBiCam,
  type HandoffRequest,
  type HeartbeatRequest,
  type IncidentRequest,
  type LeadIntakeRequest,
} from "./schemas";
import { laLoiTamThoi, maLoiNoiBo } from "./loi-he-thong";
import { khoaIdempotencyCua, traCuuIdempotency, type ThanOk } from "./dich-vu/idempotency";

// ─── Kiểu ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type DuLieuTheoEndpoint = {
  catalog: null;
  leadIntakes: LeadIntakeRequest;
  handoffs: HandoffRequest;
  incidents: IncidentRequest;
  heartbeats: HeartbeatRequest;
};

export type AgentDaXacThuc = {
  id: string;
  name: string;
  environment: "TEST" | "PROD";
  secretVersion: number;
  active: boolean;
  contractStatus: "COMPATIBLE" | "DEPRECATED" | "INCOMPATIBLE";
  /** `autoCreate` = cờ tự tạo lead RIÊNG của Page (E2) — cấu hình nội bộ Admin, CHỈ để `intake.ts` đọc; không bao giờ ra response Agent. */
  pages: { pageId: string; state: "ENABLED" | "PAUSED"; routingCenterId: string | null; autoCreate: boolean }[];
};

export type NguCanhYeuCau<E extends TenEndpoint = TenEndpoint> = {
  endpoint: E;
  agent: AgentDaXacThuc;
  /** Thân ĐÃ qua zod (POST) hoặc `null` (GET /catalog). */
  body: DuLieuTheoEndpoint[E];
  /** Giờ máy chủ (ms) — MỘT lần đọc đầu yêu cầu; mọi chỗ sau dùng lại (test đóng băng được). */
  nowMs: number;
  requestId: string;
  cai: CaiDatAiLead;
  /** `If-None-Match` đã chuẩn hoá (chỉ /catalog). */
  ifNoneMatch: string | null;
};

export type KetQuaXuLy =
  | { loai: "ok"; body: ThanOk }
  | { loai: "phat-lai"; body: ThanOk }
  | { loai: "xung-dot" }
  | { loai: "loi"; ma: MaLoi; field?: string; retryAfterS?: number }
  | { loai: "res"; res: NextResponse };

export type KetQuaXacThuc<E extends TenEndpoint> = { ok: true; ctx: NguCanhYeuCau<E> } | { ok: false; res: NextResponse };

// ─── Lỗi hạ tầng → mã ────────────────────────────────────────────────────────────────────────────────────────────────────
type NguCanhLoi = { requestId: string; nowMs: number };

/** Lỗi lạ ⇒ 503 (hạ tầng tạm thời) hoặc 500 — có cấu trúc, không để framework trả HTML. Log CHỈ mã + requestId. */
export function loiMayChu(err: unknown, ctx: NguCanhLoi, noi: string): NextResponse {
  const tamThoi = laLoiTamThoi(err);
  console.error(`[ai-lead:${noi}] requestId=${ctx.requestId} loi=${maLoiNoiBo(err)}`);
  return tamThoi ? phanHoiLoi("TEMP_UNAVAILABLE", ctx, { retryAfterS: 5 }) : phanHoiLoi("INTERNAL_ERROR", ctx);
}

// ─── Đọc thân có trần ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Đọc thân theo LUỒNG, dừng ngay khi vượt trần. `content-length` chỉ để từ chối SỚM; khai nhỏ mà gửi lớn vẫn bị chặn ở vòng đọc. Trả BYTE (chữ ký băm đúng byte đã gửi). */
async function docThanCoTran(req: NextRequest, tran: number): Promise<{ ok: true; than: Uint8Array } | { ok: false }> {
  const khai = req.headers.get("content-length");
  if (khai !== null && khai.trim() !== "") {
    const n = Number(khai);
    if (!Number.isFinite(n) || n > tran) return { ok: false };
  }
  if (!req.body) return { ok: true, than: new Uint8Array(0) };
  const reader = req.body.getReader();
  const manh: Uint8Array[] = [];
  let tong = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tong += value.byteLength;
    if (tong > tran) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    manh.push(value);
  }
  const than = new Uint8Array(tong);
  let o = 0;
  for (const m of manh) {
    than.set(m, o);
    o += m.byteLength;
  }
  return { ok: true, than };
}

function laJson(contentType: string | null): boolean {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase() === "application/json";
}

function laTrungKhoa(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "P2002";
}

const SCHEMA_THEO_ENDPOINT = {
  leadIntakes: leadIntakeRequestSchema,
  handoffs: handoffRequestSchema,
  incidents: incidentRequestSchema,
  heartbeats: heartbeatRequestSchema,
} as const;

/** Chuẩn hoá `If-None-Match`: bỏ `W/` và nháy kép — hợp đồng gửi `etag` trần, nhưng proxy/client có thể bọc nháy. */
export function chuanHoaEtag(v: string): string {
  return v.trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}

/** Hạn mức theo IP TRƯỚC xác thực: một Agent đứng sau MỘT IP gửi cả ba nhóm cùng lúc, nên trần phải ≥ tổng ba nhóm (×2 dư địa). Không có tham số riêng — xem báo cáo lát G. */
export function tranIpTruocXacThuc(c: Pick<CaiDatAiLead, "rateCatalogPerMin" | "rateIntakePerMin" | "rateControlPerMin">): number {
  return 2 * (c.rateCatalogPerMin + c.rateIntakePerMin + c.rateControlPerMin);
}

function phan404(ctx: NguCanhLoi): NextResponse {
  // Cờ cổng TẮT: không có trong bảng 18 mã (cổng "không tồn tại") ⇒ 404 JSON khung chuẩn để đo cờ bằng mã trạng thái (CLAUDE.md luật 12).
  return fail("NOT_FOUND", "Không tìm thấy.", { status: 404, requestId: ctx.requestId, headers: dauChung(ctx.nowMs) });
}

// ─── Xác thực ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Bước 1–16 của error-codes.md §3. `nowMs` mặc định là giờ máy (route là nơi DUY NHẤT đọc đồng hồ); test truyền vào.
 * `nhom` mặc định theo `NHOM_HAN_MUC[endpoint]` — nhóm khác chỉ để test.
 */
export async function xacThucYeuCauAgent<E extends TenEndpoint>(
  req: NextRequest,
  x: { endpoint: E; nhom?: NhomHanMuc; nowMs?: number },
): Promise<KetQuaXacThuc<E>> {
  const nowMs = x.nowMs ?? Date.now();
  const requestId = taoRequestId();
  const nc: NguCanhLoi = { requestId, nowMs };
  // Bộ đếm từ chối (riêng tư — xem tu-choi.ts): bật theo `ai.rejectLogEnabled` sau khi đọc được cài đặt; `agentDaKy` chỉ được đặt SAU khi chữ ký đúng (trước đó mọi giá trị đều do kẻ gọi tự khai).
  let batGhiTuChoi = false;
  let agentDaKy: string | null = null;
  const loi = (ma: MaLoi, o?: { field?: string; retryAfterS?: number }) => {
    ghiNhanTuChoi({ batGhi: batGhiTuChoi, endpoint: x.endpoint, ma, agentId: agentDaKy, nowMs });
    return { ok: false as const, res: phanHoiLoi(ma, nc, o) };
  };
  const method = x.endpoint === "catalog" ? "GET" : "POST";
  const nhom = x.nhom ?? NHOM_HAN_MUC[x.endpoint];
  const hanMuc = async (khoa: string, max: number): Promise<{ ok: true } | { ok: false; retryAfterS: number }> => {
    const rl = await rateLimit({ key: khoa, max, windowMs: 60_000 });
    return rl.success ? { ok: true } : { ok: false, retryAfterS: Math.max(1, Math.ceil((rl.resetAt - nowMs) / 1_000)) };
  };
  try {
    // 1. Cờ cổng · master key — fail-closed, KHÔNG chạm DB.
    if (!isAiLeadGatewayEnabled()) return { ok: false, res: phan404(nc) };
    if (!masterKeyCoSan()) return loi("NOT_CONFIGURED");
    const cai = await docCaiDat();
    batGhiTuChoi = cai.rejectLogEnabled === true;

    // 2. Phiên bản hợp đồng.
    if (!kiemHopDong((ten) => req.headers.get(ten))) return loi("UNSUPPORTED_CONTRACT");

    // 3. Query (không được ký) · bốn header · If-None-Match.
    if (req.nextUrl.search !== "") return loi("BAD_REQUEST", { field: "query" });
    const hd = kiemDinhDangHeader((ten) => req.headers.get(ten));
    if (!hd.ok) return loi("BAD_REQUEST", { field: hd.loi });
    const inm = req.headers.get("if-none-match");
    if (inm !== null && inm.length > AN_TOAN_CUNG.etagToiDaKyTu) return loi("BAD_REQUEST", { field: "If-None-Match" });

    // 4. Trần thân — ĐỨNG TRƯỚC bước 5. GET phải rỗng.
    const doc = await docThanCoTran(req, method === "GET" ? 0 : tranThanHieuLuc(cai));
    if (!doc.ok) return method === "GET" ? loi("BAD_REQUEST", { field: "body" }) : loi("BODY_TOO_LARGE");
    // 5. POST phải là JSON.
    if (method === "POST" && !laJson(req.headers.get("content-type"))) return loi("UNSUPPORTED_MEDIA_TYPE");

    // Hạn mức theo IP — TRƯỚC khi tra DB / dẫn xuất khoá, để người lạ không đốt tài nguyên.
    const ip = await hanMuc(`ai-lead:ip:${ipChoRateLimit(req.headers)}`, tranIpTruocXacThuc(cai));
    if (!ip.ok) return loi("RATE_LIMITED", { retryAfterS: ip.retryAfterS });

    // 6. Agent + chữ ký — một lần tra, một lần ký, một lần so; agent lạ ký bằng khoá GIẢ rồi cùng mã `BAD_SIGNATURE`.
    const agent = await db.aiLeadAgent.findUnique({
      where: { id: hd.agentId },
      select: {
        id: true,
        name: true,
        environment: true,
        secretVersion: true,
        active: true,
        contractStatus: true,
        pages: { select: { pageId: true, state: true, routingCenterId: true, autoCreate: true } },
      },
    });
    const khoa = (agent ? daoKhoaAgent(agent.id, agent.secretVersion) : null) ?? khoaGiaChoAgentLa(hd.agentId);
    const chuoi = chuoiKy({ method, path: DUONG_DAN[x.endpoint], ts: hd.ts, nonce: hd.nonce, bamThan: bamThan(doc.than) });
    const khop = safeEqual(kyChuoi(khoa, chuoi), hd.sig);
    if (!agent || !khop) return loi("BAD_SIGNATURE");
    agentDaKy = agent.id;

    // 7. Lệch giờ — biên đúng `ai.clockSkewMs` vẫn qua.
    if (!kiemLechGio(hd.tsMs, nowMs, cai.clockSkewMs)) return loi("CLOCK_SKEW");
    // 8. Agent bị tắt.
    if (!agent.active) return loi("AGENT_DISABLED");
    // FIX-03: Agent TEST trên máy chủ PROD ⇒ coi như bị tắt (fail-closed, quyết theo môi trường MÁY CHỦ). Dùng mã sẵn có để không đổi hợp đồng; không lộ thêm gì cho người chưa ký đúng.
    if (agent.environment === "TEST" && !agentTestDuocChayTrenMayChu()) return loi("AGENT_DISABLED");
    // Cổng PROD (OD-08): agent PROD chỉ được phục vụ khi `prodEnabled` + chính sách đồng ý đã duyệt. Cố ý SAU chữ ký/active.
    if (agent.environment === "PROD" && !(await congProd()).allowed) return loi("NOT_CONFIGURED");
    // 9. Hạn mức theo NHÓM endpoint (tính theo agent).
    const maxNhom = nhom === "catalog" ? cai.rateCatalogPerMin : nhom === "intake" ? cai.rateIntakePerMin : cai.rateControlPerMin;
    const rn = await hanMuc(`ai-lead:${nhom}:${agent.id}`, maxNhom);
    if (!rn.ok) return loi("RATE_LIMITED", { retryAfterS: rn.retryAfterS });

    // 10. Nonce — SAU mọi cổng trên.
    try {
      await db.aiLeadNonce.create({ data: { agentId: agent.id, nonce: hd.nonce, createdAt: new Date(nowMs) } });
    } catch (err) {
      if (laTrungKhoa(err)) return loi("NONCE_REUSED");
      throw err;
    }

    const ctxChung = { agent: agent as AgentDaXacThuc, nowMs, requestId, cai, ifNoneMatch: inm === null ? null : chuanHoaEtag(inm) };
    if (x.endpoint === "catalog") {
      return { ok: true, ctx: { endpoint: x.endpoint, body: null as DuLieuTheoEndpoint[E], ...ctxChung } };
    }

    // 11. JSON strict (UTF-8 `fatal`) + zod strict ⇒ PAYLOAD_INVALID (+ field — KHÔNG kèm giá trị: có thể là PII).
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(doc.than));
    } catch {
      return loi("PAYLOAD_INVALID");
    }
    const schema = SCHEMA_THEO_ENDPOINT[x.endpoint as Exclude<TenEndpoint, "catalog">] as z.ZodType;
    const kq = schema.safeParse(json);
    if (!kq.success) return loi("PAYLOAD_INVALID", { field: moTaTruongLoi(kq.error) });
    const body = kq.data as DuLieuTheoEndpoint[E];
    if (x.endpoint === "incidents" && !occurredAtTrongHanMuc((body as IncidentRequest).occurredAt, nowMs)) {
      return loi("PAYLOAD_INVALID", { field: "occurredAt" });
    }

    // 12. `environment` của heartbeat phải khớp môi trường của khoá.
    if (x.endpoint === "heartbeats" && (body as HeartbeatRequest).environment !== agent.environment) return loi("ENVIRONMENT_MISMATCH", { field: "environment" });
    // 13. `testRunId` gửi lên agent PROD.
    if ((x.endpoint === "leadIntakes" || x.endpoint === "handoffs") && testRunIdBiCam(body as { testRunId?: string }, agent.environment)) {
      return loi("TEST_ONLY_FIELD", { field: "testRunId" });
    }

    // 14. Page ∈ allowlist của CHÍNH agent này (không lộ Page tồn tại ở agent khác — cùng mã, không `field`). PAGE_PAUSED chỉ /lead-intakes.
    const pageId =
      x.endpoint === "leadIntakes" || x.endpoint === "handoffs"
        ? (body as LeadIntakeRequest | HandoffRequest).conversation.pageId
        : x.endpoint === "incidents"
          ? (body as IncidentRequest).pageId
          : undefined;
    if (pageId !== undefined) {
      const dong = agent.pages.find((p) => p.pageId === pageId);
      if (!dong) return loi("PAGE_NOT_ALLOWED");
      if (x.endpoint === "leadIntakes" && dong.state === "PAUSED") return loi("PAGE_PAUSED");
    }

    if (x.endpoint === "leadIntakes") {
      // 15. Công tắc INCOMPATIBLE do Admin đặt tay — CHỈ /lead-intakes (/handoffs và /incidents vẫn qua).
      if (agent.contractStatus === "INCOMPATIBLE") return loi("UNSUPPORTED_CONTRACT");
      // 16. Hạn mức theo (agent, psid). Khoá dùng HMAC của psid (không đưa PSID thật vào kho đếm/Redis).
      const psid = (body as LeadIntakeRequest).conversation.psid;
      const dau = kyChuoi(khoa, `psid:${psid}`).slice(0, 32);
      const rp = await hanMuc(`ai-lead:psid:${agent.id}:${dau}`, cai.rateIntakePerPsidPerMin);
      if (!rp.ok) return loi("RATE_LIMITED", { retryAfterS: rp.retryAfterS });
    }

    return { ok: true, ctx: { endpoint: x.endpoint, body, ...ctxChung } };
  } catch (err) {
    return { ok: false, res: loiMayChu(err, nc, "xac-thuc") };
  }
}

// ─── Vỏ chạy endpoint ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Phản hồi từ thân đã lưu/đã dựng. `X-Server-Time` là giờ HIỆN TẠI; `meta` giữ nguyên bản lưu (phát lại phải giống từng byte phản hồi gốc). */
export function phanHoiTuThan(body: ThanOk, nowMs: number, phatLai: boolean): NextResponse {
  return ok(body.data, { meta: body.meta, headers: dauChung(nowMs, phatLai ? { "Idempotent-Replay": "true" } : undefined) });
}

/**
 * Xác thực → (bước 17) tra idempotency → dịch vụ → phản hồi. Lỗi lạ ⇒ 503/500 có cấu trúc.
 * Route chỉ gọi hàm này (route mỏng).
 */
export async function chayEndpointAgent<E extends TenEndpoint>(
  req: NextRequest,
  endpoint: E,
  xuLy: (ctx: NguCanhYeuCau<E>) => Promise<KetQuaXuLy>,
  opts?: { nowMs?: number },
): Promise<NextResponse> {
  const xt = await xacThucYeuCauAgent(req, { endpoint, ...(opts?.nowMs !== undefined ? { nowMs: opts.nowMs } : {}) });
  if (!xt.ok) return xt.res;
  const { ctx } = xt;
  try {
    // 17. Cùng khoá: cùng nội dung ⇒ phát lại phản hồi cũ; khác nội dung ⇒ 409. (Tranh chấp đồng thời được giải TRONG giao dịch của dịch vụ.)
    const khoa = khoaIdempotencyCua(ctx);
    if (khoa !== null) {
      const tc = await traCuuIdempotency(ctx.agent.id, endpoint, khoa.key, khoa.hash);
      if (tc.loai === "phat-lai") return phanHoiTuThan(tc.body, ctx.nowMs, true);
      if (tc.loai === "xung-dot") return phanHoiLoi("IDEMPOTENCY_CONFLICT", ctx);
    }
    const kq = await xuLy(ctx);
    switch (kq.loai) {
      case "res":
        return kq.res;
      case "ok":
        return phanHoiTuThan(kq.body, ctx.nowMs, false);
      case "phat-lai":
        return phanHoiTuThan(kq.body, ctx.nowMs, true);
      case "xung-dot":
        return phanHoiLoi("IDEMPOTENCY_CONFLICT", ctx);
      case "loi":
        return phanHoiLoi(kq.ma, ctx, { ...(kq.field ? { field: kq.field } : {}), ...(kq.retryAfterS !== undefined ? { retryAfterS: kq.retryAfterS } : {}) });
    }
  } catch (err) {
    return loiMayChu(err, ctx, endpoint);
  }
}
