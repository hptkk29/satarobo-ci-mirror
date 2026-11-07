// lib/cham-cong/khoi-parttime.ts — HAI màn Parttime của QLCS ("Phân công buổi", "Công parttime tháng") mở KHỐI nào, và tab
// điều hướng in nhãn "Chưa bật" cho khối nào. THUẦN (chỉ đọc `ModuleScope` đã dựng) — không DB.
//
// Vì sao một hàm: trước 20/10/2026 phép chọn khối chép tay ở hai trang, còn tab thì không biết trang sẽ mở khối nào. Nhãn trên tab
// phải nói ĐÚNG thứ màn đích sẽ nói ("Chưa bật · chỉ xem" hay đang chạy) — hai bản của một phép chọn là hai chỗ để lệch (luật 12).
import type { ModuleAction, ModuleScope, ScopeBlock } from "./module-scope";

const VIEW: ModuleAction = "hr_attendance:view";
const ASSIGN: ModuleAction = "hr_attendance:assign";

export type KhoiParttime = {
  /** Các khối được bày trên thanh chọn cơ sở (ScopeBar). */
  khoi: ScopeBlock[];
  /** Khối màn đang mở. */
  block: ScopeBlock;
};

/**
 * Khối của màn Parttime. `null` = người này không xem được màn (không có VIEW / ASSIGN ở khối nào) ⇒ trang vẽ "không có quyền",
 * tab không hiện.
 *
 * Thứ tự chọn: `?coSo=` nếu thuộc danh sách khối được bày → khối ĐANG BẬT phân công đầu tiên (thí điểm một cơ sở: vào từ tab là
 * thấy cơ sở thí điểm, không phải "chưa bật" của khối đứng đầu) → khối đầu tiên. `?coSo=` không hợp lệ thì KHÔNG mở bừa khối đầu
 * danh sách — rơi về đúng thứ tự trên.
 */
export function khoiParttime(scope: ModuleScope, coSo: string | null | undefined): KhoiParttime | null {
  const xem = scope.blocksWith(VIEW);
  const khoi = xem.length > 0 ? xem : scope.blocksWith(ASSIGN);
  if (khoi.length === 0) return null;
  const block = (coSo ? khoi.find((b) => b.id === coSo) : undefined) ?? khoi.find((b) => b.parttimeStaffing) ?? khoi[0];
  return { khoi, block };
}
