/**
 * V8.40 — TRẠNG THÁI HOÀN TIỀN HIỂN THỊ CHO PHỤ HUYNH (PAY-06). THUẦN. Enum ĐÓNG — app dùng zod lenient (giá trị lạ ⇒ không hiện nhãn hoàn).
 *   cấp DÒNG: KHONG | DANG_XET | DA_DUYET | DA_HOAN | TU_CHOI
 *   cấp ĐƠN : thêm MOT_PHAN
 * Ưu tiên cấp dòng: có yêu cầu MỞ (PENDING ⇒ DANG_XET, APPROVED ⇒ DA_DUYET) > đã hoàn (soTienDaHoan > 0 ⇒ DA_HOAN, kể cả một phần) > yêu cầu gần nhất bị TỪ CHỐI (không tính «phụ huynh rút») > KHONG.
 * Gộp cấp đơn: có dòng DANG_XET ⇒ DANG_XET; có DA_DUYET ⇒ DA_DUYET; mọi dòng CÓ TIỀN đều hoàn HẾT ⇒ DA_HOAN; có dòng đã hoàn (kể cả một phần) ⇒ MOT_PHAN; có dòng TU_CHOI ⇒ TU_CHOI; còn lại KHONG.
 * BẢO ĐẢM cho app: `daHoan > 0` ⇔ `soDongDaHoan > 0` (không dựa vào trạng thái cấp đơn — DANG_XET/DA_DUYET có thể che DA_HOAN).
 */
export type TrangThaiHoanDong = "KHONG" | "DANG_XET" | "DA_DUYET" | "DA_HOAN" | "TU_CHOI";
export type TrangThaiHoanDon = TrangThaiHoanDong | "MOT_PHAN";

export const LY_DO_RUT_YEU_CAU = "Phụ huynh đã rút yêu cầu";

export type YeuCauThoDong = { status: string; lyDoTuChoi: string | null; createdAt: Date; approvedAmount: number | null; quyenDaThuHoiLuc: Date | null };

export function trangThaiHoanCuaDong(input: { yeuCau: readonly YeuCauThoDong[]; thucTra: number }): { trangThai: TrangThaiHoanDong; soTienDaHoan: number; hoanHet: boolean; quyenDaThuHoi: boolean } {
  const soTienDaHoan = input.yeuCau.filter((y) => y.status === "PAID").reduce((s, y) => s + (y.approvedAmount ?? 0), 0);
  const hoanHet = input.thucTra > 0 && soTienDaHoan >= input.thucTra;
  const quyenDaThuHoi = input.yeuCau.some((y) => y.status === "PAID" && y.quyenDaThuHoiLuc !== null);
  const gan = [...input.yeuCau].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  let trangThai: TrangThaiHoanDong = "KHONG";
  if (gan.some((y) => y.status === "PENDING")) trangThai = "DANG_XET";
  else if (gan.some((y) => y.status === "APPROVED")) trangThai = "DA_DUYET";
  else if (soTienDaHoan > 0) trangThai = "DA_HOAN";
  else if (gan[0] && gan[0].status === "REJECTED" && gan[0].lyDoTuChoi !== LY_DO_RUT_YEU_CAU) trangThai = "TU_CHOI";
  return { trangThai, soTienDaHoan, hoanHet, quyenDaThuHoi };
}

export function gopTrangThaiHoanDon(dong: readonly { trangThai: TrangThaiHoanDong; soTienDaHoan: number; hoanHet: boolean; coTien: boolean }[]): TrangThaiHoanDon {
  if (dong.some((d) => d.trangThai === "DANG_XET")) return "DANG_XET";
  if (dong.some((d) => d.trangThai === "DA_DUYET")) return "DA_DUYET";
  const coTien = dong.filter((d) => d.coTien);
  if (coTien.length > 0 && coTien.every((d) => d.hoanHet)) return "DA_HOAN";
  if (dong.some((d) => d.soTienDaHoan > 0)) return "MOT_PHAN";
  if (dong.some((d) => d.trangThai === "TU_CHOI")) return "TU_CHOI";
  return "KHONG";
}
