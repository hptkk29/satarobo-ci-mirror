/**
 * lib/lead/child-center-options.ts — V-4 · G-01b.
 *
 * Ô "Cơ sở quan tâm" của một con (`LeadChild.interestedCenterId`) lưu **Center.id**
 * — `prisma/schema.prisma` ghi thẳng `// tham chiếu Center`, và cả hai đường ghi tự
 * động (`lib/lead/intake/ingest.ts`, `lib/lead/import-registered.ts`) đều ghi Center.id.
 *
 * Nhưng cái picker của ô đó lại nạp `getSelectableOrgUnits()` — hàm trả về đơn vị
 * trong cây tổ chức, khoá chính là `orgUnitId`. Map thẳng `({ id: o.orgUnitId })`
 * là đưa **sai loại mã** xuống DB: `OrgUnit.id` và `Center.id` là hai cuid khác
 * nhau (`OrgUnit.centerId` là FK @unique trỏ sang Center), nên giá trị lưu ra
 * không khớp Center nào ⇒ màn chi tiết tra tên cơ sở không thấy và bỏ trắng, im lặng.
 *
 * Hàm này là chỗ DUY NHẤT dịch danh sách đơn vị (đã lọc theo phạm vi của actor,
 * đã chuẩn hoá tên theo Center.name) sang option cho ô ấy. Đừng map tay ở page —
 * lệch một chỗ là hỏng câm, không lỗi, không nhật ký.
 *
 * Đơn vị không gắn Center (HO/REGION) bị loại: ô này trỏ sang bảng Center, mà
 * HO/REGION không có bản ghi Center để trỏ. Cho lọt ra là đẻ một option
 * `value=""` trùng hệt mục "— Chưa chọn —" (và trùng luật 04/08: lead không về Hội sở).
 */
import type { SelectableOrgUnit } from "@/lib/org/org-tree";

export type LeadChildCenterOption = { id: string; name: string };

/** Đơn vị chọn được → option cho ô "Cơ sở quan tâm" (value = Center.id). */
export function leadChildCenterOptions(
  units: readonly SelectableOrgUnit[],
): LeadChildCenterOption[] {
  const seen = new Set<string>();
  const out: LeadChildCenterOption[] = [];
  for (const u of units) {
    if (!u.centerId || seen.has(u.centerId)) continue;
    seen.add(u.centerId);
    out.push({ id: u.centerId, name: u.name });
  }
  return out;
}
