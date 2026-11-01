import { ActionError } from "@/lib/actions/factory";

/**
 * ADR-0001 phương án A — MỘT hàm chặn người quyết định trùng với người bị quyết định.
 *
 * Hành động QUYẾT ĐỊNH trên hồ sơ của một người học cụ thể (chấm, mở khoá thi, quyết cờ nghi ngờ, cấp chứng
 * nhận tay, điểm danh buổi trực tiếp, công nhận tương đương, duyệt phiếu nhu cầu) sinh ra chứng từ đào tạo và
 * chỉ số tuân thủ. Người có quyền làm việc đó cũng có thể là người học; điểm kiểm soát duy nhất là có NGƯỜI
 * THỨ HAI đứng tên.
 *
 * ⚠️ KHÔNG có nhánh miễn theo vai (kể cả SUPER_ADMIN) — đúng tinh thần `no-inline-authz`: không có "admin đi
 * qua". Hàm cố ý chỉ nhận hai id, không nhận actor, để không ai thêm được điều kiện vai vào đây.
 *
 * Gọi TRONG LÕI của từng hành động (không ở tầng giao diện) và TRƯỚC phép ghi đầu tiên. Lưới
 * `lib/elearning/self-decision.test.ts` quét các lõi đó và đòi lời gọi này.
 */
export function assertKhongTuQuyet(
  actorUserId: string,
  chuTheUserId: string,
  thongDiep: string,
  field?: string,
): void {
  if (actorUserId === chuTheUserId) {
    throw new ActionError("SELF_APPROVAL", thongDiep, field);
  }
}
