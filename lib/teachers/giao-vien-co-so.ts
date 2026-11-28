// lib/teachers/giao-vien-co-so.ts — "GIÁO VIÊN CỦA CƠ SỞ" cho màn Phân công buổi: ai QLCS được chọn để phân đứng lớp / trợ giảng.
//
// Vì sao không dùng `getAssignableTeachers({ centerIds })` (20/10/2026): hàm đó lọc THUẦN theo `User.centerId`. Đo prod CS2 cùng ngày:
// 4 người khớp, trong khi 4 giáo viên khác ĐANG dạy / có vai giáo viên tại CS2 mà `User.centerId` trống (Hoàng Trà My, Lê Nhật Thuận,
// Nguyễn Như Cường, Nguyễn Đức Tuấn) — QLCS không chọn được họ. Chủ dự án: "show hết các giáo viên trong cơ sở, để QLCS điều chuyển
// linh hoạt; QLCS quản lý nhiều cơ sở thì chọn được giáo viên của các cơ sở mình quản lý".
//
// Một người THUỘC cơ sở C khi (đang hoạt động · chưa xoá · là giáo viên: vai TEACHER hoặc hồ sơ GV ACTIVE) VÀ ít nhất một trong:
//   · `User.centerId = C` (cơ sở nhà);
//   · có vai giáo viên (`UserOrgRole` ACTIVE, còn hiệu lực) tại đơn vị của C;
//   · đang là GV / trợ giảng của một lớp (chưa xoá) thuộc C.
// MỘT hàm cho cả DANH SÁCH (màn) lẫn CỔNG GHI (action kiểm người được phân) — hai bản là hai chỗ để lệch: màn bày một người mà
// action từ chối, hoặc action nhận một người màn không bày (luật 12).
import { db } from "@/lib/db";

/** Mã vai (RoleDef.code) coi là giáo viên tại một đơn vị. */
const VAI_GIAO_VIEN = ["TEACHER", "TEACHING_ASSISTANT"];

export type GiaoVienCoSo = { id: string; name: string | null; coSo: string[] };

export async function docGiaoVienCuaCoSo(centerIds: readonly string[], now: Date = new Date()): Promise<GiaoVienCoSo[]> {
  const ids = [...new Set(centerIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const [ous, lop] = await Promise.all([
    db.orgUnit.findMany({ where: { centerId: { in: ids } }, select: { id: true, centerId: true } }),
    db.class.findMany({ where: { centerId: { in: ids }, deletedAt: null }, select: { centerId: true, teacherId: true, assistantId: true } }),
  ]);
  const coSoCuaOu = new Map(ous.map((o) => [o.id, o.centerId!]));
  const uor = ous.length
    ? await db.userOrgRole.findMany({
        where: {
          orgUnitId: { in: ous.map((o) => o.id) },
          status: "ACTIVE",
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          role: { code: { in: VAI_GIAO_VIEN } },
        },
        select: { userId: true, orgUnitId: true },
      })
    : [];
  const ungVien = new Map<string, Set<string>>();
  const them = (u: string | null, c: string | null | undefined) => {
    if (!u || !c) return;
    ungVien.set(u, (ungVien.get(u) ?? new Set()).add(c));
  };
  for (const r of uor) them(r.userId, coSoCuaOu.get(r.orgUnitId));
  for (const l of lop) {
    them(l.teacherId, l.centerId);
    them(l.assistantId, l.centerId);
  }
  const rows = await db.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      AND: [
        { OR: [{ roles: { has: "TEACHER" } }, { teacherProfile: { is: { status: "ACTIVE" } } }] },
        { OR: [{ centerId: { in: ids } }, { id: { in: [...ungVien.keys()] } }] },
      ],
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, centerId: true },
  });
  return rows.map((u) => {
    const s = new Set(ungVien.get(u.id) ?? []);
    if (u.centerId && ids.includes(u.centerId)) s.add(u.centerId);
    // Thứ tự cơ sở theo thứ tự đầu vào (cơ sở đang xem đứng đầu).
    return { id: u.id, name: u.name, coSo: ids.filter((c) => s.has(c)) };
  });
}

/** Cổng ghi: `userId` có phải giáo viên của ÍT NHẤT một cơ sở trong `centerIds` không. */
export async function laGiaoVienCuaCoSo(userId: string, centerIds: readonly string[]): Promise<boolean> {
  return (await docGiaoVienCuaCoSo(centerIds)).some((g) => g.id === userId);
}

/**
 * Nhóm danh sách theo cơ sở để vẽ `<optgroup>`: mỗi người hiện MỘT lần, ở cơ sở đầu tiên của họ theo thứ tự `centerIds` (cơ sở đang
 * xem trước) — người dạy hai cơ sở nằm ở nhóm cơ sở đang xem. THUẦN.
 */
export function nhomTheoCoSo<T extends { coSo: string[] }>(ds: readonly T[], centerIds: readonly string[]): { centerId: string; ds: T[] }[] {
  return centerIds
    .map((c) => ({ centerId: c, ds: ds.filter((g) => g.coSo[0] === c) }))
    .filter((n) => n.ds.length > 0);
}
