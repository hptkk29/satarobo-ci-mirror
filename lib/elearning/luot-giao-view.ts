import type { ScopedDb } from "@/lib/actions/factory";

/**
 * DỮ LIỆU màn CHI TIẾT MỘT LƯỢT GIAO (danh sách người nhận + trạng thái, để chọn nhiều và gia hạn/thu hồi hàng loạt).
 * Đọc qua `scopedDb` — người cấp cơ sở chỉ thấy người nhận thuộc cơ sở mình; lượt giao ngoài tầm nhìn ⇒ `null` (cùng câu "không tìm thấy").
 */

export type DongNguoiNhan = {
  id: string;
  userId: string;
  hoTen: string;
  status: string;
  tienDo: number;
  dueAt: Date | null;
  dueAtOriginal: Date | null;
  lyDoGiaHan: string | null;
};

export type ChiTietLuotGiao = {
  /** `tenKhoa`: tên khoá khi lượt giao nhắm vào MỘT khoá (`contentType = COURSE`); đích khác (bài, lộ trình) ⇒ `null` — không bịa tên. */
  luot: { id: string; title: string; status: string; isMandatory: boolean; dueAt: Date | null; tenKhoa: string | null };
  dong: DongNguoiNhan[];
  /** `true` = còn nhiều người hơn số hiển thị (trần 500, cùng trần thao tác hàng loạt). */
  biCat: boolean;
};

const TRAN = 500;

export async function napChiTietLuotGiao(db: ScopedDb, assignmentId: string): Promise<ChiTietLuotGiao | null> {
  const luot = await db.trnAssignment.findFirst({
    where: { id: assignmentId },
    select: { id: true, title: true, status: true, isMandatory: true, dueAt: true, contentType: true, contentId: true },
  });
  if (!luot) return null;
  const khoa = luot.contentType === "COURSE" ? await db.trnCourse.findFirst({ where: { id: luot.contentId }, select: { title: true } }) : null;

  const gd = await db.trnEnrollment.findMany({
    where: { assignmentId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: TRAN + 1,
    select: { id: true, userId: true, status: true, progressPercent: true, dueAt: true, dueAtOriginal: true, extensionReason: true },
  });
  const biCat = gd.length > TRAN;
  const hien = biCat ? gd.slice(0, TRAN) : gd;

  const ten = hien.length
    ? await db.user.findMany({ where: { id: { in: hien.map((g) => g.userId) } }, select: { id: true, name: true } })
    : [];
  const tenTheoId = new Map(ten.map((u) => [u.id, u.name]));

  return {
    luot: { id: luot.id, title: luot.title, status: luot.status, isMandatory: luot.isMandatory, dueAt: luot.dueAt, tenKhoa: khoa?.title ?? null },
    biCat,
    dong: hien.map((g) => ({
      id: g.id,
      userId: g.userId,
      hoTen: tenTheoId.get(g.userId) ?? "(không đọc được tên)",
      status: g.status,
      tienDo: g.progressPercent,
      dueAt: g.dueAt,
      dueAtOriginal: g.dueAtOriginal,
      lyDoGiaHan: g.extensionReason,
    })),
  };
}
