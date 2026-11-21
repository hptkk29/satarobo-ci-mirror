// lib/ai-lead/dich-vu/ket-noi.ts — MÔ HÌNH ĐỌC + HÀNH ĐỘNG của Trung tâm kết nối AI (lát K).
//
// MỌI con số/nhãn ở đây suy từ TELEMETRY THẬT trong DB (`AiLeadAgent.last*`, `AiLeadRequest`, `AiLeadDraft`, `AiLeadIncident`, `AiLeadProbe`,
// `AiLeadVerificationRun`). Luật nhãn nằm ở `ket-noi-thuan.ts` (thuần, test ma trận) — tệp này chỉ NẠP dữ liệu rồi gọi nó.
//
// Phần ghi (`phatHanhThamDo`, `ghiLanChay`, `chuyenTrangThaiSuCo`) KHÔNG hỏi quyền: Server Action ở `ket-noi/_actions.ts` hỏi.
//
// TTL kiểm chứng và ngưỡng ngắt kết nối đọc từ `ai.verifyTtlHours` / `ai.disconnectHours` (cùng nhãn "(tạm)" — số chưa đo, không phải chính sách).
//
// ⚠️ "Yêu cầu 24h" chỉ đếm `AiLeadRequest` = yêu cầu ĐÃ QUA XÁC THỰC và có idempotency. Yêu cầu bị 401/413/415… bị từ chối TRƯỚC khi tới bảng đó nên KHÔNG có ở đây;
// giao diện nói điều này thành lời để không ai đọc "0 lỗi" thành "không có yêu cầu hỏng".
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { agentTestDuocChayTrenMayChu, congProd, docCaiDat, nguongMatKetNoiMs } from "../cai-dat";
import { docTuChoiGanDay, type TuChoiTheoAgent } from "../tu-choi";
import { ngayVnLaDate } from "../ngay-vn";
import { kiemToanVenSnapshot, type KetQuaToanVen } from "./cau-hinh-thuan";
import { RE } from "../hop-dong";
import { masterKeyCoSan } from "../khoa";
import type { MoiTruong, Severity, TrangThaiContract } from "../kieu";
import type { KetQua, NguoiThaoTac } from "./cau-hinh";
import { HANH_DONG_THONG_BAO_LOI, nguoiCoQuyen } from "./thong-bao";
import {
  HASH_HOP_DONG_HIEN_HANH,
  LOAI_THEO_TANG,
  kiemLanChayNhap,
  kiemLyDo,
  nguonBangChung,
  tinhTrangKetNoi,
  type BangChungNhap,
  type KetQuaTinhTrang,
  type LanChay,
  type LanChayNhap,
  type LoaiLanChay,
  type MucKiemChung,
  type NguonBangChung,
  type TrangThaiLanChay,
} from "./ket-noi-thuan";

/** TTL bằng chứng kiểm chứng và ngưỡng ngắt kết nối nay là tham số `ai.verifyTtlHours` / `ai.disconnectHours` (trước đây hằng cứng 7 ngày / 24 giờ). */
const GIO_MS = 3_600_000;
const MOT_NGAY_MS = 24 * 3_600_000;

class LoiNghiepVu extends Error {}

// ─── Đọc telemetry ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Hình dạng `lastHeartbeatPayload` mà màn này cần. Lát G sở hữu việc ghi nó; đọc bằng safeParse — hỏng ⇒ "không có dữ liệu", KHÔNG BAO GIỜ suy ra đạt. */
const heartbeatDaLuuSchema = z.looseObject({
  catalogVersionSeen: z.number().int().nullish(),
  pages: z.array(z.looseObject({ pageId: z.string(), lastWebhookEventAt: z.string().nullable().optional() })).optional(),
});

export type NhipWebhook = { trangThai: "CHUA_BIET" | "CHUA_TUNG" | "CO"; lanCuoi: Date | null; tuoiMs: number | null };

export function docWebhookTheoPage(payload: unknown, pageId: string, now: number): NhipWebhook {
  const r = heartbeatDaLuuSchema.safeParse(payload);
  if (!r.success) return { trangThai: "CHUA_BIET", lanCuoi: null, tuoiMs: null };
  const p = r.data.pages?.find((x) => x.pageId === pageId);
  if (!p) return { trangThai: "CHUA_BIET", lanCuoi: null, tuoiMs: null };
  if (!p.lastWebhookEventAt) return { trangThai: "CHUA_TUNG", lanCuoi: null, tuoiMs: null };
  const t = Date.parse(p.lastWebhookEventAt);
  if (Number.isNaN(t)) return { trangThai: "CHUA_BIET", lanCuoi: null, tuoiMs: null };
  return { trangThai: "CO", lanCuoi: new Date(t), tuoiMs: Math.max(0, now - t) };
}

export function docCatalogDaThay(payload: unknown): number | null {
  const r = heartbeatDaLuuSchema.safeParse(payload);
  return r.success ? (r.data.catalogVersionSeen ?? null) : null;
}

export type ChayGanDay = {
  id: string;
  level: MucKiemChung;
  status: TrangThaiLanChay;
  kind: LoaiLanChay;
  createdAt: Date;
  correlationId: string | null;
  mock: boolean;
  nguon: NguonBangChung;
};

export type PageKetNoiView = {
  pageId: string;
  state: "ENABLED" | "PAUSED";
  routingCenterId: string | null;
  webhook: NhipWebhook;
  tinhTrang: KetQuaTinhTrang;
  /** Số cuộc trò chuyện MỚI Agent mở cho Page này trong NGÀY VN hôm nay, và cờ vượt `ai.rate.newConversationsPerDayPerPage`. CHỈ cảnh báo (có thể AI bị lạm dụng), không chặn. */
  cuocMoiHomNay: number;
  luuLuongBatThuong: boolean;
};

export type AgentKetNoiView = {
  agent: {
    id: string;
    name: string;
    environment: MoiTruong;
    active: boolean;
    contractStatus: TrangThaiContract;
    secretVersion: number;
    lastAgentVersion: string | null;
    lastBuildSha: string | null;
    lastContractHash: string | null;
    lastHeartbeatAt: Date | null;
  };
  tongHop: KetQuaTinhTrang;
  pages: PageKetNoiView[];
  catalog: { daThay: number | null; moiNhat: number | null; tre: boolean | null };
  luuLuong24h: { tong: number; loi: number };
  /** Bộ đếm yêu cầu bị TỪ CHỐI sau khi chữ ký đúng (hôm nay + hôm qua, theo ngày VN). `null` = cờ `ai.rejectLogEnabled` TẮT hoặc không đọc được ⇒ giao diện nói «chưa đo», KHÔNG in 0. */
  tuChoi: TuChoiTheoAgent | null;
  /** `quaTuoi`: hồ sơ ở hàng chờ NGƯỜI (WAITING_QLCS/READY_FOR_REVIEW), chưa ai nhận, đã tạo cách đây quá `ai.queueMaxAgeHours`. CHỈ cảnh báo, không tự xử lý hồ sơ. */
  hoSo: { cho: number; dangXuLy: number; quaHan: number; quaTuoi: number };
  suCoMo: { tong: number; nghiemTrongNhat: Severity | null };
  thamDo: { dangMo: { probeId: string; expiresAt: Date } | null; ackGanNhat: Date | null };
  chayGanDay: ChayGanDay[];
};

export type TrungTamKetNoiView = {
  bayGio: Date;
  masterKeyOk: boolean;
  hashHienHanh: string;
  congProd: { allowed: boolean; thieu: readonly string[] };
  nguongMatKetNoiMs: number;
  agents: AgentKetNoiView[];
  catalogMoiNhat: number | null;
  /** Toàn vẹn của snapshot mới nhất (payload đúng hợp đồng + etag khớp băm). `null` = chưa xuất bản bản nào. `ok:false` ⇒ Agent nhận 503 cho tới khi xuất bản lại. */
  catalogToanVen: KetQuaToanVen | null;
  /** Số lần gửi thông báo nội bộ (chuông cho QLCS/Marketing/Admin) LỖI trong 24 giờ — đọc từ nhật ký audit; `null` = không đọc được (≠ 0). */
  thongBaoLoi24h: number | null;
  /** Từ chối KHÔNG xác thực được (chữ ký sai/thiếu, Agent lạ…) — gộp mọi nguồn, không gắn với Agent nào. `bat` = cờ ghi bộ đếm; `chuaXacThuc = null` khi tắt hoặc đọc lỗi. */
  tuChoiChuaXacThuc: { bat: boolean; chuaXacThuc: TuChoiTheoAgent | null };
};

/** Nửa đêm của ngày VN chứa `nowMs` TÍNH THEO GIỜ VN dưới dạng thời điểm tuyệt đối (khác `ngayVnLaDate` — nửa đêm UTC để ghi cột `@db.Date`). */
function ngayVnBatDau(nowMs: number): Date {
  return new Date(ngayVnLaDate(nowMs).getTime() - 7 * 3_600_000);
}

const SEV_THU_TU: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
function nangNhat(a: Severity | null, b: Severity): Severity {
  return a === null || SEV_THU_TU.indexOf(b) > SEV_THU_TU.indexOf(a) ? b : a;
}

const TRANG_THAI_CHO = ["WAITING_QLCS", "PENDING_INFO", "READY_FOR_REVIEW", "ASSIGNMENT_PENDING"] as const;
/** Hàng chờ do NGƯỜI xử lý và chưa ai nhận (PENDING_INFO là chờ khách bổ sung; ASSIGNMENT_PENDING là chờ chia sale — không tính). Tuổi đo từ lúc tạo hồ sơ (chưa có mốc «vào hàng chờ»). */
const TRANG_THAI_CHO_NGUOI = ["WAITING_QLCS", "READY_FOR_REVIEW"] as const;
const TRANG_THAI_MO = [...TRANG_THAI_CHO, "COLLECTING", "IN_PROGRESS", "SYSTEM_EXCEPTION"] as const;

/** `bayGio` truyền vào (không `new Date()` ở trong) — test đóng băng được đồng hồ. */
export async function docTrungTamKetNoi(actor: Actor, bayGio: Date): Promise<TrungTamKetNoiView> {
  const now = bayGio.getTime();
  const cai = await docCaiDat();
  const [cong, agents, snapshotMoi] = await Promise.all([
    congProd(),
    db.aiLeadAgent.findMany({ orderBy: { createdAt: "asc" }, include: { pages: { orderBy: { pageId: "asc" } } } }),
    db.aiLeadCatalogSnapshot.findFirst({ orderBy: { version: "desc" }, select: { version: true, etag: true, payload: true } }),
  ]);
  const ids = agents.map((a) => a.id);
  const tu24h = new Date(now - MOT_NGAY_MS);
  const thongBaoLoi24h = await db.auditLog.count({ where: { module: "ai-lead", action: HANH_DONG_THONG_BAO_LOI, createdAt: { gte: tu24h } } }).catch(() => null);

  const tuChoiDoc = cai.rejectLogEnabled ? await docTuChoiGanDay(now).catch(() => null) : null;

  const [runs, suCo, luu, luuLoi, thamDo, hoSo, cuocMoi] = ids.length
    ? await Promise.all([
        db.aiLeadVerificationRun.findMany({
          where: { OR: [{ agentId: { in: ids } }, { agentId: null }] },
          orderBy: { createdAt: "desc" },
          take: 600,
        }),
        db.aiLeadIncident.findMany({ where: { state: { not: "RESOLVED" } }, select: { agentId: true, severity: true } }),
        db.aiLeadRequest.groupBy({ by: ["agentId"], where: { agentId: { in: ids }, createdAt: { gte: tu24h } }, _count: { _all: true } }),
        db.aiLeadRequest.groupBy({
          by: ["agentId"],
          where: { agentId: { in: ids }, createdAt: { gte: tu24h }, responseStatus: { gte: 400 } },
          _count: { _all: true },
        }),
        db.aiLeadProbe.findMany({ where: { agentId: { in: ids } }, orderBy: { issuedAt: "desc" }, take: 100 }),
        // `AiLeadDraft` mang cách ly cơ sở ⇒ đọc qua scopedDb: người cấp cơ sở chỉ đếm hồ sơ của cơ sở mình.
        scopedDb(actor).aiLeadDraft.findMany({
          where: { state: { in: [...TRANG_THAI_MO] }, conversation: { agentId: { in: ids } } },
          select: { state: true, createdAt: true, slaClaimDueAt: true, slaResolveDueAt: true, claimedAt: true, conversation: { select: { agentId: true } } },
          take: 5000,
        }),
        // Cuộc trò chuyện mới theo (Agent, Page) trong ngày VN hôm nay — chỉ ĐẾM, không đọc nội dung/PSID.
        db.aiLeadConversation.groupBy({ by: ["agentId", "pageId"], where: { agentId: { in: ids }, createdAt: { gte: ngayVnBatDau(now) } }, _count: { _all: true } }),
      ])
    : [[], [], [], [], [], [], []];

  const view: AgentKetNoiView[] = agents.map((a) => {
    const pageIds = a.pages.map((p) => p.pageId);
    const mo = suCo.filter((s) => s.agentId === a.id);
    const suCoMo = { tong: mo.length, nghiemTrongNhat: mo.reduce<Severity | null>((acc, s) => nangNhat(acc, s.severity), null) };
    const lanChay: LanChay[] = runs
      .filter((r) => r.agentId === a.id || (r.agentId === null && r.level === "L1"))
      .map((r) => ({
        id: r.id,
        agentId: r.agentId,
        level: r.level,
        status: r.status,
        kind: r.kind,
        createdAt: r.createdAt,
        buildSha: r.buildSha,
        contractHash: r.contractHash,
        correlationId: r.correlationId,
        evidence: r.evidence,
      }));
    const dauVao = {
      now,
      nguongMatKetNoiMs: nguongMatKetNoiMs(cai),
      nguongNgatKetNoiMs: cai.disconnectHours * GIO_MS,
      ttlKiemChungMs: cai.verifyTtlHours * GIO_MS,
      hashHopDongHienHanh: HASH_HOP_DONG_HIEN_HANH,
      congProd: { allowed: cong.allowed, thieu: cong.thieu },
      agent: {
        active: a.active,
        environment: a.environment,
        moiTruongHopLe: a.environment !== "TEST" || agentTestDuocChayTrenMayChu(),
        contractStatus: a.contractStatus,
        lastHeartbeatAt: a.lastHeartbeatAt,
        lastBuildSha: a.lastBuildSha,
        lastContractHash: a.lastContractHash,
      },
      pageIdsHienTai: pageIds,
      lanChay,
      suCoMo,
    };
    const daThay = docCatalogDaThay(a.lastHeartbeatPayload);
    const moiNhat = snapshotMoi?.version ?? null;
    const cuaAgent = thamDo.filter((p) => p.agentId === a.id);
    const dangMo = cuaAgent.find((p) => p.ackedAt === null && p.expiresAt.getTime() > now);
    const ack = cuaAgent.find((p) => p.ackedAt !== null);
    const dr = hoSo.filter((h) => h.conversation.agentId === a.id);
    const quaHan = dr.filter(
      (h) =>
        (h.claimedAt === null && h.slaClaimDueAt !== null && h.slaClaimDueAt.getTime() < now && (TRANG_THAI_CHO as readonly string[]).includes(h.state)) ||
        (h.slaResolveDueAt !== null && h.slaResolveDueAt.getTime() < now),
    ).length;
    return {
      agent: {
        id: a.id,
        name: a.name,
        environment: a.environment,
        active: a.active,
        contractStatus: a.contractStatus,
        secretVersion: a.secretVersion,
        lastAgentVersion: a.lastAgentVersion,
        lastBuildSha: a.lastBuildSha,
        lastContractHash: a.lastContractHash,
        lastHeartbeatAt: a.lastHeartbeatAt,
      },
      tongHop: tinhTrangKetNoi(dauVao),
      pages: a.pages.map((p) => ({
        pageId: p.pageId,
        state: p.state,
        routingCenterId: p.routingCenterId,
        webhook: docWebhookTheoPage(a.lastHeartbeatPayload, p.pageId, now),
        tinhTrang: tinhTrangKetNoi({ ...dauVao, page: { pageId: p.pageId, state: p.state } }),
        cuocMoiHomNay: cuocMoi.find((c) => c.agentId === a.id && c.pageId === p.pageId)?._count._all ?? 0,
        luuLuongBatThuong: (cuocMoi.find((c) => c.agentId === a.id && c.pageId === p.pageId)?._count._all ?? 0) > cai.rateNewConversationsPerDayPerPage,
      })),
      catalog: { daThay, moiNhat, tre: daThay === null || moiNhat === null ? null : daThay < moiNhat },
      luuLuong24h: {
        tong: luu.find((x) => x.agentId === a.id)?._count._all ?? 0,
        loi: luuLoi.find((x) => x.agentId === a.id)?._count._all ?? 0,
      },
      tuChoi: tuChoiDoc ? (tuChoiDoc.theoAgent.get(a.id) ?? { tong: 0, theoMa: [] }) : null,
      hoSo: {
        cho: dr.filter((h) => (TRANG_THAI_CHO as readonly string[]).includes(h.state)).length,
        dangXuLy: dr.filter((h) => h.state === "IN_PROGRESS").length,
        quaHan,
        quaTuoi: dr.filter((h) => (TRANG_THAI_CHO_NGUOI as readonly string[]).includes(h.state) && h.claimedAt === null && now - h.createdAt.getTime() > cai.queueMaxAgeHours * GIO_MS).length,
      },
      suCoMo,
      thamDo: { dangMo: dangMo ? { probeId: dangMo.probeId, expiresAt: dangMo.expiresAt } : null, ackGanNhat: ack?.ackedAt ?? null },
      chayGanDay: lanChay.slice(0, 8).map((r) => ({
        id: r.id,
        level: r.level,
        status: r.status,
        kind: r.kind,
        createdAt: r.createdAt,
        correlationId: r.correlationId,
        mock: r.status === "MOCK_ONLY",
        nguon: nguonBangChung(r.level, r.evidence),
      })),
    };
  });

  return {
    bayGio,
    masterKeyOk: masterKeyCoSan(),
    hashHienHanh: HASH_HOP_DONG_HIEN_HANH,
    congProd: { allowed: cong.allowed, thieu: cong.thieu },
    nguongMatKetNoiMs: nguongMatKetNoiMs(cai),
    agents: view,
    catalogMoiNhat: snapshotMoi?.version ?? null,
    catalogToanVen: snapshotMoi ? kiemToanVenSnapshot({ version: snapshotMoi.version, etag: snapshotMoi.etag, payload: snapshotMoi.payload }) : null,
    thongBaoLoi24h,
    tuChoiChuaXacThuc: { bat: cai.rejectLogEnabled, chuaXacThuc: tuChoiDoc?.chuaXacThuc ?? null },
  };
}

// ─── THĂM DÒ ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function chuoiNgauNhien(doDai: number): string {
  // base36 thường [a-z0-9] — khớp RE.probeId; đủ dài để không đoán được.
  let s = "";
  while (s.length < doDai) s += randomBytes(16).readBigUInt64BE(0).toString(36);
  return s.slice(0, doDai);
}
function nonceNgauNhien(): string {
  return randomBytes(24).toString("base64url"); // 32 ký tự [A-Za-z0-9_-] — khớp RE.nonce
}

export async function phatHanhThamDo(
  ng: NguoiThaoTac,
  input: { agentId: string },
  bayGio: Date,
): Promise<KetQua<{ probeId: string; expiresAt: Date }>> {
  const cai = await docCaiDat();
  try {
    const kq = await db.$transaction(async (tx) => {
      const a = await tx.aiLeadAgent.findUnique({ where: { id: input.agentId }, select: { id: true, active: true } });
      if (!a) throw new LoiNghiepVu("Không tìm thấy Agent.");
      if (!a.active) throw new LoiNghiepVu("Agent đang bị tắt — bật lại rồi mới thăm dò được.");
      // Giới hạn tần suất: còn một thăm dò CHƯA hết hạn, CHƯA được xác nhận thì không phát thêm (đơn giản và nói thật hơn đếm theo phút).
      const dangMo = await tx.aiLeadProbe.findFirst({
        where: { agentId: a.id, ackedAt: null, expiresAt: { gt: bayGio } },
        select: { expiresAt: true },
      });
      if (dangMo) {
        const con = Math.max(1, Math.ceil((dangMo.expiresAt.getTime() - bayGio.getTime()) / 60_000));
        throw new LoiNghiepVu(`Đang có một lần thăm dò chờ Agent xác nhận (còn khoảng ${con} phút). Chờ nó xong hoặc hết hạn.`);
      }
      const probeId = `prb_${chuoiNgauNhien(24)}`;
      const nonce = nonceNgauNhien();
      if (!RE.probeId.test(probeId) || !RE.nonce.test(nonce)) throw new Error("Sinh probeId/nonce sai định dạng.");
      const expiresAt = new Date(bayGio.getTime() + cai.probeTtlMinutes * 60_000);
      await tx.aiLeadProbe.create({ data: { agentId: a.id, probeId, nonce, issuedById: ng.userId, issuedAt: bayGio, expiresAt } });
      await writeAudit({
        actor: { id: ng.userId, name: ng.userName },
        module: "ai-lead",
        entityType: "AiLeadProbe",
        entityId: probeId,
        action: "AI_LEAD_THAM_DO_PHAT_HANH",
        newValues: { agentId: a.id, hetHan: expiresAt.toISOString() },
        tx,
      });
      return { probeId, expiresAt };
    });
    return { ok: true, ...kq };
  } catch (err) {
    if (err instanceof LoiNghiepVu) return { ok: false, error: err.message };
    throw err;
  }
}

// ─── GHI NHẬN LẦN CHẠY ─────────────────────────────────────────────────────────────────────────────────────────────────

async function ghiRun(
  tx: Prisma.TransactionClient,
  ng: NguoiThaoTac,
  r: {
    agentId: string | null;
    level: MucKiemChung;
    status: TrangThaiLanChay;
    kind: LoaiLanChay;
    evidence: Record<string, unknown>;
    contractHash: string | null;
    buildSha: string | null;
    correlationId: string | null;
    lyDo: string;
    action: string;
    taoLuc: Date;
  },
): Promise<string> {
  const run = await tx.aiLeadVerificationRun.create({
    data: {
      agentId: r.agentId,
      level: r.level,
      status: r.status,
      kind: r.kind,
      evidence: r.evidence as Prisma.InputJsonValue,
      contractHash: r.contractHash,
      buildSha: r.buildSha,
      correlationId: r.correlationId,
      runById: ng.userId,
      createdAt: r.taoLuc,
    },
    select: { id: true },
  });
  // Nhật ký KHÔNG chứa hash/evidence: chỉ định danh lần chạy + kết quả.
  await writeAudit({
    actor: { id: ng.userId, name: ng.userName },
    module: "ai-lead",
    entityType: "AiLeadVerificationRun",
    entityId: run.id,
    action: r.action,
    newValues: { agentId: r.agentId, level: r.level, status: r.status, kind: r.kind },
    reason: r.lyDo,
    tx,
  });
  return run.id;
}

export async function ghiLanChay(ng: NguoiThaoTac, input: LanChayNhap, bayGio: Date): Promise<KetQua<{ runId: string }>> {
  const loi = kiemLanChayNhap(input);
  if (loi) return { ok: false, error: loi };
  try {
    const runId = await db.$transaction(async (tx) => {
      let agent: { id: string; environment: MoiTruong; lastBuildSha: string | null; lastContractHash: string | null } | null = null;
      if (input.agentId !== null) {
        agent = await tx.aiLeadAgent.findUnique({
          where: { id: input.agentId },
          select: { id: true, environment: true, lastBuildSha: true, lastContractHash: true },
        });
        if (!agent) throw new LoiNghiepVu("Không tìm thấy Agent.");
      }
      if (input.status === "PASS" && input.level === "L1" && input.contractHash !== HASH_HOP_DONG_HIEN_HANH) {
        throw new LoiNghiepVu("contractHash khác hash hợp đồng hiện hành — không ghi PASS cho một bản hợp đồng cũ.");
      }
      if (input.status === "PASS" && agent && input.level !== "L1") {
        // Ghi PASS mà lập tức hết hạn là ghi bằng chứng "chết": từ chối ngay, nói đúng lệch ở đâu.
        if (input.bangChung.environment !== agent.environment) throw new LoiNghiepVu("Môi trường trong bằng chứng khác môi trường của Agent.");
        if (input.buildSha !== agent.lastBuildSha) throw new LoiNghiepVu("buildSha khác bản build Agent đang báo trong nhịp sống gần nhất.");
        if (input.contractHash !== agent.lastContractHash) throw new LoiNghiepVu("contractHash khác hash Agent đang khai trong nhịp sống gần nhất.");
        const pages = await tx.aiLeadAgentPage.findMany({ where: { agentId: agent.id }, select: { pageId: true } });
        const hienTai = pages.map((p) => p.pageId).sort().join(",");
        if ([...input.bangChung.pageIds].sort().join(",") !== hienTai) throw new LoiNghiepVu("Tập Page trong bằng chứng khác tập Page đang cấp cho Agent.");
        if (input.level === "L4" && !(await congProd()).allowed) throw new LoiNghiepVu("Cổng PROD đang đóng — không ghi L4 PASS.");
      }
      return ghiRun(tx, ng, {
        agentId: input.agentId,
        level: input.level,
        status: input.status,
        kind: input.kind,
        evidence: { ...input.bangChung, nguon: "THU_CONG" }, // máy chủ gắn nguồn; schema strict nên người dùng không tự khai được
        contractHash: input.contractHash ?? null,
        buildSha: input.buildSha ?? null,
        correlationId: input.correlationId ?? null,
        lyDo: input.lyDo,
        action: "AI_LEAD_KIEM_CHUNG_GHI",
        taoLuc: bayGio,
      });
    });
    return { ok: true, runId };
  } catch (err) {
    if (err instanceof LoiNghiepVu) return { ok: false, error: err.message };
    throw err;
  }
}

export async function docLichSuChay(agentId: string | null, take = 30): Promise<ChayGanDay[]> {
  const rows = await db.aiLeadVerificationRun.findMany({
    where: agentId === null ? {} : { OR: [{ agentId }, { agentId: null }] },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, level: true, status: true, kind: true, createdAt: true, correlationId: true, evidence: true },
  });
  return rows.map(({ evidence, ...r }) => ({ ...r, mock: r.status === "MOCK_ONLY", nguon: nguonBangChung(r.level, evidence) }));
}

// ─── SỰ CỐ (Exception Center cơ bản) ────────────────────────────────────────────────────────────────────────────────────

export type LocSuCo = {
  state?: "OPEN" | "ACKED" | "RESOLVED" | undefined;
  agentId?: string | undefined;
  severity?: Severity | undefined;
  trang?: number | undefined;
};
export type SuCoView = {
  id: string;
  agentId: string;
  agentName: string;
  pageId: string;
  category: string;
  detailCode: string;
  severity: Severity;
  count: number;
  state: "OPEN" | "ACKED" | "RESOLVED";
  firstSeenAt: Date;
  lastSeenAt: Date;
  assigneeId: string | null;
  assigneeName: string | null;
  lastCorrelationId: string | null;
};
export const SO_SU_CO_MOI_TRANG = 25;

export async function docSuCo(loc: LocSuCo): Promise<{ rows: SuCoView[]; tong: number; trang: number; soTrang: number }> {
  const where: Prisma.AiLeadIncidentWhereInput = {
    ...(loc.state ? { state: loc.state } : {}),
    ...(loc.agentId ? { agentId: loc.agentId } : {}),
    ...(loc.severity ? { severity: loc.severity } : {}),
  };
  const trang = Math.max(1, Math.floor(loc.trang ?? 1));
  const [tong, rows] = await Promise.all([
    db.aiLeadIncident.count({ where }),
    db.aiLeadIncident.findMany({
      where,
      orderBy: [{ lastSeenAt: "desc" }],
      skip: (trang - 1) * SO_SU_CO_MOI_TRANG,
      take: SO_SU_CO_MOI_TRANG,
      include: { agent: { select: { name: true } } },
    }),
  ]);
  const ids = [...new Set(rows.map((r) => r.assigneeId).filter((x): x is string => !!x))];
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const ten = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  return {
    tong,
    trang,
    soTrang: Math.max(1, Math.ceil(tong / SO_SU_CO_MOI_TRANG)),
    rows: rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      agentName: r.agent.name,
      pageId: r.pageId,
      category: r.category,
      detailCode: r.detailCode,
      severity: r.severity,
      count: r.count,
      state: r.state,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
      assigneeId: r.assigneeId,
      assigneeName: r.assigneeId ? (ten.get(r.assigneeId) ?? null) : null,
      lastCorrelationId: r.lastCorrelationId,
    })),
  };
}

/**
 * Người có thể được giao sự cố = người THẬT SỰ xem được Trung tâm kết nối (`ai-integration:view` qua vai còn hiệu lực — nguồn quyền RBAC v2) ∪ Quản trị tối cao (`can()` cho SUPER_ADMIN qua nhánh riêng,
 * không cần dòng vai). KHÔNG đọc cột vai cũ `role: MARKETING`: một Marketing không có quyền xem màn này từng được giao sự cố mà không mở được (review độc lập 28/10).
 */
export async function nguoiXuLySuCoIds(now: Date): Promise<string[]> {
  const [coQuyen, quanTri] = await Promise.all([
    nguoiCoQuyen("ai-integration:view", now),
    db.user.findMany({ where: { isActive: true, deletedAt: null, OR: [{ role: "SUPER_ADMIN" }, { roles: { has: "SUPER_ADMIN" } }] }, select: { id: true } }),
  ]);
  return [...new Set([...coQuyen, ...quanTri.map((u) => u.id)])];
}

/** Danh sách chọn người nhận sự cố (xem `nguoiXuLySuCoIds`). */
export async function docNguoiXuLy(bayGio: Date): Promise<{ id: string; name: string }[]> {
  const ids = await nguoiXuLySuCoIds(bayGio);
  const rows = await db.user.findMany({
    where: { id: { in: ids }, isActive: true, deletedAt: null },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
    take: 50,
  });
  return rows.map((u) => ({ id: u.id, name: u.name ?? u.email ?? u.id }));
}

export type HanhDongSuCo = "ACK" | "GIAO" | "BO_GIAO" | "DONG" | "MO_LAI";

export async function chuyenTrangThaiSuCo(
  ng: NguoiThaoTac,
  input: { id: string; hanhDong: HanhDongSuCo; assigneeId?: string | undefined; lyDo?: string | undefined },
  /** Đồng hồ do chỗ gọi truyền (luật 19) — dùng để tính quyền còn hiệu lực của người nhận. */
  bayGio: Date,
): Promise<KetQua<object>> {
  if ((input.hanhDong === "DONG" || input.hanhDong === "MO_LAI") && kiemLyDo(input.lyDo)) {
    return { ok: false, error: kiemLyDo(input.lyDo) as string };
  }
  // Người được giao hợp lệ tính TRƯỚC giao dịch (chỉ đọc) — cùng nguồn với danh sách chọn ở màn.
  const duocGiao = input.hanhDong === "GIAO" ? new Set(await nguoiXuLySuCoIds(bayGio)) : null;
  try {
    await db.$transaction(async (tx) => {
      const s = await tx.aiLeadIncident.findUnique({ where: { id: input.id }, select: { id: true, state: true, assigneeId: true } });
      if (!s) throw new LoiNghiepVu("Không tìm thấy sự cố.");
      let tuTrangThai: ("OPEN" | "ACKED" | "RESOLVED")[];
      let data: Prisma.AiLeadIncidentUpdateManyMutationInput;
      switch (input.hanhDong) {
        case "ACK":
          tuTrangThai = ["OPEN"];
          data = { state: "ACKED" };
          break;
        case "DONG":
          tuTrangThai = ["OPEN", "ACKED"];
          data = { state: "RESOLVED" };
          break;
        case "MO_LAI":
          tuTrangThai = ["RESOLVED"];
          // Mở lại tay cũng là «mở lại»: cron leo thang tính mốc từ đây và khoá thông báo theo lần (xem don-dep.ts).
          data = { state: "OPEN", moLaiLuc: bayGio, soLanMoLai: { increment: 1 } };
          break;
        case "GIAO": {
          if (!input.assigneeId) throw new LoiNghiepVu("Chọn người nhận.");
          if (!duocGiao?.has(input.assigneeId)) throw new LoiNghiepVu("Người nhận không hợp lệ.");
          const u = { id: input.assigneeId };
          tuTrangThai = ["OPEN", "ACKED"];
          data = { assigneeId: u.id };
          break;
        }
        case "BO_GIAO":
          tuTrangThai = ["OPEN", "ACKED"];
          data = { assigneeId: null };
          break;
      }
      // CÓ ĐIỀU KIỆN theo trạng thái đang thấy: đổi 0 dòng ⇒ có người vừa xử lý trước.
      const doi = await tx.aiLeadIncident.updateMany({ where: { id: s.id, state: { in: tuTrangThai } }, data });
      if (doi.count === 0) throw new LoiNghiepVu("Sự cố vừa được người khác xử lý — tải lại danh sách.");
      await writeAudit({
        actor: { id: ng.userId, name: ng.userName },
        module: "ai-lead",
        entityType: "AiLeadIncident",
        entityId: s.id,
        action: `AI_LEAD_SU_CO_${input.hanhDong}`,
        oldValues: { state: s.state, assigneeId: s.assigneeId },
        newValues: { hanhDong: input.hanhDong, assigneeId: input.assigneeId ?? null },
        reason: input.lyDo,
        tx,
      });
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof LoiNghiepVu) return { ok: false, error: err.message };
    throw err;
  }
}

export { LOAI_THEO_TANG };
export type { BangChungNhap };
