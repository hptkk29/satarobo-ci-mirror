import "server-only";
/**
 * «Tủ sách gia đình» ở CỔNG PHỤ HUYNH (08/11/2026) — phần máy chủ.
 *
 * Phụ huynh đã đăng nhập ⇒ KHÔNG hỏi lại họ tên / SĐT (đã có trên tài khoản). Chỉ cần biết nhà ở phường/xã nào để xếp về cơ sở gần nhất:
 * hồ sơ (Lead cùng SĐT) đã có phường/xã thì tải thẳng; chưa có thì hỏi MỘT lần rồi lưu vào đúng Lead đó (dữ liệu trước 05/11/2026 thường thiếu).
 *
 * Việc lưu phường/xã đi qua `taoLeadTuCong` — CÙNG đường với hộp «để lại thông tin» công khai (chống trùng SĐT, chỉ bổ sung địa chỉ còn trống, quy nguồn, chia theo phường).
 */
import { db } from "@/lib/db";
import { phoneVariants, canonicalPhone } from "@/lib/phone";
import { kiemTraPhieu } from "@/lib/cong-thong-tin/phieu";
import { boSungDiaChiLead, taoLeadTuCong } from "@/lib/cong-thong-tin/tao-lead";
import { maLoiAnToan } from "@/lib/disc/crm";
import { danhSachPhuongCuaTinh, idTinhTheoTen, TP_MAC_DINH } from "@/lib/lead/phuong-xa";

export type LopCuaCon = { ten: string; lop: number };

export type NguCanhTuSach = {
  hoTen: string;
  /** SĐT chuẩn hoá `84…`, hoặc null nếu tài khoản chưa có SĐT dùng được. */
  soDienThoai: string | null;
  /** Đã có phường/xã trên một Lead cùng SĐT ⇒ được tải. */
  coPhuong: boolean;
  /** Lớp (1–12) của các con có khai lớp — để mở nhanh đúng lớp trong ngăn sách giáo khoa. */
  lopCuaCon: LopCuaCon[];
  tinh: string;
  phuongDs: string[];
};

async function phuHuynhCoPhuong(soDienThoai: string | null): Promise<boolean> {
  if (!soDienThoai) return false;
  const bien = phoneVariants(soDienThoai);
  if (bien.length === 0) return false;
  const co = await db.lead.findFirst({
    where: { phone: { in: bien }, deletedAt: null, ward: { not: null }, NOT: { ward: "" } },
    select: { id: true },
  });
  return co !== null;
}

/** Chỉ hỏi «đã đủ điều kiện tải chưa» — dùng cho route tải (không cần danh sách phường). */
export async function phuHuynhDuocTai(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { phone: true } });
  return phuHuynhCoPhuong(u?.phone ? (canonicalPhone(u.phone) ?? null) : null);
}

export async function docNguCanhTuSach(userId: string): Promise<NguCanhTuSach> {
  const [u, cons] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { name: true, phone: true } }),
    db.student.findMany({ where: { parentUserId: userId, deletedAt: null }, select: { name: true, currentGrade: true }, orderBy: { createdAt: "asc" }, take: 8 }),
  ]);
  const sdt = u?.phone ? (canonicalPhone(u.phone) ?? null) : null;
  const tinhId = idTinhTheoTen(TP_MAC_DINH);
  return {
    hoTen: (u?.name ?? "").trim(),
    soDienThoai: sdt,
    coPhuong: await phuHuynhCoPhuong(sdt),
    lopCuaCon: cons.flatMap((c) => (c.currentGrade !== null && c.currentGrade >= 1 && c.currentGrade <= 12 ? [{ ten: c.name, lop: c.currentGrade }] : [])),
    tinh: TP_MAC_DINH,
    phuongDs: tinhId ? danhSachPhuongCuaTinh(tinhId) : [],
  };
}

export type KetQuaLuuPhuong = { ok: true } | { ok: false; ma: "THIEU_THONG_TIN_TAI_KHOAN" | "PHUONG_KHONG_HOP_LE" | "LOI_HE_THONG" };

/** Lưu phường/xã của phụ huynh (một lần). Tên + SĐT lấy từ TÀI KHOẢN, không nhận từ trình duyệt. */
export async function luuPhuongPhuHuynh(userId: string, phuong: string): Promise<KetQuaLuuPhuong> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { name: true, phone: true } });
  const sdt = u?.phone ? canonicalPhone(u.phone) : null;
  const ten = (u?.name ?? "").trim();
  if (!sdt || ten.length < 2) return { ok: false, ma: "THIEU_THONG_TIN_TAI_KHOAN" };

  const kq = kiemTraPhieu({
    hoTen: ten,
    soDienThoai: sdt,
    thanhPho: TP_MAC_DINH,
    phuong,
    soNha: null,
    // Phụ huynh đã là khách của Sata Robo; câu cảm ơn trên màn nói rõ phường/xã dùng để xếp về cơ sở gần nhà. Không tích «nhận tin» thay họ.
    dongY: { xuLyHoSo: true, tiepThi: false },
    nguon: "tu-sach",
    nguCanh: "cong-phu-huynh",
    bay: "",
  });
  if (!kq.ok) return { ok: false, ma: "PHUONG_KHONG_HOP_LE" };
  try {
    // Đã có phiếu lead cùng SĐT (kể cả đã chốt/đóng) ⇒ CHỈ điền phường/xã còn trống vào đúng phiếu đó — không tạo lead thứ hai cho một khách đã có.
    // Chưa có phiếu nào (tài khoản tạo tay) ⇒ đi đường chung của cổng để lại thông tin (tạo lead + chia theo phường).
    const bien = phoneVariants(sdt);
    const lead = await db.lead.findFirst({ where: { phone: { in: bien }, deletedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (lead) await boSungDiaChiLead(lead.id, kq.phieu.diaChi, kq.phieu.nguon, new Date());
    else await taoLeadTuCong(kq.phieu);
    return { ok: true };
  } catch (err) {
    console.error("[portal-tu-sach] luu-phuong:", maLoiAnToan(err));
    return { ok: false, ma: "LOI_HE_THONG" };
  }
}
