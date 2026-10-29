// lib/ai-lead/dich-vu/ngoai-le.ts — DỊCH VỤ «NGOẠI LỆ» (Exception Center) của hồ sơ AI Lead: danh sách · thử lại tạo lead · đánh dấu đã xử lý · giao người.
//
// ═══ BỐN LUẬT (cùng bốn luật của `duyet.ts` — tệp này KHÔNG nới luật nào) ═══════════════════════════════════════════════════════════════════
//  1. CÁCH LY CƠ SỞ. ĐỌC qua `scopedDb(actor)` (hồ sơ `centerId = NULL` chỉ cấp Hội sở thấy — KHÔNG phải «dùng chung»). GHI không được che nên mỗi phép ghi tự `passesScope()` +
//     `can("ai-leads:review", { centerId })`; ngoài phạm vi trả `KHONG_TIM_THAY` — cùng một câu với «không có hồ sơ này» (không thành kênh dò).
//  2. KHOÁ LẠC QUAN. Mỗi phép ghi nhận `version` mà người dùng ĐÃ THẤY, ghi bằng `updateMany({ where: { id, version, state } })`; đổi 0 dòng ⇒ THROW trong transaction
//     (audit không bị ghi lẻ) ⇒ `XUNG_DOT_PHIEN_BAN`. Hai người cùng bấm «Thử lại»: một người thắng, người kia nhận câu xung đột — KHÔNG có hai lead.
//  3. MỘT NGƯỜI MỘT HỒ SƠ. Hồ sơ lỗi đang do người khác giữ ⇒ `DA_NGUOI_KHAC_NHAN`.
//  4. MỌI GHI CÓ AUDIT (module `ai-lead`) TRONG CÙNG transaction, kèm LÝ DO do người dùng nhập.
//
// ═══ ĐIỀU TỆP NÀY KHÔNG LÀM ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  · KHÔNG `db.lead.create` / không chạm lõi CRM: thử lại = đưa hồ sơ về hàng chờ rồi gọi `taoLeadTuHoSo` (đường ghi DUY NHẤT của lead).
//  · KHÔNG tự chia sale. ASSIGNMENT_PENDING chỉ được đóng khi `Lead.assignedToId` ĐÃ có giá trị (người khác đã giao ở màn lead) — «đã xử lý» mà lead vẫn vô chủ là im lặng nói dối.
//  · KHÔNG sửa `duyet.ts` / `tao-lead.ts` / `intake.ts` (chỉ import). Giao người = chính `chuyenNguoi` (không viết lại luật chuyển).
//
// ═══ PII ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// `canViewPii` là tham số BẮT BUỘC của `danhSachNgoaiLe` (luật 7). Dòng ngoại lệ chỉ mang TÊN FB (đã che theo quyền) — không SĐT. Lý do lỗi là câu dịch từ bảng trắng mã, không in `resultNote`.
import type { AiLeadDraft, AiLeadDraftState, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { passesScope, scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/permissions/can";
import { writeAudit } from "@/lib/audit/audit-log";
import { cheTenFacebook } from "./che-pii";
import { daRaLead, laKetThuc, NHAN_THIEU, thieuDieuKien, type ThieuDieuKien } from "./dieu-kien";
import { chuyenNguoi, dungWhereDanhSach, SO_DONG_TOI_DA, ungVienHopLeChoCoSo, type KetQuaDuyet, type MaLoiDuyet, type NguoiThaoTac } from "./duyet";
import { mucSla, type MucSla } from "./sla";
import { taoLeadTuHoSo } from "./tao-lead";
import {
  THU_TU_LOAI,
  bangNutNgoaiLe,
  lyDoNgoaiLe,
  maHopLe,
  mocNgoaiLe,
  phanLoaiNgoaiLe,
  type BangNutNgoaiLe,
  type LoaiNgoaiLe,
  type LyDoNgoaiLe,
} from "./ngoai-le-thuan";

// ─── Kiểu & lỗi ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type MaLoiNgoaiLe = MaLoiDuyet | "LEAD_CHUA_CO_NGUOI";

export type KetQuaNgoaiLe<T> = { ok: true; data: T } | { ok: false; error: { code: MaLoiNgoaiLe; message: string; field?: string } };

class LoiNgoaiLe extends Error {
  constructor(
    readonly ma: MaLoiNgoaiLe,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "LoiNgoaiLe";
  }
}

async function chay<T>(fn: () => Promise<T>): Promise<KetQuaNgoaiLe<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof LoiNgoaiLe) return { ok: false, error: { code: e.ma, message: e.message, ...(e.field ? { field: e.field } : {}) } };
    throw e; // lỗi hệ thống → để Next/Sentry bắt, KHÔNG nuốt thành «lỗi nghiệp vụ»
  }
}

const CAU_XUNG_DOT = "Hồ sơ vừa được cập nhật bởi người hoặc hệ thống khác. Tải lại trang để xem bản mới nhất rồi thao tác lại.";
/** Cùng ngưỡng với ô lý do ở giao diện (`NutLyDo`) — máy chủ KIỂM LẠI, giao diện chỉ là tiện lợi. */
export const LY_DO_TOI_THIEU = 10;
export const LY_DO_TOI_DA = 500;

function kiemLyDo(lyDo: string): string {
  const x = lyDo.trim();
  if (x.length < LY_DO_TOI_THIEU) throw new LoiNgoaiLe("DU_LIEU_KHONG_HOP_LE", `Nhập lý do (ít nhất ${LY_DO_TOI_THIEU} ký tự).`, "lyDo");
  if (x.length > LY_DO_TOI_DA) throw new LoiNgoaiLe("DU_LIEU_KHONG_HOP_LE", `Lý do tối đa ${LY_DO_TOI_DA} ký tự.`, "lyDo");
  return x;
}

// ─── Tải hồ sơ để GHI ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type HoSoGhi = AiLeadDraft;

/** Ba cổng, theo thứ tự: tồn tại → trong phạm vi → có quyền `ai-leads:review` tại cơ sở của hồ sơ. Hai cổng đầu cùng trả KHONG_TIM_THAY. */
async function taiDeGhi(nguoi: NguoiThaoTac, draftId: string): Promise<HoSoGhi> {
  const hs = await db.aiLeadDraft.findUnique({ where: { id: draftId } });
  if (!hs || !passesScope("AiLeadDraft", hs, nguoi.actor)) throw new LoiNgoaiLe("KHONG_TIM_THAY", "Không tìm thấy hồ sơ.");
  if (!can(nguoi.actor, "ai-leads:review", { centerId: hs.centerId })) throw new LoiNgoaiLe("KHONG_CO_QUYEN", "Bạn không có quyền xử lý hồ sơ AI.");
  return hs;
}

function chanNeuNguoiKhacGiu(hs: Pick<HoSoGhi, "claimedById">, nguoi: NguoiThaoTac): void {
  if (hs.claimedById !== null && hs.claimedById !== nguoi.actor.userId) {
    throw new LoiNgoaiLe("DA_NGUOI_KHAC_NHAN", "Hồ sơ này đang được người khác xử lý.");
  }
}

function chanNeuLechPhienBan(hs: Pick<HoSoGhi, "version">, version: number): void {
  if (hs.version !== version) throw new LoiNgoaiLe("XUNG_DOT_PHIEN_BAN", CAU_XUNG_DOT);
}

async function transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => fn(tx as unknown as Prisma.TransactionClient));
}

// ─── DANH SÁCH ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type LocNgoaiLe = {
  /** Mặc định = cả ba loại. */
  loai?: LoaiNgoaiLe | "tat-ca";
  pageId?: string;
  coSoId?: string;
  /** Mã hồ sơ (8 ký tự cuối id). Cố ý KHÔNG tìm theo tên/SĐT: màn này không cần, và ô tìm theo PII là kênh dò. */
  q?: string;
};

const KET_THUC_DB: AiLeadDraftState[] = ["COMPLETED", "REJECTED", "EXPIRED"];

/** `where` cho MỘT loại. Quá hạn gọi lại `dungWhereDanhSach({ quaHanSla })` — MỘT định nghĩa «quá hạn» với danh sách chính — rồi loại SYSTEM_EXCEPTION (đã thuộc loại nặng hơn). */
function whereLoai(loai: LoaiNgoaiLe, now: Date): Prisma.AiLeadDraftWhereInput {
  if (loai === "SYSTEM_EXCEPTION") return { state: "SYSTEM_EXCEPTION" };
  if (loai === "ASSIGNMENT_PENDING") return { state: "ASSIGNMENT_PENDING" };
  return { AND: [dungWhereDanhSach({ quaHanSla: true }, { userId: "" }, false, now), { state: { notIn: [...KET_THUC_DB, "SYSTEM_EXCEPTION", "ASSIGNMENT_PENDING"] } }] };
}

/** `where` THUẦN (test được không cần DB). `now` là tham số. `boLoai` = bỏ điều kiện loại (để đếm từng loại với cùng các bộ lọc còn lại). */
export function dungWhereNgoaiLe(loc: LocNgoaiLe, now: Date, loaiDem?: LoaiNgoaiLe): Prisma.AiLeadDraftWhereInput {
  const loai = loaiDem ?? (loc.loai && loc.loai !== "tat-ca" ? loc.loai : null);
  const and: Prisma.AiLeadDraftWhereInput[] = [loai ? whereLoai(loai, now) : { OR: THU_TU_LOAI.map((l) => whereLoai(l, now)) }];
  if (loc.pageId) and.push({ conversation: { pageId: loc.pageId } });
  if (loc.coSoId) and.push({ centerId: loc.coSoId });
  const q = loc.q?.trim();
  if (q) and.push({ id: { endsWith: q } });
  return { AND: and };
}

export type HangNgoaiLe = {
  id: string;
  loai: LoaiNgoaiLe;
  state: AiLeadDraftState;
  version: number;
  /** ĐÃ che theo `canViewPii`. */
  fbName: string | null;
  pageId: string;
  centerId: string | null;
  centerTen: string | null;
  claimedById: string | null;
  claimedTen: string | null;
  claimedBoiToi: boolean;
  mucSla: MucSla;
  /** «Lỗi cách đây» · «Chờ phân công cách đây» · «Quá hạn» — ghép với `tuoiMs`. */
  nhanTuoi: string;
  tuoiMs: number;
  lyDo: LyDoNgoaiLe;
  thieu: ThieuDieuKien[];
  leadId: string | null;
  /** Chỉ có nghĩa với ASSIGNMENT_PENDING; `null` = không áp dụng. */
  leadDaCoNguoi: boolean | null;
  coQuyenXuLy: boolean;
  /** Người nhận chuyển được (đã loại chính mình). Rỗng khi loại/trạng thái không chuyển được. */
  ungVien: { id: string; ten: string }[];
  nut: BangNutNgoaiLe;
};

export type KetQuaDanhSachNgoaiLe = {
  hang: HangNgoaiLe[];
  /** Tổng số khớp bộ lọc hiện tại (có thể > số dòng trả về). */
  tong: number;
  biCat: boolean;
  /** Số hồ sơ MỖI loại với các bộ lọc còn lại (Page · cơ sở · mã) — để hiện số trên thẻ chọn loại. */
  dem: Record<LoaiNgoaiLe, number>;
  tuyChon: { pages: string[]; coSo: { id: string; ten: string }[] };
};

/** Quản lý hợp lệ (theo cơ sở) cho ô «Giao người». Mỗi người còn phải qua `kiemNguoiNhan` của `chuyenNguoi` lúc chuyển thật. */
async function ungVienTheoCoSo(centerIds: string[], tuId: string): Promise<Map<string, { id: string; ten: string }[]>> {
  const ra = new Map<string, { id: string; ten: string }[]>();
  if (centerIds.length === 0) return ra;
  // Cùng cổng với `chuyenNguoi` (`ungVienHopLeChoCoSo`): chỉ liệt kê người mà máy chủ sẽ nhận.
  await Promise.all(centerIds.map(async (c) => ra.set(c, await ungVienHopLeChoCoSo(c, tuId))));
  return ra;
}

export async function danhSachNgoaiLe(actor: Actor, loc: LocNgoaiLe, canViewPii: boolean, now: Date): Promise<KetQuaDanhSachNgoaiLe> {
  const sdb = scopedDb(actor);
  const where = dungWhereNgoaiLe(loc, now);
  const [dong, tong, dSe, dAp, dQh, pages] = await Promise.all([
    sdb.aiLeadDraft.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: SO_DONG_TOI_DA,
      include: { conversation: { select: { pageId: true } } },
    }),
    sdb.aiLeadDraft.count({ where }),
    sdb.aiLeadDraft.count({ where: dungWhereNgoaiLe(loc, now, "SYSTEM_EXCEPTION") }),
    sdb.aiLeadDraft.count({ where: dungWhereNgoaiLe(loc, now, "ASSIGNMENT_PENDING") }),
    sdb.aiLeadDraft.count({ where: dungWhereNgoaiLe(loc, now, "QUA_HAN_SLA") }),
    db.aiLeadAgentPage.findMany({ distinct: ["pageId"], select: { pageId: true }, orderBy: { pageId: "asc" } }),
  ]);

  const centerIds = [...new Set(dong.map((d) => d.centerId).filter((x): x is string => !!x))];
  const userIds = [...new Set(dong.map((d) => d.claimedById).filter((x): x is string => !!x))];
  const leadIds = [...new Set(dong.filter((d) => d.state === "ASSIGNMENT_PENDING").map((d) => d.leadId).filter((x): x is string => !!x))];
  const [centers, users, leads, coSoLoc] = await Promise.all([
    centerIds.length ? db.center.findMany({ where: { id: { in: centerIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    leadIds.length ? db.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, assignedToId: true } }) : Promise.resolve([]),
    db.center.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const tenCoSo = new Map(centers.map((c) => [c.id, c.name]));
  const tenNguoi = new Map(users.map((u) => [u.id, u.name]));
  const chuLead = new Map(leads.map((l) => [l.id, l.assignedToId !== null]));

  // Hạng nào mới cần danh sách ứng viên: loại ≠ ASSIGNMENT_PENDING, có quyền, người khác không giữ. Tra theo CƠ SỞ (ít hơn theo hồ sơ nhiều lần).
  const phanLoai = dong.map((d) => ({ d, loai: phanLoaiNgoaiLe(d, now) }));
  const canUngVien = phanLoai
    .filter((x) => x.loai !== null && x.loai !== "ASSIGNMENT_PENDING" && x.d.centerId && (x.d.claimedById === null || x.d.claimedById === actor.userId) && can(actor, "ai-leads:review", { centerId: x.d.centerId }))
    .map((x) => x.d.centerId!);
  const ungVien = await ungVienTheoCoSo([...new Set(canUngVien)], actor.userId);

  const hang: HangNgoaiLe[] = [];
  for (const { d, loai } of phanLoai) {
    // Một dòng DB khớp `where` mà hàm thuần không phân loại được = hai định nghĩa lệch nhau (đồng hồ chạy giữa hai lượt đọc) ⇒ bỏ dòng, không bịa loại.
    if (loai === null) continue;
    const muc = mucSla(d, now);
    const thieu = thieuDieuKien(d);
    const leadDaCoNguoi = loai === "ASSIGNMENT_PENDING" && d.leadId ? (chuLead.get(d.leadId) ?? false) : null;
    const lyDo = lyDoNgoaiLe({ loai, resultNote: d.resultNote, mucSla: muc, leadDaCoNguoi });
    const moc = mocNgoaiLe(loai, d, now);
    const claimedBoiToi = d.claimedById === actor.userId;
    const coQuyenXuLy = can(actor, "ai-leads:review", { centerId: d.centerId });
    const uv = d.centerId && loai !== "ASSIGNMENT_PENDING" && coQuyenXuLy ? (ungVien.get(d.centerId) ?? []) : [];
    hang.push({
      id: d.id,
      loai,
      state: d.state,
      version: d.version,
      fbName: cheTenFacebook(d.fbName, canViewPii),
      pageId: d.conversation.pageId,
      centerId: d.centerId,
      centerTen: d.centerId ? (tenCoSo.get(d.centerId) ?? null) : null,
      claimedById: d.claimedById,
      claimedTen: d.claimedById ? (tenNguoi.get(d.claimedById) ?? null) : null,
      claimedBoiToi,
      mucSla: muc,
      nhanTuoi: moc.nhan,
      tuoiMs: Math.max(0, now.getTime() - moc.moc.getTime()),
      lyDo,
      thieu,
      leadId: d.leadId,
      leadDaCoNguoi,
      coQuyenXuLy,
      ungVien: uv,
      nut: bangNutNgoaiLe({
        loai,
        state: d.state,
        coQuyenXuLy,
        claimedById: d.claimedById,
        claimedBoiToi,
        claimedTen: d.claimedById ? (tenNguoi.get(d.claimedById) ?? null) : null,
        thieu,
        thuLaiDuoc: lyDo.thuLaiDuoc,
        leadId: d.leadId,
        leadDaCoNguoi,
        soUngVien: uv.length,
      }),
    });
  }
  // Nặng trước: lỗi → chờ phân công → quá hạn; trong cùng loại: cũ nhất trước (đã sắp theo `updatedAt` ở DB, sort ổn định giữ nguyên thứ tự).
  hang.sort((a, b) => THU_TU_LOAI.indexOf(a.loai) - THU_TU_LOAI.indexOf(b.loai));

  return {
    hang,
    tong,
    biCat: tong > dong.length,
    dem: { SYSTEM_EXCEPTION: dSe, ASSIGNMENT_PENDING: dAp, QUA_HAN_SLA: dQh },
    tuyChon: { pages: pages.map((p) => p.pageId), coSo: coSoLoc.filter((c) => passesScope("AiLeadDraft", { centerId: c.id }, actor)).map((c) => ({ id: c.id, ten: c.name })) },
  };
}

// ─── THỬ LẠI TẠO LEAD ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type KetQuaThuLai = { id: string; leadId: string | null; state: AiLeadDraftState; daCoLead: boolean };

/**
 * Hồ sơ `SYSTEM_EXCEPTION` → thử tạo lead lại. Thứ tự (luật rollback: cổng đứng TRƯỚC phép ghi đầu tiên):
 *   lý do → tải (tồn tại · phạm vi · quyền) → ĐÃ ra lead ⇒ OK idempotent (trước cả version: người bấm muộn nhận «xong rồi», không nhận xung đột) → phải là SYSTEM_EXCEPTION →
 *   người khác giữ? → version → thiếu điều kiện (từ chối TRƯỚC khi ghi) → CAS `SYSTEM_EXCEPTION → READY_FOR_REVIEW` + nhận hồ sơ + audit (một transaction) → `taoLeadTuHoSo(STAFF)`.
 * Người thử lại NHẬN hồ sơ trong cùng bước CAS: hồ sơ đã nhận được Gateway coi là của nhân viên và KHÔNG tính lại trong khoảng giữa CAS và lúc tạo lead.
 */
export async function thuLaiTaoLead(nguoi: NguoiThaoTac, input: { draftId: string; version: number; lyDo: string }): Promise<KetQuaNgoaiLe<KetQuaThuLai>> {
  return chay(async () => {
    const lyDo = kiemLyDo(input.lyDo);
    const hs = await taiDeGhi(nguoi, input.draftId);
    if (daRaLead(hs.state)) return { id: hs.id, leadId: hs.leadId, state: hs.state, daCoLead: true };
    if (hs.state !== "SYSTEM_EXCEPTION") {
      throw new LoiNgoaiLe("TRANG_THAI_KHONG_HOP_LE", laKetThuc(hs.state) ? "Hồ sơ đã đóng." : "Chỉ hồ sơ bị lỗi hệ thống mới thử lại được. Hồ sơ này dùng nút «Duyệt» ở màn chi tiết.");
    }
    chanNeuNguoiKhacGiu(hs, nguoi);
    chanNeuLechPhienBan(hs, input.version);
    const thieu = thieuDieuKien(hs);
    if (thieu.length > 0) {
      throw new LoiNgoaiLe("THIEU_DIEU_KIEN", `${thieu.map((t) => NHAN_THIEU[t]).join("; ")}. Mở hồ sơ để bổ sung rồi duyệt.`);
    }

    const luc = new Date();
    await transaction(async (tx) => {
      const r = await tx.aiLeadDraft.updateMany({
        where: { id: hs.id, version: hs.version, state: "SYSTEM_EXCEPTION" },
        data: {
          state: "READY_FOR_REVIEW",
          resultNote: null,
          version: { increment: 1 },
          ...(hs.claimedById === null ? { claimedById: nguoi.actor.userId, claimedAt: luc } : {}),
        },
      });
      if (r.count === 0) throw new LoiNgoaiLe("XUNG_DOT_PHIEN_BAN", CAU_XUNG_DOT); // THROW ⇒ audit không bị ghi lẻ
      await writeAudit({
        tx,
        actor: { id: nguoi.actor.userId, name: nguoi.ten },
        module: "ai-lead",
        entityType: "AiLeadDraft",
        entityId: hs.id,
        action: "RETRY_CREATE_LEAD",
        oldValues: { state: "SYSTEM_EXCEPTION", maLoi: maHopLe(hs.resultNote), claimedById: hs.claimedById },
        newValues: { state: "READY_FOR_REVIEW", claimedById: hs.claimedById ?? nguoi.actor.userId },
        reason: lyDo,
        orgUnitId: hs.orgUnitId,
      });
    });

    const kq = await taoLeadTuHoSo(hs.id, { actor: nguoi.actor, tu: "STAFF", tenNguoi: nguoi.ten });
    if (kq.ok) {
      const sau = await db.aiLeadDraft.findUnique({ where: { id: hs.id }, select: { state: true } });
      return { id: hs.id, leadId: kq.leadId, state: sau?.state ?? "COMPLETED", daCoLead: kq.duplicate };
    }
    switch (kq.lyDo) {
      case "NGUON_CHUA_CAU_HINH":
        throw new LoiNgoaiLe("NGUON_CHUA_CAU_HINH", "Nguồn lead của Page này vẫn chưa được cấu hình. Hồ sơ còn trong danh sách ngoại lệ; cấu hình nguồn ở module Nguồn lead rồi thử lại.");
      case "LOI_INGEST":
        // `taoLeadTuHoSo` đã tự đưa hồ sơ về SYSTEM_EXCEPTION kèm mã mới ⇒ vẫn nằm trong hàng đợi này.
        throw new LoiNgoaiLe("LOI_INGEST", "Hệ thống vẫn chưa tạo được lead. Hồ sơ còn trong danh sách ngoại lệ; thử lại sau hoặc báo bộ phận kỹ thuật.");
      case "THIEU_DIEU_KIEN":
        throw new LoiNgoaiLe("THIEU_DIEU_KIEN", "Hồ sơ chưa đủ thông tin (có thể vừa bị sửa). Hồ sơ đã về danh sách «Hồ sơ chờ AI» để bổ sung rồi duyệt lại — không còn ở danh sách ngoại lệ.");
      case "CO_SO_KHONG_HOP_LE":
        throw new LoiNgoaiLe("CO_SO_KHONG_HOP_LE", "Cơ sở của hồ sơ không còn nhận khách từ Page này. Hồ sơ đã về danh sách «Hồ sơ chờ AI» — chọn lại cơ sở rồi duyệt; không còn ở danh sách ngoại lệ.");
      case "XUNG_DOT_PHIEN_BAN":
        throw new LoiNgoaiLe("XUNG_DOT_PHIEN_BAN", CAU_XUNG_DOT);
      case "KHONG_TIM_THAY":
      case "NGOAI_PHAM_VI":
        throw new LoiNgoaiLe("KHONG_TIM_THAY", "Không tìm thấy hồ sơ.");
      case "DA_XU_LY":
      case "TU_DONG_TAT":
        throw new LoiNgoaiLe("TRANG_THAI_KHONG_HOP_LE", "Hồ sơ đã được xử lý xong.");
    }
  });
}

// ─── ĐÁNH DẤU ĐÃ XỬ LÝ (ASSIGNMENT_PENDING) ──────────────────────────────────────────────────────────────────────────────────────────────────

export type KetQuaDong = { id: string; leadId: string | null; state: AiLeadDraftState };

/**
 * Đóng ngoại lệ «lead chưa có sale» SAU KHI người có thẩm quyền đã giao sale ở màn lead. KHÔNG tự chia sale; KHÔNG đóng khi `Lead.assignedToId` còn trống.
 * Không áp luật «người khác giữ hồ sơ»: hồ sơ đã ra lead rồi, người nhận ban đầu không còn là chủ của việc này — bất kỳ QLCS trong phạm vi + có quyền review đều đóng được.
 * Đã `COMPLETED` (người khác vừa đóng) ⇒ OK idempotent.
 */
export async function danhDauDaXuLy(nguoi: NguoiThaoTac, input: { draftId: string; version: number; lyDo: string }): Promise<KetQuaNgoaiLe<KetQuaDong>> {
  return chay(async () => {
    const lyDo = kiemLyDo(input.lyDo);
    const hs = await taiDeGhi(nguoi, input.draftId);
    if (hs.state === "COMPLETED") return { id: hs.id, leadId: hs.leadId, state: "COMPLETED" as const };
    if (hs.state !== "ASSIGNMENT_PENDING") {
      throw new LoiNgoaiLe("TRANG_THAI_KHONG_HOP_LE", "Chỉ hồ sơ «lead chưa có người phụ trách» mới đánh dấu đã xử lý được.");
    }
    chanNeuLechPhienBan(hs, input.version);
    if (!hs.leadId) throw new LoiNgoaiLe("LEAD_CHUA_CO_NGUOI", "Hồ sơ chưa gắn lead nào để kiểm tra người phụ trách.");
    const lead = await db.lead.findUnique({ where: { id: hs.leadId }, select: { assignedToId: true } });
    if (!lead?.assignedToId) {
      throw new LoiNgoaiLe("LEAD_CHUA_CO_NGUOI", "Lead này vẫn chưa có người phụ trách. Giao sale ở màn lead trước, rồi quay lại đánh dấu đã xử lý.");
    }
    const luc = new Date();
    await transaction(async (tx) => {
      const r = await tx.aiLeadDraft.updateMany({
        where: { id: hs.id, version: hs.version, state: "ASSIGNMENT_PENDING" },
        data: { state: "COMPLETED", closedAt: luc, version: { increment: 1 } },
      });
      if (r.count === 0) throw new LoiNgoaiLe("XUNG_DOT_PHIEN_BAN", CAU_XUNG_DOT);
      await writeAudit({
        tx,
        actor: { id: nguoi.actor.userId, name: nguoi.ten },
        module: "ai-lead",
        entityType: "AiLeadDraft",
        entityId: hs.id,
        action: "CLOSE_EXCEPTION",
        oldValues: { state: "ASSIGNMENT_PENDING" },
        newValues: { state: "COMPLETED", leadId: hs.leadId },
        reason: lyDo,
        orgUnitId: hs.orgUnitId,
      });
    });
    return { id: hs.id, leadId: hs.leadId, state: "COMPLETED" as const };
  });
}

// ─── GIAO NGƯỜI ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Giao hồ sơ ngoại lệ cho người khác = ĐÚNG `chuyenNguoi` (luật chuyển, thông báo, audit nằm ở đó). Hồ sơ đã ra lead bị `chuyenNguoi` từ chối. */
export async function giaoNguoi(nguoi: NguoiThaoTac, input: { draftId: string; version: number; nguoiNhanId: string }): Promise<KetQuaNgoaiLe<{ id: string; version: number; state: AiLeadDraftState }>> {
  const kq: KetQuaDuyet<{ id: string; version: number; state: AiLeadDraftState }> = await chuyenNguoi(nguoi, input);
  return kq;
}
