/**
 * lib/nguon/the-ghi-nguon.ts — «THẺ GHI NGUỒN»: bằng chứng RUNTIME rằng người ghi giữ ĐÚNG khoá GHI nguồn TẠI cơ sở của lead (closeout 19/10/2026, lane A).
 *
 * Vì sao có thẻ, khi đã có `kiemQuyenGhiTaiCoSo` (#794):
 *   · #794 vá ĐÚNG MỘT đường (`doiNguonLead`) bằng cách nhớ gọi hàm bọc. Phép ghi `doiNguon` nhận `leadId` TRẦN + `tx` — một server action mới gọi thẳng nó mà quên cổng thì
 *     KHÔNG lỗi biên dịch, KHÔNG ca nào đỏ, và `passesScope` (nhìn thấy) + `can()` GLOBAL (đúng cho mọi cơ sở) đều "qua" ⇒ đúng lỗ `[PVG-04]` quay lại ở đường thứ hai.
 *     Đã có đường thứ hai THẬT: duyệt referral affiliate (`ghiNguonKhiDuyetReferral`) từng chỉ gác `affiliate_referrals:manage` tại cơ sở của REFERRAL, không tại cơ sở của LEAD.
 *   · Thẻ đổi «nhớ gọi» thành «KHÔNG GỌI ĐƯỢC NẾU KHÔNG CÓ»: `doiNguon` đòi một `TheGhiNguon` (kiểu có nhãn — `tsc` liệt kê mọi chỗ gọi) và KIỂM LẠI lúc chạy (WeakSet nội bộ —
 *     `as TheGhiNguon` ép kiểu không qua được), TRƯỚC phép ghi đầu tiên. Thẻ chỉ do `capTheGhiNguon` sinh ra, và nó chỉ sinh khi `coQuyenTaiCoSo(actor, khoá, centerId của LEAD)` đúng.
 *
 * Không dựng khung phân quyền thứ hai: phép kiểm vẫn là `coQuyenTaiCoSo` (một định nghĩa «giữ khoá tại cơ sở» — lưới `[PVG-W2]`); thẻ chỉ là cách BUỘC phép ấy phải chạy.
 *
 * Thẻ gắn với MỘT lead: thẻ của lead A không ghi được lead B. `userId` chỉ để truy vết (người ghi AUDIT ở hai đường gọi có thể là `nguoi` khác `actor` trong test — không ràng buộc bằng nhau).
 */
import type { Actor } from "@/lib/auth/actor";
import { coQuyenTaiCoSo } from "@/lib/auth/quyen-tai-co-so";
import { KHOA_QUYEN_DOI_NGUON } from "./doi-nguon";

/** Khoá duyệt referral affiliate — chép chuỗi ở ĐÂY một lần (lib/affiliate import ngược sẽ tạo vòng); lưới `[THE-W*]` đối chiếu với `KHOA_QUYEN_XU_LY_REFERRAL`. */
const KHOA_DUYET_REFERRAL = "affiliate_referrals:manage" as const;

/** Các khoá được phép mở thẻ ghi nguồn — BA khoá đổi nguồn (CÙNG bảng với `quyenDoiNguon`) + khoá duyệt referral affiliate. */
export const KHOA_CAP_THE_GHI_NGUON = [
  KHOA_QUYEN_DOI_NGUON.truocThuc,
  KHOA_QUYEN_DOI_NGUON.sauThuc,
  KHOA_QUYEN_DOI_NGUON.khoa,
  KHOA_DUYET_REFERRAL,
] as const;
export type KhoaGhiNguon = (typeof KHOA_CAP_THE_GHI_NGUON)[number];

declare const NHAN_THE: unique symbol;

export type TheGhiNguon = {
  readonly [NHAN_THE]: true;
  readonly leadId: string;
  /** Cơ sở của LEAD lúc cấp thẻ (không phải của referral/đề xuất): khoá được kiểm TẠI đây. */
  readonly centerId: string | null;
  readonly khoa: KhoaGhiNguon;
  readonly userId: string;
};

/** Thẻ đã cấp — `Object.freeze` + WeakSet: một đối tượng tự dựng (kể cả ép kiểu) không nằm trong tập này nên `kiemTheGhiNguon` ném. */
const DA_CAP = new WeakSet<object>();

/**
 * Cấp thẻ nếu `actor` giữ ĐÚNG `khoa` tại cơ sở của lead; ngược lại `null` (người gọi phải từ chối TRƯỚC khi ghi gì). `lead.centerId` PHẢI là cột đọc từ chính lead đang ghi —
 * đừng truyền cơ sở của đối tượng khác (referral, đề xuất…): đó chính là lỗ đang vá.
 */
export function capTheGhiNguon(actor: Actor, khoa: KhoaGhiNguon, lead: { id: string; centerId: string | null }): TheGhiNguon | null {
  if (!coQuyenTaiCoSo(actor, khoa, lead.centerId)) return null;
  const the = Object.freeze({ leadId: lead.id, centerId: lead.centerId, khoa, userId: actor.userId }) as unknown as TheGhiNguon;
  DA_CAP.add(the);
  return the;
}

/**
 * Cổng ĐỨNG TRƯỚC phép ghi đầu tiên của `doiNguon` / `ghiNguonKhiDuyetReferral`: thẻ phải do `capTheGhiNguon` cấp, đúng lead, đúng khoá cho phép.
 * Ném (không trả) — người gọi đến đây là đã quên cổng, không phải người dùng gõ sai.
 */
export function kiemTheGhiNguon(the: TheGhiNguon, ghi: { leadId: string }): void {
  if (!DA_CAP.has(the as unknown as object)) throw new Error("ghi nguồn: thiếu thẻ ghi hợp lệ (capTheGhiNguon) — không ghi gì.");
  if (the.leadId !== ghi.leadId) throw new Error("ghi nguồn: thẻ ghi cấp cho lead khác — không ghi gì.");
  if (!(KHOA_CAP_THE_GHI_NGUON as readonly string[]).includes(the.khoa)) throw new Error("ghi nguồn: thẻ ghi mang khoá không được phép — không ghi gì.");
}
