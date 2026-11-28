// lib/ai-lead/dich-vu/duyet.ts — DỊCH VỤ XỬ LÝ HỒ SƠ CHỜ cho màn «Hồ sơ chờ AI» (design §7, lát C): danh sách · chi tiết · nhận xử lý · bổ sung · duyệt · từ chối · chuyển · trả · báo đã nhận.
//
// ═══ BỐN LUẬT (đứng trên mọi hàm ghi ở đây) ═════════════════════════════════════════════════════════════════════════════════════════════════
//  1. CÁCH LY CƠ SỞ. ĐỌC đi qua `scopedDb(actor)`; GHI không được che (scopedDb chỉ che đọc) nên MỌI phép ghi tự `passesScope()` trên bản ghi vừa tải. Ngoài phạm vi trả
//     `KHONG_TIM_THAY` — cùng một câu với «không có hồ sơ này», để mã lỗi không thành kênh dò xem hồ sơ có tồn tại ở cơ sở khác không.
//  2. KHOÁ LẠC QUAN. Mọi phép ghi nhận `version` mà người dùng ĐÃ THẤY và ghi bằng `updateMany({ where: { id, version } })`; đổi 0 dòng ⇒ THROW trong transaction (audit không bị ghi lẻ)
//     ⇒ `XUNG_DOT_PHIEN_BAN` («hồ sơ vừa được cập nhật, tải lại»). Hai QLCS cùng bấm: một người thắng, người kia nhận câu xung đột chứ không ghi đè lên nhau.
//  3. MỘT NGƯỜI MỘT HỒ SƠ. `claimedById` đã có người khác ⇒ `DA_NGUOI_KHAC_NHAN`. Hồ sơ CHƯA ai nhận thì hành động ghi (bổ sung/duyệt/từ chối/báo đã nhận) tự nhận luôn — QLCS không phải
//     bấm hai lần cho một việc.
//  4. MỌI GHI CÓ AUDIT (module `ai-lead`), TRONG CÙNG transaction. Giá trị trước/sau của tên/SĐT đã CHE (`cheChoAudit`) — AuditLog không là nơi SĐT thật nằm lại.
//
// ═══ PII ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// `canViewPii` là tham số BẮT BUỘC của `danhSach`/`chiTiet` (không mặc định — luật 7). Thiếu quyền: SĐT/tên che ở ĐÂY (server), tìm theo tên/SĐT bị tắt (tìm được là dò được).
import type { AiLeadDraftState, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getModelVisibleCenterIds, passesScope, scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/permissions/can";
import { writeAudit } from "@/lib/audit/audit-log";
import { canonicalPhone } from "@/lib/phone";
import { getNonEnrollableCenterIds } from "@/lib/enrollment-flow";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { getSetting } from "@/lib/settings/service";
import { ghiThongBaoNhanSu } from "@/lib/notifications/notify";
import { nguoiDuyetCoSo } from "./nguoi-duyet-co-so";
import { chePhone, cheTenFacebook, cheChoAudit } from "./che-pii";
import {
  daRaLead,
  docXacMinhNhanVien,
  ghiXacMinhNhanVien,
  laKetThuc,
  nguonTenFacebook,
  nhanVienXuLyDuoc,
  NHAN_THIEU,
  sdtChuanHoa,
  thieuDieuKien,
  tuChoiDuoc,
  type NguonTenFacebook,
  type ThieuDieuKien,
} from "./dieu-kien";
import { mucSla, type MucSla } from "./sla";
import { taoLeadTuHoSo, type KetQuaTaoLead } from "./tao-lead";

// ─── Kiểu & lỗi ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type MaLoiDuyet =
  | "KHONG_TIM_THAY"
  | "KHONG_CO_QUYEN"
  | "XUNG_DOT_PHIEN_BAN"
  | "DA_NGUOI_KHAC_NHAN"
  | "TRANG_THAI_KHONG_HOP_LE"
  | "DU_LIEU_KHONG_HOP_LE"
  | "THIEU_DIEU_KIEN"
  | "CO_SO_KHONG_HOP_LE"
  | "LOI_INGEST"
  | "NGUON_CHUA_CAU_HINH"
  | "NGUOI_NHAN_KHONG_HOP_LE"
  | "HOI_THOAI_KHONG_HOP_LE";

export type KetQuaDuyet<T> = { ok: true; data: T } | { ok: false; error: { code: MaLoiDuyet; message: string; field?: string } };

export class LoiDuyet extends Error {
  constructor(
    readonly ma: MaLoiDuyet,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "LoiDuyet";
  }
}

/** Người thao tác: `actor` để kiểm phạm vi/quyền, `ten` chỉ để ghi audit (Actor không mang tên). */
export type NguoiThaoTac = { actor: Actor; ten: string };

async function chay<T>(fn: () => Promise<T>): Promise<KetQuaDuyet<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof LoiDuyet) return { ok: false, error: { code: e.ma, message: e.message, ...(e.field ? { field: e.field } : {}) } };
    throw e; // lỗi hệ thống → để Next/Sentry bắt, KHÔNG nuốt thành «lỗi nghiệp vụ»
  }
}

const CAU_XUNG_DOT = "Hồ sơ vừa được cập nhật bởi người hoặc hệ thống khác. Tải lại trang để xem bản mới nhất rồi thao tác lại.";

// ─── Tải hồ sơ để GHI (phạm vi + quyền + điều kiện nhận) ────────────────────────────────────────────────────────────────────────────────────

type HoSoGhi = Prisma.AiLeadDraftGetPayload<{ include: { conversation: true } }>;

/**
 * Tải hồ sơ để thao tác GHI. Ba cổng, theo thứ tự: tồn tại → trong phạm vi (`passesScope`) → có quyền `ai-leads:review`.
 * Hai cổng đầu cùng trả KHONG_TIM_THAY (không lộ hồ sơ ở cơ sở khác). Quyền hỏi qua `can()` hợp nhất với `target.centerId` của hồ sơ.
 */
async function taiDeGhi(nguoi: NguoiThaoTac, draftId: string): Promise<HoSoGhi> {
  const hs = await db.aiLeadDraft.findUnique({ where: { id: draftId }, include: { conversation: true } });
  if (!hs || !passesScope("AiLeadDraft", hs, nguoi.actor)) throw new LoiDuyet("KHONG_TIM_THAY", "Không tìm thấy hồ sơ.");
  if (!can(nguoi.actor, "ai-leads:review", { centerId: hs.centerId })) throw new LoiDuyet("KHONG_CO_QUYEN", "Bạn không có quyền xử lý hồ sơ AI.");
  return hs;
}

/** Hồ sơ đang do người KHÁC giữ ⇒ chặn. Chưa ai giữ hoặc chính mình giữ ⇒ qua. */
function chanNeuNguoiKhacGiu(hs: Pick<HoSoGhi, "claimedById">, nguoi: NguoiThaoTac): void {
  if (hs.claimedById !== null && hs.claimedById !== nguoi.actor.userId) {
    throw new LoiDuyet("DA_NGUOI_KHAC_NHAN", "Hồ sơ này đang được người khác xử lý.");
  }
}

function chanNeuLechPhienBan(hs: Pick<HoSoGhi, "version">, version: number): void {
  if (hs.version !== version) throw new LoiDuyet("XUNG_DOT_PHIEN_BAN", CAU_XUNG_DOT);
}

/** Ghi `data` với điều kiện `version` còn nguyên. THROW khi 0 dòng đổi (trong transaction ⇒ rollback cả audit). */
async function ghiCoKhoa(
  tx: Prisma.TransactionClient,
  id: string,
  version: number,
  data: Prisma.AiLeadDraftUncheckedUpdateManyInput,
): Promise<void> {
  const r = await tx.aiLeadDraft.updateMany({
    where: { id, version, state: { notIn: ["COMPLETED", "ASSIGNMENT_PENDING", "REJECTED", "EXPIRED"] } },
    data: { ...data, version: { increment: 1 } },
  });
  if (r.count === 0) throw new LoiDuyet("XUNG_DOT_PHIEN_BAN", CAU_XUNG_DOT);
}

async function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => fn(tx as unknown as Prisma.TransactionClient));
}

// ─── DANH SÁCH ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SO_DONG_TOI_DA = 300;

export type LocDanhSach = {
  /** `"mo"` (mặc định) = mọi hồ sơ chưa kết thúc; `"tat-ca"`; hoặc đúng một trạng thái. */
  trangThai?: "mo" | "tat-ca" | AiLeadDraftState;
  pageId?: string;
  coSoId?: string;
  /** `"toi"` · `"chua-nhan"` · userId. */
  nguoiXuLy?: string;
  quaHanSla?: boolean;
  q?: string;
};

export type HangDanhSach = {
  id: string;
  state: AiLeadDraftState;
  intent: string;
  version: number;
  /** ĐÃ che theo `canViewPii`. */
  fbName: string | null;
  phone: string | null;
  pageId: string;
  campusCode: string | null;
  centerId: string | null;
  centerTen: string | null;
  claimedById: string | null;
  claimedTen: string | null;
  slaClaimDueAt: Date | null;
  slaResolveDueAt: Date | null;
  mucSla: MucSla;
  createdAt: Date;
  thieu: ThieuDieuKien[];
  leadId: string | null;
};

export type KetQuaDanhSach = {
  hang: HangDanhSach[];
  /** Tổng số khớp bộ lọc (có thể > số dòng trả về). */
  tong: number;
  biCat: boolean;
  /** Tuỳ chọn cho ô lọc — chỉ cơ sở trong phạm vi người xem. */
  tuyChon: { pages: string[]; coSo: { id: string; ten: string }[] };
};

const TRANG_THAI_HOP_LE = new Set<string>([
  "COLLECTING", "PENDING_INFO", "WAITING_QLCS", "IN_PROGRESS", "READY_FOR_REVIEW", "COMPLETED", "REJECTED", "EXPIRED", "SYSTEM_EXCEPTION", "ASSIGNMENT_PENDING",
]);
const KET_THUC_DB: AiLeadDraftState[] = ["COMPLETED", "REJECTED", "EXPIRED"];

/** Dựng `where` THUẦN từ bộ lọc (test được không cần DB). `now` là tham số — không đọc đồng hồ. */
export function dungWhereDanhSach(loc: LocDanhSach, nguoi: { userId: string }, canViewPii: boolean, now: Date): Prisma.AiLeadDraftWhereInput {
  const and: Prisma.AiLeadDraftWhereInput[] = [];
  const tt = loc.trangThai ?? "mo";
  if (tt === "mo") and.push({ state: { notIn: KET_THUC_DB } });
  else if (tt !== "tat-ca" && TRANG_THAI_HOP_LE.has(tt)) and.push({ state: tt });
  // Giá trị lạ ⇒ rơi về «mở» (không phải «tất cả»): bộ lọc hỏng không được làm lộ nhiều hơn mặc định.
  else if (tt !== "tat-ca") and.push({ state: { notIn: KET_THUC_DB } });

  if (loc.pageId) and.push({ conversation: { pageId: loc.pageId } });
  if (loc.coSoId) and.push({ centerId: loc.coSoId });
  if (loc.nguoiXuLy === "toi") and.push({ claimedById: nguoi.userId });
  else if (loc.nguoiXuLy === "chua-nhan") and.push({ claimedById: null });
  else if (loc.nguoiXuLy) and.push({ claimedById: loc.nguoiXuLy });
  if (loc.quaHanSla) {
    and.push({
      state: { notIn: [...KET_THUC_DB, "ASSIGNMENT_PENDING"] },
      OR: [{ claimedById: null, slaClaimDueAt: { lt: now } }, { slaResolveDueAt: { lt: now } }],
    });
  }
  const q = loc.q?.trim();
  if (q) {
    // Tìm theo MÃ HỒ SƠ (8 ký tự cuối id — đúng chuỗi in ở ghi chú lead) luôn được. Tìm theo tên/SĐT chỉ khi có quyền xem PII: ô tìm không che được kết quả khớp,
    // nên ai không được xem SĐT mà tìm được theo SĐT là dò được «số này có hồ sơ chờ không».
    const or: Prisma.AiLeadDraftWhereInput[] = [{ id: { endsWith: q } }];
    if (canViewPii) {
      const sdt = canonicalPhone(q);
      if (sdt) or.push({ phoneCanonical: sdt }); // KHỚP ĐỦ SỐ, không khớp một phần
      or.push({ fbName: { contains: q, mode: "insensitive" } });
    }
    and.push({ OR: or });
  }
  return and.length ? { AND: and } : {};
}

export async function danhSach(actor: Actor, loc: LocDanhSach, canViewPii: boolean, now: Date): Promise<KetQuaDanhSach> {
  const sdb = scopedDb(actor);
  const where = dungWhereDanhSach(loc, { userId: actor.userId }, canViewPii, now);
  const [dong, tong, pages] = await Promise.all([
    sdb.aiLeadDraft.findMany({
      where,
      orderBy: [{ slaResolveDueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: SO_DONG_TOI_DA,
      include: { conversation: { select: { pageId: true } } },
    }),
    sdb.aiLeadDraft.count({ where }),
    db.aiLeadAgentPage.findMany({ distinct: ["pageId"], select: { pageId: true }, orderBy: { pageId: "asc" } }),
  ]);

  const centerIds = [...new Set(dong.map((d) => d.centerId).filter((x): x is string => !!x))];
  const userIds = [...new Set(dong.map((d) => d.claimedById).filter((x): x is string => !!x))];
  const vis = getModelVisibleCenterIds("AiLeadDraft", actor);
  const [centers, users, coSoLoc] = await Promise.all([
    centerIds.length ? db.center.findMany({ where: { id: { in: centerIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    db.center.findMany({ where: { isActive: true, ...(vis === "ALL" ? {} : { id: { in: vis } }) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const tenCoSo = new Map(centers.map((c) => [c.id, c.name]));
  const tenNguoi = new Map(users.map((u) => [u.id, u.name]));

  return {
    hang: dong.map((d) => ({
      id: d.id,
      state: d.state,
      intent: d.intent,
      version: d.version,
      fbName: cheTenFacebook(d.fbName, canViewPii),
      phone: chePhone(sdtChuanHoa(d), canViewPii),
      pageId: d.conversation.pageId,
      campusCode: d.campusCode,
      centerId: d.centerId,
      centerTen: d.centerId ? (tenCoSo.get(d.centerId) ?? null) : null,
      claimedById: d.claimedById,
      claimedTen: d.claimedById ? (tenNguoi.get(d.claimedById) ?? null) : null,
      slaClaimDueAt: d.slaClaimDueAt,
      slaResolveDueAt: d.slaResolveDueAt,
      mucSla: mucSla(d, now),
      createdAt: d.createdAt,
      thieu: thieuDieuKien(d),
      leadId: d.leadId,
    })),
    tong,
    biCat: tong > dong.length,
    tuyChon: { pages: pages.map((p) => p.pageId), coSo: coSoLoc.map((c) => ({ id: c.id, ten: c.name })) },
  };
}

// ─── CHI TIẾT ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SuKienDongThoiGian = {
  id: string;
  luc: Date;
  hanhDong: string;
  nguoi: string;
  lyDo: string | null;
  /** Giá trị mới ĐÃ CHE từ lúc ghi audit (xem `cheChoAudit`). */
  thayDoi: Record<string, unknown> | null;
};

export type CoSoXuatBan = { id: string; ten: string; maCoSo: string | null };

export type ChiTietHoSo = {
  id: string;
  version: number;
  state: AiLeadDraftState;
  intent: string;
  pageId: string;
  psidRutGon: string;
  /** ĐÃ che theo `canViewPii`. */
  fbName: string | null;
  fbNameSource: string | null;
  nguonTen: NguonTenFacebook;
  phone: string | null;
  phoneHopLe: boolean;
  campusCode: string | null;
  centerId: string | null;
  centerTen: string | null;
  consentAllowed: boolean;
  thieu: ThieuDieuKien[];
  mucSla: MucSla;
  slaClaimDueAt: Date | null;
  slaResolveDueAt: Date | null;
  createdAt: Date;
  closedAt: Date | null;
  claimedById: string | null;
  claimedTen: string | null;
  claimedBoiToi: boolean;
  leadId: string | null;
  resultNote: string | null;
  rejectedReason: string | null;
  hoiThoai: {
    id: string;
    ownerState: string;
    claimSource: string;
    inboxThreadId: string | null;
    takeoverConfirmSource: string | null;
    takeoverConfirmedAt: Date | null;
  };
  /** Cơ sở có thể chọn cho Page này (đã xuất bản, còn nhận khách, nằm trong phạm vi người xem). */
  coSoCoThe: CoSoXuatBan[];
  dongThoiGian: SuKienDongThoiGian[];
};

/** `null` = không có hồ sơ HOẶC ngoài phạm vi (cùng một kết quả, xem đầu tệp). */
export async function chiTiet(actor: Actor, draftId: string, canViewPii: boolean, now: Date): Promise<ChiTietHoSo | null> {
  const hs = await scopedDb(actor).aiLeadDraft.findUnique({ where: { id: draftId }, include: { conversation: true } });
  // `findUnique` của scopedDb đã lọc hậu kỳ theo phạm vi; kiểm lại tường minh để cổng không phụ thuộc vào một cơ chế ngầm.
  if (!hs || !passesScope("AiLeadDraft", hs, actor)) return null;

  const [center, nguoiNhan, xuatBan, nhatKy] = await Promise.all([
    hs.centerId ? db.center.findUnique({ where: { id: hs.centerId }, select: { name: true } }) : Promise.resolve(null),
    hs.claimedById ? db.user.findUnique({ where: { id: hs.claimedById }, select: { name: true } }) : Promise.resolve(null),
    db.aiLeadCampusPublication.findMany({
      where: { pageId: hs.conversation.pageId, publicVisible: true, acceptingLeads: true },
      include: { campus: { select: { id: true, name: true, code: true, isActive: true } } },
      orderBy: { displayOrder: "asc" },
    }),
    db.auditLog.findMany({
      where: { module: "ai-lead", entityType: "AiLeadDraft", entityId: hs.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, createdAt: true, action: true, actorName: true, reason: true, newValues: true },
    }),
  ]);

  // Cơ sở chọn được: phải nằm TRONG phạm vi người xem (không để QLCS CS1 «giao» hồ sơ sang CS2 bằng ô chọn) và là cơ sở nhận ghi danh.
  const khongNhan = await getNonEnrollableCenterIds();
  const coSoCoThe: CoSoXuatBan[] = xuatBan
    .filter((p) => p.campus.isActive && !khongNhan.includes(p.campus.id) && passesScope("AiLeadDraft", { centerId: p.campus.id }, actor))
    .map((p) => ({ id: p.campus.id, ten: p.campus.name, maCoSo: p.campus.code }));

  return {
    id: hs.id,
    version: hs.version,
    state: hs.state,
    intent: hs.intent,
    pageId: hs.conversation.pageId,
    // PSID là định danh Messenger của khách: chỉ hiện 4 ký tự cuối để đối chiếu, không bao giờ nguyên vẹn.
    psidRutGon: hs.conversation.psid.length > 4 ? `…${hs.conversation.psid.slice(-4)}` : "…",
    fbName: cheTenFacebook(hs.fbName, canViewPii),
    fbNameSource: hs.fbNameSource,
    nguonTen: nguonTenFacebook(hs),
    phone: chePhone(sdtChuanHoa(hs), canViewPii),
    phoneHopLe: sdtChuanHoa(hs) !== null,
    campusCode: hs.campusCode,
    centerId: hs.centerId,
    centerTen: center?.name ?? null,
    consentAllowed: hs.consentAllowed,
    thieu: thieuDieuKien(hs),
    mucSla: mucSla(hs, now),
    slaClaimDueAt: hs.slaClaimDueAt,
    slaResolveDueAt: hs.slaResolveDueAt,
    createdAt: hs.createdAt,
    closedAt: hs.closedAt,
    claimedById: hs.claimedById,
    claimedTen: nguoiNhan?.name ?? null,
    claimedBoiToi: hs.claimedById === actor.userId,
    leadId: hs.leadId,
    resultNote: hs.resultNote,
    rejectedReason: hs.rejectedReason,
    hoiThoai: {
      id: hs.conversation.id,
      ownerState: hs.conversation.ownerState,
      claimSource: hs.conversation.claimSource,
      inboxThreadId: hs.conversation.inboxThreadId,
      takeoverConfirmSource: hs.conversation.takeoverConfirmSource,
      takeoverConfirmedAt: hs.conversation.takeoverConfirmedAt,
    },
    coSoCoThe,
    dongThoiGian: nhatKy.map((n) => ({
      id: n.id,
      luc: n.createdAt,
      hanhDong: n.action,
      nguoi: n.actorName,
      lyDo: n.reason,
      thayDoi: n.newValues && typeof n.newValues === "object" && !Array.isArray(n.newValues) ? (n.newValues as Record<string, unknown>) : null,
    })),
  };
}

// ─── NHẬN XỬ LÝ ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type KetQuaGhi = { id: string; version: number; state: AiLeadDraftState };

export async function nhanXuLy(nguoi: NguoiThaoTac, input: { draftId: string; version: number }): Promise<KetQuaDuyet<KetQuaGhi>> {
  return chay(async () => {
    const hs = await taiDeGhi(nguoi, input.draftId);
    if (!nhanVienXuLyDuoc(hs.state)) throw new LoiDuyet("TRANG_THAI_KHONG_HOP_LE", "Hồ sơ ở trạng thái này không nhận xử lý được.");
    // Chính mình đã nhận ⇒ idempotent (bấm đúp không báo lỗi, không tăng version).
    if (hs.claimedById === nguoi.actor.userId) return { id: hs.id, version: hs.version, state: hs.state };
    chanNeuNguoiKhacGiu(hs, nguoi);
    chanNeuLechPhienBan(hs, input.version);
    return transaction(async (tx) => {
      await ghiCoKhoa(tx, hs.id, hs.version, { state: "IN_PROGRESS", claimedById: nguoi.actor.userId, claimedAt: new Date() });
      await writeAudit({
        tx,
        actor: { id: nguoi.actor.userId, name: nguoi.ten },
        module: "ai-lead",
        entityType: "AiLeadDraft",
        entityId: hs.id,
        action: "CLAIM",
        oldValues: { state: hs.state, claimedById: hs.claimedById },
        newValues: { state: "IN_PROGRESS", claimedById: nguoi.actor.userId },
        orgUnitId: hs.orgUnitId,
      });
      return { id: hs.id, version: hs.version + 1, state: "IN_PROGRESS" as const };
    });
  });
}

// ─── BỔ SUNG ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DauVaoBoSung = {
  draftId: string;
  version: number;
  /** Có mặt = nhân viên XÁC NHẬN/SỬA giá trị này (kể cả giữ nguyên — «tôi đã đối chiếu tên này trong Page Inbox»). */
  fbName?: string;
  phone?: string;
  campusCenterId?: string;
};

/** `campusCode` của hợp đồng: `^[A-Z0-9_-]{2,16}$`. Ánh xạ Center→campusCode thuộc lát Catalog; ở đây chỉ chuẩn hoá `Center.code` đúng khuôn, sai khuôn ⇒ null (không bịa). */
export function maCoSoTuCenter(code: string | null | undefined): string | null {
  const m = (code ?? "").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return /^[A-Z0-9_-]{2,16}$/.test(m) ? m : null;
}

export async function botSung(nguoi: NguoiThaoTac, input: DauVaoBoSung): Promise<KetQuaDuyet<KetQuaGhi & { thieu: ThieuDieuKien[] }>> {
  return chay(async () => {
    const hs = await taiDeGhi(nguoi, input.draftId);
    if (!nhanVienXuLyDuoc(hs.state)) throw new LoiDuyet("TRANG_THAI_KHONG_HOP_LE", "Hồ sơ ở trạng thái này không sửa được.");
    chanNeuNguoiKhacGiu(hs, nguoi);
    chanNeuLechPhienBan(hs, input.version);
    if (input.fbName === undefined && input.phone === undefined && input.campusCenterId === undefined) {
      throw new LoiDuyet("DU_LIEU_KHONG_HOP_LE", "Chưa có thông tin nào để lưu.");
    }

    const luc = new Date();
    const data: Prisma.AiLeadDraftUncheckedUpdateManyInput = {};
    let evidence: unknown = hs.evidence;
    const truoc: { fbName?: string | null; phone?: string | null; campus?: string | null } = {};
    const sau: { fbName?: string | null; phone?: string | null; campus?: string | null } = {};

    if (input.fbName !== undefined) {
      const ten = input.fbName.trim();
      if (ten.length < 1 || ten.length > 120) throw new LoiDuyet("DU_LIEU_KHONG_HOP_LE", "Tên Facebook phải từ 1 đến 120 ký tự.", "fbName");
      truoc.fbName = hs.fbName;
      sau.fbName = ten;
      data.fbName = ten;
      evidence = ghiXacMinhNhanVien(evidence, "fbName", ten, nguoi.actor.userId, luc);
    }
    if (input.phone !== undefined) {
      const chuan = canonicalPhone(input.phone);
      if (!chuan) throw new LoiDuyet("DU_LIEU_KHONG_HOP_LE", "Số điện thoại không hợp lệ (di động Việt Nam).", "phone");
      truoc.phone = sdtChuanHoa(hs);
      sau.phone = chuan;
      data.phoneRaw = input.phone.trim().slice(0, 32);
      data.phoneCanonical = chuan;
      evidence = ghiXacMinhNhanVien(evidence, "phone", chuan, nguoi.actor.userId, luc);
    }
    if (input.campusCenterId !== undefined) {
      const coSo = await kiemCoSoChoBoSung(nguoi, hs.conversation.pageId, input.campusCenterId);
      truoc.campus = hs.campusCode;
      sau.campus = coSo.maCoSo;
      data.campusCenterId = coSo.id;
      data.campusCode = coSo.maCoSo;
      // Cơ sở XỬ LÝ đi theo cơ sở khách chọn (schema: `centerId = cơ sở khách chọn ?? routingCenterId`). Ghi kép orgUnitId tại ĐÂY — `updateMany` không qua hook ghi kép.
      data.centerId = coSo.id;
      data.orgUnitId = await orgUnitIdForCenter(coSo.id);
      evidence = ghiXacMinhNhanVien(evidence, "campus", coSo.id, nguoi.actor.userId, luc);
    }
    data.evidence = evidence as Prisma.InputJsonValue;
    // Nhận hồ sơ luôn nếu chưa ai giữ (luật 3).
    if (hs.claimedById === null) {
      data.claimedById = nguoi.actor.userId;
      data.claimedAt = luc;
    }
    data.state = "IN_PROGRESS";

    const thieuSau = thieuDieuKien({
      fbName: (data.fbName as string | undefined) ?? hs.fbName,
      fbNameSource: hs.fbNameSource,
      phoneCanonical: (data.phoneCanonical as string | undefined) ?? hs.phoneCanonical,
      phoneRaw: (data.phoneRaw as string | undefined) ?? hs.phoneRaw,
      campusCenterId: (data.campusCenterId as string | undefined) ?? hs.campusCenterId,
      evidence,
    });

    return transaction(async (tx) => {
      await ghiCoKhoa(tx, hs.id, hs.version, data);
      await writeAudit({
        tx,
        actor: { id: nguoi.actor.userId, name: nguoi.ten },
        module: "ai-lead",
        entityType: "AiLeadDraft",
        entityId: hs.id,
        action: "STAFF_UPDATE",
        // Trước/sau đã CHE — xem đầu tệp, luật 4.
        oldValues: { ...cheChoAudit({ fbName: truoc.fbName, phone: truoc.phone }), ...(truoc.campus !== undefined ? { campus: truoc.campus } : {}) },
        newValues: { ...cheChoAudit({ fbName: sau.fbName, phone: sau.phone }), ...(sau.campus !== undefined ? { campus: sau.campus } : {}), provenance: "STAFF_VERIFIED" },
        orgUnitId: (data.orgUnitId as string | null | undefined) ?? hs.orgUnitId,
      });
      return { id: hs.id, version: hs.version + 1, state: "IN_PROGRESS" as const, thieu: thieuSau };
    });
  });
}

async function kiemCoSoChoBoSung(nguoi: NguoiThaoTac, pageId: string, centerId: string): Promise<{ id: string; maCoSo: string | null }> {
  const [center, xuatBan, khongNhan] = await Promise.all([
    db.center.findUnique({ where: { id: centerId }, select: { id: true, code: true, isActive: true } }),
    db.aiLeadCampusPublication.findUnique({
      where: { pageId_campusCenterId: { pageId, campusCenterId: centerId } },
      select: { acceptingLeads: true, publicVisible: true },
    }),
    getNonEnrollableCenterIds(),
  ]);
  if (!center || !center.isActive || khongNhan.includes(center.id) || !xuatBan || !xuatBan.publicVisible || !xuatBan.acceptingLeads) {
    throw new LoiDuyet("CO_SO_KHONG_HOP_LE", "Cơ sở này không nhận khách từ Page này.", "campusCenterId");
  }
  // Cơ sở MỚI cũng phải nằm trong phạm vi người sửa: QLCS CS1 không được đẩy hồ sơ sang CS2 (hồ sơ sẽ biến mất khỏi tay họ và hiện ra ở cơ sở khác mà không ai hay).
  if (!passesScope("AiLeadDraft", { centerId: center.id }, nguoi.actor)) {
    throw new LoiDuyet("CO_SO_KHONG_HOP_LE", "Bạn không phụ trách cơ sở này.", "campusCenterId");
  }
  return { id: center.id, maCoSo: maCoSoTuCenter(center.code) };
}

// ─── DUYỆT ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type KetQuaDuyetHoSo = { id: string; leadId: string | null; state: AiLeadDraftState; daCoLead: boolean };

export async function duyet(nguoi: NguoiThaoTac, input: { draftId: string; version: number }): Promise<KetQuaDuyet<KetQuaDuyetHoSo>> {
  return chay(async () => {
    const hs = await taiDeGhi(nguoi, input.draftId);
    // Bấm đúp / hai QLCS cùng duyệt: hồ sơ ĐÃ ra lead ⇒ trả đúng lead đó, KHÔNG báo lỗi và KHÔNG gọi ingest lần nữa.
    if (daRaLead(hs.state)) return { id: hs.id, leadId: hs.leadId, state: hs.state, daCoLead: true };
    if (laKetThuc(hs.state) || !nhanVienXuLyDuoc(hs.state)) throw new LoiDuyet("TRANG_THAI_KHONG_HOP_LE", "Hồ sơ ở trạng thái này không duyệt được.");
    chanNeuNguoiKhacGiu(hs, nguoi);
    chanNeuLechPhienBan(hs, input.version);
    // Cổng THUẦN trước mọi phép ghi: thiếu điều kiện thì không nhận hồ sơ, không tăng version — người dùng bổ sung rồi duyệt lại với đúng phiên bản đang xem.
    const thieu = thieuDieuKien(hs);
    if (thieu.length > 0) throw new LoiDuyet("THIEU_DIEU_KIEN", `${thieu.map((t) => NHAN_THIEU[t]).join("; ")}. Bổ sung rồi duyệt lại.`);

    // Chưa ai nhận ⇒ nhận luôn (CAS bằng version); hai người cùng bấm thì một người nhận được, người kia nhận XUNG_DOT_PHIEN_BAN.
    if (hs.claimedById === null) {
      await transaction(async (tx) => {
        await ghiCoKhoa(tx, hs.id, hs.version, { state: "IN_PROGRESS", claimedById: nguoi.actor.userId, claimedAt: new Date() });
        await writeAudit({
          tx,
          actor: { id: nguoi.actor.userId, name: nguoi.ten },
          module: "ai-lead",
          entityType: "AiLeadDraft",
          entityId: hs.id,
          action: "CLAIM",
          oldValues: { state: hs.state, claimedById: null },
          newValues: { state: "IN_PROGRESS", claimedById: nguoi.actor.userId },
          orgUnitId: hs.orgUnitId,
        });
      });
    }

    const kq = await taoLeadTuHoSo(hs.id, { actor: nguoi.actor, tu: "STAFF", tenNguoi: nguoi.ten });
    return dichKetQuaTaoLead(hs.id, kq);
  });
}

function dichKetQuaTaoLead(draftId: string, kq: KetQuaTaoLead): KetQuaDuyetHoSo {
  if (kq.ok) return { id: draftId, leadId: kq.leadId, state: "COMPLETED", daCoLead: kq.duplicate };
  switch (kq.lyDo) {
    case "THIEU_DIEU_KIEN": {
      const thieu = (kq.chiTiet ?? "").replace(/^THIEU:/, "").split(",").filter((x): x is ThieuDieuKien => x === "fbName" || x === "phone" || x === "campus");
      const cau = thieu.length ? thieu.map((t) => NHAN_THIEU[t]).join("; ") : "Hồ sơ chưa đủ thông tin";
      throw new LoiDuyet("THIEU_DIEU_KIEN", `${cau}. Bổ sung rồi duyệt lại.`);
    }
    case "CO_SO_KHONG_HOP_LE":
      throw new LoiDuyet("CO_SO_KHONG_HOP_LE", "Cơ sở của hồ sơ không còn nhận khách từ Page này. Chọn lại cơ sở rồi duyệt lại.");
    case "XUNG_DOT_PHIEN_BAN":
      throw new LoiDuyet("XUNG_DOT_PHIEN_BAN", CAU_XUNG_DOT);
    case "DA_XU_LY":
      throw new LoiDuyet("TRANG_THAI_KHONG_HOP_LE", "Hồ sơ đã được xử lý xong.");
    case "KHONG_TIM_THAY":
    case "NGOAI_PHAM_VI":
      throw new LoiDuyet("KHONG_TIM_THAY", "Không tìm thấy hồ sơ.");
    case "TU_DONG_TAT":
      // Chỉ đường AUTO mới gặp; nút «Duyệt» của nhân viên không bao giờ qua nhánh này.
      throw new LoiDuyet("TRANG_THAI_KHONG_HOP_LE", "Tạo lead tự động đang tắt.");
    case "NGUON_CHUA_CAU_HINH":
      throw new LoiDuyet("NGUON_CHUA_CAU_HINH", "Nguồn lead của Page này chưa được cấu hình (nhóm «Marketing HO»). Hồ sơ chuyển sang Ngoại lệ và không mất; báo người quản lý nguồn cấu hình rồi bấm «Thử lại».");
    case "LOI_INGEST":
      throw new LoiDuyet("LOI_INGEST", "Hệ thống chưa tạo được lead từ hồ sơ này. Hồ sơ được đánh dấu lỗi để kiểm tra; thử lại sau hoặc báo bộ phận kỹ thuật.");
  }
}

// ─── TỪ CHỐI ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function tuChoi(nguoi: NguoiThaoTac, input: { draftId: string; version: number; lyDo: string }): Promise<KetQuaDuyet<KetQuaGhi>> {
  return chay(async () => {
    const lyDo = input.lyDo.trim();
    if (lyDo.length < 5) throw new LoiDuyet("DU_LIEU_KHONG_HOP_LE", "Nhập lý do từ chối (ít nhất 5 ký tự).", "lyDo");
    if (lyDo.length > 500) throw new LoiDuyet("DU_LIEU_KHONG_HOP_LE", "Lý do tối đa 500 ký tự.", "lyDo");
    const hs = await taiDeGhi(nguoi, input.draftId);
    if (!tuChoiDuoc(hs.state)) throw new LoiDuyet("TRANG_THAI_KHONG_HOP_LE", "Hồ sơ ở trạng thái này không từ chối được.");
    chanNeuNguoiKhacGiu(hs, nguoi);
    chanNeuLechPhienBan(hs, input.version);
    const luc = new Date();
    return transaction(async (tx) => {
      await ghiCoKhoa(tx, hs.id, hs.version, {
        state: "REJECTED",
        rejectedReason: lyDo,
        closedAt: luc,
        ...(hs.claimedById === null ? { claimedById: nguoi.actor.userId, claimedAt: luc } : {}),
      });
      await writeAudit({
        tx,
        actor: { id: nguoi.actor.userId, name: nguoi.ten },
        module: "ai-lead",
        entityType: "AiLeadDraft",
        entityId: hs.id,
        action: "REJECT",
        oldValues: { state: hs.state },
        newValues: { state: "REJECTED" },
        reason: lyDo,
        orgUnitId: hs.orgUnitId,
      });
      return { id: hs.id, version: hs.version + 1, state: "REJECTED" as const };
    });
  });
}

// ─── CHUYỂN NGƯỜI / TRẢ HỒ SƠ ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Những người HỢP LỆ để nhận chuyển một hồ sơ (cho ô chọn): quản lý của cơ sở xử lý, trừ chính mình. Mỗi người còn phải qua `kiemNguoiNhan` lúc chuyển thật. */
export async function ungVienChuyen(nguoi: NguoiThaoTac, draftId: string): Promise<{ id: string; ten: string }[]> {
  const hs = await db.aiLeadDraft.findUnique({ where: { id: draftId }, select: { centerId: true } });
  if (!hs || !hs.centerId || !passesScope("AiLeadDraft", hs, nguoi.actor)) return [];
  return ungVienHopLeChoCoSo(hs.centerId, nguoi.actor.userId);
}

/**
 * MỘT cổng cho "ai nhận được hồ sơ này": CÓ `ai-leads:review` tại cơ sở VÀ thấy được hồ sơ (`passesScope`). Cổng thật lúc chuyển (`kiemNguoiNhan`) và danh sách ứng viên
 * (`ungVienHopLeChoCoSo`) cùng gọi hàm này — viết hai bản là để danh sách hiện người rồi máy chủ từ chối (sự cố QA 28/10: «Giáo vụ CS1»).
 */
function nguoiNhanXuLyDuoc(actorNhan: Actor | null | undefined, hs: Pick<HoSoGhi, "centerId">): boolean {
  if (!actorNhan) return false;
  return can(actorNhan, "ai-leads:review", { centerId: hs.centerId }) && passesScope("AiLeadDraft", hs, actorNhan);
}

/**
 * Ứng viên nhận hồ sơ của MỘT cơ sở: tập quản lý cơ sở (nguồn thông báo) rồi LỌC bằng đúng cổng `nguoiNhanXuLyDuoc` trên actor RBAC v2 thật của từng người.
 * Quyền đọc từ DB mỗi người một lần (`resolveActor` có cache theo request) — danh sách quản lý một cơ sở chỉ vài người.
 */
export async function ungVienHopLeChoCoSo(centerId: string, loaiTruId: string): Promise<{ id: string; ten: string }[]> {
  const ids = (await nguoiDuyetCoSo(centerId)).filter((id) => id !== loaiTruId);
  if (ids.length === 0) return [];
  const [users, actors] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    Promise.all(ids.map(async (id) => [id, await resolveActor(id).catch(() => null)] as const)),
  ]);
  const actorTheoId = new Map(actors);
  return users.filter((u) => nguoiNhanXuLyDuoc(actorTheoId.get(u.id), { centerId })).map((u) => ({ id: u.id, ten: u.name ?? "(chưa có tên)" }));
}

async function kiemNguoiNhan(hs: Pick<HoSoGhi, "centerId">, nguoiNhanId: string): Promise<void> {
  const u = await db.user.findUnique({ where: { id: nguoiNhanId }, select: { id: true, isActive: true, deletedAt: true } });
  if (!u || !u.isActive || u.deletedAt) throw new LoiDuyet("NGUOI_NHAN_KHONG_HOP_LE", "Người nhận không còn hoạt động.", "nguoiNhanId");
  const actorNhan = await resolveActor(nguoiNhanId);
  // Người nhận phải CÓ quyền xử lý VÀ nhìn thấy hồ sơ này — giao cho người không thấy được hồ sơ là làm nó biến mất.
  if (!nguoiNhanXuLyDuoc(actorNhan, hs)) {
    throw new LoiDuyet("NGUOI_NHAN_KHONG_HOP_LE", "Người này không có quyền xử lý hồ sơ của cơ sở này.", "nguoiNhanId");
  }
}

export async function chuyenNguoi(nguoi: NguoiThaoTac, input: { draftId: string; version: number; nguoiNhanId: string }): Promise<KetQuaDuyet<KetQuaGhi>> {
  const kq = await chay(async () => {
    if (input.nguoiNhanId === nguoi.actor.userId) throw new LoiDuyet("NGUOI_NHAN_KHONG_HOP_LE", "Chọn một người khác để chuyển.", "nguoiNhanId");
    const hs = await taiDeGhi(nguoi, input.draftId);
    if (!nhanVienXuLyDuoc(hs.state)) throw new LoiDuyet("TRANG_THAI_KHONG_HOP_LE", "Hồ sơ ở trạng thái này không chuyển được.");
    chanNeuNguoiKhacGiu(hs, nguoi);
    chanNeuLechPhienBan(hs, input.version);
    await kiemNguoiNhan(hs, input.nguoiNhanId);
    const luc = new Date();
    return transaction(async (tx) => {
      await ghiCoKhoa(tx, hs.id, hs.version, { state: "IN_PROGRESS", claimedById: input.nguoiNhanId, claimedAt: luc });
      await writeAudit({
        tx,
        actor: { id: nguoi.actor.userId, name: nguoi.ten },
        module: "ai-lead",
        entityType: "AiLeadDraft",
        entityId: hs.id,
        action: "TRANSFER",
        oldValues: { claimedById: hs.claimedById },
        newValues: { claimedById: input.nguoiNhanId, state: "IN_PROGRESS" },
        orgUnitId: hs.orgUnitId,
      });
      return { id: hs.id, version: hs.version + 1, state: "IN_PROGRESS" as const };
    });
  });
  if (kq.ok) {
    // SAU commit (notify.ts không nhận tx). Lỗi báo tin KHÔNG làm hỏng việc đã chuyển. Nội dung KHÔNG chứa tên/SĐT khách.
    await ghiThongBaoNhanSu({
      userIds: [input.nguoiNhanId],
      dedupeKey: `ai_lead.draft:${input.draftId}`,
      title: "Hồ sơ AI Messenger được giao cho bạn",
      body: "Một hồ sơ khách từ AI Messenger vừa được chuyển cho bạn xử lý.",
      href: `/ai-lead/${input.draftId}`,
      entityId: input.draftId,
      reopen: true,
    }).catch(() => undefined);
  }
  return kq;
}

export async function traHoSo(nguoi: NguoiThaoTac, input: { draftId: string; version: number }): Promise<KetQuaDuyet<KetQuaGhi>> {
  return chay(async () => {
    const hs = await taiDeGhi(nguoi, input.draftId);
    if (hs.claimedById !== nguoi.actor.userId) throw new LoiDuyet("TRANG_THAI_KHONG_HOP_LE", "Chỉ người đang giữ hồ sơ mới trả lại được.");
    if (!nhanVienXuLyDuoc(hs.state)) throw new LoiDuyet("TRANG_THAI_KHONG_HOP_LE", "Hồ sơ ở trạng thái này không trả lại được.");
    chanNeuLechPhienBan(hs, input.version);
    // Trả về hàng chờ đúng chỗ: đủ điều kiện thì chờ DUYỆT, thiếu thì chờ QLCS BỔ SUNG.
    const trangThaiMoi: AiLeadDraftState = thieuDieuKien(hs).length === 0 ? "READY_FOR_REVIEW" : "WAITING_QLCS";
    return transaction(async (tx) => {
      await ghiCoKhoa(tx, hs.id, hs.version, { state: trangThaiMoi, claimedById: null, claimedAt: null });
      await writeAudit({
        tx,
        actor: { id: nguoi.actor.userId, name: nguoi.ten },
        module: "ai-lead",
        entityType: "AiLeadDraft",
        entityId: hs.id,
        action: "RELEASE",
        oldValues: { claimedById: hs.claimedById, state: hs.state },
        newValues: { claimedById: null, state: trangThaiMoi },
        orgUnitId: hs.orgUnitId,
      });
      return { id: hs.id, version: hs.version + 1, state: trangThaiMoi };
    });
  });
}

// ─── BÁO ĐÃ NHẬN TRONG PAGE INBOX (OD-11) ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Nhân viên xác nhận «tôi đã nhận cuộc trò chuyện trong Page Inbox». Đây là LỜI KHAI của nhân viên (`STAFF_ATTESTED`), không phải bằng chứng từ Meta:
 *   · `ai.takeoverNeedsAgentConfirmation = true` (mặc định) ⇒ dừng ở `TAKEOVER_PENDING` — Agent vẫn giữ im lặng chờ xác nhận thật;
 *   · `= false`, HOẶC Agent đã báo trước (`takeoverConfirmSource = AGENT_REPORTED`) ⇒ lên `HUMAN_ACTIVE`.
 * Chỉ áp cho hội thoại ĐÃ yêu cầu chuyển người (`HANDOFF_REQUESTED`/`TAKEOVER_PENDING`): hội thoại còn `AI_ACTIVE` thì Agent đang giữ — nhân viên «báo nhận» lúc đó chỉ là nói dối với Agent.
 */
export async function baoDaNhanTrongPageInbox(
  nguoi: NguoiThaoTac,
  input: { draftId: string; version: number },
): Promise<KetQuaDuyet<{ id: string; version: number; ownerState: string }>> {
  return chay(async () => {
    const hs = await taiDeGhi(nguoi, input.draftId);
    chanNeuNguoiKhacGiu(hs, nguoi);
    chanNeuLechPhienBan(hs, input.version);
    const conv = hs.conversation;
    if (conv.ownerState !== "HANDOFF_REQUESTED" && conv.ownerState !== "TAKEOVER_PENDING") {
      throw new LoiDuyet("HOI_THOAI_KHONG_HOP_LE", "Hội thoại này chưa có yêu cầu chuyển cho người, nên chưa báo đã nhận được.");
    }
    if (laKetThuc(hs.state)) throw new LoiDuyet("TRANG_THAI_KHONG_HOP_LE", "Hồ sơ đã đóng.");
    const canAgentXacNhan = await getSetting("ai.takeoverNeedsAgentConfirmation");
    const nguonXacNhan = conv.takeoverConfirmSource ?? "STAFF_ATTESTED";
    const lenHumanActive = !canAgentXacNhan || nguonXacNhan === "AGENT_REPORTED";
    const ownerMoi = lenHumanActive ? ("HUMAN_ACTIVE" as const) : ("TAKEOVER_PENDING" as const);
    const luc = new Date();

    return transaction(async (tx) => {
      const r = await tx.aiLeadConversation.updateMany({
        where: { id: conv.id, ownerState: { in: ["HANDOFF_REQUESTED", "TAKEOVER_PENDING"] } },
        data: {
          ownerState: ownerMoi,
          staffClaimedById: conv.staffClaimedById ?? nguoi.actor.userId,
          staffClaimedAt: conv.staffClaimedAt ?? luc,
          takeoverConfirmedAt: luc,
          takeoverConfirmSource: nguonXacNhan,
        },
      });
      if (r.count === 0) throw new LoiDuyet("XUNG_DOT_PHIEN_BAN", CAU_XUNG_DOT);
      await ghiCoKhoa(tx, hs.id, hs.version, {
        ...(hs.claimedById === null ? { state: "IN_PROGRESS" as const, claimedById: nguoi.actor.userId, claimedAt: luc } : {}),
      });
      await writeAudit({
        tx,
        actor: { id: nguoi.actor.userId, name: nguoi.ten },
        module: "ai-lead",
        entityType: "AiLeadDraft",
        entityId: hs.id,
        action: "TAKEOVER_ATTEST",
        oldValues: { ownerState: conv.ownerState },
        newValues: { ownerState: ownerMoi, nguon: nguonXacNhan },
        orgUnitId: hs.orgUnitId,
      });
      return { id: hs.id, version: hs.version + 1, ownerState: ownerMoi };
    });
  });
}

export { docXacMinhNhanVien };
