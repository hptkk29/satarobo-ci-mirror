// Gợi ý "cơ sở lần trước" của THANH PHẠM VI (S5b) — phần CLIENT. THUẦN, không chạm DB, không kéo module nghiệp vụ nặng.
//
// CHỈ GỢI Ý (O-5 chưa chốt: hành vi hiện hữu là luôn bắt chọn cơ sở khi có nhiều). Khoá theo userId; chỉ chứa mã cơ sở
// (không PII); lọc theo phạm vi HIỆN TẠI nên không sống sót qua đổi vai / đổi tài khoản; mọi truy cập kho đều bọc
// try/catch (cửa sổ riêng tư, thumbnail, chặn dữ liệu trang). Pháp nhân đang thao tác: xem `phap-nhan-hien-thi.ts`.

type Kho = Pick<Storage, "getItem" | "setItem">;

export const khoaGoiYCoSo = (userId: string) => `satarobo:hd:${userId}:co-so-cuoi`;

/** Cơ sở lần trước của tài khoản — CHỈ trả về khi còn nằm trong phạm vi hiện tại. Lỗi kho ⇒ null. */
export function docGoiYCoSo(kho: Kho | null, userId: string, cacCoSo: readonly { id: string }[]): string | null {
  if (!kho) return null;
  try {
    const v = kho.getItem(khoaGoiYCoSo(userId));
    return v && cacCoSo.some((c) => c.id === v) ? v : null;
  } catch {
    return null;
  }
}

export function ghiGoiYCoSo(kho: Kho | null, userId: string, coSoId: string): void {
  if (!kho) return;
  try {
    kho.setItem(khoaGoiYCoSo(userId), coSoId);
  } catch {
    /* kho bị chặn / đầy — gợi ý là tiện lợi, mất cũng không sao */
  }
}

/** `localStorage` hoặc null — truy cập chính `window.localStorage` có thể ném (SecurityError). */
export function khoTrinhDuyet(): Kho | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
