/**
 * lib/nguon/ma-nhan-vien.ts — giải MÃ NHÂN VIÊN trong `Lead.note` THEO NGÀY (D12). THUẦN.
 *
 * Đặc tả: `docs/source-commission/07 §2.6.3`.
 *
 * Vì sao theo NGÀY: mã nhân viên bị đổi (đợt 04/09/2026 hoán vị SR.NV.002 ↔ 004), mà `Lead.note` chỉ
 * giữ ẢNH CHỤP chuỗi mã lúc nhập phiếu. Hỏi "mã đó là ai" bằng bảng HÔM NAY là gán nhầm người; lịch
 * sử đổi mã (AuditLog) là nguồn DUY NHẤT còn giữ ánh xạ theo thời gian.
 */
import { NHAN_MA_NGUOI_NHAP } from "@/lib/lead/note-view";

const thoatRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Dòng bắt đầu bằng nhãn "Nhân viên nhập:" (sau trim) ⇒ token kế tiếp TRÊN CÙNG DÒNG, và token đó phải có
 * DẠNG MÃ NHÂN VIÊN. Không có ⇒ null.
 *
 * [F2] Hai lỗi của bản cũ `^\s*Nhân viên nhập:\s*(\S+)`:
 *  · `\s*` ăn cả xuống dòng ⇒ nhãn không kèm mã ("Nhân viên nhập:\n<dòng kế>") lấy token đầu của DÒNG KẾ;
 *  · `map-internal-form.ts` ghi "Nhân viên nhập: <tên hiển thị> (chưa gắn mã nhân viên)" khi tài khoản chưa có
 *    mã ⇒ bóc ra HỌ của người nhập làm "mã" ("Nguyễn"), rồi `MA_NV_KHONG_GIAI` báo "mã Nguyễn không có trong hệ thống".
 *
 * Dạng mã: các đoạn chữ-số (`_`/`-` được) nối bằng dấu chấm (`SR.NV.002`, `nv.sr.002`, `CS2.TVV.007`) VÀ có
 * ít nhất một chữ số — tên người không có chữ số. Token phải kết thúc ở khoảng trắng/hết dòng nên "Nguyễn"
 * (chữ có dấu) không bị cắt thành "Nguy". Khoảng trắng sau nhãn chỉ là space/tab (`[ \t]*`), không xuống dòng.
 */
const DANG_MA = "(?=[^\\s]*\\d)([A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*)(?=\\s|$)";

export function bocMaNhanVienTuNote(note: string | null): string | null {
  if (!note) return null;
  const re = new RegExp(`^[ \\t]*${thoatRegex(NHAN_MA_NGUOI_NHAP)}[ \\t]*${DANG_MA}`, "m");
  return re.exec(note)?.[1] ?? null;
}

/**
 * trim + toUpperCase(); dạng "NV.<ĐOẠN>.<SỐ>" ⇒ "<ĐOẠN>.NV.<SỐ>" (bắt buộc — bỏ là mất 21 phiếu,
 * 06/10 §8.2: biểu mẫu cũ ghi `nv.sr.002`, bảng nhân sự lưu `SR.NV.002`).
 */
export function chuanHoaMaNhanVien(raw: string): string {
  const m = raw.trim().toUpperCase();
  const dao = /^NV\.([A-Z0-9]+)\.(\d+)$/.exec(m);
  return dao ? `${dao[1]}.NV.${dao[2]}` : m;
}

export type DoiMa = { employeeId: string; maCu: string | null; maMoi: string; luc: Date };

/**
 * Ai giữ mã `ma` (đã chuẩn hoá) TẠI THỜI ĐIỂM `ngay`.
 *
 * Dựng bảng lúc `ngay` bằng cách đi NGƯỢC thời gian từ bảng hôm nay:
 *   bang = copy(maHienTai)                       // code → employeeId
 *   for d of lichSuDoiMa.filter(d => d.luc > ngay).sort(luc GIẢM DẦN):
 *     if (bang.get(d.maMoi) === d.employeeId) bang.delete(d.maMoi)
 *     if (d.maCu !== null) bang.set(d.maCu, d.employeeId)
 *   return bang.get(ma) ?? null
 *
 * Đi ngược theo thứ tự GIẢM DẦN là BẮT BUỘC khi CÙNG MỘT NGƯỜI đổi mã ≥ 2 lần trong khoảng cần lùi
 * (vd E1 010→011 rồi 011→012, xen giữa E2 013→011): tăng dần thì tra 011 trước đợt đổi ra E1 thay vì null.
 * [PB-11] Với cặp hoán vị đơn của 04/09 hai thứ tự ra CÙNG kết quả — cặp đó không chứng minh được
 * luật thứ tự; ca [NHH-SRC-13] (b) có fixture riêng cho nó.
 *
 * `maHienTai` dựng với khoá `chuanHoaMaNhanVien(employeeCode)`; `DoiMa.maCu/maMoi` cũng phải đã chuẩn hoá
 * (tầng DB làm). Hàm KHÔNG đổi đầu vào.
 */
export function giaiMaNhanVienTheoNgay(
  ma: string,
  ngay: Date,
  lichSuDoiMa: readonly DoiMa[],
  maHienTai: ReadonlyMap<string, string>,
): string | null {
  const bang = new Map(maHienTai);
  const sau = lichSuDoiMa.filter((d) => d.luc.getTime() > ngay.getTime()).sort((a, b) => b.luc.getTime() - a.luc.getTime());
  for (const d of sau) {
    if (bang.get(d.maMoi) === d.employeeId) bang.delete(d.maMoi);
    if (d.maCu !== null) bang.set(d.maCu, d.employeeId);
  }
  return bang.get(ma) ?? null;
}
