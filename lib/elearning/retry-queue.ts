import { scopedDb } from "@/lib/db-scope";
import type { ScopedDb } from "@/lib/actions/factory";
import type { Actor } from "@/lib/auth/actor";
import { cacLuatToWhere } from "@/lib/elearning/assignment-rule";
import { chonThuLaiChoDuLieu } from "@/lib/elearning/dem-quyet-dinh";
import { dungHangGhiDanh } from "@/lib/elearning/enrollment-rows";
import { orgUnitIdForCenter } from "@/lib/org/org-service";

/**
 * EL-06 việc (5) — THỬ LẠI HÀNG ĐỢI "CHỜ DỮ LIỆU NHÂN SỰ".
 *
 * Người từng bị bỏ qua vì thiếu `centerId` (QĐ-CDA-10) nay đã có thì tạo lượt
 * ghi danh; chưa có thì **đếm và nêu tên**, không im lặng bỏ qua vô thời hạn.
 *
 * ⚠️ Hàng đợi này KHÔNG có bảng riêng, và đó là lựa chọn có chủ đích: một bảng
 * hàng đợi phải tự đồng bộ với luật lọc mỗi khi luật đổi, và khi lệch thì nó im
 * lặng lệch. Ở đây hàng đợi được TÁI DỰNG mỗi đêm từ chính luật của lượt giao —
 * luôn khớp theo định nghĩa.
 *
 * ⚠️ Cái giá của lựa chọn đó là điều kiện `existedAt <= assignmentCreatedAt` cho
 * lượt giao TĨNH (xem `chonThuLaiChoDuLieu`): không có nó thì chạy lại luật thô
 * mỗi đêm sẽ kéo người mới vào làm vào một lượt giao đã chốt.
 */

const ACTOR_CRON: Actor = {
  userId: "cron:elearning-dem",
  isSuperAdmin: false,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
} as unknown as Actor;

export type KetQuaThuLai = {
  taoMoi: number;
  vanKet: number;
  /** Nêu TÊN, không chỉ con số — Nhân sự cần biết vá cho ai. */
  nguoiVanKet: string[];
};

export async function thuLaiHangDoiNhanSu(now: Date): Promise<KetQuaThuLai> {
  const sdb = scopedDb(ACTOR_CRON) as ScopedDb;
  const ket: KetQuaThuLai = { taoMoi: 0, vanKet: 0, nguoiVanKet: [] };

  const luotGiao = await sdb.trnAssignment.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      contentType: true,
      contentId: true,
      audienceMode: true,
      createdAt: true,
      dueAt: true,
      dueRelativeDays: true,
      dueAnchor: true,
      rules: { select: { filterJson: true }, orderBy: { orderIndex: "asc" } },
      includes: { select: { userId: true } },
      excludes: { select: { userId: true } },
    },
  });

  const daKe = new Set<string>();

  for (const lg of luotGiao) {
    try {
      const loaiTru = new Set(lg.excludes.map((e) => e.userId));
      const themDichDanh = new Set(lg.includes.map((i) => i.userId));

      // Ứng viên = người khớp luật ∪ người thêm đích danh. Lấy CẢ người thiếu
      // `centerId` — đó chính là nhóm cần đếm.
      const where = lg.rules.length
        ? cacLuatToWhere(
            lg.rules.map((r) => r.filterJson),
            { mode: lg.audienceMode, now },
          )
        : { id: { in: [] } };

      const [theoLuat, dichDanh] = await Promise.all([
        sdb.employee.findMany({ where, select: CHON }),
        themDichDanh.size
          ? sdb.employee.findMany({
              where: { userAccount: { id: { in: [...themDichDanh] } } },
              select: CHON,
            })
          : Promise.resolve([]),
      ]);

      const gop = new Map<string, HangEmployee>();
      for (const e of [...theoLuat, ...dichDanh] as HangEmployee[]) gop.set(e.id, e);

      const daCoGhiDanh = new Set(
        (
          (await sdb.trnEnrollment.findMany({
            where: { assignmentId: lg.id },
            select: { userId: true },
          })) as { userId: string }[]
        ).map((x) => x.userId),
      );

      const ungVien = [...gop.values()]
        .filter((e) => !(e.userAccount && loaiTru.has(e.userAccount.id)))
        .map((e) => ({
          employeeId: e.id,
          userId: e.userAccount?.id ?? null,
          employeeCode: e.employeeCode,
          fullName: e.fullName,
          jobTitle: e.jobTitle,
          centerId: e.centerId,
          orgUnitId: e.orgUnitId,
          departmentId: e.departmentId,
          managerId: e.managerId,
          joinedAt: e.joinedAt,
          // `Employee.createdAt` là mốc "đã có mặt trong hệ thống" — dùng nó chứ
          // KHÔNG dùng `joinedAt`: ngày vào làm có thể được nhập lùi về quá khứ,
          // còn ngày tạo bản ghi thì không.
          existedAt: e.createdAt,
        }));

      const { taoMoi, vanKet } = chonThuLaiChoDuLieu({
        ungVien,
        daCoGhiDanh,
        themDichDanh,
        assignmentCreatedAt: lg.createdAt,
        isStatic: lg.audienceMode === "STATIC",
      });

      for (const n of vanKet) {
        const khoa = `${n.employeeCode}`;
        if (daKe.has(khoa)) continue;
        daKe.add(khoa);
        ket.nguoiVanKet.push(`${n.fullName} (${n.employeeCode})`);
      }

      if (!taoMoi.length) continue;

      const courseIds = await noNoiDung(sdb, lg.contentType, lg.contentId);
      if (!courseIds.length) continue;

      const { rows } = dungHangGhiDanh({
        nguoi: taoMoi,
        courseIds,
        assignmentId: lg.id,
        han: {
          dueAt: lg.dueAt,
          dueRelativeDays: lg.dueRelativeDays,
          dueAnchor: lg.dueAnchor,
        },
        now,
      });

      const orgTheoCenter = new Map<string, string>();
      for (const cid of new Set(rows.map((r) => r.centerId))) {
        const ou = await orgUnitIdForCenter(cid);
        if (ou) orgTheoCenter.set(cid, ou);
      }
      const dungDon = rows.filter((r) => orgTheoCenter.has(r.centerId));
      if (!dungDon.length) continue;

      await sdb.trnEnrollment.createMany({
        data: dungDon.map((r) => ({ ...r, orgUnitId: orgTheoCenter.get(r.centerId)! })),
        skipDuplicates: true,
      });
      ket.taoMoi += dungDon.length;
    } catch {
      // Một lượt giao hỏng không làm chết cả việc (5) — bộ chạy đêm ghi lỗi ở
      // tầng trên nếu cả việc này ném.
      continue;
    }
  }

  ket.vanKet = ket.nguoiVanKet.length;
  return ket;
}

const CHON = {
  id: true,
  employeeCode: true,
  fullName: true,
  jobTitle: true,
  centerId: true,
  orgUnitId: true,
  departmentId: true,
  managerId: true,
  joinedAt: true,
  createdAt: true,
  userAccount: { select: { id: true } },
} as const;

type HangEmployee = {
  id: string;
  employeeCode: string;
  fullName: string;
  jobTitle: string;
  centerId: string | null;
  orgUnitId: string | null;
  departmentId: string | null;
  managerId: string | null;
  joinedAt: Date | null;
  createdAt: Date;
  userAccount: { id: string } | null;
};

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
