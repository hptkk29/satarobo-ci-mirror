import { z } from "zod";
import { kiemDongKetQuaMau } from "./cn-dong-ket-qua";

/**
 * E-LEARNING ONLINE — CÀI ĐẶT HỌC TẬP của MỘT BẢN khoá (`OnlCourseVersion.settingsJson`), theo thiết kế `QoCaiDat`.
 *
 * Mọi khoá ĐỀU BẮT BUỘC có mặt (không `.default()`): đọc ra thiếu khoá = lỗi, KHÔNG lặng lẽ thành "cho xem lại" — nên cổng truy cập
 * đọc cài đặt hỏng thì ĐÓNG (fail-closed), xem `kiemTraTruyCapNoiDungDb`. Giá trị khởi đầu của một bản NHÁP mới nằm ở
 * `caiDatKhoiDauChoBanNhap()` — một hàm tường minh người gọi phải chọn dùng, không phải mặc định ngầm của schema.
 */
export const caiDatHocTapSchema = z
  .object({
    /** Bài video tính là đã xem khi xem ≥ ngần này % thời lượng (tua nhanh không tính). */
    tinhDaXemPhanTramVideo: z.number().int().min(1).max(100),
    /** Ngưỡng đúng mặc định (% số câu) cho bài tập mới; sửa riêng ở từng bài. */
    baiTapDatPhanTram: z.number().int().min(0).max(100),
    moBaiTiepTheo: z.enum(["KHI_BAI_TRUOC_XONG", "MO_HET", "THEO_CHUONG"]),
    /** Khoá hoàn thành khi xong ≥ ngần này % số bài BẮT BUỘC. */
    khoaHoanThanhPhanTramBaiBatBuoc: z.number().int().min(1).max(100),
    /** V7 §9: BẬT ⇒ không mở lại NỘI DUNG của bài đã hoàn thành (vẫn lưu tiến độ/điểm/lịch sử). */
    khongChoXemLaiBaiDaQua: z.boolean(),
    thiCuoiKhoa: z
      .object({
        bat: z.boolean(),
        diemDat: z.number().int().min(0).max(100),
        /** `null` = không giới hạn lượt. */
        soLanThi: z.number().int().min(1).nullable(),
        phut: z.number().int().min(1).nullable(),
      })
      .strict(),
    xemKetQua: z.enum(["DIEM_VA_DUNG_SAI", "CA_DAP_AN_SAU_HET_LUOT", "CHI_DIEM"]),
    /**
     * D6 (Owner 21/11/2026) — KHI NÀO học viên được thấy ĐÁP ÁN ĐÚNG + giải thích (Đào tạo chọn):
     * `SAU_KHI_NOP` · `SAU_KHI_DE_DONG` (từ `dongDapAnLuc`) · `KHONG_BAO_GIO`. TUỲ CHỌN để bản đã lưu vẫn đọc được; vắng ⇒ suy từ `xemKetQua` cũ
     * (`CA_DAP_AN_SAU_HET_LUOT` ⇒ chỉ lượt ĐÃ ĐẠT; còn lại ⇒ không lộ). Không ảnh hưởng điểm/đúng-sai từng câu (do `xemKetQua` quyết) và không bao giờ áp cho lượt INTERRUPTED/EXPIRED.
     */
    hienDapAn: z.enum(["SAU_KHI_NOP", "SAU_KHI_DE_DONG", "KHONG_BAO_GIO"]).optional(),
    /** Mốc "đề đóng" (ISO 8601). `SAU_KHI_DE_DONG` mà để trống ⇒ chưa lộ (fail-closed). */
    dongDapAnLuc: z.string().datetime({ offset: true }).nullable().optional(),
    /**
     * KHÔNG CÒN TÁC DỤNG (Owner 27/11/2026, phương án A): bài đã khoá xem lại LUÔN cho xem điểm + đạt/không, dù cờ BẬT hay TẮT; không mã nào đọc cờ này.
     * GIỮ trường (bắt buộc) để cài đặt đã lưu vẫn đọc được — schema strict, bỏ trường thì bản cũ thành "cài đặt hỏng" và cổng ĐÓNG. Form quản trị không còn ô cho cờ này; lưu thì gửi lại nguyên giá trị đã lưu (`[ONL-CDF-02]`).
     */
    choXemDiemBaiKhoaXemLai: z.boolean(),
    /**
     * V10.2 (QoCN "Điều kiện cấp") — `false` ⇒ KHÔNG tự cấp chứng nhận khi khoá hoàn thành (chỉ cấp tay). TUỲ CHỌN để bản đã lưu vẫn đọc được; vắng ⇒ tự cấp
     * (đúng hành vi trước V10.2). Điều kiện "đủ" vẫn là `khoaHoanThanhPhanTramBaiBatBuoc` + `thiCuoiKhoa` — một nguồn duy nhất, không bản sao.
     */
    tuCapChungNhan: z.boolean().optional(),
    /**
     * FREE MODE (Owner F2/F3, 25/11/2026) — chính sách HỌC THỬ của khoá, do người có quyền cấu hình (KHÔNG hard-code). TUỲ CHỌN: vắng ⇒ không cho tự nhận miễn phí, không giới hạn.
     * `dangKyMienPhi`: khoá được công bố cho đăng ký miễn phí (giá 0 KHÔNG tự đồng nghĩa). `gioiHanSoBai`: số bài miễn phí tối đa một học viên mở (null = không giới hạn).
     * `hanNgay`: số ngày học thử kể từ lần mở bài miễn phí đầu tiên (null = không hạn).
     */
    hocThu: z
      .object({
        dangKyMienPhi: z.boolean(),
        gioiHanSoBai: z.number().int().min(1).max(500).nullable(),
        hanNgay: z.number().int().min(1).max(3650).nullable(),
        /** C11 — số khoá miễn phí ĐANG HOẠT ĐỘNG tối đa mỗi SĐT phụ huynh đã xác minh (mọi con cùng phụ huynh tính chung). Vắng/null = không giới hạn. Admin cấu hình, KHÔNG hard-code. */
        toiDaKhoaMienPhi: z.number().int().min(1).max(100).nullable().optional(),
      })
      .strict()
      .optional(),
    /** V10.2 — mẫu "Dòng kết quả" in trên giấy chứng nhận: chỗ trống `{số bài}`, `{điểm}`. `null`/vắng ⇒ câu mặc định. Chốt vào bản chụp lúc cấp. */
    dongKetQuaChungNhan: z
      .string()
      .refine((m) => kiemDongKetQuaMau(m).ok, { message: "Dòng kết quả không hợp lệ (tối đa 120 ký tự; chỉ dùng {số bài} và {điểm})" })
      .nullable()
      .optional(),
  })
  .strict();

export type CaiDatHocTap = z.infer<typeof caiDatHocTapSchema>;

/** Giá trị khởi đầu của bản nháp MỚI (Đào tạo chỉnh sau). Hàm tường minh, không phải mặc định của schema. */
export function caiDatKhoiDauChoBanNhap(): CaiDatHocTap {
  return {
    tinhDaXemPhanTramVideo: 90,
    baiTapDatPhanTram: 70,
    moBaiTiepTheo: "KHI_BAI_TRUOC_XONG",
    khoaHoanThanhPhanTramBaiBatBuoc: 100,
    khongChoXemLaiBaiDaQua: false,
    thiCuoiKhoa: { bat: false, diemDat: 70, soLanThi: null, phut: null },
    xemKetQua: "DIEM_VA_DUNG_SAI",
    choXemDiemBaiKhoaXemLai: true,
  };
}

export type KetQuaDocCaiDat = { ok: true; caiDat: CaiDatHocTap } | { ok: false; ma: "CAI_DAT_KHONG_HOP_LE" };

export function docCaiDatHocTap(json: unknown): KetQuaDocCaiDat {
  const r = caiDatHocTapSchema.safeParse(json);
  return r.success ? { ok: true, caiDat: r.data } : { ok: false, ma: "CAI_DAT_KHONG_HOP_LE" };
}
