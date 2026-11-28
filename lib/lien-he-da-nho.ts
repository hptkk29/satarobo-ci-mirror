/**
 * LIÊN HỆ CỦA NGƯỜI LỚN «NHỚ TRÊN MÁY NÀY» — dùng chung DISC · Tủ sách · Sức khoẻ (14/11/2026, chủ dự án chốt).
 *
 * Vì sao có: phụ huynh làm DISC xong sang Tủ sách/Sức khoẻ phải gõ lại họ tên · SĐT · địa chỉ. Ba nơi này chạy cho người CHƯA đăng nhập
 * nên máy chủ không biết họ là ai; chỗ duy nhất để nhớ hộ là chính trình duyệt của họ.
 *
 * LUẬT (đảo CÓ ĐIỀU KIỆN quy tắc riêng tư D2 của DISC — `components/disc/ban-nhap.ts` vẫn KHÔNG lưu tên trong bản nháp):
 *  · CHỈ ghi khi người dùng TÍCH «Nhớ trên máy này» — mặc định KHÔNG tích; bỏ tích ở lần gửi sau ⇒ xoá. Máy dùng chung thì họ không tích.
 *  · CHỈ thông tin liên hệ của NGƯỜI LỚN: họ tên · SĐT · email · tỉnh/phường · số nhà. KHÔNG BAO GIỜ: tên/năm sinh/lớp của bé, câu trả lời, điểm,
 *    số đo sức khoẻ. Hàm ghi nhận từng trường một (không nhận «cả đối tượng»), nên trường lạ có truyền vào cũng không rơi xuống kho.
 *  · Chỉ localStorage của CHÍNH trình duyệt này; không cookie, không gửi đi đâu, không vào URL/analytics (lưới `[DISC-RT-*]` canh phía DISC).
 *  · Có hạn 90 ngày (quá hạn bị xoá khi đọc); sai hình dạng bị bỏ, không cố sửa. Nút xoá ở cả ba nơi + nút «Xoá dữ liệu DISC trên máy này».
 *  · Có thể ném lỗi (cửa sổ riêng tư, bị chặn) hoặc rỗng: mọi đường đọc/ghi phải sống sót và im lặng.
 *
 * THUẦN: kho và đồng hồ được TIÊM (test không đọc đồng hồ thật — luật 19).
 */
import { z } from "zod";

export const KHOA_LIEN_HE_DA_NHO = "sata:lien-he-da-nho:v1";
export const HAN_LIEN_HE_DA_NHO_NGAY = 90;
const HAN_MS = HAN_LIEN_HE_DA_NHO_NGAY * 86_400_000;
/** Mốc ghi ở tương lai xa hơn chừng này ⇒ đồng hồ lệch/giả mạo, không tin. */
const LECH_TOI_DA_MS = 86_400_000;

export type KhoLienHe = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const chuoi = (toiDa: number) => z.string().max(toiDa);

const schema = z.object({
  v: z.literal(1),
  luuLuc: z.number().finite(),
  hoTen: chuoi(80),
  soDienThoai: chuoi(20),
  email: chuoi(254).nullable(),
  thanhPho: chuoi(80).nullable(),
  phuong: chuoi(80).nullable(),
  soNha: chuoi(160).nullable(),
});

export type LienHeDaNho = Omit<z.infer<typeof schema>, "v" | "luuLuc">;

/** Đầu vào ghi: ĐÚNG các trường của người lớn. `email`/địa chỉ tuỳ chọn (Tủ sách/Sức khoẻ không hỏi email). */
export type LienHeCanNho = {
  hoTen: string;
  soDienThoai: string;
  email?: string | null;
  thanhPho?: string | null;
  phuong?: string | null;
  soNha?: string | null;
};

export function khoLienHeMacDinh(): KhoLienHe | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const gon = (s: string | null | undefined, toiDa: number): string | null => {
  const t = (s ?? "").trim().slice(0, toiDa);
  return t ? t : null;
};

/** Đọc liên hệ đã nhớ. Quá hạn / sai hình dạng / mốc tương lai xa ⇒ null (và dọn khỏi máy). */
export function docLienHeDaNho(kho: KhoLienHe | null, now: number): LienHeDaNho | null {
  if (!kho) return null;
  try {
    const tho = kho.getItem(KHOA_LIEN_HE_DA_NHO);
    if (!tho) return null;
    const p = schema.safeParse(JSON.parse(tho));
    const hopLe = p.success && p.data.luuLuc - now <= LECH_TOI_DA_MS && now - p.data.luuLuc <= HAN_MS && p.data.hoTen.trim() !== "" && p.data.soDienThoai.trim() !== "";
    if (!p.success || !hopLe) {
      xoaLienHeDaNho(kho);
      return null;
    }
    const { v: _v, luuLuc: _l, ...ra } = p.data;
    void _v;
    void _l;
    return ra;
  } catch {
    xoaLienHeDaNho(kho);
    return null;
  }
}

/**
 * Ghi liên hệ người lớn. Trả true khi ghi được; lỗi ⇒ false, im lặng (nhớ hộ là tiện ích, không phải điều kiện).
 * Thiếu họ tên hoặc SĐT ⇒ KHÔNG ghi (nửa vời thì lần sau điền sẵn nửa vời, tệ hơn không điền).
 */
export function ghiLienHeDaNho(kho: KhoLienHe | null, c: LienHeCanNho, now: number): boolean {
  if (!kho) return false;
  const hoTen = gon(c.hoTen, 80);
  const soDienThoai = gon(c.soDienThoai, 20);
  if (!hoTen || !soDienThoai) return false;
  try {
    const goi = {
      v: 1 as const,
      luuLuc: now,
      hoTen,
      soDienThoai,
      email: gon(c.email, 254),
      thanhPho: gon(c.thanhPho, 80),
      phuong: gon(c.phuong, 80),
      soNha: gon(c.soNha, 160),
    };
    kho.setItem(KHOA_LIEN_HE_DA_NHO, JSON.stringify(goi));
    return true;
  } catch {
    return false;
  }
}

export function xoaLienHeDaNho(kho: KhoLienHe | null): void {
  if (!kho) return;
  try {
    kho.removeItem(KHOA_LIEN_HE_DA_NHO);
  } catch {
    /* bỏ qua */
  }
}
