// lib/hoa-hong/hang-cho-xu-ly-service.ts — XỬ LÝ HÀNG CHỜ `INPUT_DRIFT` / `PAYMENT_WITHDRAWN` (R9 · T1): xem trước → đề nghị (cấp 1) → duyệt (cấp 2) → ghi.
//
// Nguồn: docs/source-commission/12 §11.6. Luật thuần: `hang-cho-xu-ly.ts`. Phép GHI TIỀN DUY NHẤT vẫn là `giaiHangCho` (dòng điều chỉnh mới, sổ không bị sửa) — tệp này KHÔNG bao giờ
// ghi `CommissionTransaction`, KHÔNG `UPDATE status` của hàng chờ (không "ép pass"). Nó chỉ: kiểm phạm vi · tính tiền bị ảnh hưởng · quyết một/hai người · ghi dấu vết kiểm toán · rồi GỌI `giaiHangCho`.
//
// ── Vì sao hai người dựa trên AuditLog mà không có bảng mới ──────────────────────────────────────────────
// Đề nghị cấp 1 là một dòng `AuditLog` (`RELEASE_REQUEST`) — bảng CHỈ-THÊM, đã có chỉ mục (entityType, entityId, createdAt). Không cột mới, không migration, không bước prod thêm.
// Cái giá: trạng thái "chờ duyệt" được SUY ra từ dấu vết (dòng mới nhất còn hiệu lực), không phải một cột. Hiệu lực = đúng `holdKey` hiện tại (INPUT_DRIFT mang hash đầu vào: đầu vào đổi ⇒ khoá khác ⇒ đề nghị cũ
// hết nghĩa) và chưa quá `HAN_DE_NGHI_NGAY` ngày. Tiền được ghi vẫn bị chặn bởi `tranTien` (trần số người đề nghị đã thấy) NGAY TRONG khoá của `giaiHangCho`.
//
// ⚠️ KHÔNG kiểm quyền CHỨC NĂNG (`commission_periods:manage`) — việc của Server Action ngay đầu hàm (luật cứng Nền #1). Tự gác PHẠM VI (`passesScope`): `scopedDb` không che ghi.
// Từ chối = `throw` TRƯỚC phép ghi đầu tiên (luật 12). `now` BẮT BUỘC (luật 19).
import type { PrismaClient } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/actor";
import { passesScope } from "@/lib/db-scope";

import type { BoiCanhQuet } from "./boi-canh";
import type { QuyetDinhGiai } from "./dieu-chinh";
import { giaiHangCho, type DongXemTruoc, type KetQuaGiai } from "./giai-hang-cho";
import {
  HANH_DONG_DE_NGHI,
  HANH_DONG_KIEM_TOAN_XU_LY,
  HANH_DONG_XEM_TAY,
  KEY_XU_LY_HANG_CHO,
  deNghiConHieuLuc,
  docDeNghi,
  docXemTay,
  ghepLyDoKiemToan,
  huongXuLy,
  kiemLyDoVaBangChung,
  loiNguoiDuyet,
  quyetCapDuyet,
  tienTiepXuc,
  trangThaiXuLy,
  type CapDuyet,
  type DeNghiDaGhi,
  type LyDoCapDuyet,
  type TrangThaiXuLy,
  type XemTayDaGhi,
} from "./hang-cho-xu-ly";
import { HoaHongError } from "./kieu";
import type { NguoiThaoTacKy } from "./ky-service";
import { docNguongDuyetHaiCap } from "./quan-tri-nguong";

const MODULE_AUDIT = "hoa-hong";
const ENTITY = "CommissionHold";
const actorAudit = (n: NguoiThaoTacKy) => ({ id: n.userId, name: n.ten });

type HoldDay = NonNullable<Awaited<ReturnType<PrismaClient["commissionHold"]["findUnique"]>>>;

/**
 * Người này có quyền QUẢN LÝ KỲ (`commission_periods:manage`) tại cơ sở `centerId` không. `passesScope("CommissionHold")` KHÔNG đủ cho phép GHI: nó gộp tầm nhìn của MỌI quyền bắt đầu bằng
 * `commission:` / `commission_periods:` — người giữ `manage` ở CS1 và chỉ `commission:view-center` ở CS2 sẽ "qua" phạm vi CS2 dù KHÔNG có quyền ghi ở đó (reviewer 14/10/2026; `ky-hanh-dong` có cùng khe,
 * đường tiền mới ở đây không được thừa hưởng). Hàng chờ chưa quy được cơ sở (`centerId` null) chỉ SUPER_ADMIN / quyền "ALL". Per-user grant ALLOW là ngoại lệ toàn cục (cùng nghĩa với `getModelVisibleCenterIds`).
 */
export function coQuyenXuLyTai(actor: Actor, centerId: string | null): boolean {
  if (actor.isSuperAdmin) return true;
  if (actor.grantsAllow.has(KEY_XU_LY_HANG_CHO)) return true;
  for (const p of actor.permissions) {
    if (p.action !== KEY_XU_LY_HANG_CHO) continue;
    if (p.centerScope === "ALL") return true;
    if (Array.isArray(p.centerScope) && centerId !== null && p.centerScope.includes(centerId)) return true;
  }
  return false;
}

/** Đọc hàng chờ + cổng PHẠM VI (ghi). Người ngoài phạm vi không được biết hàng chờ ấy có tồn tại hay mã gì. */
async function docHoldTrongPhamVi(client: PrismaClient, holdId: string, nguoi: NguoiThaoTacKy): Promise<HoldDay> {
  const hold = await client.commissionHold.findUnique({ where: { id: holdId } });
  if (!hold || !passesScope("CommissionHold", { centerId: hold.centerId }, nguoi.quyen) || !coQuyenXuLyTai(nguoi.quyen, hold.centerId)) {
    // Cùng MỘT câu cho "không có" và "ngoài phạm vi" (không lộ sự tồn tại của hàng chờ cơ sở khác).
    throw new HoaHongError("HANG_CHO_KHONG_MO", "Hàng chờ không tồn tại hoặc ngoài phạm vi của bạn.");
  }
  return hold;
}

/**
 * "Bây giờ" theo đồng hồ của CHÍNH Postgres — cùng đồng hồ đóng `AuditLog.createdAt` (`@default(now())`), nên hạn của đề nghị không lệch vì chênh đồng hồ giữa máy ứng dụng và máy DB.
 * Dùng khi người gọi (trang đọc danh sách) không có mốc thời gian truyền vào; mã chạy trong `lib/hoa-hong` không tự đọc đồng hồ máy (luật 19).
 */
export async function docGioDb(client: Pick<PrismaClient, "$queryRaw">): Promise<Date> {
  const r = await client.$queryRaw<{ now: Date }[]>`select now() as now`;
  const g = r[0]?.now;
  if (!g) throw new Error("Không đọc được đồng hồ DB.");
  return g;
}

// ── Đọc dấu vết kiểm toán ──────────────────────────────────────────────────────────────────────────

export type DauVetXuLy = { deNghi: DeNghiDaGhi | null; xemTay: XemTayDaGhi | null };

/** MỘT câu cho nhiều hàng chờ: dòng `RELEASE_REQUEST` / `ESCALATE_MANUAL` MỚI NHẤT của từng hàng chờ (chưa lọc hiệu lực — lọc ở `trangThaiXuLy`). */
export async function docDauVetXuLy(client: Pick<PrismaClient, "auditLog">, holdIds: readonly string[]): Promise<Map<string, DauVetXuLy>> {
  const kq = new Map<string, DauVetXuLy>();
  if (holdIds.length === 0) return kq;
  const rows = await client.auditLog.findMany({
    where: { entityType: ENTITY, entityId: { in: [...holdIds] }, module: MODULE_AUDIT, action: { in: [...HANH_DONG_KIEM_TOAN_XU_LY] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, entityId: true, action: true, actorId: true, actorName: true, createdAt: true, newValues: true, reason: true },
  });
  for (const r of rows) {
    const cu = kq.get(r.entityId) ?? { deNghi: null, xemTay: null };
    if (r.action === HANH_DONG_DE_NGHI && cu.deNghi === null) cu.deNghi = docDeNghi(r);
    if (r.action === HANH_DONG_XEM_TAY && cu.xemTay === null) cu.xemTay = docXemTay(r);
    kq.set(r.entityId, cu);
  }
  return kq;
}

export function trangThaiXuLyCua(dauVet: DauVetXuLy | undefined, holdKey: string, now: Date): TrangThaiXuLy {
  return trangThaiXuLy({ deNghi: dauVet?.deNghi ?? null, xemTay: dauVet?.xemTay ?? null, holdKey, now });
}

// ── Xem trước ──────────────────────────────────────────────────────────────────────────────────────

export type XemTruocXuLy = {
  holdId: string;
  code: string;
  holdKey: string;
  /** Kết quả "Giải phóng nếu bấm bây giờ": các cổng của `giaiHangCho` đã chạy. `ok:false` ⇒ lý do bằng tiếng Việt (cổng nào chặn). */
  giaiPhong: { ok: true; tongTuyetDoi: number; tongRong: number; chenh: DongXemTruoc[]; kyDuKien: string } | { ok: false; ma: string; loi: string };
  /** Tiền bị ảnh hưởng dùng cho cổng hai cấp = max(bản xem trước, số trong `detail`) — thận trọng hơn là một trong hai. `null` = không đo được. */
  tien: number | null;
  nguong: number | null;
  cap: CapDuyet;
  lyDoCap: LyDoCapDuyet;
  /** Đề nghị cấp 1 CÒN HIỆU LỰC (đúng khoá hàng chờ, chưa quá hạn), nếu có. */
  deNghi: DeNghiDaGhi | null;
  xemTay: XemTayDaGhi | null;
  trangThai: TrangThaiXuLy;
};

function tienChoCap(xem: XemTruocXuLy["giaiPhong"], hold: Pick<HoldDay, "code" | "detail">): number | null {
  const tuDetail = tienTiepXuc({ code: hold.code, detail: hold.detail });
  const tuXem = xem.ok ? xem.tongTuyetDoi : null;
  if (tuDetail === null) return tuXem;
  if (tuXem === null) return tuDetail;
  return Math.max(tuDetail, tuXem);
}

async function chayXemTruoc(client: PrismaClient, bc: BoiCanhQuet, hold: HoldDay, nguoi: NguoiThaoTacKy): Promise<XemTruocXuLy["giaiPhong"]> {
  try {
    const r = await giaiHangCho(client, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "", nguoi, xemTruoc: true });
    if (r.loai !== "XEM_TRUOC") throw new Error("giaiHangCho ở chế độ xem trước trả kết quả khác XEM_TRUOC (lỗi lập trình).");
    return { ok: true, tongTuyetDoi: r.tongTuyetDoi, tongRong: r.tongRong, chenh: r.chenh, kyDuKien: r.kyDuKien };
  } catch (e) {
    if (e instanceof HoaHongError) return { ok: false, ma: e.ma, loi: e.message };
    throw e;
  }
}

export async function xemTruocXuLy(client: PrismaClient, bc: BoiCanhQuet, i: { holdId: string; nguoi: NguoiThaoTacKy; now: Date }): Promise<XemTruocXuLy> {
  const hold = await docHoldTrongPhamVi(client, i.holdId, i.nguoi);
  const h = huongXuLy({ code: hold.code, status: hold.status, detail: hold.detail });
  if (!h.giaiPhong.duoc && !h.tuChoi.duoc) throw new HoaHongError("HANG_CHO_KHONG_XU_LY_DUOC", h.giaiPhong.duoc ? "Hàng chờ không xử lý được." : h.giaiPhong.lyDo);

  const [giaiPhong, nguongDoc, dauVet] = await Promise.all([chayXemTruoc(client, bc, hold, i.nguoi), docNguongDuyetHaiCap(client), docDauVetXuLy(client, [hold.id])]);
  const tien = tienChoCap(giaiPhong, hold);
  const q = quyetCapDuyet({ tien, nguong: nguongDoc.nguong });
  const dv = dauVet.get(hold.id);
  const deNghiHieuLuc = dv?.deNghi && deNghiConHieuLuc(dv.deNghi, { holdKey: hold.holdKey, now: i.now }) ? dv.deNghi : null;
  return {
    holdId: hold.id,
    code: hold.code,
    holdKey: hold.holdKey,
    giaiPhong,
    tien,
    nguong: nguongDoc.nguong,
    cap: q.cap,
    lyDoCap: q.lyDo,
    deNghi: deNghiHieuLuc,
    xemTay: dv?.xemTay && dv.xemTay.holdKey === hold.holdKey ? dv.xemTay : null,
    trangThai: trangThaiXuLyCua(dv, hold.holdKey, i.now),
  };
}

// ── Đề nghị (cấp 1) ────────────────────────────────────────────────────────────────────────────────

export type KetQuaDeNghi = { loai: "DA_GHI"; tien: number | null } | { loai: "DA_CO_TRUOC" };

/**
 * CẤP 1: ghi đề nghị (hàng chờ vẫn MỞ, sổ không đổi). Chỉ có nghĩa khi cần HAI người — dưới ngưỡng thì quyết thẳng, đề nghị là thừa (và là một cửa khác để lách "một người" nếu để mở).
 * Idempotent: cùng người · cùng quyết định · cùng khoá hàng chờ đang có đề nghị còn hiệu lực ⇒ không ghi dòng thứ hai.
 */
export async function deNghiXuLy(
  client: PrismaClient,
  bc: BoiCanhQuet,
  i: { holdId: string; quyetDinh: QuyetDinhGiai; lyDo: string; bangChung: string; nguoi: NguoiThaoTacKy; now: Date },
): Promise<KetQuaDeNghi> {
  const v = kiemLyDoVaBangChung(i);
  if (!v.ok) throw new HoaHongError("THIEU_LY_DO", v.loi);
  const hold = await docHoldTrongPhamVi(client, i.holdId, i.nguoi);
  const h = huongXuLy({ code: hold.code, status: hold.status, detail: hold.detail });
  const cho = i.quyetDinh === "AP_DUNG" ? h.giaiPhong : h.tuChoi;
  if (!cho.duoc) throw new HoaHongError("HANG_CHO_KHONG_XU_LY_DUOC", cho.lyDo);

  const xem = await chayXemTruoc(client, bc, hold, i.nguoi);
  // "Giải phóng" mà các cổng của service đã chặn (đổi nguồn chưa duyệt…) thì đề nghị cũng vô nghĩa: lỗi nói đúng cổng nào, không để người duyệt cấp 2 gặp lại đúng bức tường đó.
  if (i.quyetDinh === "AP_DUNG" && !xem.ok) throw new HoaHongError(xem.ma, xem.loi);
  const tien = tienChoCap(xem, hold);
  const nguong = (await docNguongDuyetHaiCap(client)).nguong;
  const q = quyetCapDuyet({ tien, nguong });
  if (q.cap === "MOT_CAP") {
    throw new HoaHongError("KHONG_CAN_DE_NGHI", "Số tiền dưới ngưỡng duyệt hai cấp — một người có quyền quyết trực tiếp, không cần đề nghị.");
  }

  const dv = (await docDauVetXuLy(client, [hold.id])).get(hold.id);
  const cu = dv?.deNghi;
  // Idempotent CHỈ khi đề nghị cũ còn ĐỦ TRẦN: tiền đã TĂNG kể từ lúc lập thì đề nghị cũ không đủ cho người duyệt (`TIEN_DA_DOI` mãi mãi) ⇒ phải lập lại để nâng trần, không được trả "đã có" (reviewer #3).
  if (cu && deNghiConHieuLuc(cu, { holdKey: hold.holdKey, now: i.now }) && cu.nguoiId === i.nguoi.userId && cu.quyetDinh === i.quyetDinh && (i.quyetDinh === "GIU_NGUYEN" || cu.tien >= (tien ?? Number.POSITIVE_INFINITY))) {
    return { loai: "DA_CO_TRUOC" };
  }

  await writeAudit({
    actor: actorAudit(i.nguoi),
    module: MODULE_AUDIT,
    entityType: ENTITY,
    entityId: hold.id,
    action: HANH_DONG_DE_NGHI,
    oldValues: { status: "OPEN", code: hold.code },
    newValues: { status: "OPEN", quyetDinh: i.quyetDinh, tien: tien ?? 0, tienDoDuoc: tien !== null, holdKey: hold.holdKey, lyDo: v.lyDo, bangChung: v.bangChung, lyDoCap: q.lyDo },
    reason: ghepLyDoKiemToan(v),
    orgUnitId: hold.orgUnitId,
  });
  return { loai: "DA_GHI", tien };
}

// ── Quyết (một người dưới ngưỡng · hoặc cấp 2) ────────────────────────────────────────────────────

export type KetQuaQuyet = { loai: "DA_XU_LY"; ketQua: KetQuaGiai; cap: CapDuyet } | { loai: "DA_XU_LY_TRUOC" };

/**
 * Quyết hàng chờ: «Giải phóng» (`AP_DUNG`) hoặc «Từ chối / giữ nguyên» (`GIU_NGUYEN`).
 *   · dưới ngưỡng        ⇒ MỘT người, `tranTien` = min(số đã thấy, ngưỡng − 1): tính lại sau khoá mà ≥ ngưỡng ⇒ từ chối (không "lọt" qua một con số cũ);
 *   · từ ngưỡng / không đo được ⇒ cần đề nghị CÒN HIỆU LỰC của người KHÁC, đúng quyết định, `tranTien` = số cấp 1 đã nêu.
 * Idempotent: hàng chờ đã đóng ĐÚNG như quyết định này bởi CHÍNH người này ⇒ `DA_XU_LY_TRUOC` (không ghi lần hai); đóng bởi người khác / theo cách khác ⇒ lỗi.
 */
export async function quyetXuLy(
  client: PrismaClient,
  bc: BoiCanhQuet,
  i: { holdId: string; quyetDinh: QuyetDinhGiai; lyDo: string; bangChung: string; tienDaThay: number; nguoi: NguoiThaoTacKy; now: Date },
): Promise<KetQuaQuyet> {
  const v = kiemLyDoVaBangChung(i);
  if (!v.ok) throw new HoaHongError("THIEU_LY_DO", v.loi);
  if (!Number.isInteger(i.tienDaThay) || i.tienDaThay < 0) throw new HoaHongError("DAU_VAO_SAI", "Số tiền đã xem không hợp lệ — tải lại trang.");
  const hold = await docHoldTrongPhamVi(client, i.holdId, i.nguoi);

  const daDongDung = (h: Pick<HoldDay, "status" | "resolvedById">) => h.status === (i.quyetDinh === "AP_DUNG" ? "RESOLVED" : "DISMISSED") && h.resolvedById === i.nguoi.userId;
  if (hold.status !== "OPEN") {
    if (daDongDung(hold)) return { loai: "DA_XU_LY_TRUOC" };
    throw new HoaHongError("TRANG_THAI_DA_DOI", "Hàng chờ đã được xử lý (bởi người khác hoặc theo cách khác).");
  }
  const h = huongXuLy({ code: hold.code, status: hold.status, detail: hold.detail });
  const cho = i.quyetDinh === "AP_DUNG" ? h.giaiPhong : h.tuChoi;
  if (!cho.duoc) throw new HoaHongError("HANG_CHO_KHONG_XU_LY_DUOC", cho.lyDo);

  const xem = await chayXemTruoc(client, bc, hold, i.nguoi);
  if (i.quyetDinh === "AP_DUNG" && !xem.ok) throw new HoaHongError(xem.ma, xem.loi);
  const tien = tienChoCap(xem, hold);
  const nguong = (await docNguongDuyetHaiCap(client)).nguong;
  const q = quyetCapDuyet({ tien, nguong });

  let tranTien: number | undefined;
  let deNghi: DeNghiDaGhi | null = null;
  if (q.cap === "MOT_CAP") {
    // Dưới ngưỡng ở lúc này. Trần = min(số đã thấy, ngưỡng − 1): bấm trên con số cũ, hoặc tiền tính lại SAU khoá chạm ngưỡng ⇒ `TIEN_DA_DOI`.
    tranTien = i.quyetDinh === "AP_DUNG" ? Math.min(i.tienDaThay, (nguong ?? 0) - 1) : undefined;
  } else {
    const dv = (await docDauVetXuLy(client, [hold.id])).get(hold.id);
    deNghi = dv?.deNghi ?? null;
    if (!deNghi || !deNghiConHieuLuc(deNghi, { holdKey: hold.holdKey, now: i.now })) {
      throw new HoaHongError("CAN_DE_NGHI_CAP_1", "Số tiền cần HAI người: chưa có đề nghị còn hiệu lực (hết hạn hoặc đầu vào đã đổi). Người thứ nhất lập đề nghị trước, người KHÁC duyệt sau.");
    }
    const loi = loiNguoiDuyet(deNghi, i.nguoi.userId);
    if (loi) throw new HoaHongError("CUNG_NGUOI", loi);
    if (deNghi.quyetDinh !== i.quyetDinh) {
      throw new HoaHongError("QUYET_DINH_KHAC_DE_NGHI", `Đề nghị cấp 1 là «${deNghi.quyetDinh === "AP_DUNG" ? "Giải phóng" : "Từ chối / giữ nguyên"}» — cấp 2 duyệt hoặc bỏ qua đúng đề nghị đó, không đổi chiều.`);
    }
    tranTien = i.quyetDinh === "AP_DUNG" ? deNghi.tien : undefined;
  }

  try {
    const ketQua = await giaiHangCho(client, bc, {
      holdId: hold.id,
      quyetDinh: i.quyetDinh,
      lyDo: ghepLyDoKiemToan({ ...v, deNghi: deNghi ? { ten: deNghi.tenNguoi, lyDo: deNghi.lyDo, bangChung: deNghi.bangChung } : null }),
      nguoi: i.nguoi,
      ...(tranTien !== undefined ? { tranTien } : {}),
      batKy: {
        cap: q.cap,
        lyDoCap: q.lyDo,
        nguong,
        tienDoDuoc: tien,
        bangChung: v.bangChung,
        ...(deNghi ? { deNghi: { auditId: deNghi.id, nguoiId: deNghi.nguoiId, ten: deNghi.tenNguoi, luc: deNghi.luc.toISOString(), tien: deNghi.tien, lyDo: deNghi.lyDo, bangChung: deNghi.bangChung } } : {}),
      },
    });
    return { loai: "DA_XU_LY", ketQua, cap: q.cap };
  } catch (e) {
    // Hai người cùng bấm: người sau thấy hàng chờ đã đóng. Nếu đóng ĐÚNG như họ định bởi CHÍNH họ (bấm đúp) thì đó là idempotent, không phải lỗi.
    if (e instanceof HoaHongError && e.ma === "TRANG_THAI_DA_DOI") {
      const sau = await client.commissionHold.findUnique({ where: { id: hold.id }, select: { status: true, resolvedById: true } });
      if (sau && sau.status !== "OPEN" && daDongDung(sau)) return { loai: "DA_XU_LY_TRUOC" };
    }
    throw e;
  }
}

// ── Chuyển xem tay ─────────────────────────────────────────────────────────────────────────────────

export type KetQuaXemTay = { loai: "DA_GHI" } | { loai: "DA_CO_TRUOC" };

/**
 * «Chuyển xem tay»: đánh dấu hàng chờ cần người có thẩm quyền xem (không đổi trạng thái, KHÔNG gỡ chặn khoá kỳ — hàng chờ vẫn là hàng chờ CỨNG). Chỉ là dấu vết kiểm toán + nhãn hiển thị.
 * Idempotent theo khoá hàng chờ: đã có dấu cho đúng khoá này thì không ghi thêm.
 */
export async function chuyenXemTay(client: PrismaClient, i: { holdId: string; lyDo: string; nguoi: NguoiThaoTacKy; now: Date }): Promise<KetQuaXemTay> {
  const lyDo = i.lyDo.trim();
  if (lyDo.length < 10) throw new HoaHongError("THIEU_LY_DO", "Chuyển xem tay bắt buộc kèm lý do (≥ 10 ký tự).");
  if (lyDo.length > 1000) throw new HoaHongError("THIEU_LY_DO", "Lý do quá dài (tối đa 1000 ký tự).");
  const hold = await docHoldTrongPhamVi(client, i.holdId, i.nguoi);
  const h = huongXuLy({ code: hold.code, status: hold.status, detail: hold.detail });
  if (!h.chuyenXemTay.duoc) throw new HoaHongError("HANG_CHO_KHONG_XU_LY_DUOC", h.chuyenXemTay.lyDo);
  const dv = (await docDauVetXuLy(client, [hold.id])).get(hold.id);
  if (dv?.xemTay && dv.xemTay.holdKey === hold.holdKey) return { loai: "DA_CO_TRUOC" };
  await writeAudit({
    actor: actorAudit(i.nguoi),
    module: MODULE_AUDIT,
    entityType: ENTITY,
    entityId: hold.id,
    action: HANH_DONG_XEM_TAY,
    oldValues: { status: "OPEN", code: hold.code },
    newValues: { status: "OPEN", holdKey: hold.holdKey },
    reason: lyDo,
    orgUnitId: hold.orgUnitId,
  });
  return { loai: "DA_GHI" };
}
