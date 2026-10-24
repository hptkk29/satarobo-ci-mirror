import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { db } from "@/lib/db";
import type { ScopedDb } from "@/lib/actions/factory";

/**
 * F-01 — PHẠM VI báo cáo tuân thủ (R1) theo quyền xem tiến độ.
 *
 *  · `ALL`  — `elearning:progress:view-all` (Đào tạo · Nhân sự · Quản trị): đường cũ, GIỮ NGUYÊN từng byte.
 *  · `TEAM` — `elearning:progress:view-team` (Quản lý cơ sở): chỉ người thuộc cơ sở trong tầm nhìn của `actor`.
 *  · `null` — không có quyền nào.
 *
 * ⚠️ `TrnAssignment.centerId` là cơ sở của NGƯỜI TẠO lượt giao (xem `coSoCuaLuotGiao`), còn lượt học mang cơ sở của
 * NGƯỜI HỌC. Lượt giao do Hội sở tạo cho nhiều cơ sở nằm ở cơ sở Hội sở — đọc `trnAssignment` qua `scopedDb` thì quản lý
 * CS1 KHÔNG thấy nó dù có người CS1 trong đó (danh sách rỗng, xuất file 404). Nên với `TEAM`, một lượt giao hiện ra KHI VÀ
 * CHỈ KHI actor thấy ≥ 1 lượt học của nó (cách ly theo `TrnEnrollment.centerId`).
 *
 * ⚠️ PHẠM VI CƠ SỞ LÀ THAM SỐ TƯỜNG MINH, không chỉ dựa vào `scopedDb`: `scopedDb` nới thành "mọi cơ sở" khi actor có BẤT KỲ
 * `UserPermissionGrant` ALLOW nào bắt đầu bằng `elearning:` (`getModelVisibleCenterIds`). Một quản lý CS1 được cấp một grant
 * cá nhân sẽ đọc được cả công ty qua `scopedDb` — nên `TEAM` luôn tự thêm `centerId IN visibleCenterIds` vào mọi truy vấn
 * lượt học (`PhamViCoSo` BẮT BUỘC truyền — luật 7: `tsc` liệt kê chỗ gọi).
 *
 * ⚠️ Đọc `trnAssignment` KHÔNG scope ở đây là cố ý và HẸP: chỉ theo danh sách id rút ra từ lượt học ĐÃ giới hạn cơ sở, và chỉ
 * `select` id/tiêu đề/hạn — không bao giờ nhận id thô từ thanh địa chỉ (IDOR).
 */
export type PhamViBaoCao = "ALL" | "TEAM";

/** `"TAT_CA"` hoặc danh sách cơ sở. `[]` = KHÔNG cơ sở nào (không bao giờ rơi về "TAT_CA"). */
export type PhamViCoSo = "TAT_CA" | readonly string[];

export function loaiQuyenBaoCao(actor: Actor): PhamViBaoCao | null {
  if (can(actor, "elearning:progress:view-all")) return "ALL";
  if (can(actor, "elearning:progress:view-team")) return "TEAM";
  return null;
}

/** ALL ⇒ không giới hạn thêm; TEAM ⇒ đúng các cơ sở actor quản lý (fail-closed: rỗng ⇒ không thấy gì). */
export function coSoCuaPhamVi(loai: PhamViBaoCao, actor: Pick<Actor, "visibleCenterIds">): PhamViCoSo {
  return loai === "ALL" ? "TAT_CA" : [...actor.visibleCenterIds];
}

/** Mảnh `where` cho `TrnEnrollment`. */
export function locCoSoLuotHoc(coSo: PhamViCoSo): { centerId?: { in: string[] } } {
  return coSo === "TAT_CA" ? {} : { centerId: { in: [...coSo] } };
}

/** F-02 — danh sách cơ sở được liệt kê trong bộ lọc: Hội sở/Quản trị thấy tất cả, còn lại chỉ cơ sở trong tầm nhìn. */
export function whereCoSoHienThi(
  actor: Pick<Actor, "isHoLevel" | "isSuperAdmin" | "visibleCenterIds">,
): { id: { in: string[] } } | undefined {
  return actor.isHoLevel || actor.isSuperAdmin ? undefined : { id: { in: [...actor.visibleCenterIds] } };
}

export type LuotGiaoBaoCao = { id: string; title: string; dueAt: Date | null };

const TRAN_LUOT_GIAO = 100;

/** Danh sách lượt giao đang chạy mà `actor` được xem báo cáo. */
export async function docLuotGiaoTrongTamNhin(
  sdb: ScopedDb,
  loai: PhamViBaoCao,
  coSo: PhamViCoSo,
): Promise<LuotGiaoBaoCao[]> {
  if (loai === "ALL") {
    return sdb.trnAssignment.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, title: true, dueAt: true },
      orderBy: { createdAt: "desc" },
      take: TRAN_LUOT_GIAO,
    });
  }
  // Lượt giao có người trong tầm nhìn, MỚI NHẤT trước (gộp ở DB — không quét rồi cắt tuỳ ý).
  const thay = await sdb.trnEnrollment.groupBy({
    by: ["assignmentId"],
    where: { assignmentId: { not: null }, ...locCoSoLuotHoc(coSo) },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: TRAN_LUOT_GIAO * 2,
  });
  const ids = thay.map((r) => r.assignmentId).filter((x): x is string => !!x);
  if (ids.length === 0) return [];
  return db.trnAssignment.findMany({
    where: { id: { in: ids }, status: "ACTIVE" },
    select: { id: true, title: true, dueAt: true },
    orderBy: { createdAt: "desc" },
    take: TRAN_LUOT_GIAO,
  });
}

/**
 * Một lượt giao theo id (cho `?luot=` và `?assignmentId=`): `null` nếu không có HOẶC không thuộc tầm nhìn —
 * hai trường hợp không được phân biệt ra ngoài.
 */
export async function luotGiaoHienThiDuoc(
  sdb: ScopedDb,
  loai: PhamViBaoCao,
  coSo: PhamViCoSo,
  assignmentId: string,
): Promise<{ id: string; title: string } | null> {
  if (loai === "ALL") {
    return sdb.trnAssignment.findFirst({
      where: { id: assignmentId },
      select: { id: true, title: true },
    });
  }
  const thay = await sdb.trnEnrollment.findFirst({
    where: { assignmentId, ...locCoSoLuotHoc(coSo) },
    select: { id: true },
  });
  if (!thay) return null;
  return db.trnAssignment.findFirst({
    where: { id: assignmentId },
    select: { id: true, title: true },
  });
}
