/**
 * lib/nguon/quyen-ghi-tai-co-so.ts — «giữ ĐÚNG khoá GHI nguồn tại cơ sở CỦA LEAD» (N9 mở rộng sang đổi nguồn lead, 19/10/2026).
 *
 * Vì sao tồn tại — `NHÌN THẤY ≠ ĐƯỢC GHI`:
 *   · `passesScope("Lead", …)` trả lời «người này nhìn thấy cơ sở của lead không» và GỘP tầm nhìn của mọi quyền `leads:` (xem + ghi).
 *   · `kiemQuyen(key, target)` = `checkPermission` → `can()` v2: quyền seed `scopeType: GLOBAL` trả TRUE cho MỌI `target.centerId` (cơ sở nằm ở NƠI NEO VAI,
 *     `centerScope`, không ở scopeType). Gọi nó với target của lead CS-B không hỏi «bạn giữ khoá này ở CS-B không».
 *   ⇒ CENTER_MANAGER@CS1 (có `leads:overwrite`) + CENTER_SALES_CSM@CS2 (chỉ thấy lead) «qua» cả hai cổng khi đổi nguồn lead CS2. Đo thật: `[PVG-04]`.
 *
 * Luật: cả CỔNG GHI (`doiNguonLead`) lẫn NÚT (`docChoGanNguon`) hỏi quyền qua MỘT hàm này — nút và cổng cùng một phép (luật 12), và quên một đầu là lệch.
 * Hàm bọc `KiemQuyen` ĐÃ có (không dựng khung phân quyền thứ hai): kết quả = `kiemQuyen(...) VÀ coQuyenTaiCoSo(...)`. Chỉ BA khoá GHI nguồn bị siết;
 * mọi khoá khác đi thẳng xuống `kiemQuyen` như cũ. Riêng `payments:view` của Sheet (khoá ĐỌC tiền) KHÔNG đi qua hàm bọc này mà bị siết ở `docChoGanNguon` bằng chính `coQuyenTaiCoSo` (closeout 19/10: lộ tổng tiền theo `can()` GLOBAL).
 */
import type { Actor } from "@/lib/auth/actor";
import { coQuyenTaiCoSo } from "@/lib/auth/quyen-tai-co-so";
import { KHOA_QUYEN_DOI_NGUON } from "./doi-nguon";

/** Hỏi quyền theo khoá + đối tượng. Đường thật: `(a, t) => checkPermission(a, t)`. Định nghĩa ở ĐÂY (không ở `doi-nguon-lead.ts`) để cắt vòng import; `doi-nguon-lead.ts` re-export. */
export type KiemQuyen = (action: string, target: { centerId: string | null; orgUnitId: string | null }) => Promise<boolean>;

/** Ba khoá GHI nguồn — CÙNG bảng với `quyenDoiNguon`, không chép chuỗi. */
const KHOA_GHI_NGUON: ReadonlySet<string> = new Set<string>([
  KHOA_QUYEN_DOI_NGUON.truocThuc,
  KHOA_QUYEN_DOI_NGUON.sauThuc,
  KHOA_QUYEN_DOI_NGUON.khoa,
]);

export function kiemQuyenGhiTaiCoSo(actor: Actor, kiemQuyen: KiemQuyen, lead: { centerId: string | null }): KiemQuyen {
  return async (action, target) => {
    if (!(await kiemQuyen(action, target))) return false;
    return KHOA_GHI_NGUON.has(action) ? coQuyenTaiCoSo(actor, action, lead.centerId) : true;
  };
}
