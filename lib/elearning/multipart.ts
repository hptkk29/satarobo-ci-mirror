/**
 * EL-10 — PHẦN THUẦN của luồng tải nhiều phần (multipart) lên R2.
 *
 * Tách khỏi route vì đây là chỗ dễ sai mà lại không cần mạng để kiểm: đánh số
 * phần, ghép ETag theo đúng thứ tự, và hạn của link ký.
 *
 * ⚠️ Một `Complete` với các phần ghép SAI THỨ TỰ không báo lỗi ở tầng HTTP — R2
 * nhận, ghép, và trả về một tệp mp4 hỏng. Người soạn chỉ biết khi mở thử, hoặc
 * tệ hơn, khi người học mở.
 */

/** Trần của giao thức S3/R2. */
export const PART_MIN = 1;
export const PART_MAX = 10_000;
/** R2 đòi mọi phần trừ phần cuối phải ≥ 5MB. */
export const PART_MIN_BYTES = 5 * 1024 * 1024;

export type PhanDaTai = { partNumber: number; etag: string };

export type LoiMultipart =
  | "SO_PHAN_NGOAI_KHOANG"
  | "TRUNG_SO_PHAN"
  | "THIEU_PHAN"
  | "ETAG_RONG"
  | "KHONG_CO_PHAN_NAO";

export type KetQuaGhep =
  | { ok: true; parts: PhanDaTai[] }
  | { ok: false; code: LoiMultipart; message: string };

/**
 * Sắp và kiểm danh sách phần trước khi gọi `Complete`.
 *
 * ⚠️ SẮP LẠI theo `partNumber`, không tin thứ tự client gửi. Trình duyệt tải
 * song song nhiều phần nên thứ tự hoàn thành là ngẫu nhiên; gửi nguyên thứ tự đó
 * cho R2 là ghép tệp theo thứ tự tải xong.
 *
 * ⚠️ Cũng đòi các số phần LIÊN TỤC từ 1. Thiếu một phần ở giữa mà vẫn Complete
 * thì R2 ghép phần còn lại thành một tệp ngắn hơn — vẫn là mp4 hợp lệ về cấu
 * trúc, chỉ là mất một khúc giữa.
 */
export function ghepPhan(ds: PhanDaTai[]): KetQuaGhep {
  if (ds.length === 0) {
    return {
      ok: false,
      code: "KHONG_CO_PHAN_NAO",
      message: "Chưa có phần nào được tải lên.",
    };
  }

  for (const p of ds) {
    if (!Number.isInteger(p.partNumber) || p.partNumber < PART_MIN || p.partNumber > PART_MAX) {
      return {
        ok: false,
        code: "SO_PHAN_NGOAI_KHOANG",
        message: `Số thứ tự phần phải trong khoảng ${PART_MIN}–${PART_MAX}.`,
      };
    }
    if (!p.etag?.trim()) {
      return {
        ok: false,
        code: "ETAG_RONG",
        message: `Phần ${p.partNumber} thiếu mã xác nhận từ máy chủ lưu trữ.`,
      };
    }
  }

  const theoSo = new Map<number, PhanDaTai>();
  for (const p of ds) {
    if (theoSo.has(p.partNumber)) {
      return {
        ok: false,
        code: "TRUNG_SO_PHAN",
        message: `Phần ${p.partNumber} được gửi hai lần.`,
      };
    }
    theoSo.set(p.partNumber, p);
  }

  const parts = [...theoSo.values()].sort((a, b) => a.partNumber - b.partNumber);
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i]!.partNumber !== i + 1) {
      return {
        ok: false,
        code: "THIEU_PHAN",
        message: `Thiếu phần ${i + 1} — tải lại rồi thử lại.`,
      };
    }
  }

  return { ok: true, parts };
}

/**
 * Chia một tệp thành các phần.
 *
 * Trả số phần và kích thước mỗi phần. Phần cuối được phép nhỏ hơn `PART_MIN_BYTES`.
 */
export function chiaPhan(
  sizeBytes: number,
  partSize = 8 * 1024 * 1024,
): { soPhan: number; partSize: number } | { loi: "QUA_NHIEU_PHAN" } {
  const co = Math.max(partSize, PART_MIN_BYTES);
  const soPhan = Math.max(1, Math.ceil(sizeBytes / co));
  // Vượt trần 10.000 phần thì phải tăng kích thước phần, không phải cắt bớt.
  if (soPhan > PART_MAX) return { loi: "QUA_NHIEU_PHAN" };
  return { soPhan, partSize: co };
}

/**
 * Hạn của link ký cho một phần.
 *
 * ⚠️ Tính từ tham số, KHÔNG hardcode. Đường SCORM đã hardcode 3600s và bỏ qua
 * setting tương ứng — sửa được một lần thì đừng lặp lại lần hai.
 */
export function hanLinkKy(input: {
  soPhan: number;
  giaySoiPhan?: number;
  tranGiay?: number;
}): number {
  const moiPhan = input.giaySoiPhan ?? 120;
  const tran = input.tranGiay ?? 6 * 3600;
  // Người soạn tải qua mạng chậm thì cả lượt kéo dài; link hết hạn giữa chừng
  // buộc họ làm lại từ đầu — với tệp 200MB đó là một buổi chiều.
  return Math.min(tran, Math.max(600, input.soPhan * moiPhan));
}
