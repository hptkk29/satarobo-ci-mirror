/**
 * lib/nguon/chuyen-khoan-ghi-danh.ts — LÕI THUẦN của «P7-B · khoản thu và giá ĐI THEO ghi danh đang học» (nhóm G2, 26/10/2026).
 *
 * ── Vấn đề ───────────────────────────────────────────────────────────────────────────────────────────────
 * Khi học viên bị chuyển lớp (đường chuyển lớp trơn trước 21/10) hoặc bị add nhầm rồi gỡ khỏi lớp và xếp lại, hệ thống tạo ghi danh MỚI **không giá** (`listPrice … finalPrice` đều NULL) còn khoản thu CONFIRMED và giá niêm yết
 * ở lại ghi danh CŨ đã đóng (TRANSFERRED / WITHDREW). Hệ quả: ghi danh đóng báo nợ (màn công nợ vẫn liệt kê ghi danh đóng) trong khi học viên đang học ở ghi danh mới mà không có giá, không có khoản thu. `Payment.enrollmentId` là «hạt của học bạ,
 * hoàn tiền» (schema) nên khoản thu nằm ở ghi danh đóng cũng là sai hạt.
 *
 * ── Lệnh này làm gì (khi và CHỈ KHI chứng minh được) ──────────────────────────────────────────────────────
 *   · `Payment.enrollmentId`: ghi danh cũ → ghi danh mới (MỌI khoản sống đang gắn ghi danh cũ);
 *   · giá: ghi danh mới (đang CẢ NĂM cột giá NULL) NHẬN nguyên năm cột giá của ghi danh cũ; ghi danh cũ về CẢ NĂM cột NULL — giá đi theo tiền, không nhân đôi, không mất.
 *   Tổng giá và tổng tiền của học viên KHÔNG đổi; chỉ đổi chỗ đứng. Giá đích đúng (giảm 15%…) là việc của lệnh P7-A SAU ĐÓ (lệnh này không đụng mức giảm).
 *
 * ── Bằng chứng (đủ TẤT CẢ) ───────────────────────────────────────────────────────────────────────────────
 *   1. ghi danh cũ ĐÃ ĐÓNG (WITHDREW/TRANSFERRED/CANCELLED), chưa xoá mềm; ghi danh mới CÒN HIỆU LỰC, chưa xoá mềm; cùng học viên · cùng khoá · cùng cơ sở;
 *   2. một trong hai dây liên kết (mỗi dây TỰ ĐỨNG, và nếu cả hai có thì phải trỏ cùng một ghi danh):
 *        (R1) dòng đơn của khoản thu đã trỏ ghi danh mới (`OrderItem.enrollmentId`);
 *        (R2) ghi danh cũ ghi `transferredToId` = ghi danh mới (hệ thống tự ghi lúc chuyển lớp);
 *   3. ghi danh mới CHƯA có giá, CHƯA có khoản thu sống, CHƯA có biên lai / hoa hồng / yêu cầu hoàn / bảo lưu; ghi danh cũ CHƯA có yêu cầu hoàn / bảo lưu;
 *   4. mọi khoản sống của ghi danh cũ là `PAYMENT / RECORDED / CONFIRMED`, không phải bút toán điều chỉnh (khoản `PENDING`, `REJECTED` hay điều chỉnh ⇒ để kế toán xử lý trước, lệnh không trộn);
 *   5. ghi danh cũ CÓ giá (có gì để mang đi) và Σ khoản không vượt giá đó; dòng đơn của khoản (nếu có) không trỏ ghi danh THỨ BA;
 *   6. một ghi danh cũ chỉ đi tới đúng MỘT ghi danh mới và ngược lại (trùng ⇒ dừng cả lô);
 *   7. CỬA SỔ NGÀY THU: mọi khoản của ghi danh cũ có ngày thu (theo giờ VN) trong [01/09/2026, 23/10/2026) — phạm vi đối soát T9–T10; khoản T5–T8 («Nhập liệu ban đầu» tháng 6, dữ liệu lịch sử) KHÔNG BAO GIỜ bị chạm
 *      (`CUA_SO_NGAY_THU_TU` / `CUA_SO_NGAY_THU_DEN`: hằng nghiệp vụ, KHÔNG nhận từ dòng lệnh).
 * Trượt bất kỳ điều kiện nào ⇒ cặp bị LOẠI kèm mã lý do (không nới); lỗi cấp lô (trùng đích) ⇒ DỪNG CẢ LÔ.
 *
 * ── KHÔNG làm ────────────────────────────────────────────────────────────────────────────────────────────
 * Số tiền / trạng thái / ngày thu của Payment · Receipt (biên lai đã phát hành là chứng từ — chỉ BÁO số biên lai đang trỏ ghi danh cũ) · hoá đơn điện tử · hoa hồng (chỉ BÁO số dòng đang trỏ ghi danh cũ) · Order / OrderItem ·
 * mức giảm · trạng thái ghi danh · quyền học.
 *
 * THUẦN: không Prisma, không đồng hồ, không fs, không env.
 */
import { shaDongWaveC } from "./wave-c-chung";
import { TRANG_THAI_GHI_DANH_LOAI_WAVE_C } from "./wave-c-gan-danh-tinh";
import { chuoiGiaWaveCB, type GiaGhiDanh } from "./wave-c-sua-gia-ghi-danh";

export const KHUON_DONG_CHUYEN_KHOAN = "chuyen-khoan-ghi-danh/v1";
export const LY_DO_CHUYEN_KHOAN =
  "P7-B: khoản thu và giá đi theo ghi danh đang học — chuyển Payment.enrollmentId từ ghi danh đã đóng sang ghi danh đang học (đủ bằng chứng), giá niêm yết đi theo, tổng không đổi";
export const HANH_DONG_CHUYEN_KHOAN = "CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC";
export const HANH_DONG_CHUYEN_GIA = "CHUYEN_GIA_SANG_GHI_DANH_DANG_HOC";
export const HANH_DONG_CHUYEN_KHOAN_LUOT = "CHUYEN_KHOAN_SANG_GHI_DANH_DANG_HOC_LUOT_CHAY";
export const ENTITY_LUOT_CHUYEN_KHOAN = "ChuyenKhoanGhiDanh";

export const TRANG_THAI_GHI_DANH_DONG = TRANG_THAI_GHI_DANH_LOAI_WAVE_C;

/** Cửa sổ ngày thu của đợt đối soát T9–T10/2026 theo giờ VN: [00:00 01/09, 00:00 23/10). T5–T8 bị cấm sửa (chủ hệ thống chốt). */
export const CUA_SO_NGAY_THU_TU = new Date("2026-08-31T17:00:00.000Z");
export const CUA_SO_NGAY_THU_DEN = new Date("2026-10-22T17:00:00.000Z");

const TRONG: GiaGhiDanh = { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null };
const laTrong = (g: GiaGhiDanh) => g.listPrice === null && g.discountType === null && g.discountAmount === null && g.tuition === null && g.finalPrice === null;
const cungGia = (a: GiaGhiDanh, b: GiaGhiDanh) =>
  a.listPrice === b.listPrice && a.discountType === b.discountType && a.discountAmount === b.discountAmount && a.tuition === b.tuition && a.finalPrice === b.finalPrice;

export type GhiDanhChuyen = {
  id: string;
  studentId: string;
  courseId: string | null;
  centerId: string | null;
  status: string;
  deletedAt: Date | null;
  transferredToId: string | null;
  gia: GiaGhiDanh;
};

export type KhoanChuyen = {
  id: string;
  orderId: string;
  amount: number;
  /** Ngày thu (VN) — để chặn khoản ngoài cửa sổ đối soát. */
  paidDate: Date;
  paymentType: string;
  saleStatus: string;
  accountantStatus: string;
  adjustmentOfId: string | null;
  /** Dòng đơn của khoản (nếu có) → ghi danh mà dòng đơn đang trỏ (null = dòng chưa trỏ / khoản không gắn dòng). */
  dongDonTroToi: string | null;
  coDongDon: boolean;
};

/** Một ứng viên = một ghi danh đóng đang giữ khoản, cùng ghi danh đích ứng viên (do tầng DB dò theo R1/R2). */
export type UngVienChuyen = {
  cu: GhiDanhChuyen;
  /** Ghi danh đích theo từng dây: `r1` = ghi danh mà dòng đơn của khoản trỏ tới; `r2` = `cu.transferredToId`. */
  r1: string[];
  r2: string | null;
  moi: GhiDanhChuyen | null;
  /** MỌI khoản SỐNG đang gắn ghi danh cũ. */
  khoanCu: readonly KhoanChuyen[];
  /** Số khoản SỐNG đang gắn ghi danh mới. */
  khoanMoi: number;
  /** Ràng buộc chặn: biên lai / hoa hồng / hoàn tiền / bảo lưu trên MỖI ghi danh. */
  moiCo: { bienLai: number; hoaHong: number; hoanTien: number; baoLuu: number };
  cuCo: { bienLai: number; hoaHong: number; hoanTien: number; baoLuu: number };
};

export type DongChuyen = {
  code: string; // mã đơn đầu tiên của khoản (để báo cáo); KHÔNG dùng làm khoá
  cuId: string;
  moiId: string;
  khoanIds: readonly string[];
  tongTien: number;
  giaCu: GiaGhiDanh;
  /** Báo cáo: số biên lai / dòng hoa hồng đang trỏ ghi danh CŨ (lệnh KHÔNG đổi). */
  bienLaiConTroCu: number;
  hoaHongConTroCu: number;
  dayLienKet: "R1" | "R2" | "R1+R2";
};

export type DonBiLoaiChuyen = { cuId: string; ma: string; chiTiet: string };

export const MA_LOAI_CHUYEN = {
  GHI_DANH_CU_CHUA_DONG: "GHI_DANH_CU_CHUA_DONG",
  KHONG_CO_KHOAN: "KHONG_CO_KHOAN",
  KHONG_TIM_RA_GHI_DANH_MOI: "KHONG_TIM_RA_GHI_DANH_MOI",
  HAI_DAY_LIEN_KET_LECH: "HAI_DAY_LIEN_KET_LECH",
  GHI_DANH_MOI_KHONG_HOP_LE: "GHI_DANH_MOI_KHONG_HOP_LE",
  LECH_HOC_VIEN_KHOA_CO_SO: "LECH_HOC_VIEN_KHOA_CO_SO",
  GHI_DANH_MOI_DA_CO_GIA_HOAC_TIEN: "GHI_DANH_MOI_DA_CO_GIA_HOAC_TIEN",
  CO_RANG_BUOC_CHAN: "CO_RANG_BUOC_CHAN",
  KHOAN_KHONG_HOP_LE: "KHOAN_KHONG_HOP_LE",
  DONG_DON_TRO_GHI_DANH_THU_BA: "DONG_DON_TRO_GHI_DANH_THU_BA",
  GHI_DANH_CU_KHONG_CO_GIA: "GHI_DANH_CU_KHONG_CO_GIA",
  TIEN_VUOT_GIA: "TIEN_VUOT_GIA",
  TRUNG_DICH: "TRUNG_DICH",
  TRUNG_NGUON: "TRUNG_NGUON",
  NGOAI_CUA_SO_NGAY_THU: "NGOAI_CUA_SO_NGAY_THU",
} as const;

const NHAN_HIEU_LUC = (s: string) => !(TRANG_THAI_GHI_DANH_DONG as readonly string[]).includes(s);

/** Xét MỘT ứng viên; trả dòng chuyển hoặc lý do loại. */
export function xetUngVienChuyen(u: UngVienChuyen): { dong: DongChuyen } | { loai: DonBiLoaiChuyen } {
  const cuId = u.cu.id;
  const loai = (ma: string, chiTiet: string) => ({ loai: { cuId, ma, chiTiet } });
  // 1 · ghi danh cũ đã đóng, chưa xoá mềm
  if (!(TRANG_THAI_GHI_DANH_DONG as readonly string[]).includes(u.cu.status) || u.cu.deletedAt !== null) {
    return loai("GHI_DANH_CU_CHUA_DONG", `ghi danh cũ ở trạng thái «${u.cu.status}»${u.cu.deletedAt ? " và đã xoá mềm" : ""} — chỉ nhận WITHDREW/TRANSFERRED/CANCELLED chưa xoá mềm`);
  }
  if (u.khoanCu.length === 0) return loai("KHONG_CO_KHOAN", "ghi danh cũ không giữ khoản thu sống nào");
  // 7 · cửa sổ ngày thu (đứng TRƯỚC mọi xét đoán khác: khoản lịch sử không bao giờ vào kế hoạch, kể cả khi mọi điều kiện còn lại đủ)
  const ngoai = u.khoanCu.filter((k) => k.paidDate.getTime() < CUA_SO_NGAY_THU_TU.getTime() || k.paidDate.getTime() >= CUA_SO_NGAY_THU_DEN.getTime());
  if (ngoai.length > 0) return loai("NGOAI_CUA_SO_NGAY_THU", `${ngoai.length} khoản có ngày thu ngoài [01/09/2026, 23/10/2026) — dữ liệu lịch sử, không chạm`);
  // 2 · dây liên kết
  const dich = new Set<string>([...u.r1, ...(u.r2 === null ? [] : [u.r2])]);
  if (dich.size > 1) return loai("HAI_DAY_LIEN_KET_LECH", `các dây liên kết trỏ tới ${dich.size} ghi danh khác nhau`);
  if (dich.size === 0 || u.moi === null) return loai("KHONG_TIM_RA_GHI_DANH_MOI", "không dây liên kết nào (dòng đơn trỏ ghi danh mới · transferredToId) dẫn tới một ghi danh tồn tại");
  const moi = u.moi;
  if (moi.deletedAt !== null || !NHAN_HIEU_LUC(moi.status)) return loai("GHI_DANH_MOI_KHONG_HOP_LE", `ghi danh mới ở trạng thái «${moi.status}»${moi.deletedAt ? " / đã xoá mềm" : ""}`);
  if (moi.id === u.cu.id || moi.studentId !== u.cu.studentId || moi.courseId === null || moi.courseId !== u.cu.courseId || moi.centerId === null || moi.centerId !== u.cu.centerId) {
    return loai("LECH_HOC_VIEN_KHOA_CO_SO", "hai ghi danh khác học viên / khoá / cơ sở");
  }
  // 3 · ghi danh mới trống; ràng buộc chặn
  if (!laTrong(moi.gia) || u.khoanMoi > 0) return loai("GHI_DANH_MOI_DA_CO_GIA_HOAC_TIEN", `ghi danh mới đã có giá (${chuoiGiaWaveCB(moi.gia)}) hoặc ${u.khoanMoi} khoản thu`);
  const chan = (c: UngVienChuyen["moiCo"], ten: string) =>
    [c.hoanTien > 0 ? `${ten}: ${c.hoanTien} yêu cầu hoàn` : "", c.baoLuu > 0 ? `${ten}: ${c.baoLuu} bảo lưu` : ""].filter(Boolean);
  const chanMoi = [...chan(u.moiCo, "ghi danh mới"), ...(u.moiCo.bienLai > 0 ? [`ghi danh mới: ${u.moiCo.bienLai} biên lai`] : []), ...(u.moiCo.hoaHong > 0 ? [`ghi danh mới: ${u.moiCo.hoaHong} dòng hoa hồng`] : [])];
  const chanCu = chan(u.cuCo, "ghi danh cũ");
  if (chanMoi.length + chanCu.length > 0) return loai("CO_RANG_BUOC_CHAN", [...chanMoi, ...chanCu].join(" · "));
  // 4 · khoản hợp lệ
  const xau = u.khoanCu.filter((k) => k.paymentType !== "PAYMENT" || k.saleStatus !== "RECORDED" || k.accountantStatus !== "CONFIRMED" || k.adjustmentOfId !== null);
  if (xau.length > 0) return loai("KHOAN_KHONG_HOP_LE", `${xau.length} khoản không phải PAYMENT/RECORDED/CONFIRMED hoặc là bút toán điều chỉnh — kế toán xử lý trước`);
  // 5 · giá để mang đi; tiền không vượt giá; dòng đơn không trỏ ghi danh thứ ba
  const gia = u.cu.gia.finalPrice;
  if (gia === null) return loai("GHI_DANH_CU_KHONG_CO_GIA", "ghi danh cũ không có giá để mang đi");
  const tong = u.khoanCu.reduce((s, k) => s + k.amount, 0);
  if (tong > gia) return loai("TIEN_VUOT_GIA", `Σ khoản ${tong} vượt giá ghi danh cũ ${gia}`);
  const thuBa = u.khoanCu.filter((k) => k.dongDonTroToi !== null && k.dongDonTroToi !== moi.id && k.dongDonTroToi !== u.cu.id);
  if (thuBa.length > 0) return loai("DONG_DON_TRO_GHI_DANH_THU_BA", `${thuBa.length} khoản có dòng đơn trỏ ghi danh thứ ba`);

  const r1 = u.r1.includes(moi.id);
  const r2 = u.r2 === moi.id;
  return {
    dong: {
      code: u.khoanCu[0]!.orderId,
      cuId,
      moiId: moi.id,
      khoanIds: u.khoanCu.map((k) => k.id).sort(),
      tongTien: tong,
      giaCu: u.cu.gia,
      bienLaiConTroCu: u.cuCo.bienLai,
      hoaHongConTroCu: u.cuCo.hoaHong,
      dayLienKet: r1 && r2 ? "R1+R2" : r1 ? "R1" : "R2",
    },
  };
}

/** MỘT dòng ký / cặp: ràng ghi danh cũ → mới, danh sách khoản (sắp), tổng tiền, giá mang đi. Không chứa tên/SĐT/email. */
export function dongDauRaChuyenKhoan(ghi: readonly DongChuyen[]): string[] {
  return ghi.map((g) => [KHUON_DONG_CHUYEN_KHOAN, g.cuId, g.moiId, g.khoanIds.join(","), String(g.tongTien), chuoiGiaWaveCB(g.giaCu), g.dayLienKet].join("|"));
}

export type KeHoachChuyenKhoan = {
  ghi: readonly DongChuyen[];
  loai: readonly DonBiLoaiChuyen[];
  loiLo: readonly DonBiLoaiChuyen[];
  dung: boolean;
  dongDauRa: readonly string[];
  sha: string;
};

/** Cả lô. Cặp trùng đích / trùng nguồn ⇒ DỪNG CẢ LÔ. */
export function lapKeHoachChuyenKhoan(ung: readonly UngVienChuyen[]): KeHoachChuyenKhoan {
  const ghi: DongChuyen[] = [];
  const loai: DonBiLoaiChuyen[] = [];
  for (const u of [...ung].sort((a, b) => (a.cu.id < b.cu.id ? -1 : 1))) {
    const r = xetUngVienChuyen(u);
    if ("loai" in r) loai.push(r.loai);
    else ghi.push(r.dong);
  }
  const loiLo: DonBiLoaiChuyen[] = [];
  const dem = (khoa: (g: DongChuyen) => string) => {
    const m = new Map<string, DongChuyen[]>();
    for (const g of ghi) m.set(khoa(g), [...(m.get(khoa(g)) ?? []), g]);
    return [...m.entries()].filter(([, v]) => v.length > 1);
  };
  for (const [id, v] of dem((g) => g.moiId)) loiLo.push({ cuId: v.map((g) => g.cuId).join(","), ma: MA_LOAI_CHUYEN.TRUNG_DICH, chiTiet: `ghi danh ${id} là đích của ${v.length} ghi danh cũ` });
  for (const [id, v] of dem((g) => g.cuId)) loiLo.push({ cuId: id, ma: MA_LOAI_CHUYEN.TRUNG_NGUON, chiTiet: `ghi danh cũ ${id} xuất hiện ${v.length} lần` });
  const dung = loiLo.length > 0;
  const ra = dung ? [] : ghi;
  const dongDauRa = dongDauRaChuyenKhoan(ra);
  return { ghi: ra, loai, loiLo, dung, dongDauRa, sha: shaDongWaveC(dongDauRa) };
}

export { TRONG as GIA_TRONG, cungGia as cungGiaChuyen, laTrong as laGiaTrong };
