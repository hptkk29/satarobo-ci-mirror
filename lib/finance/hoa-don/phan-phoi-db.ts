import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { scopedDb } from "@/lib/db-scope";
import { actionCenterScope } from "@/lib/lms/report-card-core";
import { portalDb, type PortalOwner } from "@/lib/portal/db";
import { laHubPhanPhoiBatChoCoSo } from "./feature";
import { khoHoaDonDaCauHinh } from "./kho-tep";
import {
  choPhepTaiPdf,
  hienThiChoPhuHuynh,
  hienThiChoSale,
  hoaDonThuocPhuHuynh,
  tenTepAnToan,
  type DongHoaDonPhuHuynh,
  type DongHoaDonSale,
  type HoaDonPhanPhoiVao,
} from "./phan-phoi-doc";
import { docPdfHoaDon } from "./phan-phoi-tep";

// lib/finance/hoa-don/phan-phoi-db.ts — NẠP + PHÁT hoá đơn ĐÃ PHÁT HÀNH cho Sale / phụ huynh (Invoice Hub S10, CHỈ ĐỌC). Người chạy DB.
// Luật hiển thị / tải nằm ở `phan-phoi-doc.ts` (thuần); đây chỉ là: ai là người xem → đọc đúng phạm vi → hỏi cờ THEO CƠ SỞ → audit → byte.
//
// Bất di bất dịch:
//  · Cờ `hoaDon.hubPhanPhoi` hỏi theo cơ sở CỦA CHÍNH hoá đơn (`laHubPhanPhoiBatChoCoSo(hd.centerId)`) — TẮT ⇒ như không tồn tại (danh sách rỗng, tải ⇒ không tìm thấy).
//  · SALE đọc hoá đơn LỒNG DƯỚI ĐƠN qua `scopedDb(actor).order` (cổng phạm vi `orders:`), KHÔNG qua `scopedDb.hoaDonDienTu` (tầm nhìn bảng ấy theo tiền tố `payments:` —
//    một Sale thuần không có tiền tố đó sẽ mất hết hoá đơn). Tải PDF còn đòi `orders:view-pii` TẠI ĐÚNG cơ sở của hoá đơn.
//  · PHỤ HUYNH: sở hữu viết THẲNG vào `where` (portalDb không có đường sở hữu cho hoá đơn — pass-through), rồi kiểm lại bằng `hoaDonThuocPhuHuynh`.
//    Con của phụ huynh lấy lại từ DB qua `portalDb(owner).student` (đã AND `parentUserId`), không tin `owner.childIds` do người gọi truyền.
//  · Tải: kiểm sở hữu → trạng thái → cờ → kho cấu hình → AUDIT → mới đọc byte. Audit ném ⇒ không có byte nào đi ra.
//  · Không `console.log`; không trả khoá kho; không `studentId`/tên học viên đi vào audit hay view-model.

/** `orders:view-pii` có hiệu lực ở ĐÚNG cơ sở này không (quyền trần chưa đủ: `can()` GLOBAL bỏ qua cơ sở). */
export function coQuyenXemPiiTaiCoSo(actor: Pick<Actor, "isSuperAdmin" | "permissions" | "grantsAllow">, centerId: string | null): boolean {
  if (!centerId) return false;
  const tap = actionCenterScope(actor, "orders:view-pii");
  return tap === "ALL" || tap.includes(centerId);
}

/** Cờ phân phối cho một tập cơ sở — mỗi cơ sở hỏi MỘT lần (số cơ sở nhỏ). */
async function coBatTheoCoSo(centerIds: readonly string[]): Promise<Set<string>> {
  const duy = [...new Set(centerIds)];
  const bat = await Promise.all(duy.map(async (c) => ((await laHubPhanPhoiBatChoCoSo(c)) ? c : null)));
  return new Set(bat.filter((c): c is string => c !== null));
}

type BanGhiHoaDon = {
  id: string;
  centerId: string;
  orgUnitId: string | null;
  orderId: string;
  trangThai: string;
  nguonPhatHanh: string;
  kyHieu: string | null;
  soHoaDon: string | null;
  ngayPhatHanh: Date | null;
  tongTien: number;
  tepPdfKey: string | null;
};

/** Chuyển bản ghi DB → đầu vào luật thuần. Khoá tệp bị bỏ ở đây: chỉ còn CÓ/KHÔNG. */
function tuBanGhi(r: BanGhiHoaDon): HoaDonPhanPhoiVao {
  return {
    id: r.id,
    trangThai: r.trangThai,
    nguonPhatHanh: r.nguonPhatHanh,
    kyHieu: r.kyHieu,
    soHoaDon: r.soHoaDon,
    ngayPhatHanh: r.ngayPhatHanh,
    tongTien: r.tongTien,
    coTepPdf: typeof r.tepPdfKey === "string" && r.tepPdfKey.length > 0,
  };
}

const CHON_HOA_DON = {
  id: true,
  centerId: true,
  orgUnitId: true,
  orderId: true,
  trangThai: true,
  nguonPhatHanh: true,
  kyHieu: true,
  soHoaDon: true,
  ngayPhatHanh: true,
  tongTien: true,
  tepPdfKey: true,
} as const;

// ── SALE: khối trong chi tiết đơn ──────────────────────────────────────────────────────────────────────────────────

export type KhoiPhanPhoiSale = { dong: DongHoaDonSale[] };

/**
 * Hoá đơn đã phát hành của MỘT đơn, cho Sale. `null` ⇒ KHÔNG vẽ khối (đơn ngoài tầm nhìn / cơ sở chưa bật cờ). Người gọi (trang chi tiết đơn) đã qua cổng `orders:view`.
 * `xemPii` = `orders:view-pii` trần; hàm tự thu hẹp theo cơ sở của TỪNG hoá đơn.
 */
export async function docHoaDonChoDon(actor: Actor, opts: { orderId: string; xemPii: boolean }): Promise<KhoiPhanPhoiSale | null> {
  const don = await scopedDb(actor).order.findUnique({
    where: { id: opts.orderId },
    select: {
      id: true,
      centerId: true,
      hoaDonDienTu: {
        where: { trangThai: { in: ["DA_XAC_NHAN", "THAY_THE"] } },
        orderBy: [{ ngayPhatHanh: "desc" }, { createdAt: "desc" }],
        select: CHON_HOA_DON,
      },
    },
  });
  if (!don || !don.centerId) return null;
  const bat = await coBatTheoCoSo([don.centerId, ...don.hoaDonDienTu.map((h) => h.centerId)]);
  if (!bat.has(don.centerId)) return null;
  const khoOk = khoHoaDonDaCauHinh();
  const dong: DongHoaDonSale[] = [];
  for (const h of don.hoaDonDienTu) {
    if (!bat.has(h.centerId)) continue;
    const [d] = hienThiChoSale([tuBanGhi(h)], { duocTaiPdf: opts.xemPii && coQuyenXemPiiTaiCoSo(actor, h.centerId), khoOk });
    if (d) dong.push(d);
  }
  return { dong };
}

// ── PHỤ HUYNH: khối dưới học phí của con ──────────────────────────────────────────────────────────────────────────

export type KhoiPhanPhoiPhuHuynh = {
  /** Cơ sở của con đã bật phân phối — để khối nói "chưa có hoá đơn" thay vì biến mất. */
  bat: boolean;
  dong: DongHoaDonPhuHuynh[];
};

function lienKetCon(ids: readonly string[]) {
  return [
    { order: { studentId: { in: [...ids] } } },
    { order: { items: { some: { studentId: { in: [...ids] } } } } },
    { khoan: { some: { hieuLuc: true, payment: { enrollment: { studentId: { in: [...ids] } } } } } },
    { khoan: { some: { hieuLuc: true, payment: { orderItem: { studentId: { in: [...ids] } } } } } },
  ];
}

/** Hoá đơn ĐÃ PHÁT HÀNH, tải được, của phụ huynh — đã kiểm sở hữu. Dùng chung cho danh sách và route tải. */
async function layHoaDonCuaPhuHuynh(
  owner: PortalOwner,
  opts: { hoaDonId: string | null; conDangChon: string | null },
): Promise<BanGhiHoaDon[]> {
  const pdb = portalDb(owner);
  // Con LẤY LẠI từ DB (portalDb AND parentUserId) — không tin `owner.childIds`.
  const con = await pdb.student.findMany({ where: { id: { in: owner.childIds }, deletedAt: null }, select: { id: true } });
  const conCua = con.map((c) => c.id);
  if (conCua.length === 0) return [];
  if (opts.conDangChon !== null && !conCua.includes(opts.conDangChon)) return [];

  const rows = await pdb.hoaDonDienTu.findMany({
    where: {
      ...(opts.hoaDonId !== null ? { id: opts.hoaDonId } : {}),
      trangThai: "DA_XAC_NHAN",
      nguonPhatHanh: { not: "MISA_GIA_LAP" },
      tepPdfKey: { not: null },
      order: { deletedAt: null },
      OR: lienKetCon(opts.conDangChon !== null ? [opts.conDangChon] : conCua),
    },
    orderBy: [{ ngayPhatHanh: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      ...CHON_HOA_DON,
      order: { select: { studentId: true, items: { select: { studentId: true } } } },
      khoan: {
        where: { hieuLuc: true },
        select: { payment: { select: { enrollment: { select: { studentId: true } }, orderItem: { select: { studentId: true } } } } },
      },
    },
  });

  return rows
    .filter((r) =>
      hoaDonThuocPhuHuynh({
        conTheoKhoan: r.khoan.flatMap((k) => [k.payment.enrollment?.studentId, k.payment.orderItem?.studentId]),
        conTheoDon: [r.order.studentId, ...r.order.items.map((i) => i.studentId)],
        conCuaPhuHuynh: conCua,
        conDangChon: opts.conDangChon,
      }),
    )
    .map((r) => ({
      id: r.id,
      centerId: r.centerId,
      orgUnitId: r.orgUnitId,
      orderId: r.orderId,
      trangThai: r.trangThai,
      nguonPhatHanh: r.nguonPhatHanh,
      kyHieu: r.kyHieu,
      soHoaDon: r.soHoaDon,
      ngayPhatHanh: r.ngayPhatHanh,
      tongTien: r.tongTien,
      tepPdfKey: r.tepPdfKey,
    }));
}

/**
 * Hoá đơn của CON ĐANG XEM, cho phụ huynh. `centerIdCuaCon` chỉ để quyết khối có hiện lời "chưa có hoá đơn" hay không (khối tắt hẳn khi cơ sở chưa bật cờ).
 * `studentId` đến từ server (con đang chọn trong phiên), không bao giờ từ URL.
 */
export async function docHoaDonChoPhuHuynh(owner: PortalOwner, studentId: string, centerIdCuaCon: string | null): Promise<KhoiPhanPhoiPhuHuynh> {
  const [rows, batCon] = await Promise.all([
    layHoaDonCuaPhuHuynh(owner, { hoaDonId: null, conDangChon: studentId }),
    centerIdCuaCon ? laHubPhanPhoiBatChoCoSo(centerIdCuaCon) : Promise.resolve(false),
  ]);
  const bat = await coBatTheoCoSo(rows.map((r) => r.centerId));
  const dong = hienThiChoPhuHuynh(
    rows.filter((r) => bat.has(r.centerId)).map(tuBanGhi),
    { khoOk: khoHoaDonDaCauHinh() },
  );
  return { bat: batCon, dong };
}

// ── TẢI PDF (Sale + phụ huynh) ─────────────────────────────────────────────────────────────────────────────────────

export type NguoiTai =
  | { loai: "NHAN_VIEN"; actor: Actor; xemPii: boolean }
  | { loai: "PHU_HUYNH"; owner: PortalOwner };

export type KetQuaMoTep =
  | { ok: true; than: Uint8Array; tenTep: string }
  | { ok: false; ma: "KHONG_TIM_THAY" | "KHO_CHUA_CAU_HINH" | "KHO_LOI" | "AUDIT_LOI" };

const KHONG_TIM_THAY: KetQuaMoTep = { ok: false, ma: "KHONG_TIM_THAY" };

/** Tìm bản ghi hoá đơn mà NGƯỜI NÀY được tải (sở hữu / phạm vi / quyền). `null` ⇒ không phân biệt "không có" với "không phải của bạn". */
async function timHoaDonChoNguoiTai(nguoi: NguoiTai, hoaDonId: string): Promise<BanGhiHoaDon | null> {
  if (nguoi.loai === "PHU_HUYNH") {
    const [r] = await layHoaDonCuaPhuHuynh(nguoi.owner, { hoaDonId, conDangChon: null });
    return r ?? null;
  }
  if (!nguoi.xemPii) return null;
  const don = await scopedDb(nguoi.actor).order.findFirst({
    where: { hoaDonDienTu: { some: { id: hoaDonId } } },
    select: { hoaDonDienTu: { where: { id: hoaDonId }, select: CHON_HOA_DON } },
  });
  const hd = don?.hoaDonDienTu[0];
  if (!hd || !coQuyenXemPiiTaiCoSo(nguoi.actor, hd.centerId)) return null;
  return hd;
}

/**
 * Mở PDF của MỘT hoá đơn cho người xem. Thứ tự cổng (đừng đảo): sở hữu → trạng thái → cờ theo cơ sở → kho cấu hình → AUDIT → đọc byte.
 * Audit chỉ ghi: ai, hoá đơn, loại tệp, kênh (SALE | PHU_HUYNH), trạng thái, orderId — không khoá kho, không URL, không tên học viên.
 */
export async function moTepChoNguoiXem(input: {
  hoaDonId: string;
  nguoi: NguoiTai;
  nguoiDung: { id: string; ten: string };
}): Promise<KetQuaMoTep> {
  const hd = await timHoaDonChoNguoiTai(input.nguoi, input.hoaDonId);
  if (!hd) return KHONG_TIM_THAY;
  if (!choPhepTaiPdf(tuBanGhi(hd))) return KHONG_TIM_THAY;
  if (!(await laHubPhanPhoiBatChoCoSo(hd.centerId))) return KHONG_TIM_THAY;
  if (!khoHoaDonDaCauHinh()) return { ok: false, ma: "KHO_CHUA_CAU_HINH" };

  try {
    await writeAudit({
      actor: { id: input.nguoiDung.id, name: input.nguoiDung.ten },
      module: "finance",
      entityType: "HoaDonDienTu",
      entityId: hd.id,
      action: "TAI_TEP_HOA_DON",
      newValues: { loai: "pdf", kenh: input.nguoi.loai === "PHU_HUYNH" ? "PHU_HUYNH" : "SALE", trangThai: hd.trangThai, orderId: hd.orderId },
      orgUnitId: hd.orgUnitId,
    });
  } catch {
    return { ok: false, ma: "AUDIT_LOI" };
  }

  const than = hd.tepPdfKey ? await docPdfHoaDon(hd.tepPdfKey) : null;
  if (!than) return { ok: false, ma: "KHO_LOI" };
  return { ok: true, than, tenTep: tenTepAnToan(hd.kyHieu, hd.soHoaDon) };
}
