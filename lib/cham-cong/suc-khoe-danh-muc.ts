/**
 * lib/cham-cong/suc-khoe-danh-muc.ts — CANH danh mục nền rỗng hoặc hỏng cấu hình.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CÓ FILE NÀY — sự cố 09/09/2026
 *
 * Đo prod: `TeachingCreditType` **0 dòng** và `SessionCategory` **0 dòng**, suốt từ lúc
 * module lên. Không gì báo. Hệ quả của cái thứ nhất là **công dạy = 0 cho mọi giáo viên**,
 * im lặng — `loadLoaiCongDay()` trả `[]` ⇒ `loaiCua()` trả `null` ⇒ `congDayCuaNguoi()`
 * bỏ MỌI buổi. Không exception, không log, console sạch.
 *
 * Đây là **luật 1 áp cho dữ liệu nền**: bảng rỗng + đường đọc còn sống = số 0 im lặng.
 * Và nó suýt gây ra một chẩn đoán sai theo **luật 15** — hai nguyên nhân ĐỦ cùng cho ra
 * số 0, vá một cái thì số không nhúc nhích.
 *
 * ⚠️ CỔNG NÀY **KHÔNG CHẶN**, chỉ NÓI. Chặn màn Cấu hình khi danh mục rỗng là khoá đúng
 * cái cửa người ta cần vào để sửa.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Hàm dưới đây THUẦN — nhận số đếm, trả danh sách cảnh báo. Không chạm DB, nên ca test
 * kiểm được mọi tổ hợp mà không cần Postgres, và mỗi ngưỡng cấy lại được (luật 8).
 */

export type DemDanhMuc = {
  /** `ShiftTemplate` dùng chung (`centerId: null`). */
  maCa: number;
  /** `LeaveType`. */
  loaiNghi: number;
  /** `SessionCategory`. */
  phanLoaiBuoi: number;
  /** Số dòng `SessionCategory` đang giữ `isDefault`. Phải đúng 1. */
  soPhanLoaiMacDinh: number;
  /** `TeachingCreditType`. */
  loaiCongDay: number;
  /** `WorkLocation`. */
  diemCham: number;
  /** `Center` đang hoạt động, có `code`, KHÔNG tính Hội sở (Q-04: HO không có quầy). */
  coSoVanHanh: number;
};

export type MucCanhBao = "NANG" | "NHE";

export type CanhBaoDanhMuc = {
  /** Khoá ổn định để ca test và log neo vào — đừng đổi khi sửa câu chữ. */
  ma: string;
  muc: MucCanhBao;
  /** Chuyện gì đang xảy ra. */
  noi: string;
  /** Làm gì bây giờ. */
  lam: string;
};

/**
 * NẶNG = có đường đọc đang trả số sai vì bảng rỗng.
 * NHẸ  = thiếu dữ liệu nhưng chưa làm sai con số nào.
 */
export function kiemSucKhoeDanhMuc(d: DemDanhMuc): CanhBaoDanhMuc[] {
  const ra: CanhBaoDanhMuc[] = [];

  // ── NẶNG NHẤT: bảng này rỗng thì công dạy của MỌI người ra 0, không ai biết ────
  if (d.loaiCongDay === 0) {
    ra.push({
      ma: "CONG_DAY_RONG",
      muc: "NANG",
      noi:
        "Chưa có loại công dạy nào. Mọi buổi dạy đều không khớp loại nào ⇒ công dạy của " +
        "TẤT CẢ giáo viên đang tính ra 0, và không có lỗi nào được ném ra.",
      lam: "Vào Công dạy tạo danh mục, hoặc bấm workflow nhập danh mục nền.",
    });
  }

  if (d.phanLoaiBuoi === 0) {
    ra.push({
      ma: "PHAN_LOAI_RONG",
      muc: "NANG",
      noi: "Chưa có phân loại buổi nào. Buổi mới không gán được phân loại.",
      lam: "Vào Phân loại buổi tạo danh mục, hoặc bấm workflow nhập danh mục nền.",
    });
  } else if (d.soPhanLoaiMacDinh !== 1) {
    // Chỉ hỏi câu này khi bảng KHÔNG rỗng — bảng rỗng thì "0 dòng mặc định" là hệ quả
    // hiển nhiên của dòng trên, báo hai lần chỉ làm loãng.
    ra.push({
      ma: "MAC_DINH_SAI",
      muc: "NANG",
      noi:
        d.soPhanLoaiMacDinh === 0
          ? "Không phân loại buổi nào được đặt làm mặc định. Buổi chưa phân loại sẽ không " +
            "rơi vào dòng nào khi tính công dạy."
          : `Có ${d.soPhanLoaiMacDinh} phân loại buổi cùng được đặt làm mặc định (chỉ được 1).`,
      lam: "Vào Phân loại buổi, đặt đúng MỘT dòng làm mặc định.",
    });
  }

  if (d.maCa === 0) {
    ra.push({
      ma: "MA_CA_RONG",
      muc: "NANG",
      noi: "Chưa có mã ca nào dùng chung. Không xếp được khung ca cho ai.",
      lam: "Vào Mã ca tạo danh mục, hoặc bấm workflow seed danh mục nền.",
    });
  }

  if (d.loaiNghi === 0) {
    ra.push({
      ma: "LOAI_NGHI_RONG",
      muc: "NANG",
      noi: "Chưa có loại nghỉ nào. Không ai nộp được đơn nghỉ.",
      lam: "Vào Loại nghỉ tạo danh mục, hoặc bấm workflow seed danh mục nền.",
    });
  }

  // ── NHẸ: thiếu dữ liệu, nhưng chưa làm sai con số nào ──────────────────────────
  const thieuDiem = d.coSoVanHanh - d.diemCham;
  if (thieuDiem > 0) {
    ra.push({
      ma: "THIEU_DIEM_CHAM",
      muc: "NHE",
      noi: `${thieuDiem} cơ sở đang hoạt động chưa có điểm chấm công.`,
      lam: "Vào Điểm chấm thêm điểm cho cơ sở còn thiếu.",
    });
  }

  return ra;
}

/** Có cảnh báo NẶNG nào không — dùng để chọn màu khối và mức log. */
export function coCanhBaoNang(ds: readonly CanhBaoDanhMuc[]): boolean {
  return ds.some((c) => c.muc === "NANG");
}
