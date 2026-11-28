// lib/ai-lead/dich-vu/che-pii.ts — CHE PII của hồ sơ chờ theo quyền xem PII lead (`leads:view-pii`). HÀM THUẦN.
//
// Che Ở SERVER, trước khi dữ liệu rời `duyet.ts` — che ở JSX thì SĐT thật vẫn xuống trình duyệt qua RSC payload (cùng luật `lib/lead/pii.ts`).
// `canViewPii` là tham số BẮT BUỘC, KHÔNG mặc định: gọi mà quên truyền là `tsc` đỏ chứ không phải số điện thoại lặng lẽ lộ (luật 7).
import { maskPersonName, maskPhone } from "@/lib/lead/pii";

export function chePhone(phone: string | null | undefined, canViewPii: boolean): string | null {
  if (!phone) return null;
  return canViewPii ? phone : maskPhone(phone);
}

export function cheTenFacebook(ten: string | null | undefined, canViewPii: boolean): string | null {
  if (!ten) return null;
  return canViewPii ? ten : maskPersonName(ten);
}

/** Dạng CHE LUÔN LUÔN — dùng cho audit (nhật ký trước/sau không được là nơi SĐT thật nằm lại), bất kể người sửa có quyền xem hay không. */
export function cheChoAudit(x: { fbName?: string | null; phone?: string | null }): { fbName?: string | null; phone?: string | null } {
  return {
    ...(x.fbName !== undefined ? { fbName: cheTenFacebook(x.fbName, false) } : {}),
    ...(x.phone !== undefined ? { phone: chePhone(x.phone, false) } : {}),
  };
}
