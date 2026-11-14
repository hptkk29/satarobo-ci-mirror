import "server-only";
import { coSoNguoiMuaDuoc, docCauHinhNguoiMua, laHubNguoiMuaBat } from "./feature";
import { quetHetHan, type KetQuaQuet } from "./yeu-cau-nguoi-mua-db";

// lib/finance/hoa-don/yeu-cau-nguoi-mua-quet.ts — pha P3 của cron `hoa-don-misa-doi-soat` (TD-04: mở rộng cron có sẵn, KHÔNG cron mới): dọn yêu cầu thông tin người mua.
//
//  · Cờ `hoaDon.hubNguoiMua` (+ công tắc tổng) TẮT ⇒ `null`, không đọc cấu hình, không chạm bảng nào ⇒ phản hồi cron giữ nguyên từng chữ.
//  · Chỉ quét CƠ SỞ THÍ ĐIỂM (`coSoNguoiMuaDuoc`); danh sách rỗng ⇒ `null`. Phạm vi truyền cho dịch vụ luôn là MẢNG cơ sở, không bao giờ «TAT_CA».
//  · Thời hạn giữ dữ liệu / chờ xử lý đến từ CẤU HÌNH (chưa được kế toán / pháp chế duyệt — OD-11), không từ hằng ẩn.
//  · KHÔNG BAO GIỜ ném (cron chạy cùng pha P1/P2): lỗi trả nhãn ngắn, không kèm câu lỗi gốc.

const nhan = (e: unknown): string => {
  const ma = (e as { code?: unknown } | null)?.code;
  if (typeof ma === "string" && /^[A-Z0-9_]{2,12}$/.test(ma)) return ma;
  return e instanceof Error && /^[A-Za-z]{2,40}$/.test(e.name) ? e.name : "LOI";
};

/** Số yêu cầu mỗi lượt cron (mỗi yêu cầu một giao dịch ngắn). */
const LO_MOI_LUOT = 100;

export type KetQuaDonDep = KetQuaQuet & { loi?: string };

export async function chayDonDepNguoiMua(input: { now: Date }): Promise<KetQuaDonDep | null> {
  const rong = { hetHan: 0, daXoaDuLieu: 0, choXuLyQuaHan: 0 };
  let coSo: string[];
  let cfg: Awaited<ReturnType<typeof docCauHinhNguoiMua>>;
  try {
    if (!(await laHubNguoiMuaBat())) return null;
    coSo = await coSoNguoiMuaDuoc();
    if (coSo.length === 0) return null;
    cfg = await docCauHinhNguoiMua();
  } catch (e) {
    return { ...rong, loi: `CO:${nhan(e)}` };
  }
  try {
    return await quetHetHan({ now: input.now, giuDuLieuNgay: cfg.giuDuLieuNgay, choXuLyToiDaNgay: cfg.choXuLyToiDaNgay, phamVi: coSo, lo: LO_MOI_LUOT });
  } catch (e) {
    return { ...rong, loi: `QUET:${nhan(e)}` };
  }
}
