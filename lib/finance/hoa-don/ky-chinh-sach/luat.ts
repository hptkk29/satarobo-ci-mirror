// lib/finance/hoa-don/ky-chinh-sach/luat.ts — LUẬT THUẦN của chính sách ký theo PHÁP NHÂN: tạm dừng khẩn cấp + hạn mức ký tự động (BGĐ 04/11/2026). Không DB.
//
// Ba luật, mỗi luật MỘT chỗ:
//   1. `kiemChinhSach`  — đầu vào khi lưu (số nguyên dương, cửa sổ đi đôi với số tối đa, lý do ≥ 10 ký tự).
//   2. `kiemBatLai`     — bật lại ký sau tạm dừng. Tạm dừng vì SỰ CỐ BẢO MẬT cần xác nhận riêng, ngoài lý do.
//   3. `kiemHanMuc`     — hoá đơn này có được KÝ TỰ ĐỘNG không. FAIL-CLOSED: chưa khai hạn mức ⇒ KHÔNG. Vượt ⇒ KHÔNG ký, KHÔNG mất dữ liệu: hoá đơn nằm lại hàng chờ xuất.
//
// ⚠️ Chưa có số tiền mặc định nào ở đây, và sẽ không có: hạn mức là con số của chủ dự án, đặt sau khi xem thống kê 60–90 ngày.

export const TOI_THIEU_LY_DO_KY = 10;
export const TOI_DA_LY_DO_KY = 500;
/** Trần số khai báo: cột là INTEGER (2^31−1). Nhỏ hơn một chút để phép cộng dồn trong ngày không tràn khi so sánh. */
export const TRAN_SO_HAN_MUC = 2_000_000_000;
export const TRAN_CUA_SO_PHUT = 1440;

export type HanMucKy = {
  /** VND, tối đa cho MỘT hoá đơn được ký tự động. */
  hanMucMoiHoaDon: number | null;
  /** VND, tổng hoá đơn ký tự động trong MỘT ngày (giờ Việt Nam). */
  hanMucMoiNgay: number | null;
  /** Số hoá đơn tối đa trong `cuaSoPhut` phút gần nhất. Đi đôi với `cuaSoPhut`. */
  soToiDa: number | null;
  cuaSoPhut: number | null;
  /** Số hoá đơn trong cửa sổ từ đó trở lên thì CẢNH BÁO (không chặn). `null` = không cảnh báo. */
  nguongTanSuat: number | null;
};

export const HAN_MUC_TRONG: HanMucKy = Object.freeze({ hanMucMoiHoaDon: null, hanMucMoiNgay: null, soToiDa: null, cuaSoPhut: null, nguongTanSuat: null });

const laSoNguyenDuong = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= TRAN_SO_HAN_MUC;

/** Trả mảng câu tiếng Việt; rỗng = hợp lệ. Đường ghi PHẢI gọi hàm này. */
export function kiemChinhSach(d: HanMucKy & { lyDo: string | null }): string[] {
  const loi: string[] = [];
  const ly = (d.lyDo ?? "").trim();
  if (ly.length < TOI_THIEU_LY_DO_KY) loi.push(`Lý do thay đổi phải có ít nhất ${TOI_THIEU_LY_DO_KY} ký tự.`);
  if (ly.length > TOI_DA_LY_DO_KY) loi.push(`Lý do dài tối đa ${TOI_DA_LY_DO_KY} ký tự.`);
  const ten: [keyof HanMucKy, string][] = [
    ["hanMucMoiHoaDon", "Hạn mức mỗi hoá đơn"],
    ["hanMucMoiNgay", "Hạn mức mỗi ngày"],
    ["soToiDa", "Số hoá đơn tối đa"],
    ["nguongTanSuat", "Ngưỡng cảnh báo tần suất"],
  ];
  for (const [k, nhan] of ten) {
    const v = d[k];
    if (v !== null && !laSoNguyenDuong(v)) loi.push(`${nhan} phải là số nguyên dương (tối đa ${TRAN_SO_HAN_MUC.toLocaleString("vi-VN")}), hoặc để trống.`);
  }
  if (d.cuaSoPhut !== null && (!Number.isInteger(d.cuaSoPhut) || d.cuaSoPhut < 1 || d.cuaSoPhut > TRAN_CUA_SO_PHUT)) {
    loi.push(`Cửa sổ thời gian phải từ 1 đến ${TRAN_CUA_SO_PHUT} phút, hoặc để trống.`);
  }
  if ((d.soToiDa === null) !== (d.cuaSoPhut === null)) loi.push("Số hoá đơn tối đa và cửa sổ thời gian phải khai cùng nhau (hoặc cùng để trống).");
  if (d.nguongTanSuat !== null && d.cuaSoPhut === null) loi.push("Ngưỡng cảnh báo tần suất cần cửa sổ thời gian.");
  if (d.hanMucMoiHoaDon !== null && d.hanMucMoiNgay !== null && d.hanMucMoiHoaDon > d.hanMucMoiNgay) {
    loi.push("Hạn mức mỗi hoá đơn không được lớn hơn hạn mức mỗi ngày.");
  }
  return loi;
}

// ─── Tạm dừng / bật lại ───────────────────────────────────────────────────────────────────────────────────────────────────

export type TrangThaiTamDung = { tamDung: boolean; tamDungSuCo: boolean };

export function kiemTamDung(lyDo: string | null): string[] {
  const ly = (lyDo ?? "").trim();
  if (ly.length < TOI_THIEU_LY_DO_KY) return [`Lý do tạm dừng phải có ít nhất ${TOI_THIEU_LY_DO_KY} ký tự.`];
  if (ly.length > TOI_DA_LY_DO_KY) return [`Lý do dài tối đa ${TOI_DA_LY_DO_KY} ký tự.`];
  return [];
}

/**
 * Bật lại ký. Chưa tạm dừng ⇒ từ chối (không ghi nhật ký giả). Tạm dừng vì sự cố bảo mật ⇒ phải có `xacNhanSuCo === true` (so nghiêm):
 * người bật lại tự nói «tôi đã kiểm chứng thư/tài khoản/nguồn rò» — một ô tick riêng, không gộp vào lý do.
 */
export function kiemBatLai(i: { hienTai: TrangThaiTamDung | null; xacNhanSuCo: unknown; lyDo: string | null }): string[] {
  if (!i.hienTai?.tamDung) return ["Pháp nhân này không đang tạm dừng ký."];
  const loi: string[] = [];
  const ly = (i.lyDo ?? "").trim();
  if (ly.length < TOI_THIEU_LY_DO_KY) loi.push(`Lý do bật lại phải có ít nhất ${TOI_THIEU_LY_DO_KY} ký tự.`);
  if (ly.length > TOI_DA_LY_DO_KY) loi.push(`Lý do dài tối đa ${TOI_DA_LY_DO_KY} ký tự.`);
  if (i.hienTai.tamDungSuCo && i.xacNhanSuCo !== true) {
    loi.push("Pháp nhân này được tạm dừng vì sự cố bảo mật — cần xác nhận riêng rằng sự cố đã được kiểm tra và xử lý trước khi bật lại.");
  }
  return loi;
}

// ─── Hạn mức ký tự động ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Đã dùng bao nhiêu: tổng VND của hoá đơn tự động trong NGÀY (VN) và số hoá đơn trong CỬA SỔ — người gọi đếm từ sổ, không từ client. */
export type SuDungHanMuc = { tongNgay: number; soTrongCuaSo: number };

export type MaVuotHanMuc = "CHUA_KHAI_HAN_MUC" | "VUOT_MOI_HOA_DON" | "VUOT_NGAY" | "VUOT_SO_LUONG";
export type KetQuaHanMuc = { ok: true; canhBao: string | null } | { ok: false; ma: MaVuotHanMuc; lyDo: string };

const vnd = (n: number) => `${n.toLocaleString("vi-VN")}đ`;

/**
 * Hoá đơn có `soTien` này có được KÝ TỰ ĐỘNG không, biết `suDung` hiện tại.
 * Thiếu BẤT KỲ hạn mức bắt buộc nào (mỗi hoá đơn · mỗi ngày · số lượng+cửa sổ) ⇒ CHUA_KHAI_HAN_MUC — không có chuyện «chưa khai nên không giới hạn».
 * Tính CỘNG DỒN: hoá đơn này được tính vào ngày/cửa sổ trước khi so (chạm đúng hạn mức vẫn được; hơn một đồng/một hoá đơn là vượt).
 * Số tiền không hợp lệ (âm, NaN, không nguyên) ⇒ vượt mỗi hoá đơn (không đoán).
 */
export function kiemHanMuc(i: { chinhSach: HanMucKy | null; soTien: number; suDung: SuDungHanMuc }): KetQuaHanMuc {
  const c = i.chinhSach;
  if (!c || c.hanMucMoiHoaDon === null || c.hanMucMoiNgay === null || c.soToiDa === null || c.cuaSoPhut === null) {
    return { ok: false, ma: "CHUA_KHAI_HAN_MUC", lyDo: "Pháp nhân này chưa khai đủ hạn mức ký tự động nên hoá đơn chờ kiểm tra." };
  }
  if (!Number.isInteger(i.soTien) || i.soTien < 0 || i.soTien > c.hanMucMoiHoaDon) {
    return { ok: false, ma: "VUOT_MOI_HOA_DON", lyDo: `Hoá đơn vượt hạn mức ký tự động mỗi hoá đơn (${vnd(c.hanMucMoiHoaDon)}) nên chờ kiểm tra.` };
  }
  if (i.suDung.tongNgay + i.soTien > c.hanMucMoiNgay) {
    return { ok: false, ma: "VUOT_NGAY", lyDo: `Tổng giá trị ký tự động trong ngày sẽ vượt hạn mức (${vnd(c.hanMucMoiNgay)}) nên hoá đơn chờ kiểm tra.` };
  }
  if (i.suDung.soTrongCuaSo + 1 > c.soToiDa) {
    return { ok: false, ma: "VUOT_SO_LUONG", lyDo: `Số hoá đơn ký tự động trong ${c.cuaSoPhut} phút sẽ vượt ${c.soToiDa} nên hoá đơn chờ kiểm tra.` };
  }
  const canhBao =
    c.nguongTanSuat !== null && i.suDung.soTrongCuaSo + 1 >= c.nguongTanSuat
      ? `Tần suất ký tự động cao bất thường: ${i.suDung.soTrongCuaSo + 1} hoá đơn trong ${c.cuaSoPhut} phút (ngưỡng ${c.nguongTanSuat}).`
      : null;
  return { ok: true, canhBao };
}

// ─── Thay đổi hạn mức: cái gì NỚI LỎNG ────────────────────────────────────────────────────────────────────────────────────

export type DongThayDoiHanMuc = { truong: keyof HanMucKy; nhan: string; truoc: number | null; sau: number | null };
export type PhanTichThayDoiHanMuc = { dong: DongThayDoiHanMuc[]; noiLong: boolean; lyDoNoiLong: string[] };

const NHAN_TRUONG: Record<keyof HanMucKy, string> = {
  hanMucMoiHoaDon: "Tối đa mỗi hoá đơn (VND)",
  hanMucMoiNgay: "Tối đa mỗi ngày (VND)",
  soToiDa: "Số hoá đơn tối đa",
  cuaSoPhut: "Trong bao nhiêu phút",
  nguongTanSuat: "Ngưỡng cảnh báo tần suất",
};

const dayDu = (c: HanMucKy | null): boolean => !!c && c.hanMucMoiHoaDon !== null && c.hanMucMoiNgay !== null && c.soToiDa !== null && c.cuaSoPhut !== null;

/**
 * So hạn mức đang có (`cu`, `null` = chưa có dòng) với hạn mức sắp lưu (`moi`). THUẦN — màn (để hiện bảng cũ→mới + ô xác nhận) và lớp DB (để ÉP xác nhận)
 * cùng gọi MỘT hàm, nên «tăng hạn mức» không thể lọt vì màn và máy chủ hiểu khác nhau.
 *
 * NỚI LỎNG (cần xác nhận riêng) khi:
 *   · từ «chưa khai đủ» (đang KHÔNG tự ký — fail-closed) sang «khai đủ» = BẬT khả năng tự ký lần đầu;
 *   · tăng «mỗi hoá đơn» · tăng «mỗi ngày» · tăng «số hoá đơn tối đa» · GIẢM cửa sổ phút (cùng số tối đa trong cửa sổ ngắn hơn = nới).
 * Siết chặt hoặc đổi ngưỡng cảnh báo thì KHÔNG cần xác nhận thêm (lý do + nhật ký vẫn bắt buộc).
 */
export function phanTichThayDoiHanMuc(cu: HanMucKy | null, moi: HanMucKy): PhanTichThayDoiHanMuc {
  const truong = Object.keys(NHAN_TRUONG) as (keyof HanMucKy)[];
  const dong = truong
    .map((k) => ({ truong: k, nhan: NHAN_TRUONG[k], truoc: cu ? cu[k] : null, sau: moi[k] }))
    .filter((d) => d.truoc !== d.sau);
  const lyDoNoiLong: string[] = [];
  if (!dayDu(cu) && dayDu(moi)) {
    lyDoNoiLong.push("Từ «chưa khai đủ hạn mức» (hệ thống KHÔNG tự ký) sang «đã khai đủ» — bật khả năng ký tự động của pháp nhân này.");
  } else if (dayDu(cu) && dayDu(moi) && cu && moi) {
    if (moi.hanMucMoiHoaDon! > cu.hanMucMoiHoaDon!) lyDoNoiLong.push(`Tăng hạn mức mỗi hoá đơn: ${vnd(cu.hanMucMoiHoaDon!)} → ${vnd(moi.hanMucMoiHoaDon!)}.`);
    if (moi.hanMucMoiNgay! > cu.hanMucMoiNgay!) lyDoNoiLong.push(`Tăng hạn mức mỗi ngày: ${vnd(cu.hanMucMoiNgay!)} → ${vnd(moi.hanMucMoiNgay!)}.`);
    if (moi.soToiDa! > cu.soToiDa!) lyDoNoiLong.push(`Tăng số hoá đơn tối đa: ${cu.soToiDa} → ${moi.soToiDa}.`);
    if (moi.cuaSoPhut! < cu.cuaSoPhut!) lyDoNoiLong.push(`Rút ngắn cửa sổ đếm: ${cu.cuaSoPhut} → ${moi.cuaSoPhut} phút (cùng số hoá đơn tối đa trong khoảng ngắn hơn = nới).`);
  }
  return { dong, noiLong: lyDoNoiLong.length > 0, lyDoNoiLong };
}

// ─── Trạng thái «ký tự động» của một pháp nhân (chỉ để HIỂN THỊ — không phải cổng) ─────────────────────────────────────────

export type TrangThaiKyTuDong = { ma: "TAM_DUNG" | "CHUA_KHAI" | "SAN_SANG"; nhan: string };

/**
 * Đọc từ CHÍNH SÁCH: tạm dừng · chưa khai đủ hạn mức (fail-closed: không tự ký) · đủ điều kiện về mặt chính sách.
 * ⚠️ «Đủ điều kiện» KHÔNG có nghĩa đang tự ký: lô 23h / tự xuất còn công tắc riêng (Cấu hình vận hành), cổng nhà cung cấp, chứng thư… Màn nói rõ điều đó.
 */
export function trangThaiKyTuDong(c: (HanMucKy & { tamDung: boolean }) | null): TrangThaiKyTuDong {
  if (c?.tamDung) return { ma: "TAM_DUNG", nhan: "Đang tạm dừng — không ký, không phát hành" };
  if (!dayDu(c)) return { ma: "CHUA_KHAI", nhan: "Không tự ký — chưa khai đủ hạn mức" };
  return { ma: "SAN_SANG", nhan: "Đủ điều kiện tự ký theo chính sách (còn tuỳ công tắc lô 23h / tự xuất)" };
}
