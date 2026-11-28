// lib/affiliate/cookie-gioi-thieu.ts — đọc cookie giới thiệu `sr_aff`. THUẦN (không DB) để tệp thuần như `lib/disc/crm.ts` dùng được.

/** Giá trị cookie `sr_aff` = `<token>.<epochMs>` (xem `theo-doi-cong-khai.ts`). Lấy phần token; lạ ⇒ null. */
export function tachTokenTuCookie(v: string | null | undefined): string | null {
  if (!v) return null;
  const i = v.lastIndexOf(".");
  const token = i > 0 ? v.slice(0, i) : v;
  return token.length > 0 && token.length <= 128 ? token : null;
}
