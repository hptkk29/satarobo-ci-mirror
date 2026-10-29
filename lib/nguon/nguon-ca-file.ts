/**
 * lib/nguon/nguon-ca-file.ts — «NGUỒN CỦA CẢ FILE» của hai đường nhập Excel (chủ dự án chốt 28/10/2026):
 *
 *   «excel: thêm ô nguồn của phải chọn tương tự ô nhập khách hàng cho toàn bộ file, bỏ nguồn ở file mẫu template đi»
 *
 * Nguyên tắc chung: đường NỘI BỘ hoặc IMPORT phải chọn nguồn TRƯỚC khi nhập. Cột «Nguồn» của file mẫu đã bỏ; một lựa chọn duy nhất (cùng ô chọn nguồn của
 * `/nhap-khach-hang`) áp cho MỌI dòng của file, đi vào quy nguồn qua luật `CHON_NGUON` (đứng ngay sau KE_THUA_SDT, trước mọi luật tự động).
 *
 * ── Máy chủ ÉP, không chỉ giao diện ──────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Ô chọn bị ẩn / bắt buộc ở màn hình là lời hứa suông nếu một request thiếu `nguonChon` vẫn lọt. Cả hai route gọi MỘT hàm này ngay sau khi đọc thân
 * request và TRƯỚC mọi truy vấn: module Nguồn BẬT ⇒ thiếu lựa chọn là từ chối cả lô (0 lead). Cùng câu hỏi «có ép không» với `quick-form-action`
 * (`epChonNguonChoMaCoSo`). Module TẮT ⇒ `{ ok: true, nguonChon: null }` — hành vi cũ y nguyên, kể cả khi client có gửi kèm một lựa chọn (bị bỏ qua).
 *
 * Hợp lệ hay không CỦA lựa chọn (nhóm còn chọn được, người tồn tại + còn làm việc, giải trình đủ dài) KHÔNG kiểm ở đây: `chuanBiQuyNguon` kiểm bằng
 * `giaiNguonChon` và trả `chanNhap` — vì lựa chọn là MỘT cho cả file nên lỗi là của cả file (xem `loiNguonCaFile`).
 */
import { nguonChonSchema } from "@/lib/validators/internal-lead";
import type { NguonChonDauVao } from "./tin-hieu";
import { epChonNguonChoMaCoSo } from "./nguon-cho-form-nhap";
import type { NguonDaChuanBi } from "./noi-day";

/** Câu từ chối khi module Nguồn BẬT mà request không mang lựa chọn. Một chỗ, để test ghim đúng câu. */
export const CAU_THIEU_NGUON_CA_FILE =
  "Nhập Excel bắt buộc chọn «Nguồn của cả file» — hãy chọn một nguồn (và người giới thiệu nếu nguồn yêu cầu) rồi nhập lại. Chưa có lead nào được ghi.";

export const CAU_NGUON_CA_FILE_SAI_DANG = "Nguồn của cả file không hợp lệ — hãy chọn lại nguồn rồi nhập lại. Chưa có lead nào được ghi.";

export type KetQuaNguonCaFile = { ok: true; nguonChon: NguonChonDauVao | null } | { ok: false; error: string };

/**
 * `raw` = giá trị khoá `nguonChon` của request (đã `JSON.parse` nếu đi qua FormData; `undefined`/`null` khi vắng).
 * Module BẬT ⇒ bắt buộc có và đúng dạng; TẮT ⇒ luôn `{ ok: true, nguonChon: null }`.
 */
export async function docVaEpNguonCaFile(raw: unknown): Promise<KetQuaNguonCaFile> {
  // `null` (không phải `maCoSo`): lựa chọn là của CẢ FILE, không thuộc cơ sở nào — cùng giá trị `loadNguonChoFormNhap` dùng cho `epMacDinh`.
  if (!(await epChonNguonChoMaCoSo(null))) return { ok: true, nguonChon: null };
  // Đường nhập «đã đăng ký» gửi multipart/form-data nên lựa chọn đến dưới dạng CHUỖI JSON; đường nhập sự kiện gửi JSON nên đến dưới dạng đối tượng.
  let tho: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") tho = null;
    else {
      try {
        tho = JSON.parse(raw);
      } catch {
        return { ok: false, error: CAU_NGUON_CA_FILE_SAI_DANG };
      }
    }
  }
  const parsed = nguonChonSchema.safeParse(tho ?? null);
  if (!parsed.success) return { ok: false, error: CAU_NGUON_CA_FILE_SAI_DANG };
  if (!parsed.data) return { ok: false, error: CAU_THIEU_NGUON_CA_FILE };
  return { ok: true, nguonChon: parsed.data };
}

/**
 * Lựa chọn chung cho cả file mà KHÔNG ghi được (nhóm đã ngừng, người đã nghỉ, giải trình ngắn…) ⇒ MỌI dòng mới cùng nhận một `chanNhap`. Trả MỘT câu cho cả lô
 * (thay vì N lỗi giống hệt từng dòng); `null` nếu lựa chọn dùng được (hoặc không có dòng mới nào để kiểm).
 *
 * «Cả lô» = MỌI dòng mới đều bị chặn. Đường gọi chỉ truyền kết quả chuẩn bị của các dòng MỚI (lead đã có không đi qua `chuanBiQuyNguon`).
 */
export function loiNguonCaFile(chuanBi: readonly NguonDaChuanBi[]): string | null {
  if (chuanBi.length === 0) return null;
  const chan = chuanBi.map((c) => (c.bat ? c.chanNhap : null));
  return chan.every((c) => c !== null) ? chan[0]! : null;
}
