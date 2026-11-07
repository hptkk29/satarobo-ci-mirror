import { KICH_THUOC_ANH } from "@/components/public/pub-design/pub-anh-kich-thuoc";
import { ANH_KHOA_HOC } from "@/components/public/khoa-hoc/anh-khoa-hoc";
import { MA_ANH_RE } from "./ghi-de-thuan";
import { VI_TRI_DUNG_ANH } from "./vi-tri-dung";

/** Thứ tự hiển thị các nhóm trang: trang marketing hay sửa nhất đứng trước. Nhóm lạ (chưa khai ở đây) xếp cuối. */
export const THU_TU_NHOM_TRANG = ["Trang chủ", "Khoá học", "Về chúng tôi", "Liên hệ", "Tin tức", "Tuyển dụng", "DISC", "Đăng nhập & kích hoạt", "Chính sách", "Trang 404", "Dùng chung (đầu/cuối trang, nút nổi, popup)"] as const;

function hangNhom(n: string): number {
  const i = (THU_TU_NHOM_TRANG as readonly string[]).indexOf(n);
  return i < 0 ? THU_TU_NHOM_TRANG.length : i;
}

function sapNhom(ds: readonly string[] | undefined): readonly string[] {
  return [...(ds ?? [])].sort((a, b) => hangNhom(a) - hangNhom(b));
}

/** Một "ô ảnh" của giao diện public: ảnh mặc định nằm trong repo, admin có thể thay. */
export interface OAnh {
  id: string;
  /** Kích thước pixel của ảnh mặc định = khung hình mà trang dựng quanh ô này. */
  w: number;
  h: number;
  /** Đường dẫn ảnh mặc định (cùng đường mà `<PubAnh>` dùng khi không có ảnh thay). */
  macDinh: string;
  /** Các nhóm trang đang dùng ảnh này (xem scripts/pub/gen-vi-tri-anh.mjs). */
  nhomTrang: readonly string[];
}

/** `null` nếu mã ảnh không phải một ô của giao diện public (mã lạ KHÔNG được phép ghi đè — chặn rác vào DB). */
export function layOAnh(id: string): OAnh | null {
  if (!MA_ANH_RE.test(id)) return null;
  const k = KICH_THUOC_ANH[id];
  if (k) return { id, w: k[0], h: k[1], macDinh: `/pub/${id}.${k[2]}`, nhomTrang: sapNhom(VI_TRI_DUNG_ANH[id]) };
  const a = ANH_KHOA_HOC[id];
  if (a) return { id, w: a.w, h: a.h, macDinh: `/images/khoa-hoc/${id}.${a.ext}`, nhomTrang: sapNhom(VI_TRI_DUNG_ANH[id]) };
  return null;
}

/** Mọi ô ảnh (hợp của hai bảng kích thước), sắp theo nhóm trang đầu tiên rồi mã. */
export function moiOAnh(): OAnh[] {
  const ids = new Set<string>([...Object.keys(KICH_THUOC_ANH), ...Object.keys(ANH_KHOA_HOC)]);
  const ds: OAnh[] = [];
  for (const id of ids) {
    const o = layOAnh(id);
    if (o) ds.push(o);
  }
  return ds.sort((a, b) => hangNhom(a.nhomTrang[0] ?? "~") - hangNhom(b.nhomTrang[0] ?? "~") || a.id.localeCompare(b.id));
}
