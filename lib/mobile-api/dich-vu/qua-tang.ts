import { db } from "@/lib/db";
import { isDiscEnabled, isSucKhoeEnabled, isThuNhapThemEnabled, isTuSachEnabled } from "@/lib/flags";
import { docKhuyenMaiChoPhuHuynh } from "@/lib/portal/khuyen-mai-ph";
import { quaTangDangMo } from "@/lib/portal/qua-tang";

/**
 * P-Qua-tang (hộp «Quà tặng» của cổng phụ huynh, 12/11/2026) — CHỈ ĐỌC, cấp PHỤ HUYNH (không theo học viên ⇒ dùng được khi tài khoản CHƯA có bé: đây là lối vào DISC/Sức khoẻ/Tủ sách cho phụ huynh chưa có học viên).
 * Danh mục và thứ tự lấy NGUYÊN từ `lib/portal/qua-tang.ts` (nguồn của web) — không có danh sách thứ hai; mỗi quà theo CỜ riêng, tắt ⇒ không hiện. Hộp quà tắt hẳn ⇒ `qua:[]` (200, để app tự ẩn ô — khác web trả 404 vì web là một trang).
 * `soKhuyenMai`: số chương trình khuyến mãi đang hiệu lực cho cơ sở của em ĐẦU TIÊN còn hoạt động của phụ huynh (chưa có em ⇒ chỉ chương trình áp cho mọi cơ sở). KHÔNG mở lại catalog/giỏ/thanh toán (Q2=C): chỉ là số đếm.
 * Không trả tên người, SĐT hay dữ liệu DISC/sức khoẻ/sách — chỉ metadata của quà. Mã `manHinh` là mã màn của app (không phải đường dẫn web).
 */
export type QuaTangMobileDto = {
  qua: Array<{ ma: "disc" | "suc-khoe" | "tu-sach"; ten: string; phu: string; mo: string; manHinh: "P-Disc" | "P-Suc-khoe" | "P-Tu-sach" }>;
  soKhuyenMai: number;
  coThuNhap: boolean;
};

const MAN_HINH = { disc: "P-Disc", "suc-khoe": "P-Suc-khoe", "tu-sach": "P-Tu-sach" } as const;

/** Đếm khuyến mãi theo cơ sở của em đầu tiên; mọi lỗi ⇒ 0 (thiếu số đếm không được làm hỏng hộp quà). */
async function dem(parentUserId: string, now: Date): Promise<number> {
  try {
    const be = await db.student.findFirst({ where: { parentUserId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { centerId: true } });
    const co = be?.centerId ? await db.center.findUnique({ where: { id: be.centerId }, select: { code: true } }) : null;
    return (await docKhuyenMaiChoPhuHuynh(co?.code ?? null, now)).length;
  } catch {
    return 0;
  }
}

export async function docQuaTang(parentUserId: string, now: Date = new Date()): Promise<QuaTangMobileDto> {
  const qua = quaTangDangMo({ disc: isDiscEnabled(), sucKhoe: isSucKhoeEnabled(), tuSach: isTuSachEnabled() }).map((q) => ({ ma: q.ma, ten: q.ten, phu: q.phu, mo: q.mo, manHinh: MAN_HINH[q.ma] }));
  const soKhuyenMai = await dem(parentUserId, now);
  return { qua, soKhuyenMai, coThuNhap: isThuNhapThemEnabled() };
}
