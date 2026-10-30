// lib/ai-lead/dich-vu/cau-hinh.ts — CẤU HÌNH AI Lead (lát K): agent & khoá, Page, cơ sở xuất bản, catalog, chính sách PROD.
//
// Tệp này là LỚP GHI. Nó KHÔNG hỏi quyền (không biết phiên): việc đó là của Server Action ở `app/(admin)/admin/ai-lead/*/_actions.ts`, nơi
// `checkPermission(...)` đứng NGAY ĐẦU thân (lint `authz/require-can-in-write-action`). Gọi các hàm này từ chỗ khác ⇒ chỗ gọi tự chịu trách nhiệm hỏi quyền.
//
// ─── BẤT BIẾN ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
//  · KHOÁ AGENT không được lưu, không được log, không được vào `writeAudit` (oldValues/newValues chỉ có `secretVersion`). Nó chỉ đi ra ở GIÁ TRỊ TRẢ của
//    `taoAgent` / `taoLaiKhoa` — một lần. `ghiNhatKy` còn chặn cứng mọi chuỗi 64-hex lọt vào nhật ký (dáng của khoá dẫn xuất).
//  · Thiếu `AI_LEAD_AGENT_MASTER_KEY` ⇒ TỪ CHỐI RÕ RÀNG trước mọi phép ghi (không tạo agent "không có khoá").
//  · SNAPSHOT catalog BẤT BIẾN: file này không có `update`/`delete`/`upsert` nào trên `aiLeadCatalogSnapshot` — chỉ `create`. Rollback = xuất bản LẠI nội dung cũ
//    thành version MỚI. Lưới `[AIK-CH-SRC-01]` đếm điều này trên mã đã bỏ chú thích.
//  · Agent PROD: TẠO được kể cả khi cổng PROD đóng (ra đời ở trạng thái TẮT); BẬT chỉ khi cổng PROD mở (`congProd()`). Cấp ≠ kích hoạt — Gateway còn chặn Agent PROD khi cổng đóng.
//  · Luật rollback: trong `$transaction`, từ chối = `throw` (LoiNghiepVu); cổng đứng TRƯỚC phép ghi đầu tiên.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { getNonEnrollableCenterIds } from "@/lib/enrollment-flow";
import { getSetting, setGlobalSetting } from "@/lib/settings/service";
import type { Actor } from "@/lib/auth/actor";
import { agentTestDuocChayTrenMayChu, congProd, docCaiDat, LOI_AGENT_TEST_TREN_PROD, type KetQuaCongProd } from "../cai-dat";
import { RE, laDanhTinhFixture } from "../hop-dong";
import { daoKhoaAgent, masterKeyCoSan } from "../khoa";
import type { MoiTruong, TrangThaiContract, TrangThaiPage } from "../kieu";
import { catalogResponseSchema } from "../schemas";
import { boQuyTacSchema, type QuyTac, type QuyTacNotify, type QuyTacSla } from "./bo-quy-tac-schema";
import { docSanSangNguon, type KetQuaSanSangNguon } from "./san-sang-nguon";
import { BoQuyTacKhongHopLe, chupBoQuyTac, docBoHienHanh, docLichSuBoQuyTac, docPayloadBoQuyTac, docTrangThaiBoQuyTac, PhienBanHong, PhienBanLech } from "./bo-quy-tac-db";
import {
  LoiCatalog,
  dungPayloadCatalog,
  jsonChuanTac,
  kiemToanVenSnapshot,
  soSanhCatalog,
  type KetQuaToanVen,
  tinhEtag,
  type HangXuatBan,
  type PayloadCatalog,
  type ThayDoiCatalog,
} from "./cau-hinh-thuan";

export type NguoiThaoTac = { userId: string; userName: string };
export type KetQua<T> = ({ ok: true } & T) | { ok: false; error: string };

export const LOI_THIEU_KHOA =
  "Máy chủ chưa đặt AI_LEAD_AGENT_MASTER_KEY (≥ 32 ký tự) — chưa tạo / đổi được khoá Agent. Báo bộ phận kỹ thuật.";

/** Ném trong `$transaction` để ROLLBACK; ngoài transaction được bắt và dịch thành `{ ok: false }`. */
class LoiNghiepVu extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoiNghiepVu";
  }
}

async function chayGiaoDich<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<{ ok: true; v: T } | { ok: false; error: string }> {
  try {
    return { ok: true, v: await db.$transaction(fn) };
  } catch (err) {
    if (err instanceof LoiNghiepVu || err instanceof LoiCatalog || err instanceof PhienBanLech || err instanceof PhienBanHong || err instanceof BoQuyTacKhongHopLe) return { ok: false, error: err.message };
    if ((err as { code?: unknown } | null)?.code === "P2002") return { ok: false, error: "Dữ liệu vừa bị người khác thay đổi — tải lại trang rồi thử lại." };
    // KHÔNG log `err` ở đây (lỗi Prisma có thể kèm giá trị cột). Ném tiếp: Next ghi nhận ở ranh giới action.
    throw err;
  }
}

const RE_CHUOI_GIONG_KHOA = /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/i;

/** Ghi nhật ký module "ai-lead". Chặn cứng chuỗi 64-hex (dáng khoá dẫn xuất) trong dữ liệu truyền vào. */
async function ghiNhatKy(
  tx: Prisma.TransactionClient,
  ng: NguoiThaoTac,
  p: {
    entityType: string;
    entityId: string;
    action: string;
    oldValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
    reason?: string;
  },
): Promise<void> {
  if (RE_CHUOI_GIONG_KHOA.test(JSON.stringify([p.oldValues ?? null, p.newValues ?? null, p.reason ?? null]))) {
    throw new Error("Nhật ký AI Lead bị từ chối: dữ liệu chứa chuỗi giống khoá bí mật.");
  }
  await writeAudit({
    actor: { id: ng.userId, name: ng.userName },
    module: "ai-lead",
    entityType: p.entityType,
    entityId: p.entityId,
    action: p.action,
    oldValues: p.oldValues ?? null,
    newValues: p.newValues ?? null,
    reason: p.reason,
    tx,
  });
}

async function cheMoCongProd(): Promise<string | null> {
  const c = await congProd();
  if (c.allowed) return null;
  return `Cổng PROD đang đóng (thiếu ${c.thieu.join(", ")}) — chưa tạo / bật được Agent môi trường PROD.`;
}

/** Cơ sở có được xuất bản / làm nơi nhận hồ sơ không: đang hoạt động, KHÔNG phải cơ sở không nhận ghi danh (Hội sở), có mã hợp lệ. */
async function kiemCoSoNhanKhach(id: string): Promise<{ id: string; code: string; name: string } | string> {
  const [c, khongNhan] = await Promise.all([
    db.center.findUnique({ where: { id }, select: { id: true, code: true, name: true, isActive: true } }),
    getNonEnrollableCenterIds(),
  ]);
  if (!c) return "Không tìm thấy cơ sở.";
  if (!c.isActive) return `Cơ sở "${c.name}" đã ngừng hoạt động.`;
  if (khongNhan.includes(c.id)) return `"${c.name}" không nhận ghi danh (Hội sở) — chỉ cơ sở dạy học mới nhận khách.`;
  if (c.code === null || !RE.campusCode.test(c.code)) return `Cơ sở "${c.name}" chưa có mã hợp lệ — khai mã ở trang cơ sở trước.`;
  return { id: c.id, code: c.code, name: c.name };
}

// ─── ĐỌC ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type AgentView = {
  id: string;
  name: string;
  environment: MoiTruong;
  secretVersion: number;
  active: boolean;
  contractStatus: TrangThaiContract;
  lastHeartbeatAt: Date | null;
  createdAt: Date;
  /** FIX-03: false ⇔ Agent TEST đang nằm trên máy chủ PROD (cổng Gateway đã chặn nó; màn hiện cảnh báo + nút vô hiệu hoá). Tính ở MÁY CHỦ khi đọc, không lưu. */
  moiTruongHopLe: boolean;
  /** `nguon` = kết quả CHẠY THỬ bộ quy nguồn thật cho Page này (chỉ đọc, không SĐT): lead chính thức của Page có ra nhóm nguồn Marketing HO qua PAGE_MAPPING không — không thì vào Ngoại lệ `NGUON_CHUA_CAU_HINH`. */
  pages: { pageId: string; state: TrangThaiPage; routingCenterId: string | null; note: string | null; nguon: KetQuaSanSangNguon }[];
};
export type XuatBanView = {
  pageId: string;
  campusCenterId: string;
  acceptingLeads: boolean;
  publicVisible: boolean;
  displayOrder: number;
  campus: { id: string; code: string | null; name: string; address: string; isActive: boolean };
};
export type SnapshotView = { version: number; publishedAt: Date; publishedByName: string | null; etag: string; soPage: number; soCoSo: number };

export type CauHinhView = {
  masterKeyOk: boolean;
  agents: AgentView[];
  xuatBan: XuatBanView[];
  coSoChon: { id: string; code: string; name: string }[];
  lichSu: SnapshotView[];
  hienHanh: { version: number; payload: PayloadCatalog } | null;
  /** Toàn vẹn của snapshot mới nhất (null = chưa xuất bản). `ok:false` ⇒ /catalog đang 503: nút Xuất bản phải BẬT dù nội dung không đổi (đường phục hồi). */
  hienHanhToanVen: KetQuaToanVen | null;
  xemTruoc: { thayDoi: ThayDoiCatalog[]; payload: PayloadCatalog | null; loi: string | null };
  chinhSach: { prodEnabled: boolean; consentPolicyStatus: "PENDING_LEGAL" | "APPROVED"; congProd: KetQuaCongProd };
};

function dem(payload: PayloadCatalog): { soPage: number; soCoSo: number } {
  return { soPage: payload.pages.length, soCoSo: payload.pages.reduce((a, p) => a + p.campuses.length, 0) };
}

function docPayloadDaLuu(json: Prisma.JsonValue): PayloadCatalog | null {
  const r = catalogResponseSchema.shape.data.shape.pages.safeParse((json as { pages?: unknown } | null)?.pages);
  return r.success ? { pages: r.data } : null;
}

export async function docCauHinh(bayGio: Date): Promise<CauHinhView> {
  const [agents, xuatBan, centers, khongNhan, snapshots, cai] = await Promise.all([
    db.aiLeadAgent.findMany({ orderBy: { createdAt: "asc" }, include: { pages: { orderBy: { pageId: "asc" } } } }),
    db.aiLeadCampusPublication.findMany({
      orderBy: [{ pageId: "asc" }, { displayOrder: "asc" }],
      include: { campus: { select: { id: true, code: true, name: true, address: true, isActive: true } } },
    }),
    db.center.findMany({ where: { isActive: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    getNonEnrollableCenterIds(),
    db.aiLeadCatalogSnapshot.findMany({ orderBy: { version: "desc" }, take: 10 }),
    docCaiDat(),
  ]);
  const congProdKq = await congProd();
  // Nguồn sẵn sàng theo TỪNG (Page, cơ sở nhận) — một lượt chạy thử mỗi cặp khác nhau (Page ít; docSanSangNguon tự nuốt lỗi ⇒ «không sẵn sàng», không làm sập trang).
  const cap = new Map<string, Promise<KetQuaSanSangNguon>>();
  const nguonCua = (pageId: string, centerId: string | null) => {
    const k = `${pageId}|${centerId ?? ""}`;
    if (!cap.has(k)) cap.set(k, docSanSangNguon({ pageId, centerId, now: bayGio }));
    return cap.get(k)!;
  };
  const nguonTheoPage = new Map<string, KetQuaSanSangNguon>();
  await Promise.all(agents.flatMap((a) => a.pages.map(async (p) => nguonTheoPage.set(`${a.id}|${p.pageId}`, await nguonCua(p.pageId, p.routingCenterId)))));

  const nguoiXb = [...new Set(snapshots.map((s) => s.publishedById).filter((x): x is string => !!x))];
  const ten = nguoiXb.length ? await db.user.findMany({ where: { id: { in: nguoiXb } }, select: { id: true, name: true, email: true } }) : [];
  const tenTheoId = new Map(ten.map((u) => [u.id, u.name ?? u.email ?? u.id]));

  const lichSu: SnapshotView[] = snapshots.map((s) => {
    const p = docPayloadDaLuu(s.payload);
    return {
      version: s.version,
      publishedAt: s.publishedAt,
      publishedByName: s.publishedById ? (tenTheoId.get(s.publishedById) ?? null) : null,
      etag: s.etag,
      ...(p ? dem(p) : { soPage: 0, soCoSo: 0 }),
    };
  });
  const moiNhat = snapshots[0];
  const hienPayload = moiNhat ? docPayloadDaLuu(moiNhat.payload) : null;
  const hienHanh = moiNhat && hienPayload ? { version: moiNhat.version, payload: hienPayload } : null;
  const hienHanhToanVen = moiNhat ? kiemToanVenSnapshot({ version: moiNhat.version, etag: moiNhat.etag, payload: moiNhat.payload }) : null;

  const xb: XuatBanView[] = xuatBan.map((x) => ({
    pageId: x.pageId,
    campusCenterId: x.campusCenterId,
    acceptingLeads: x.acceptingLeads,
    publicVisible: x.publicVisible,
    displayOrder: x.displayOrder,
    campus: x.campus,
  }));

  // Xem trước: dựng payload từ cấu hình HIỆN TẠI. Lỗi (cơ sở ngừng hoạt động…) hiện thành `loi`, KHÔNG làm sập trang.
  const pageIds = [...new Set(agents.flatMap((a) => a.pages.map((p) => p.pageId)))];
  let xemTruoc: CauHinhView["xemTruoc"];
  try {
    const payload = dungPayloadCatalog(pageIds, xb as HangXuatBan[]);
    xemTruoc = { payload, thayDoi: soSanhCatalog(hienHanh?.payload ?? null, payload), loi: null };
  } catch (err) {
    if (!(err instanceof LoiCatalog)) throw err;
    xemTruoc = { payload: null, thayDoi: [], loi: err.message };
  }

  return {
    masterKeyOk: masterKeyCoSan(),
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      environment: a.environment,
      secretVersion: a.secretVersion,
      active: a.active,
      contractStatus: a.contractStatus,
      lastHeartbeatAt: a.lastHeartbeatAt,
      createdAt: a.createdAt,
      moiTruongHopLe: a.environment !== "TEST" || agentTestDuocChayTrenMayChu(),
      pages: a.pages.map((p) => ({ pageId: p.pageId, state: p.state, routingCenterId: p.routingCenterId, note: p.note, nguon: nguonTheoPage.get(`${a.id}|${p.pageId}`)! })),
    })),
    xuatBan: xb,
    coSoChon: centers.filter((c): c is { id: string; code: string; name: string } => c.code !== null && RE.campusCode.test(c.code) && !khongNhan.includes(c.id)),
    lichSu,
    hienHanh,
    hienHanhToanVen,
    xemTruoc,
    chinhSach: { prodEnabled: cai.prodEnabled, consentPolicyStatus: cai.consentPolicyStatus, congProd: congProdKq },
  };
}

// ─── AGENT & KHOÁ ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type AgentMoi = { agentId: string; name: string; environment: MoiTruong; secretVersion: number; agentSecret: string; /** false = tạo ở trạng thái TẮT (Agent PROD khi cổng PROD đóng). */ active: boolean };

export async function taoAgent(ng: NguoiThaoTac, input: { name: string; environment: MoiTruong }): Promise<KetQua<AgentMoi>> {
  if (!masterKeyCoSan()) return { ok: false, error: LOI_THIEU_KHOA };
  if (input.environment === "TEST" && !agentTestDuocChayTrenMayChu()) return { ok: false, error: LOI_AGENT_TEST_TREN_PROD };
  // Cấp ≠ kích hoạt: Agent PROD luôn tạo được (để chuẩn bị Page/khoá trước), nhưng chỉ BẬT khi cổng PROD mở. Cổng đóng ⇒ ra đời ở trạng thái TẮT.
  const batNgay = input.environment !== "PROD" || (await cheMoCongProd()) === null;
  const r = await chayGiaoDich(async (tx) => {
    const a = await tx.aiLeadAgent.create({
      data: { name: input.name, environment: input.environment, createdById: ng.userId, active: batNgay },
      select: { id: true },
    });
    // P4: danh tính của gói bàn giao không bao giờ được là agent thật.
    if (laDanhTinhFixture({ agentId: a.id })) throw new LoiNghiepVu("Mã Agent trùng danh tính mẫu của gói bàn giao — thử tạo lại.");
    const khoa = daoKhoaAgent(a.id, 1);
    if (khoa === null) throw new LoiNghiepVu(LOI_THIEU_KHOA);
    if (laDanhTinhFixture({ agentSecret: khoa })) throw new LoiNghiepVu("Khoá sinh ra trùng khoá mẫu của gói bàn giao.");
    await ghiNhatKy(tx, ng, {
      entityType: "AiLeadAgent",
      entityId: a.id,
      action: "AI_LEAD_AGENT_TAO",
      newValues: { name: input.name, environment: input.environment, secretVersion: 1, active: batNgay },
    });
    return { agentId: a.id, agentSecret: khoa };
  });
  if (!r.ok) return r;
  return { ok: true, agentId: r.v.agentId, name: input.name, environment: input.environment, secretVersion: 1, agentSecret: r.v.agentSecret, active: batNgay };
}

export async function taoLaiKhoa(
  ng: NguoiThaoTac,
  input: { agentId: string; secretVersionDangThay: number; lyDo: string },
): Promise<KetQua<{ agentId: string; name: string; environment: MoiTruong; secretVersion: number; agentSecret: string }>> {
  if (!masterKeyCoSan()) return { ok: false, error: LOI_THIEU_KHOA };
  const r = await chayGiaoDich(async (tx) => {
    const a = await tx.aiLeadAgent.findUnique({ where: { id: input.agentId }, select: { id: true, name: true, environment: true, secretVersion: true } });
    if (!a) throw new LoiNghiepVu("Không tìm thấy Agent.");
    // Khoá mới cho Agent TEST trên máy chủ PROD là cấp thêm đường vào cho thứ đã bị cấm chạy ở đây — chặn trước khi đổi gì.
    if (a.environment === "TEST" && !agentTestDuocChayTrenMayChu()) throw new LoiNghiepVu(LOI_AGENT_TEST_TREN_PROD);
    const cu = input.secretVersionDangThay;
    const moi = cu + 1;
    // CÓ ĐIỀU KIỆN theo version màn đang thấy: đổi 0 dòng ⇒ có người vừa đổi trước — KHÔNG trả khoá nào. Bỏ điều kiện này là hai người cùng bấm sẽ nhận
    // hai khoá khác nhau cho cùng một version (đua), một trong hai khoá chết ngay sau đó mà không ai biết.
    const doi = await tx.aiLeadAgent.updateMany({ where: { id: a.id, secretVersion: cu }, data: { secretVersion: moi } });
    if (doi.count === 0) throw new LoiNghiepVu("Khoá vừa được người khác đổi — tải lại trang rồi thử lại.");
    const khoa = daoKhoaAgent(a.id, moi);
    if (khoa === null) throw new LoiNghiepVu(LOI_THIEU_KHOA);
    await ghiNhatKy(tx, ng, {
      entityType: "AiLeadAgent",
      entityId: a.id,
      action: "AI_LEAD_AGENT_TAO_LAI_KHOA",
      oldValues: { secretVersion: cu },
      newValues: { secretVersion: moi },
      reason: input.lyDo,
    });
    return { agent: a, moi, khoa };
  });
  if (!r.ok) return r;
  return { ok: true, agentId: r.v.agent.id, name: r.v.agent.name, environment: r.v.agent.environment, secretVersion: r.v.moi, agentSecret: r.v.khoa };
}

/** Công tắc khẩn: tắt ⇒ mọi yêu cầu của agent bị 401 AGENT_DISABLED. BẬT lại agent PROD đi qua cổng PROD. */
export async function datHoatDongAgent(ng: NguoiThaoTac, input: { agentId: string; active: boolean; lyDo: string }): Promise<KetQua<object>> {
  const a = await db.aiLeadAgent.findUnique({ where: { id: input.agentId }, select: { id: true, name: true, environment: true, active: true } });
  if (!a) return { ok: false, error: "Không tìm thấy Agent." };
  if (input.active && a.environment === "TEST" && !agentTestDuocChayTrenMayChu()) return { ok: false, error: LOI_AGENT_TEST_TREN_PROD };
  if (input.active && a.environment === "PROD") {
    const chan = await cheMoCongProd();
    if (chan) return { ok: false, error: chan };
  }
  const r = await chayGiaoDich(async (tx) => {
    await tx.aiLeadAgent.update({ where: { id: a.id }, data: { active: input.active } });
    await ghiNhatKy(tx, ng, {
      entityType: "AiLeadAgent",
      entityId: a.id,
      action: input.active ? "AI_LEAD_AGENT_BAT" : "AI_LEAD_AGENT_TAT",
      oldValues: { active: a.active },
      newValues: { active: input.active, name: a.name },
      reason: input.lyDo,
    });
  });
  return r.ok ? { ok: true } : r;
}

/**
 * FIX-03 — dọn Agent TEST đã tồn tại trên máy chủ PROD: TẮT (`active=false`), KHÔNG xoá (giữ nguyên Page, nhật ký, khoá, hội thoại để điều tra). Mỗi Agent một dòng nhật ký.
 * Idempotent (chạy lại ⇒ 0 Agent). Trên máy chủ cho phép Agent TEST thì từ chối — đây là thao tác dọn PROD, không phải công tắc chung. Gateway đã chặn các Agent này từ trước
 * (fail-closed); việc tắt cho trạng thái nói đúng sự thật và để không ai "bật lại" nhầm.
 */
export async function voHieuHoaAgentTestTrenProd(ng: NguoiThaoTac, input: { lyDo: string }): Promise<KetQua<{ soAgent: number; agentIds: string[] }>> {
  if (agentTestDuocChayTrenMayChu()) return { ok: false, error: "Máy chủ này cho phép Agent TEST — không có gì để vô hiệu hoá." };
  const r = await chayGiaoDich(async (tx) => {
    const ds = await tx.aiLeadAgent.findMany({ where: { environment: "TEST", active: true }, select: { id: true, name: true }, orderBy: { id: "asc" } });
    const daTat: string[] = [];
    for (const a of ds) {
      // Điều kiện `active: true` trong WHERE: hai người cùng bấm ⇒ người sau ghi 0 dòng và KHÔNG ghi nhật ký thừa.
      const u = await tx.aiLeadAgent.updateMany({ where: { id: a.id, active: true }, data: { active: false } });
      if (u.count === 0) continue;
      daTat.push(a.id);
      await ghiNhatKy(tx, ng, {
        entityType: "AiLeadAgent",
        entityId: a.id,
        action: "AI_LEAD_AGENT_TAT_TEST_TREN_PROD",
        oldValues: { active: true },
        newValues: { active: false, name: a.name, environment: "TEST" },
        reason: input.lyDo,
      });
    }
    return daTat;
  });
  return r.ok ? { ok: true, soAgent: r.v.length, agentIds: r.v } : r;
}

/** Công tắc TAY của Admin (P7). `INCOMPATIBLE` ⇒ /lead-intakes của agent bị từ chối. Hash lạ KHÔNG tự đổi trạng thái này. */
export async function datContractStatus(
  ng: NguoiThaoTac,
  input: { agentId: string; contractStatus: TrangThaiContract; lyDo: string },
): Promise<KetQua<object>> {
  const a = await db.aiLeadAgent.findUnique({ where: { id: input.agentId }, select: { id: true, contractStatus: true } });
  if (!a) return { ok: false, error: "Không tìm thấy Agent." };
  const r = await chayGiaoDich(async (tx) => {
    await tx.aiLeadAgent.update({ where: { id: a.id }, data: { contractStatus: input.contractStatus } });
    await ghiNhatKy(tx, ng, {
      entityType: "AiLeadAgent",
      entityId: a.id,
      action: "AI_LEAD_AGENT_DAT_CONTRACT",
      oldValues: { contractStatus: a.contractStatus },
      newValues: { contractStatus: input.contractStatus },
      reason: input.lyDo,
    });
  });
  return r.ok ? { ok: true } : r;
}

// ─── PAGE (allowlist của agent) ──────────────────────────────────────────────────────────────────────────────────────────

export async function themPageChoAgent(
  ng: NguoiThaoTac,
  input: { agentId: string; pageId: string; routingCenterId?: string | null; note?: string },
): Promise<KetQua<object>> {
  if (laDanhTinhFixture({ pageId: input.pageId })) return { ok: false, error: "pageId này là Page mẫu của gói bàn giao — không dùng được." };
  const a = await db.aiLeadAgent.findUnique({ where: { id: input.agentId }, select: { id: true } });
  if (!a) return { ok: false, error: "Không tìm thấy Agent." };
  if (input.routingCenterId) {
    const c = await kiemCoSoNhanKhach(input.routingCenterId);
    if (typeof c === "string") return { ok: false, error: c };
  }
  const r = await chayGiaoDich(async (tx) => {
    const co = await tx.aiLeadAgentPage.findUnique({ where: { agentId_pageId: { agentId: a.id, pageId: input.pageId } }, select: { id: true } });
    if (co) throw new LoiNghiepVu("Agent này đã được cấp Page đó.");
    await tx.aiLeadAgentPage.create({
      data: { agentId: a.id, pageId: input.pageId, routingCenterId: input.routingCenterId ?? null, note: input.note ?? null },
    });
    await ghiNhatKy(tx, ng, {
      entityType: "AiLeadAgentPage",
      entityId: `${a.id}:${input.pageId}`,
      action: "AI_LEAD_PAGE_THEM",
      newValues: { agentId: a.id, pageId: input.pageId, routingCenterId: input.routingCenterId ?? null },
    });
    await chupBoQuyTac(tx, ng, { lyDo: "Thêm Page cho Agent", hanhDong: "AI_LEAD_BO_QUY_TAC_THEM_PAGE" });
  });
  return r.ok ? { ok: true } : r;
}

export async function goPageKhoiAgent(ng: NguoiThaoTac, input: { agentId: string; pageId: string; lyDo: string }): Promise<KetQua<object>> {
  const r = await chayGiaoDich(async (tx) => {
    const p = await tx.aiLeadAgentPage.findUnique({ where: { agentId_pageId: { agentId: input.agentId, pageId: input.pageId } } });
    if (!p) throw new LoiNghiepVu("Agent không có Page đó.");
    await tx.aiLeadAgentPage.delete({ where: { id: p.id } });
    await ghiNhatKy(tx, ng, {
      entityType: "AiLeadAgentPage",
      entityId: `${input.agentId}:${input.pageId}`,
      action: "AI_LEAD_PAGE_GO",
      oldValues: { state: p.state, routingCenterId: p.routingCenterId },
      reason: input.lyDo,
    });
    await chupBoQuyTac(tx, ng, { lyDo: input.lyDo, hanhDong: "AI_LEAD_BO_QUY_TAC_GO_PAGE" });
  });
  return r.ok ? { ok: true } : r;
}

/** Tạm dừng / bật lại MỘT Page của MỘT agent. PAUSED ⇒ agent ngừng gọi /lead-intakes cho Page đó (vẫn dùng được /handoffs). */
export async function datTrangThaiPage(
  ng: NguoiThaoTac,
  input: { agentId: string; pageId: string; state: TrangThaiPage; lyDo: string },
): Promise<KetQua<object>> {
  const r = await chayGiaoDich(async (tx) => {
    const p = await tx.aiLeadAgentPage.findUnique({ where: { agentId_pageId: { agentId: input.agentId, pageId: input.pageId } } });
    if (!p) throw new LoiNghiepVu("Agent không có Page đó.");
    await tx.aiLeadAgentPage.update({ where: { id: p.id }, data: { state: input.state } });
    await ghiNhatKy(tx, ng, {
      entityType: "AiLeadAgentPage",
      entityId: `${input.agentId}:${input.pageId}`,
      action: input.state === "PAUSED" ? "AI_LEAD_PAGE_TAM_DUNG" : "AI_LEAD_PAGE_BAT_LAI",
      oldValues: { state: p.state },
      newValues: { state: input.state },
      reason: input.lyDo,
    });
  });
  return r.ok ? { ok: true } : r;
}

export async function datCoSoNhanMacDinh(
  ng: NguoiThaoTac,
  input: { agentId: string; pageId: string; routingCenterId: string | null },
): Promise<KetQua<object>> {
  if (input.routingCenterId) {
    const c = await kiemCoSoNhanKhach(input.routingCenterId);
    if (typeof c === "string") return { ok: false, error: c };
  }
  const r = await chayGiaoDich(async (tx) => {
    const p = await tx.aiLeadAgentPage.findUnique({ where: { agentId_pageId: { agentId: input.agentId, pageId: input.pageId } } });
    if (!p) throw new LoiNghiepVu("Agent không có Page đó.");
    await tx.aiLeadAgentPage.update({ where: { id: p.id }, data: { routingCenterId: input.routingCenterId } });
    await ghiNhatKy(tx, ng, {
      entityType: "AiLeadAgentPage",
      entityId: `${input.agentId}:${input.pageId}`,
      action: "AI_LEAD_PAGE_DAT_CO_SO_NHAN",
      oldValues: { routingCenterId: p.routingCenterId },
      newValues: { routingCenterId: input.routingCenterId },
    });
    await chupBoQuyTac(tx, ng, { lyDo: "Đặt cơ sở nhận mặc định của Page", hanhDong: "AI_LEAD_BO_QUY_TAC_DAT_CO_SO_NHAN" });
  });
  return r.ok ? { ok: true } : r;
}

// ─── CƠ SỞ XUẤT BẢN ──────────────────────────────────────────────────────────────────────────────────────────────────────

export async function luuCoSoXuatBan(
  ng: NguoiThaoTac,
  input: { pageId: string; campusCenterId: string; acceptingLeads: boolean; publicVisible: boolean; displayOrder: number },
): Promise<KetQua<object>> {
  if (laDanhTinhFixture({ pageId: input.pageId })) return { ok: false, error: "pageId này là Page mẫu của gói bàn giao — không dùng được." };
  const c = await kiemCoSoNhanKhach(input.campusCenterId);
  if (typeof c === "string") return { ok: false, error: c };
  const r = await chayGiaoDich(async (tx) => {
    // Gõ nhầm pageId sẽ tạo "Page ma" ngay trong catalog — chỉ nhận Page đã được cấp cho ít nhất một Agent.
    const duocCap = await tx.aiLeadAgentPage.findFirst({ where: { pageId: input.pageId }, select: { id: true } });
    if (!duocCap) throw new LoiNghiepVu("Page này chưa được cấp cho Agent nào — thêm Page vào Agent trước khi xuất bản cơ sở.");
    const cu = await tx.aiLeadCampusPublication.findUnique({
      where: { pageId_campusCenterId: { pageId: input.pageId, campusCenterId: c.id } },
    });
    const data = { acceptingLeads: input.acceptingLeads, publicVisible: input.publicVisible, displayOrder: input.displayOrder };
    await tx.aiLeadCampusPublication.upsert({
      where: { pageId_campusCenterId: { pageId: input.pageId, campusCenterId: c.id } },
      create: { pageId: input.pageId, campusCenterId: c.id, ...data },
      update: data,
    });
    await ghiNhatKy(tx, ng, {
      entityType: "AiLeadCampusPublication",
      entityId: `${input.pageId}:${c.code}`,
      action: cu ? "AI_LEAD_CO_SO_SUA" : "AI_LEAD_CO_SO_THEM",
      oldValues: cu ? { acceptingLeads: cu.acceptingLeads, publicVisible: cu.publicVisible, displayOrder: cu.displayOrder } : null,
      newValues: data,
    });
  });
  return r.ok ? { ok: true } : r;
}

export async function goCoSoXuatBan(ng: NguoiThaoTac, input: { pageId: string; campusCenterId: string }): Promise<KetQua<object>> {
  const r = await chayGiaoDich(async (tx) => {
    const cu = await tx.aiLeadCampusPublication.findUnique({
      where: { pageId_campusCenterId: { pageId: input.pageId, campusCenterId: input.campusCenterId } },
    });
    if (!cu) throw new LoiNghiepVu("Page chưa xuất bản cơ sở đó.");
    await tx.aiLeadCampusPublication.delete({ where: { id: cu.id } });
    await ghiNhatKy(tx, ng, {
      entityType: "AiLeadCampusPublication",
      entityId: `${input.pageId}:${input.campusCenterId}`,
      action: "AI_LEAD_CO_SO_GO",
      oldValues: { acceptingLeads: cu.acceptingLeads, publicVisible: cu.publicVisible, displayOrder: cu.displayOrder },
    });
  });
  return r.ok ? { ok: true } : r;
}

// ─── CATALOG ───────────────────────────────────────────────────────────────────────────────────────────────────────────

async function taoSnapshot(
  tx: Prisma.TransactionClient,
  ng: NguoiThaoTac,
  payload: PayloadCatalog,
  action: "AI_LEAD_CATALOG_XUAT_BAN" | "AI_LEAD_CATALOG_XUAT_BAN_LAI",
  lyDo: string,
  nguon?: number,
): Promise<{ version: number; etag: string }> {
  const moiNhat = await tx.aiLeadCatalogSnapshot.findFirst({ orderBy: { version: "desc" }, select: { version: true, payload: true, etag: true } });
  const hien = moiNhat ? docPayloadDaLuu(moiNhat.payload) : null;
  // Bản hiện hành KHÔNG toàn vẹn (vd. etag bị sửa tay) thì /catalog đang 503: «nội dung giống hệt» KHÔNG được chặn việc xuất bản lại — đó chính là đường phục hồi mà cảnh báo ở Trung tâm kết nối chỉ cho người dùng.
  const hienToanVen = moiNhat ? kiemToanVenSnapshot({ version: moiNhat.version, etag: moiNhat.etag, payload: moiNhat.payload }).ok : true;
  if (hien && hienToanVen && jsonChuanTac(hien) === jsonChuanTac(payload)) {
    throw new LoiNghiepVu("Nội dung giống hệt bản đang hiện hành — không có gì để xuất bản.");
  }
  const version = (moiNhat?.version ?? 0) + 1;
  const etag = tinhEtag(version, payload);
  // `version` có @unique: hai người xuất bản cùng lúc ⇒ người sau P2002 ⇒ `chayGiaoDich` dịch thành "tải lại".
  await tx.aiLeadCatalogSnapshot.create({
    data: { version, etag, payload: payload as unknown as Prisma.InputJsonValue, publishedById: ng.userId },
  });
  await ghiNhatKy(tx, ng, {
    entityType: "AiLeadCatalogSnapshot",
    entityId: String(version),
    action,
    oldValues: moiNhat ? { version: moiNhat.version } : null,
    newValues: { version, ...dem(payload), ...(nguon !== undefined ? { saoTuVersion: nguon } : {}) },
    reason: lyDo,
  });
  return { version, etag };
}

export async function xuatBanCatalog(ng: NguoiThaoTac, input: { lyDo: string }): Promise<KetQua<{ version: number; etag: string }>> {
  const r = await chayGiaoDich(async (tx) => {
    const [agentPages, hang] = await Promise.all([
      tx.aiLeadAgentPage.findMany({ select: { pageId: true } }),
      tx.aiLeadCampusPublication.findMany({
        include: { campus: { select: { id: true, code: true, name: true, address: true, isActive: true } } },
      }),
    ]);
    const payload = dungPayloadCatalog(
      agentPages.map((p) => p.pageId),
      hang as HangXuatBan[],
    );
    return taoSnapshot(tx, ng, payload, "AI_LEAD_CATALOG_XUAT_BAN", input.lyDo);
  });
  return r.ok ? { ok: true, ...r.v } : r;
}

/** Rollback = xuất bản LẠI nội dung của một version cũ thành version MỚI. Snapshot cũ KHÔNG bị sửa. */
export async function xuatBanLai(ng: NguoiThaoTac, input: { version: number; lyDo: string }): Promise<KetQua<{ version: number; etag: string }>> {
  const r = await chayGiaoDich(async (tx) => {
    const cu = await tx.aiLeadCatalogSnapshot.findUnique({ where: { version: input.version } });
    if (!cu) throw new LoiNghiepVu("Không tìm thấy phiên bản catalog đó.");
    const payload = docPayloadDaLuu(cu.payload);
    if (!payload) throw new LoiNghiepVu("Phiên bản đó không đọc được (không đúng hợp đồng) — không xuất bản lại được.");
    return taoSnapshot(tx, ng, payload, "AI_LEAD_CATALOG_XUAT_BAN_LAI", input.lyDo, cu.version);
  });
  return r.ok ? { ok: true, ...r.v } : r;
}

// ─── CHÍNH SÁCH / CỔNG PROD ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Đổi `ai.prodEnabled` / `ai.consentPolicyStatus`. Đi qua `setGlobalSetting` (đòi `actor.isSuperAdmin` — ngoài `ai-leads:policy` mà action đã hỏi) rồi GHI THÊM một
 * dòng nhật ký module "ai-lead" (`setGlobalSetting` chỉ ghi module "settings"). Bật `prodEnabled` khi chính sách chưa APPROVED là hợp lệ — cổng vẫn đóng (cần CẢ HAI).
 */
export async function doiChinhSach(
  actor: Actor,
  ng: NguoiThaoTac,
  input: { key: "ai.prodEnabled"; value: boolean; lyDo: string } | { key: "ai.consentPolicyStatus"; value: "PENDING_LEGAL" | "APPROVED"; lyDo: string },
): Promise<KetQua<object>> {
  const cu = await docCaiDat();
  const giaTriCu = input.key === "ai.prodEnabled" ? cu.prodEnabled : cu.consentPolicyStatus;
  const kq = await setGlobalSetting(actor, { key: input.key, value: input.value, reason: input.lyDo, actorName: ng.userName });
  if (!kq.ok) return { ok: false, error: kq.error.message };
  await chayGiaoDich(async (tx) => {
    await ghiNhatKy(tx, ng, {
      entityType: "AiLeadPolicy",
      entityId: input.key,
      action: "AI_LEAD_CHINH_SACH_DOI",
      oldValues: { value: giaTriCu },
      newValues: { value: input.value },
      reason: input.lyDo,
    });
  });
  return { ok: true };
}

// ─── QUY TẮC THEO PAGE (E2): tự tạo lead ───────────────────────────────────────────────────────────────────────────────────

export type QuyTacTuTaoView = {
  /** `ai.autoCreateEnabled` — công tắc TOÀN HỆ. Đọc lỗi ⇒ false (fail-closed: màn không hứa điều chưa chắc). */
  toanHe: boolean;
  /** Các Page đang BẬT cờ riêng, dạng `"agentId:pageId"`. */
  batTheo: string[];
};

/** Đọc cho màn Cấu hình. Cố ý tách khỏi `docCauHinh` (kiểu `AgentView` được Agent/Trung tâm kết nối dùng chung): cờ này là cấu hình nội bộ Admin. */
export async function docQuyTacTuTao(): Promise<QuyTacTuTaoView> {
  const [bat, toanHe] = await Promise.all([
    db.aiLeadAgentPage.findMany({ where: { autoCreate: true }, select: { agentId: true, pageId: true } }),
    getSetting("ai.autoCreateEnabled").then((v) => v === true, () => false),
  ]);
  return { toanHe, batTheo: bat.map((p) => `${p.agentId}:${p.pageId}`) };
}

/**
 * Bật / tắt TỰ TẠO LEAD cho MỘT Page của MỘT agent. Cấu hình TRƯỚC khi bật công tắc toàn hệ là hợp lệ (màn nói rõ "đang chờ công tắc toàn hệ").
 * Đổi sang đúng giá trị đang có ⇒ từ chối (màn đang cũ) thay vì ghi một dòng nhật ký vô nghĩa.
 */
export async function datTuTaoLeadChoPage(
  ng: NguoiThaoTac,
  input: { agentId: string; pageId: string; bat: boolean; lyDo: string },
): Promise<KetQua<object>> {
  const r = await chayGiaoDich(async (tx) => {
    const p = await tx.aiLeadAgentPage.findUnique({ where: { agentId_pageId: { agentId: input.agentId, pageId: input.pageId } } });
    if (!p) throw new LoiNghiepVu("Agent không có Page đó.");
    if (p.autoCreate === input.bat) throw new LoiNghiepVu("Page đã ở trạng thái đó — tải lại trang rồi thử lại.");
    await tx.aiLeadAgentPage.update({ where: { id: p.id }, data: { autoCreate: input.bat } });
    await ghiNhatKy(tx, ng, {
      entityType: "AiLeadAgentPage",
      entityId: `${input.agentId}:${input.pageId}`,
      action: input.bat ? "AI_LEAD_PAGE_TU_TAO_BAT" : "AI_LEAD_PAGE_TU_TAO_TAT",
      oldValues: { autoCreate: p.autoCreate },
      newValues: { autoCreate: input.bat },
      reason: input.lyDo,
    });
    await chupBoQuyTac(tx, ng, { lyDo: input.lyDo, hanhDong: "AI_LEAD_BO_QUY_TAC_TU_TAO" });
  });
  return r.ok ? { ok: true } : r;
}

// ─── BỘ QUY TẮC CÓ VERSION (Rule Builder) ───────────────────────────────────────────────────────────────────────────────────
// Mô hình + vì sao cột vẫn là sự thật chạy nhanh: xem đầu `bo-quy-tac-db.ts`. Ở đây là các hành động Admin NGOÀI bốn hành động đổi cột (đã tự chụp phiên bản).

/**
 * Kiểm quy tắc với THẾ GIỚI SỐNG (cơ sở còn hoạt động / có mã hợp lệ / không phải Hội sở; Page còn được cấp cho Agent nào đó). Trả danh sách câu lỗi tiếng Việt; rỗng = hợp lệ.
 * Cùng một hàm cho lưu mới VÀ khôi phục: phiên bản cũ có thể trỏ tới cơ sở đã ngừng — không được khôi phục mù.
 */
async function kiemQuyTacTheoTheGioiSong(tx: Prisma.TransactionClient, rules: readonly QuyTac[]): Promise<string[]> {
  const loi: string[] = [];
  const cacPage = new Set((await tx.aiLeadAgentPage.findMany({ select: { agentId: true, pageId: true } })).flatMap((p) => [`${p.agentId}|${p.pageId}`, `*|${p.pageId}`]));
  const cacCoSo = new Map<string, string | true>();
  const kiemCoSo = async (id: string, nhanKhach: boolean): Promise<string | null> => {
    const khoa = `${nhanKhach ? "n" : "t"}:${id}`;
    if (!cacCoSo.has(khoa)) {
      if (nhanKhach) {
        const c = await kiemCoSoNhanKhach(id);
        cacCoSo.set(khoa, typeof c === "string" ? c : true);
      } else {
        const c = await tx.center.findUnique({ where: { id }, select: { isActive: true, name: true } });
        cacCoSo.set(khoa, !c ? "Cơ sở không tồn tại." : !c.isActive ? `Cơ sở "${c.name}" đã ngừng hoạt động.` : true);
      }
    }
    const v = cacCoSo.get(khoa)!;
    return v === true ? null : v;
  };
  for (const r of rules) {
    if (r.kind === "ROUTE_PAGE_TO_CAMPUS") {
      if (!cacPage.has(`${r.agentId}|${r.pageId}`)) continue; // Page đã bị gỡ khỏi Agent: quy tắc vô nghĩa, bỏ qua (không chặn khôi phục)
      if (r.centerId) {
        const e = await kiemCoSo(r.centerId, true);
        if (e) loi.push(`Page ${r.pageId}: ${e}`);
      }
    } else if (r.kind === "AUTO_CREATE") {
      for (const c of r.campusCenterIds ?? []) {
        const e = await kiemCoSo(c, false);
        if (e) loi.push(`Tự tạo lead Page ${r.pageId}: ${e}`);
      }
    } else if (r.kind === "SLA") {
      if (r.scope.type === "PAGE" && !cacPage.has(`*|${r.scope.pageId}`)) loi.push(`SLA: Page ${r.scope.pageId} chưa được cấp cho Agent nào.`);
      if (r.scope.type === "CAMPUS") {
        const e = await kiemCoSo(r.scope.centerId, false);
        if (e) loi.push(`SLA: ${e}`);
      }
    } else if (r.kind === "NOTIFY" && r.centerId) {
      const e = await kiemCoSo(r.centerId, false);
      if (e) loi.push(`Thông báo: ${e}`);
    }
  }
  return loi;
}

const CAU_BO_KHONG_HOP_LE = "Bộ quy tắc không hợp lệ";

/** Thay TOÀN BỘ quy tắc SLA + NOTIFY (các loại khác giữ nguyên). Mỗi lần lưu = một phiên bản mới có lý do; nội dung không đổi ⇒ từ chối (không tạo phiên bản rỗng). */
export async function luuSlaThongBao(ng: NguoiThaoTac, input: { baseVersion: number; rules: unknown[]; lyDo: string }): Promise<KetQua<{ version: number }>> {
  const p = boQuyTacSchema.safeParse({ rules: input.rules });
  if (!p.success) return { ok: false, error: `${CAU_BO_KHONG_HOP_LE}: ${p.error.issues[0]?.message ?? "sai định dạng"}` };
  const moi = p.data.rules;
  if (moi.some((r) => r.kind !== "SLA" && r.kind !== "NOTIFY")) return { ok: false, error: "Màn này chỉ lưu quy tắc SLA và thông báo." };
  const r = await chayGiaoDich(async (tx) => {
    const loi = await kiemQuyTacTheoTheGioiSong(tx, moi);
    if (loi.length > 0) throw new LoiNghiepVu(loi.join(" "));
    const ch = await chupBoQuyTac(tx, ng, {
      lyDo: input.lyDo,
      hanhDong: "AI_LEAD_BO_QUY_TAC_SLA_THONG_BAO",
      baseVersion: input.baseVersion,
      bien: (cu) => [...cu.filter((x) => x.kind !== "SLA" && x.kind !== "NOTIFY"), ...(moi as (QuyTacSla | QuyTacNotify)[])],
    });
    if (!ch.doi) throw new LoiNghiepVu("Nội dung giống hệt phiên bản đang áp dụng — không có gì để lưu.");
    return ch.version;
  });
  return r.ok ? { ok: true, version: r.v } : r;
}

// Khoá lạc quan (`baseVersion`) được kiểm BÊN TRONG `chupBoQuyTac`, trên đúng lần đọc phiên bản mới nhất dùng để chụp — xem chú thích ở đó.

/** Sửa ràng buộc THU HẸP của tự tạo lead cho MỘT Page. Không bao giờ bật/tắt `autoCreate` (việc đó ở `datTuTaoLeadChoPage`, có cổng riêng): quy tắc chỉ thu hẹp. */
export async function datRangBuocTuTao(
  ng: NguoiThaoTac,
  input: { baseVersion: number; agentId: string; pageId: string; requireConsent: boolean; campusCenterIds: string[]; lyDo: string },
): Promise<KetQua<{ version: number }>> {
  const r = await chayGiaoDich(async (tx) => {
    const p = await tx.aiLeadAgentPage.findUnique({ where: { agentId_pageId: { agentId: input.agentId, pageId: input.pageId } }, select: { autoCreate: true } });
    if (!p) throw new LoiNghiepVu("Agent không có Page đó.");
    if (!p.autoCreate) throw new LoiNghiepVu("Page này đang TẮT tự tạo lead — bật tự tạo lead trước rồi mới đặt ràng buộc thu hẹp.");
    const ds = [...new Set(input.campusCenterIds)].sort();
    const loi = await kiemQuyTacTheoTheGioiSong(tx, [{ kind: "AUTO_CREATE", agentId: input.agentId, pageId: input.pageId, enabled: true, campusCenterIds: ds }]);
    if (loi.length > 0) throw new LoiNghiepVu(loi.join(" "));
    const ch = await chupBoQuyTac(tx, ng, {
      lyDo: input.lyDo,
      hanhDong: "AI_LEAD_BO_QUY_TAC_RANG_BUOC_TU_TAO",
      baseVersion: input.baseVersion,
      bien: (cu) =>
        cu.map((x) =>
          x.kind === "AUTO_CREATE" && x.agentId === input.agentId && x.pageId === input.pageId
            ? { ...x, requireConsent: input.requireConsent ? true : undefined, campusCenterIds: ds.length > 0 ? ds : undefined }
            : x,
        ),
    });
    if (!ch.doi) throw new LoiNghiepVu("Ràng buộc giống hệt phiên bản đang áp dụng — không có gì để lưu.");
    return ch.version;
  });
  return r.ok ? { ok: true, version: r.v } : r;
}

export type ThayDoiKhoiPhuc = { pageId: string; agentId: string; truong: "routingCenterId" | "autoCreate"; tu: string | boolean | null; sang: string | boolean | null };

/**
 * KHÔI PHỤC một phiên bản cũ = ghi lại CỘT theo phiên bản đó rồi chụp phiên bản MỚI (`savedFromVersion`). Phiên bản cũ không bị sửa.
 * KIỂM LẠI thế giới sống trước (cơ sở ngừng hoạt động ⇒ từ chối, nêu rõ). Page KHÔNG có quy tắc trong phiên bản đó về mặc định (không cơ sở · tắt tự tạo) — an toàn theo chiều tắt.
 * `xemTruoc: true` chỉ tính danh sách thay đổi, KHÔNG ghi gì.
 */
export async function khoiPhucBoQuyTac(
  ng: NguoiThaoTac,
  input: { version: number; lyDo: string; xemTruoc?: boolean },
  /**
   * `true` = người gọi CŨNG giữ `ai-integration:manage` (quyền bật tự tạo lead). BẮT BUỘC, không mặc định (luật 7): khôi phục ghi cột `autoCreate`, nên nếu chỉ cần `ai-leads:configure`
   * thì Marketing HO bật lại được tự tạo lead (tạo lead + chia Sale không qua duyệt) bằng đường vòng — vượt cổng riêng của `datTuTaoLeadChoPage`. Chiều TẮT luôn được phép.
   */
  choPhepBatTuTao: boolean,
): Promise<KetQua<{ version: number; thayDoi: ThayDoiKhoiPhuc[] }>> {
  const r = await chayGiaoDich(async (tx) => {
    const cu = await tx.aiLeadRuleSet.findUnique({ where: { version: input.version } });
    if (!cu) throw new LoiNghiepVu("Không tìm thấy phiên bản đó.");
    const bo = docPayloadBoQuyTac(cu.payload);
    if (!bo) throw new LoiNghiepVu("Phiên bản đó không đọc được (không đúng định dạng) — không khôi phục được.");
    const loi = await kiemQuyTacTheoTheGioiSong(tx, bo.rules);
    if (loi.length > 0) throw new LoiNghiepVu(`Không khôi phục được vì cấu hình hiện tại không còn khớp: ${loi.join(" ")}`);
    const hang = await tx.aiLeadAgentPage.findMany({ select: { id: true, agentId: true, pageId: true, routingCenterId: true, autoCreate: true } });
    const thayDoi: ThayDoiKhoiPhuc[] = [];
    const ghi: { id: string; data: { routingCenterId?: string | null; autoCreate?: boolean } }[] = [];
    for (const h of hang) {
      const route = bo.rules.find((x) => x.kind === "ROUTE_PAGE_TO_CAMPUS" && x.agentId === h.agentId && x.pageId === h.pageId);
      const auto = bo.rules.find((x) => x.kind === "AUTO_CREATE" && x.agentId === h.agentId && x.pageId === h.pageId);
      const centerMoi = route && route.kind === "ROUTE_PAGE_TO_CAMPUS" ? route.centerId : null;
      const autoMoi = !!(auto && auto.kind === "AUTO_CREATE" && auto.enabled);
      const data: { routingCenterId?: string | null; autoCreate?: boolean } = {};
      if (centerMoi !== h.routingCenterId) {
        data.routingCenterId = centerMoi;
        thayDoi.push({ agentId: h.agentId, pageId: h.pageId, truong: "routingCenterId", tu: h.routingCenterId, sang: centerMoi });
      }
      if (autoMoi !== h.autoCreate) {
        data.autoCreate = autoMoi;
        thayDoi.push({ agentId: h.agentId, pageId: h.pageId, truong: "autoCreate", tu: h.autoCreate, sang: autoMoi });
      }
      if (Object.keys(data).length > 0) ghi.push({ id: h.id, data });
    }
    if (!choPhepBatTuTao && thayDoi.some((d) => d.truong === "autoCreate" && d.sang === true)) {
      throw new LoiNghiepVu("Phiên bản này sẽ BẬT lại tự tạo lead cho ít nhất một Page — việc đó cần quyền Quản trị tối cao (ai-integration:manage). Nhờ Quản trị tối cao khôi phục, hoặc chỉ khôi phục phiên bản không bật tự tạo lead.");
    }
    if (input.xemTruoc) return { version: input.version, thayDoi };
    for (const g of ghi) await tx.aiLeadAgentPage.update({ where: { id: g.id }, data: g.data });
    const ch = await chupBoQuyTac(tx, ng, {
      lyDo: input.lyDo,
      hanhDong: "AI_LEAD_BO_QUY_TAC_KHOI_PHUC",
      savedFromVersion: input.version,
      thayTheRangBuoc: true,
      // Quy tắc AUTO của Page ĐÃ GỠ không được sống lại trong phiên bản mới (cột là sự thật; quy tắc mồ côi chỉ làm lịch sử khó đọc và có thể bị hiểu là còn áp dụng).
      bien: (hienTai) => [
        ...hienTai.filter((x) => x.kind !== "SLA" && x.kind !== "NOTIFY" && x.kind !== "AUTO_CREATE"),
        ...bo.rules.filter((x) => x.kind === "SLA" || x.kind === "NOTIFY" || (x.kind === "AUTO_CREATE" && hang.some((h) => h.agentId === x.agentId && h.pageId === x.pageId))),
      ],
    });
    if (!ch.doi) throw new LoiNghiepVu("Phiên bản này giống hệt cấu hình đang áp dụng — không có gì để khôi phục.");
    return { version: ch.version, thayDoi };
  });
  return r.ok ? { ok: true, ...r.v } : r;
}

export type BoQuyTacView = {
  /** Số phiên bản MỚI NHẤT mà payload không đọc được (≠ «chưa có phiên bản nào»): tự tạo lead đang bị chặn cho tới khi khôi phục. */
  phienBanHong: number | null;
  hienHanh: { version: number; rules: QuyTac[]; publishedAt: Date; reason: string; savedFromVersion: number | null } | null;
  lichSu: Awaited<ReturnType<typeof docLichSuBoQuyTac>>;
};

export async function docBoQuyTacView(): Promise<BoQuyTacView> {
  const [trangThai, lichSu] = await Promise.all([docTrangThaiBoQuyTac(), docLichSuBoQuyTac(20)]);
  const hien = trangThai.ban;
  return {
    phienBanHong: trangThai.phienBanHong,
    hienHanh: hien ? { version: hien.version, rules: hien.bo.rules, publishedAt: hien.publishedAt, reason: hien.reason, savedFromVersion: hien.savedFromVersion } : null,
    lichSu,
  };
}
