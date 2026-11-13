import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { docPhapNhanKyUsb } from "../ket-noi/ket-noi-db";
import { phamViKeToan } from "../quyen";
import { phieuTuJson } from "../phieu-phat-hanh";

// lib/finance/hoa-don/ky-usb/hang-cho-ky-usb.ts — DANH SÁCH hoá đơn của pháp nhân KÝ USB đang chờ ký, kèm lệnh ký mới nhất, cho khu «Ký USB token» (hub/13).
// Đọc qua `scopedDb` (tầm nhìn cơ sở) ∧ giới hạn thêm theo phạm vi KẾ TOÁN của người xem: người kiêm sale CS2 thấy đơn CS2 nhưng không làm hoá đơn ở đó.

export type TrangThaiLenhHienThi = "CHUA_CO_LENH" | "CHO_KY" | "DANG_KY" | "LOI_KY" | "HET_HAN" | "HUY" | "DA_KY";

export type DongChoKyUsb = {
  hoaDonId: string;
  phapNhanTen: string;
  nguoiMua: string;
  soTien: number;
  /** Bản đã từng GỬI nhà cung cấp (đã lưu nháp / đã gửi XML) mà chưa có số ⇒ nên «Kiểm tra lại». */
  daGui: boolean;
  thongDiep: string | null;
  lenh: { id: string; trangThai: TrangThaiLenhHienThi; nguoiYeuCauId: string; nguoiKyId: string | null; hetHan: string | null; lyDo: string | null } | null;
};

const TRAN = 100;

/** Tên người mua rút từ phiếu đã lưu; phiếu hỏng ⇒ rỗng (màn hiện «—»), không ném. */
function tenNguoiMua(misaPhieu: unknown): string {
  try {
    const p = phieuTuJson(misaPhieu);
    return (p.nguoiMua.donVi?.trim() || p.nguoiMua.hoTen?.trim() || "").slice(0, 120);
  } catch {
    return "";
  }
}

export async function docHangChoKyUsb(actor: Actor): Promise<DongChoKyUsb[]> {
  const pham = phamViKeToan(actor);
  if (pham !== "ALL" && pham.length === 0) return [];
  const usb = await docPhapNhanKyUsb();
  if (usb.size === 0) return [];
  const ds = await scopedDb(actor).hoaDonDienTu.findMany({
    where: {
      trangThai: "DANG_PHAT_HANH",
      soHoaDon: null,
      nhaCungCapMa: "VIN_HOADON",
      phapNhanMa: { in: [...usb] },
      ...(pham === "ALL" ? {} : { centerId: { in: pham } }),
    },
    orderBy: { createdAt: "asc" },
    take: TRAN,
    select: { id: true, phapNhanTen: true, tongTien: true, misaPhieu: true, misaGuiLuc: true, misaLoiThongDiep: true },
  });
  if (ds.length === 0) return [];
  const lenh = await db.hoaDonLenhKy.findMany({
    where: { hoaDonId: { in: ds.map((d) => d.id) }, phuongThuc: "USB_TOKEN" },
    orderBy: { createdAt: "desc" },
    select: { id: true, hoaDonId: true, trangThai: true, nguoiYeuCauId: true, nguoiKyId: true, hetHanLuc: true, lyDo: true },
  });
  const moiNhat = new Map<string, (typeof lenh)[number]>();
  for (const l of lenh) if (!moiNhat.has(l.hoaDonId)) moiNhat.set(l.hoaDonId, l);
  return ds.map((d) => {
    const nguoiMua = tenNguoiMua(d.misaPhieu);
    const l = moiNhat.get(d.id);
    return {
      hoaDonId: d.id,
      phapNhanTen: d.phapNhanTen ?? "",
      nguoiMua,
      soTien: d.tongTien,
      daGui: d.misaGuiLuc !== null,
      thongDiep: d.misaLoiThongDiep,
      lenh: l ? { id: l.id, trangThai: l.trangThai as TrangThaiLenhHienThi, nguoiYeuCauId: l.nguoiYeuCauId, nguoiKyId: l.nguoiKyId, hetHan: l.hetHanLuc?.toISOString() ?? null, lyDo: l.lyDo } : null,
    };
  });
}
