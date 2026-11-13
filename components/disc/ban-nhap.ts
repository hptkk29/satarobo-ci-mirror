/**
 * Bản nháp hành trình DISC — giữ trong sessionStorage của TAB (chết khi đóng tab), thuần và bọc try/catch.
 *
 * LUẬT (riêng tư dữ liệu trẻ em, D2):
 *  - KHÔNG bao giờ lưu SĐT, email, ô đồng ý, điểm số, và KHÔNG lưu HỌ TÊN của ai (phụ huynh lẫn bé): tên chỉ nằm trong
 *    bộ nhớ trang. Chỉ giữ thứ cần để làm tiếp bài: vai, năm sinh, bậc học, câu trả lời thô, vị trí, khoá idempotency.
 *    Khôi phục xong người dùng gõ lại tên (hai ô), câu trả lời không mất.
 *  - sessionStorage (không phải localStorage): đóng tab là hết; không sang tab khác, không sống qua phiên trình duyệt.
 *    Hạn thêm 2 giờ cho tab bỏ quên trên máy dùng chung.
 *  - Có thể ném lỗi (cửa sổ riêng tư, bị chặn) hoặc rỗng: mọi đường đọc/ghi phải sống sót.
 *  - Nháp quá hạn hoặc sai hình dạng bị bỏ, không cố "sửa". Bản v1 cũ (localStorage, CÓ tên, 14 ngày) bị xoá khi gặp.
 */
import { z } from "zod";

/** Khoá v2 (sessionStorage). v1 từng nằm ở localStorage kèm họ tên: chỉ còn để XOÁ. */
export const KHOA_BAN_NHAP = "satarobo:disc:ban-nhap:v2";
export const KHOA_BAN_NHAP_CU_V1 = "satarobo:disc:ban-nhap:v1";
export const HAN_BAN_NHAP_GIO = 2;

export type KhoLuuTru = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const BUOC = ["hoSo", "phuHuynh", "hocSinh", "hoanThanh"] as const;
export type Buoc = (typeof BUOC)[number];

const traLoiSchema = z.record(z.string().max(64), z.number().finite());

export const banNhapSchema = z.object({
  v: z.literal(2),
  luuLuc: z.number(),
  buoc: z.enum(BUOC),
  idempotencyKey: z.string().min(16).max(128),
  hoSo: z.object({
    phuHuynh: z.object({ vaiTro: z.string().max(20), namSinh: z.string().max(4) }),
    hocSinh: z.object({ namSinh: z.string().max(4), bacHoc: z.string().max(4) }),
    xacNhanLech: z.boolean(),
  }),
  /** Mã hai bộ đề mà câu trả lời thuộc về (không phải PII) — để giữ câu trả lời khi người dùng gõ lại tên. */
  bo: z.object({ PH: z.string().max(64), HS: z.string().max(64) }).optional(),
  traLoi: z.object({ PH: traLoiSchema, HS: traLoiSchema }),
  cau: z.object({ PH: z.number().int().min(0), HS: z.number().int().min(0) }),
});
export type BanNhap = z.infer<typeof banNhapSchema>;

export function khoMacDinh(): KhoLuuTru | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function docBanNhap(kho: KhoLuuTru | null, now: number): BanNhap | null {
  if (!kho) return null;
  try {
    const tho = kho.getItem(KHOA_BAN_NHAP);
    if (!tho) return null;
    const p = banNhapSchema.safeParse(JSON.parse(tho));
    if (!p.success) return null;
    if (now - p.data.luuLuc > HAN_BAN_NHAP_GIO * 3_600_000) return null;
    return p.data;
  } catch {
    return null;
  }
}

/** Trả true khi ghi được. Lỗi (đầy bộ nhớ, bị chặn) ⇒ false, im lặng: nháp là tiện ích, không phải điều kiện. */
export type BanNhapVao = Omit<BanNhap, "v" | "luuLuc" | "hoSo"> & {
  hoSo: {
    phuHuynh: { hoTen?: string; vaiTro: string; namSinh: string };
    hocSinh: { hoTen?: string; namSinh: string; bacHoc: string };
    xacNhanLech: boolean;
  };
};

/**
 * Trả true khi ghi được. Lỗi (đầy bộ nhớ, bị chặn) ⇒ false, im lặng.
 * Họ tên được BÓC ở đây (không tin người gọi): cho dù ai đó truyền `hoTen`, thứ rơi xuống kho không có tên.
 */
export function ghiBanNhap(kho: KhoLuuTru | null, b: BanNhapVao, now: number): boolean {
  if (!kho) return false;
  try {
    const { phuHuynh, hocSinh, xacNhanLech } = b.hoSo;
    const goi: BanNhap = {
      v: 2,
      luuLuc: now,
      buoc: b.buoc,
      idempotencyKey: b.idempotencyKey,
      hoSo: {
        phuHuynh: { vaiTro: phuHuynh.vaiTro, namSinh: phuHuynh.namSinh },
        hocSinh: { namSinh: hocSinh.namSinh, bacHoc: hocSinh.bacHoc },
        xacNhanLech,
      },
      ...(b.bo ? { bo: b.bo } : {}),
      traLoi: b.traLoi,
      cau: b.cau,
    };
    kho.setItem(KHOA_BAN_NHAP, JSON.stringify(goi));
    return true;
  } catch {
    return false;
  }
}

/** Dọn bản v1 cũ (localStorage, có họ tên). Gọi khi mount và khi xoá dữ liệu trên máy. */
export function xoaBanNhapCuV1(): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(KHOA_BAN_NHAP_CU_V1);
  } catch {
    /* bỏ qua */
  }
}

export function xoaBanNhap(kho: KhoLuuTru | null): void {
  if (!kho) return;
  try {
    kho.removeItem(KHOA_BAN_NHAP);
  } catch {
    /* bỏ qua */
  }
}
