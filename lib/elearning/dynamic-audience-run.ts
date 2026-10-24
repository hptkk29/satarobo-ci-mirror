import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { traTapNguoiHoc } from "@/lib/elearning/audience-query";
import { dungHangGhiDanh } from "@/lib/elearning/enrollment-rows";
import { soSanhTapDong, LY_DO_ROI_TAP, type GhiDanhHienCo } from "@/lib/elearning/dynamic-audience";
import { LoiLuatLoc } from "@/lib/elearning/assignment-rule";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import type { ScopedDb } from "@/lib/actions/factory";
import type { Actor } from "@/lib/auth/actor";

/**
 * EL-05 — CHẠY LẠI TẬP ĐỘNG MỖI ĐÊM.
 *
 * ⚠️ Đường này KHÔNG AI BẤM NÚT. Không có màn xem trước, không ai đọc thông báo
 * lúc nó chạy. Ba hệ quả bắt buộc:
 *
 * 1. Người thiếu dữ liệu Nhân sự vào hàng đợi ĐẾM ĐƯỢC, không im lặng trôi từ
 *    đêm này sang đêm khác.
 * 2. Một lượt giao hỏng không được làm chết cả lượt chạy — mỗi lượt giao xử
 *    riêng, lỗi thì ghi lại và đi tiếp.
 * 3. Cron KHÔNG ghi thay đổi quyền (luật cứng #8 của Nền Hệ thống). Ở đây nó chỉ
 *    ghi `TrnEnrollment`, không đụng vai hay grant nào.
 */

/**
 * Actor hạ tầng cho cron: cron chạy ngoài mọi phiên đăng nhập.
 *
 * `isHoLevel: true` là CỐ Ý và là điều kiện đúng đắn duy nhất ở đây: tập ĐỘNG
 * theo luật có thể trải khắp công ty, nên nếu neo cron vào một cơ sở thì người ở
 * cơ sở khác sẽ vắng mặt khỏi mọi lượt giao ĐỘNG — âm thầm, mỗi đêm.
 *
 * Đổi lại, cron KHÔNG nhận `permissions` nào và không đi qua `can()`: nó không
 * thực hiện quyền của ai cả, nó thi hành một luật đã được duyệt lúc tạo lượt giao.
 */
const ACTOR_CRON: Actor = {
  userId: "cron:elearning-dynamic-audience",
  isSuperAdmin: false,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
} as unknown as Actor;

export type KetQuaChayDem = {
  soLuotGiao: number;
  soThemMoi: number;
  soThuHoi: number;
  /** Tổng số người đang kẹt vì thiếu dữ liệu Nhân sự — con số phải theo dõi. */
  soChoDuLieuNhanSu: number;
  choDuLieuNhanSu: { fullName: string; employeeCode: string; assignmentId: string }[];
  loi: { assignmentId: string; message: string }[];
};

export async function runDynamicAudienceSync(now = new Date()): Promise<KetQuaChayDem> {
  const sdb = scopedDb(ACTOR_CRON) as ScopedDb;

  const luotGiao = await sdb.trnAssignment.findMany({
    where: { audienceMode: "DYNAMIC", status: "ACTIVE" },
    select: {
      id: true,
      contentType: true,
      contentId: true,
      dueAt: true,
      dueRelativeDays: true,
      dueAnchor: true,
      centerId: true,
      rules: { select: { filterJson: true }, orderBy: { orderIndex: "asc" } },
      includes: { select: { userId: true } },
      excludes: { select: { userId: true } },
    },
  });

  const ket: KetQuaChayDem = {
    soLuotGiao: luotGiao.length,
    soThemMoi: 0,
    soThuHoi: 0,
    soChoDuLieuNhanSu: 0,
    choDuLieuNhanSu: [],
    loi: [],
  };

  for (const lg of luotGiao) {
    try {
      const tap = await traTapNguoiHoc(sdb, {
        luat: lg.rules.map((r) => r.filterJson),
        mode: "DYNAMIC",
        now,
        themTayUserId: lg.includes.map((i) => i.userId),
        loaiTruUserId: lg.excludes.map((e) => e.userId),
      });

      const hienCo = (await sdb.trnEnrollment.findMany({
        where: { assignmentId: lg.id },
        select: { id: true, userId: true, status: true },
      })) as GhiDanhHienCo[];

      const viec = soSanhTapDong({
        nhan: tap.nhan,
        thieuCoSo: tap.thieuCoSo,
        thieuTaiKhoan: tap.thieuTaiKhoan,
        hienCo,
      });

      const courseIds = await noNoiDung(sdb, lg.contentType, lg.contentId);
      const { rows } = dungHangGhiDanh({
        nguoi: viec.themMoi,
        courseIds,
        assignmentId: lg.id,
        han: {
          dueAt: lg.dueAt,
          dueRelativeDays: lg.dueRelativeDays,
          dueAnchor: lg.dueAnchor,
        },
        now,
        managerUserIdTheoEmployeeId: await traTaiKhoanQuanLy(sdb, viec.themMoi),
      });

      // Cùng luật với đường tạo tay: cơ sở không suy được đơn vị thì LOẠI dòng
      // đó, không lấy đơn vị khác điền đại — `orgUnitId` quyết định ai nhìn thấy.
      const orgTheoCenter = new Map<string, string>();
      for (const cid of new Set(rows.map((r) => r.centerId))) {
        const ou = await orgUnitIdForCenter(cid);
        if (ou) orgTheoCenter.set(cid, ou);
      }
      const dungDon = rows.filter((r) => orgTheoCenter.has(r.centerId));

      await db.$transaction(async (tx) => {
        if (dungDon.length) {
          await tx.trnEnrollment.createMany({
            data: dungDon.map((r) => ({ ...r, orgUnitId: orgTheoCenter.get(r.centerId)! })),
            skipDuplicates: true,
          });
        }
        if (viec.thuHoiId.length) {
          await tx.trnEnrollment.updateMany({
            where: { id: { in: viec.thuHoiId } },
            data: { status: "REVOKED", revokedAt: now, revokeReason: LY_DO_ROI_TAP },
          });
        }
      });

      ket.soThemMoi += dungDon.length;
      ket.soThuHoi += viec.thuHoiId.length;
      for (const n of viec.choDuLieuNhanSu) {
        ket.choDuLieuNhanSu.push({
          fullName: n.fullName,
          employeeCode: n.employeeCode,
          assignmentId: lg.id,
        });
      }
    } catch (e) {
      // Một lượt giao có luật hỏng (vd chiều lọc bị gỡ nền dữ liệu) KHÔNG được
      // làm chết cả lượt chạy đêm — những lượt còn lại vẫn phải chạy.
      ket.loi.push({
        assignmentId: lg.id,
        message: e instanceof LoiLuatLoc ? `${e.code}: ${e.message}` : String(e),
      });
    }
  }

  ket.soChoDuLieuNhanSu = ket.choDuLieuNhanSu.length;
  return ket;
}

async function noNoiDung(
  sdb: ScopedDb,
  contentType: "LESSON" | "COURSE" | "PATH",
  contentId: string,
): Promise<string[]> {
  if (contentType === "COURSE") return [contentId];
  if (contentType === "LESSON") {
    const l = await sdb.trnLesson.findFirst({
      where: { id: contentId, deletedAt: null },
      select: { module: { select: { courseId: true } } },
    });
    return l ? [l.module.courseId] : [];
  }
  const ds = await sdb.trnCourse.findMany({
    where: { programId: contentId, deletedAt: null },
    select: { id: true },
  });
  return ds.map((x: { id: string }) => x.id);
}

async function traTaiKhoanQuanLy(
  sdb: ScopedDb,
  nguoi: { managerId: string | null }[],
): Promise<Record<string, string>> {
  const ids = [...new Set(nguoi.map((n) => n.managerId).filter((x): x is string => !!x))];
  if (!ids.length) return {};
  const rows = await sdb.user.findMany({
    where: { employeeId: { in: ids } },
    select: { id: true, employeeId: true },
  });
  const map: Record<string, string> = {};
  for (const r of rows as { id: string; employeeId: string | null }[]) {
    if (r.employeeId) map[r.employeeId] = r.id;
  }
  return map;
}
