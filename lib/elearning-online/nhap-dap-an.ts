import { z } from "zod";
import type { CauHoiSnapshot } from "./cham-diem";
import { chuongTrinhSchema, demNut, tachOTrong } from "./dang-cau-hoi";

/**
 * E-LEARNING ONLINE — KIỂM ĐÁP ÁN NHÁP (P0 Mobile). HÀM THUẦN. Chỉ kiểm HÌNH DẠNG + tập giá trị hợp lệ của câu trả lời theo dạng câu (và theo SNAPSHOT của lượt),
 * KHÔNG chấm đúng/sai và KHÔNG bao giờ đọc/ghi đáp án đúng. Mọi trường lạ bị từ chối: học viên không thể gửi `correct`/`key`/siêu dữ liệu chấm để lưu vào nháp.
 * Dùng cho cả 13 dạng; dạng mới thêm vào `LOAI_CAU_HOI` mà chưa có nhánh ở đây ⇒ bị từ chối (fail-closed), không rơi im lặng.
 */
export type KetQuaKiemNhap = { ok: true; value: unknown } | { ok: false; thongBao: string };

const loi = (thongBao: string): KetQuaKiemNhap => ({ ok: false, thongBao });
const laObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const ids = (ds: unknown): Set<string> => new Set(Array.isArray(ds) ? ds.filter((x): x is { id: string } => laObj(x) && typeof x.id === "string").map((x) => x.id) : []);

export const GIOI_HAN_CHU = { ngan: 1000, tuLuan: 20000, oTrong: 200, so: 40 } as const;

export function kiemDapAnNhap(q: CauHoiSnapshot, a: unknown): KetQuaKiemNhap {
  const cfg = q.cauHinh ?? {};
  switch (q.type) {
    case "SINGLE_CHOICE":
      return typeof a === "string" && ids(q.options).has(a) ? { ok: true, value: a } : loi("Lựa chọn không thuộc câu hỏi");
    case "MULTIPLE_CHOICE": {
      if (!Array.isArray(a) || a.length > 20 || a.some((x) => typeof x !== "string")) return loi("Câu chọn nhiều cần danh sách mã lựa chọn");
      const h = ids(q.options);
      if (a.some((x) => !h.has(x as string)) || new Set(a).size !== a.length) return loi("Có lựa chọn không thuộc câu hỏi hoặc bị trùng");
      return { ok: true, value: a };
    }
    case "TRUE_FALSE":
      return typeof a === "boolean" ? { ok: true, value: a } : loi("Câu Đúng/Sai cần giá trị true hoặc false");
    case "SHORT_TEXT":
      return typeof a === "string" && a.length <= GIOI_HAN_CHU.ngan ? { ok: true, value: a } : loi(`Câu trả lời ngắn tối đa ${GIOI_HAN_CHU.ngan} ký tự`);
    case "ESSAY":
      return typeof a === "string" && a.length <= GIOI_HAN_CHU.tuLuan ? { ok: true, value: a } : loi(`Bài tự luận tối đa ${GIOI_HAN_CHU.tuLuan} ký tự`);
    case "FILL_BLANK": {
      const so = tachOTrong(q.stem).length;
      if (!Array.isArray(a) || a.length !== so || a.some((x) => typeof x !== "string" || x.length > GIOI_HAN_CHU.oTrong)) return loi(`Cần đúng ${so} ô, mỗi ô tối đa ${GIOI_HAN_CHU.oTrong} ký tự`);
      return { ok: true, value: a };
    }
    case "MATCHING": {
      const trai = ids((cfg as { left?: unknown }).left), phai = ids((cfg as { right?: unknown }).right);
      if (!laObj(a) || Object.keys(a).length > 30) return loi("Câu ghép cặp cần đối tượng {mãTrái: mãPhải}");
      for (const [k, v] of Object.entries(a)) if (!trai.has(k) || typeof v !== "string" || !phai.has(v)) return loi("Có cặp không thuộc câu hỏi");
      return { ok: true, value: a };
    }
    case "ORDERING": {
      const muc = ids((cfg as { items?: unknown }).items);
      if (!Array.isArray(a) || a.length > muc.size || a.some((x) => typeof x !== "string" || !muc.has(x)) || new Set(a).size !== a.length) return loi("Thứ tự có mục không thuộc câu hỏi hoặc bị trùng");
      return { ok: true, value: a };
    }
    case "CLASSIFY": {
      const the = ids((cfg as { cards?: unknown }).cards), nhom = ids((cfg as { groups?: unknown }).groups);
      if (!laObj(a)) return loi("Câu phân loại cần đối tượng {mãThẻ: mãNhóm}");
      for (const [k, v] of Object.entries(a)) if (!the.has(k) || typeof v !== "string" || !nhom.has(v)) return loi("Có thẻ/nhóm không thuộc câu hỏi");
      return { ok: true, value: a };
    }
    case "IMAGE_HOTSPOT": {
      const rong = Number((cfg as { width?: unknown }).width), cao = Number((cfg as { height?: unknown }).height);
      const p = z.object({ x: z.number().finite(), y: z.number().finite() }).strict().safeParse(a);
      if (!p.success || p.data.x < 0 || p.data.y < 0 || p.data.x > rong || p.data.y > cao) return loi("Điểm chạm phải nằm trong ảnh");
      return { ok: true, value: p.data };
    }
    case "NUMERIC":
      if (typeof a === "number" && Number.isFinite(a)) return { ok: true, value: a };
      return typeof a === "string" && a.length <= GIOI_HAN_CHU.so ? { ok: true, value: a } : loi("Cần một số");
    case "PRODUCT":
      return typeof a === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(a) ? { ok: true, value: a } : loi("Cần mã bài nộp sản phẩm"); // mã được đối chiếu với bài nộp THẬT khi chốt lượt
    case "BLOCK_SEQUENCE": {
      const p = chuongTrinhSchema.safeParse(a);
      if (!p.success) return loi("Chương trình khối lệnh không hợp lệ");
      const toiDa = Number((cfg as { maxBlocks?: unknown }).maxBlocks);
      if (Number.isFinite(toiDa) && demNut(p.data) > toiDa) return loi(`Vượt ${toiDa} khối cho phép`);
      return { ok: true, value: p.data };
    }
    default:
      return loi("Dạng câu hỏi chưa hỗ trợ lưu nháp");
  }
}
