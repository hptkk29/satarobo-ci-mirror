import "server-only";

// lib/students/prior-history.ts — "gia đình này đã từng đăng ký / học ở cơ sở nào?"
//
// Yêu cầu 21/08/2026: cho học viên nghỉ hẳn (xoá khỏi hệ thống) thì VẪN phải giữ dấu vết
// "đã từng học tại cơ sở đó"; sau này gia đình đăng ký ở CƠ SỞ KHÁC thì sale bên đó phải
// thấy hồ sơ cũ để biết khách đã từng đăng ký tại trung tâm.
//
// ⚠️ VÌ SAO PHẢI BYPASS SCOPE: `Lead` và `Student` đều ∈ SCOPED_MODELS
// (`lib/db-scope.ts:12`) nên sale CS2 đọc qua `scopedDb` sẽ KHÔNG bao giờ thấy hồ sơ CS1 —
// đó là cách ly cố ý, không phải bug. Ở đây ta cố tình đọc liên cơ sở nhưng trả về
// ĐÚNG MỘT TẦNG DỮ LIỆU TỐI THIỂU: tên cơ sở + đã từng là lead hay đã học + mốc thời gian.
// KHÔNG trả tên phụ huynh, email, ghi chú tư vấn, sale phụ trách hay bất kỳ PII nào —
// những thứ đó vẫn phải mở hồ sơ trong đúng cơ sở mới xem được. Mỗi lượt tra ghi
// `logScopeBypass` để có vết ai đã hỏi.
//
// Nguồn dấu vết (KHÔNG cần bảng mới):
//   • `Lead.phone`                — hồ sơ CRM, không bị xoá khi học viên nghỉ;
//   • `Student.parentPhone`       — kể cả bản ghi ĐÃ XOÁ MỀM (`deletedAt` ≠ null);
//   • `StudentCenterHistory`      — `deleteStudent` chốt sổ tại đây khi cho nghỉ hẳn.
import type { Actor } from "@/lib/auth/actor";
import {
  LEAD_STATUS_VI,
  STUDENT_STATUS_VI,
  type PriorHistoryRecord,
} from "@/lib/students/prior-history.summary";
import { getModelVisibleCenterIds, logScopeBypass, scopedDb } from "@/lib/db-scope";
import { expandPhoneVariants } from "@/lib/phone";

export {
  summarizePriorHistory,
  type PriorHistoryRecord,
  type PriorHistoryRole,
} from "@/lib/students/prior-history.summary";

/**
 * Tra lịch sử LIÊN CƠ SỞ theo SĐT phụ huynh.
 *
 * `excludeCenterIds` — bỏ qua các cơ sở mà người tra vốn đã nhìn thấy (thường là cơ sở của
 * chính họ), để câu thông báo chỉ nói phần họ KHÔNG tự tra được.
 */
export async function getPriorHistoryByPhone(
  actor: Actor,
  phone: string,
  opts?: { excludeCenterIds?: (string | null)[] },
): Promise<PriorHistoryRecord[]> {
  const variants = expandPhoneVariants([phone]);
  if (variants.length === 0) return [];

  // Chỉ ghi vết khi thực sự vượt tầm nhìn (SUPER_ADMIN/HO vốn thấy tất, không phải bypass).
  if (
    getModelVisibleCenterIds("Lead", actor) !== "ALL" ||
    getModelVisibleCenterIds("Student", actor) !== "ALL"
  ) {
    await logScopeBypass(
      actor,
      "students/prior-history: tra lịch sử đăng ký liên cơ sở theo SĐT",
    );
  }
  const xdb = scopedDb(actor, { bypass: true });

  const [students, leads] = await Promise.all([
    // KHÔNG lọc `deletedAt` — học viên đã cho "nghỉ hẳn" chính là ca cần tra ra.
    xdb.student.findMany({
      where: { parentPhone: { in: variants } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        status: true,
        deletedAt: true,
        enrollmentDate: true,
        createdAt: true,
        centerId: true,
        center: { select: { name: true } },
      },
    }),
    xdb.lead.findMany({
      where: { phone: { in: variants }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        status: true,
        createdAt: true,
        centerId: true,
        center: { select: { name: true } },
      },
    }),
  ]);

  const excluded = new Set(
    (opts?.excludeCenterIds ?? []).filter((c): c is string => Boolean(c)),
  );

  const out: PriorHistoryRecord[] = [];
  // Gộp theo cơ sở — một gia đình có 2 con cùng cơ sở thì kể 1 lần.
  const seen = new Set<string>();

  for (const s of students) {
    if (s.centerId && excluded.has(s.centerId)) continue;
    const key = `S:${s.centerId ?? "-"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      role: "STUDENT",
      centerName: s.center?.name ?? null,
      statusLabel: STUDENT_STATUS_VI[s.status] ?? s.status,
      at: s.enrollmentDate ?? s.createdAt,
      removed: s.deletedAt != null,
    });
  }
  for (const l of leads) {
    if (l.centerId && excluded.has(l.centerId)) continue;
    const key = `L:${l.centerId ?? "-"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      role: "LEAD",
      centerName: l.center?.name ?? null,
      statusLabel: LEAD_STATUS_VI[l.status] ?? l.status,
      at: l.createdAt,
      removed: false,
    });
  }
  return out;
}
