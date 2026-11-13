/**
 * lib/nguon/chuyen-khoan-ghi-danh.ts — LÕI THUẦN của «P7-B v2 · khoản thu và giá ĐI THEO ghi danh đang học» (nhóm G2; v2 27/10/2026).
 *
 * ── Vấn đề ───────────────────────────────────────────────────────────────────────────────────────────────
 * Khi học viên bị chuyển lớp (đường chuyển lớp trơn trước khi luồng được vá) hoặc bị add nhầm rồi gỡ khỏi lớp và xếp lại, hệ thống tạo ghi danh MỚI **không giá** (`listPrice … finalPrice` đều NULL) còn khoản thu CONFIRMED và giá niêm yết
 * ở lại ghi danh CŨ đã đóng (TRANSFERRED / WITHDREW). Hệ quả: ghi danh đóng báo nợ (màn công nợ vẫn liệt kê ghi danh đóng) trong khi học viên đang học ở ghi danh mới mà không có giá, không có khoản thu. `Payment.enrollmentId` là «hạt của học bạ,
 * hoàn tiền» (schema) nên khoản thu nằm ở ghi danh đóng cũng là sai hạt.
 *
 * ── v2 KHÁC v1 Ở BA CHỖ (chủ hệ thống chốt 27/10/2026) ───────────────────────────────────────────────────
 *   1. PHẠM VI LÀ DANH SÁCH CẶP `cuId→moiId` DO NGƯỜI KÝ ĐƯA VÀO (`--cap=`), KHÔNG còn là «mọi ghi danh đóng còn giữ tiền». Cặp không có trong danh sách KHÔNG BAO GIỜ được đọc-để-ghi: ca mới phát sinh sau lần chạy thử không thể lọt vào
 *      lượt ghi. Mỗi cặp là MỘT dòng ký ⇒ mỗi học viên một phiếu COMMIT riêng.
 *   2. GIÁ ĐÍCH LÀ GIÁ GÓI TƯỜNG MINH (list · % giảm · final), KHÔNG mang giá cũ nguyên văn. Hệ thống dựng năm cột bằng hàm chuẩn (`giaDichWaveCB`) và đòi final = Σ khoản thu sống của ghi danh cũ (nợ ghi danh mới = 0),
 *      HOẶC (từ 28/10/2026) final = giá thực của dòng khoá học DUY NHẤT trong đơn khi còn đợt chưa thu (ghi danh mới mang nợ = final − Σ thu; giá đọc từ DB, không tin số người ký khai). Thấp hơn tiền đã thu ⇒ luôn từ chối.
 *   3. DẤU VÂN TAY của từng cặp nằm TRONG dòng ký: băm nội dung hai ghi danh · khoản thu của hai phía và của đơn · dòng đơn · biên lai · hoa hồng · quyền học. Bất kỳ phiên nào đổi một byte kể từ lần chạy thử ⇒ dòng đổi ⇒ cổng ký từ chối ⇒
 *      phải chạy thử lại và ký lại (kế hoạch mới).
 *
 * ── Lệnh này làm gì (khi và CHỈ KHI chứng minh được) ──────────────────────────────────────────────────────
 *   · `Payment.enrollmentId`: ghi danh cũ → ghi danh mới (MỌI khoản sống đang gắn ghi danh cũ);
 *   · giá: ghi danh mới (đang CẢ NĂM cột giá NULL) NHẬN giá gói đã ký; ghi danh cũ về CẢ NĂM cột NULL.
 *   Số tiền thực thu KHÔNG đổi; tổng doanh thu KHÔNG đổi; chỉ đổi chỗ đứng của khoản thu và chỗ đứng của giá.
 *
 * ── Bằng chứng (đủ TẤT CẢ, cho từng cặp được yêu cầu) ────────────────────────────────────────────────────
 *   1. ghi danh cũ ĐÃ ĐÓNG (WITHDREW/TRANSFERRED/CANCELLED), chưa xoá mềm; ghi danh mới CÒN HIỆU LỰC, chưa xoá mềm; cùng học viên · cùng khoá · cùng cơ sở;
 *   2. một trong hai dây liên kết (mỗi dây TỰ ĐỨNG, và nếu cả hai có thì phải trỏ cùng một ghi danh):
 *        (R1) dòng đơn của khoản thu đã trỏ ghi danh mới (`OrderItem.enrollmentId`);
 *        (R2) ghi danh cũ ghi `transferredToId` = ghi danh mới (hệ thống tự ghi lúc chuyển lớp);
 *      và ghi danh mà bằng chứng chỉ tới PHẢI là ghi danh mới trong cặp được yêu cầu (người ký chọn cặp, hệ thống kiểm bằng chứng — hai việc độc lập);
 *   3. ghi danh mới CHƯA có giá, CHƯA có khoản thu sống, CHƯA có biên lai / hoa hồng / yêu cầu hoàn / bảo lưu; ghi danh cũ CHƯA có yêu cầu hoàn / bảo lưu;
 *   4. mọi khoản sống của ghi danh cũ là `PAYMENT / RECORDED / CONFIRMED`, không phải bút toán điều chỉnh (khoản `PENDING`, `REJECTED` hay điều chỉnh ⇒ để kế toán xử lý trước, lệnh không trộn);
 *   5. giá đích = Σ khoản thu sống của ghi danh cũ (nợ sau lệnh = 0) HOẶC = giá thực của dòng khoá học duy nhất trong đơn (`totalPrice − discountAmount`; nợ = giá − Σ thu; mã `DON_KHONG_MOT_DONG_KHOA` / `GIA_DICH_KHONG_KHOP_DONG`); thấp hơn Σ thu ⇒ `GIA_DICH_KHAC_TONG_THU`; dòng đơn của khoản (nếu có) không trỏ ghi danh THỨ BA;
 *   6. một ghi danh cũ chỉ đi tới đúng MỘT ghi danh mới và ngược lại (trùng ⇒ dừng cả lô);
 *   7. CỬA SỔ NGÀY THU: mọi khoản của ghi danh cũ có ngày thu (theo giờ VN) trong [01/09/2026, 23/10/2026) — phạm vi đối soát T9–T10; khoản T5–T8 KHÔNG BAO GIỜ bị chạm
 *      (`CUA_SO_NGAY_THU_TU` / `CUA_SO_NGAY_THU_DEN`: hằng nghiệp vụ, KHÔNG nhận từ dòng lệnh).
 * Cặp ĐƯỢC YÊU CẦU mà trượt bất kỳ điều kiện nào ⇒ DỪNG CẢ LÔ kèm mã lý do (không bỏ qua im lặng, không nới). Cặp đã ở đúng trạng thái đích (chạy lại sau khi ghi) ⇒ `daXong`, 0 dòng ghi.
 *
 * ── KHÔNG làm ────────────────────────────────────────────────────────────────────────────────────────────
 * Số tiền / trạng thái / ngày thu của Payment · Receipt (biên lai đã phát hành là chứng từ — giữ nguyên, chỉ BÁO số biên lai đang trỏ ghi danh cũ) · hoá đơn điện tử · hoa hồng (chỉ BÁO) · Order / OrderItem · mức giảm của đơn ·
 * trạng thái ghi danh · quyền học · điểm danh.
 *
 * THUẦN: không Prisma, không đồng hồ, không fs, không env.
 */
import { shaDongWaveC } from "./wave-c-chung";
import { TRANG_THAI_GHI_DANH_LOAI_WAVE_C } from "./wave-c-gan-danh-tinh";
import { chuoiGiaWaveCB, giaDichWaveCB, type GiaGhiDanh } from "./wave-c-sua-gia-ghi-danh";

export const KHUON_DONG_CHUYEN_KHOAN = "chuyen-khoan-ghi-danh/v2";
export const LY_DO_CHUYEN_KHOAN =
  "P7-B v2: khoản thu và giá gói đi theo ghi danh đang học — chuyển Payment.enrollmentId từ ghi danh đã đóng sang ghi danh đang học (đủ bằng chứng, cặp do owner chọn), giá gói đã ký, tổng không đổi";
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

/** MỘT cặp do người ký chọn: ghi danh đóng → ghi danh đang học, kèm giá gói ĐÍCH (năm cột dựng bằng hàm chuẩn). */
export type CapYeuCau = { cuId: string; moiId: string; giaMoi: GiaGhiDanh };

const RE_ID = /^[A-Za-z0-9_-]{8,40}$/;
const RE_SO = /^[0-9]{1,12}$/;

/**
 * Phân tích `--cap=` : `cuId:moiId:giaNiemYet:phanTramGiam:giaCuoi` , nhiều cặp cách nhau bằng dấu phẩy. KHÔNG ngầm định: thiếu/sai khuôn ⇒ lỗi (không đoán).
 * `giaCuoi` PHẢI bằng giá hàm chuẩn tính ra từ `giaNiemYet` và `phanTramGiam` — nhập hai lần để bắt gõ nhầm, vì đây là con số được ký.
 */
export function phanTichCap(raw: string | null | undefined): { cap: CapYeuCau[] } | { loi: string } {
  if (raw === null || raw === undefined || raw.trim() === "") return { loi: "thiếu --cap=<cuId:moiId:giaNiemYet:phanTramGiam:giaCuoi[,…]> — lệnh v2 không tự chọn phạm vi." };
  const cap: CapYeuCau[] = [];
  for (const phan of raw.split(",").map((x) => x.trim())) {
    if (phan === "") return { loi: "--cap có phần tử rỗng (dấu phẩy thừa)." };
    const t = phan.split(":");
    if (t.length !== 5) return { loi: `cặp «${phan.slice(0, 80)}» sai khuôn — đúng: cuId:moiId:giaNiemYet:phanTramGiam:giaCuoi.` };
    const [cuId, moiId, list, pct, cuoi] = t as [string, string, string, string, string];
    if (!RE_ID.test(cuId) || !RE_ID.test(moiId)) return { loi: `cặp «${phan.slice(0, 80)}»: id sai khuôn.` };
    if (cuId === moiId) return { loi: `cặp «${cuId}»: ghi danh cũ và mới trùng nhau.` };
    if (!RE_SO.test(list) || !RE_SO.test(cuoi) || !/^[0-9]{1,3}$/.test(pct)) return { loi: `cặp «${cuId}»: giá/phần trăm phải là số nguyên không dấu.` };
    const giaNiemYet = Number.parseInt(list, 10);
    const phanTram = Number.parseInt(pct, 10);
    const giaCuoi = Number.parseInt(cuoi, 10);
    if (phanTram > 100 || giaNiemYet <= 0 || giaCuoi <= 0) return { loi: `cặp «${cuId}»: phần trăm 0–100, giá > 0.` };
    const gia = giaDichWaveCB(giaNiemYet, phanTram);
    if (gia.finalPrice !== giaCuoi) return { loi: `cặp «${cuId}»: giá cuối khai ${giaCuoi} ≠ ${gia.finalPrice} (hàm chuẩn tính từ ${giaNiemYet} giảm ${phanTram}%).` };
    cap.push({ cuId, moiId, giaMoi: gia });
  }
  const trung = (k: (c: CapYeuCau) => string) => new Set(cap.map(k)).size !== cap.length;
  if (trung((c) => c.cuId)) return { loi: "--cap có ghi danh cũ xuất hiện hai lần." };
  if (trung((c) => c.moiId)) return { loi: "--cap có ghi danh mới xuất hiện hai lần." };
  return { cap: cap.sort((a, b) => (a.cuId < b.cuId ? -1 : 1)) };
}

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

/** Một ứng viên = một ghi danh đóng được YÊU CẦU, cùng ghi danh đích mà bằng chứng chỉ tới (do tầng DB dò theo R1/R2). */
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
  /** Vân tay (sha256) nội dung mọi bản ghi liên quan của cặp — do tầng DB băm; lõi chỉ chép vào dòng ký. */
  dauVan: string;
  /** Cặp ĐÃ ở trạng thái đích của chính yêu cầu này (chạy lại sau khi ghi) — do tầng DB xác định. */
  daXong: boolean;
  /**
   * Bằng chứng giá từ ĐƠN (do tầng DB đọc, KHÔNG nhận từ dòng lệnh): số đơn mà các khoản của ghi danh cũ thuộc về · số dòng khoá học của đơn (khi đúng một đơn) ·
   * giá thực của dòng đó = `totalPrice − discountAmount` (chỉ khi đúng MỘT đơn có đúng MỘT dòng khoá học, ngược lại null).
   */
  dongKhoaDon: { soDon: number; soDongKhoa: number; gia: number | null };
};

export type DongChuyen = {
  code: string; // mã đơn đầu tiên của khoản (để báo cáo); KHÔNG dùng làm khoá
  cuId: string;
  moiId: string;
  khoanIds: readonly string[];
  tongTien: number;
  giaCu: GiaGhiDanh;
  giaMoi: GiaGhiDanh;
  dauVan: string;
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
  GIA_DICH_KHAC_TONG_THU: "GIA_DICH_KHAC_TONG_THU",
  DON_KHONG_MOT_DONG_KHOA: "DON_KHONG_MOT_DONG_KHOA",
  GIA_DICH_KHONG_KHOP_DONG: "GIA_DICH_KHONG_KHOP_DONG",
  TRUNG_DICH: "TRUNG_DICH",
  TRUNG_NGUON: "TRUNG_NGUON",
  NGOAI_CUA_SO_NGAY_THU: "NGOAI_CUA_SO_NGAY_THU",
  CAP_KHONG_CO_GHI_DANH_CU: "CAP_KHONG_CO_GHI_DANH_CU",
  CAP_LECH_BANG_CHUNG: "CAP_LECH_BANG_CHUNG",
} as const;

const NHAN_HIEU_LUC = (s: string) => !(TRANG_THAI_GHI_DANH_DONG as readonly string[]).includes(s);

/** Xét MỘT cặp được yêu cầu; trả dòng chuyển hoặc lý do loại. */
export function xetUngVienChuyen(u: UngVienChuyen, y: CapYeuCau): { dong: DongChuyen } | { loai: DonBiLoaiChuyen } {
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
  if (moi.id !== y.moiId) return loai("CAP_LECH_BANG_CHUNG", `bằng chứng dẫn tới ghi danh ${moi.id}, cặp được yêu cầu là ${y.moiId} — không đoán`);
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
  // 5 · giá đích = Σ khoản thu sống, hoặc = giá dòng đơn duy nhất (còn nợ đợt chưa thu); dòng đơn không trỏ ghi danh thứ ba
  const tong = u.khoanCu.reduce((s, k) => s + k.amount, 0);
  const giaKy = y.giaMoi.finalPrice;
  // Giá đích thấp hơn tiền đã thu ⇒ tạo «thừa» — không bao giờ. Cao hơn tiền đã thu (ghi danh mới còn nợ, vd. đợt 2 chưa thu) CHỈ khi bằng đúng giá thực của dòng khoá học duy nhất trong đơn (DB) —
  // KHÔNG nhận «giá cao hơn» chỉ vì người ký khai: đó là cách dựng nợ ảo.
  if (giaKy === null || giaKy < tong) return loai("GIA_DICH_KHAC_TONG_THU", `giá đích đã ký ${giaKy} < Σ khoản thu sống ${tong} — lệnh không tạo tiền thừa`);
  if (giaKy > tong) {
    const d = u.dongKhoaDon;
    if (d.soDon !== 1 || d.soDongKhoa !== 1 || d.gia === null) {
      return loai("DON_KHONG_MOT_DONG_KHOA", `giá đích ${giaKy} > Σ khoản thu ${tong} (còn nợ) nhưng khoản thuộc ${d.soDon} đơn / ${d.soDongKhoa} dòng khoá học — chỉ nhận đúng 1 đơn có đúng 1 dòng khoá học để đối chiếu giá`);
    }
    if (giaKy !== d.gia) return loai("GIA_DICH_KHONG_KHOP_DONG", `giá đích đã ký ${giaKy} ≠ giá thực của dòng đơn ${d.gia} (totalPrice − giảm) — giá cao hơn tiền đã thu phải khớp dòng đơn`);
  }
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
      giaMoi: y.giaMoi,
      dauVan: u.dauVan,
      bienLaiConTroCu: u.cuCo.bienLai,
      hoaHongConTroCu: u.cuCo.hoaHong,
      dayLienKet: r1 && r2 ? "R1+R2" : r1 ? "R1" : "R2",
    },
  };
}

/** MỘT dòng ký / cặp: ràng ghi danh cũ → mới, danh sách khoản (sắp), tổng tiền, giá cũ → giá gói mới, dây, VÂN TAY dữ liệu. Không chứa tên/SĐT/email. */
export function dongDauRaChuyenKhoan(ghi: readonly DongChuyen[]): string[] {
  return ghi.map((g) => [KHUON_DONG_CHUYEN_KHOAN, g.cuId, g.moiId, g.khoanIds.join(","), String(g.tongTien), chuoiGiaWaveCB(g.giaCu), chuoiGiaWaveCB(g.giaMoi), g.dayLienKet, g.dauVan].join("|"));
}

export type KeHoachChuyenKhoan = {
  ghi: readonly DongChuyen[];
  /** Cặp đã ở trạng thái đích — không ghi, không lỗi. */
  daXong: readonly string[];
  /** Mọi cặp ĐƯỢC YÊU CẦU mà trượt quy tắc, cộng lỗi cấp lô — có bất kỳ phần tử nào ⇒ DỪNG CẢ LÔ. */
  loiLo: readonly DonBiLoaiChuyen[];
  dung: boolean;
  dongDauRa: readonly string[];
  sha: string;
};

/** Cả lô = đúng các cặp được yêu cầu. Cặp trượt quy tắc / trùng đích / trùng nguồn ⇒ DỪNG CẢ LÔ. Cặp không được yêu cầu KHÔNG được xét. */
export function lapKeHoachChuyenKhoan(ung: readonly UngVienChuyen[], cap: readonly CapYeuCau[]): KeHoachChuyenKhoan {
  const ghi: DongChuyen[] = [];
  const daXong: string[] = [];
  const loiLo: DonBiLoaiChuyen[] = [];
  for (const y of [...cap].sort((a, b) => (a.cuId < b.cuId ? -1 : 1))) {
    const u = ung.find((x) => x.cu.id === y.cuId);
    if (u === undefined) {
      loiLo.push({ cuId: y.cuId, ma: MA_LOAI_CHUYEN.CAP_KHONG_CO_GHI_DANH_CU, chiTiet: "ghi danh cũ của cặp được yêu cầu không tồn tại" });
      continue;
    }
    if (u.daXong) {
      daXong.push(y.cuId);
      continue;
    }
    const r = xetUngVienChuyen(u, y);
    if ("loai" in r) loiLo.push(r.loai);
    else ghi.push(r.dong);
  }
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
  return { ghi: ra, daXong, loiLo, dung, dongDauRa, sha: shaDongWaveC(dongDauRa) };
}

/**
 * TRƯỚC / SAU của MỘT cặp cho báo cáo (thuần, tính từ dòng kế hoạch). Nợ = giá − Σ khoản thu sống của chính ghi danh đó; ghi danh không giá (NULL) không có nợ (màn công nợ không liệt kê).
 * `tongKhoanMoiTruoc` = Σ khoản sống ĐANG gắn ghi danh mới (kế hoạch buộc = 0 nhưng báo cáo in thật).
 */
export function truocSauCapChuyen(g: DongChuyen, tongKhoanMoiTruoc: number) {
  const no = (gia: number | null, daThu: number) => (gia === null ? null : gia - daThu);
  return {
    truoc: {
      giaCu: g.giaCu.finalPrice, daThuCu: g.tongTien, noCu: no(g.giaCu.finalPrice, g.tongTien),
      giaMoi: null as number | null, daThuMoi: tongKhoanMoiTruoc, noMoi: null as number | null,
    },
    sau: {
      giaCu: null as number | null, daThuCu: 0, noCu: null as number | null,
      giaMoi: g.giaMoi.finalPrice, daThuMoi: g.tongTien, noMoi: no(g.giaMoi.finalPrice, g.tongTien),
    },
    tongTienTruoc: g.tongTien + tongKhoanMoiTruoc,
    tongTienSau: g.tongTien + tongKhoanMoiTruoc,
  };
}

export { TRONG as GIA_TRONG, cungGia as cungGiaChuyen, laTrong as laGiaTrong };
