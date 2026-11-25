// Báo Sale chủ case + Đào tạo khi đơn nghỉ / đổi ca vừa DUYỆT làm giáo viên vắng ở case trial.
//
// Chốt chủ dự án 29/09/2026 — xem `lib/trial/gv-vang-case.ts`. Gọi SAU khi duyệt đơn đã
// commit (`decideRequestAction`, lib/cham-cong/request-actions.ts), vì hàm đọc lại chính ô ca
// mà lượt duyệt vừa ghi.
//
// Không scope: đây là HỆ THỐNG đi báo, không phải người dùng đi xem — người duyệt đơn chấm
// công không có (và không cần) quyền nhìn lớp trial; cắt theo họ là không ai được báo.
//
// NON-FATAL: hỏng chuông KHÔNG được làm hỏng một lượt duyệt đơn đã thành công (người dùng sẽ
// bấm duyệt lại và nhận "đơn đã được xử lý"). `dedupeKey` theo CASE, `reopen` bật: duyệt
// thêm một đơn nữa chạm cùng case thì tin cũ được kéo về chưa đọc thay vì đẻ bản mới.

import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { layNguoiDaoTao } from "@/lib/trial/notify-training";
import { layGvVangChoCase } from "@/lib/trial/gv-vang-case-db";
import { vnYmd } from "@/lib/time/vn";

function ngayVn(d: Date): string {
  // `@db.Date` là nửa đêm UTC của ngày VN — cộng nửa ngày để `vnYmd` không lùi sang hôm trước.
  const [y, m, dd] = vnYmd(new Date(d.getTime() + 12 * 3_600_000)).split("-");
  return `${dd}/${m}/${y}`;
}

/** Trả về số case đã báo. */
export async function baoCaseTrialGvVang(p: {
  /** Giáo viên có ca vừa đổi (người nộp đơn, và người nhận ca nếu là đơn đổi ca). */
  teacherIds: string[];
  /** `@db.Date` — ngày đầu/cuối của đơn. */
  tu: Date;
  den: Date;
}): Promise<number> {
  try {
    const ids = [...new Set(p.teacherIds.filter(Boolean))];
    if (ids.length === 0) return 0;

    const cases = await db.trialClassSession.findMany({
      where: {
        teacherId: { in: ids },
        status: "SCHEDULED",
        date: { gte: p.tu, lte: p.den },
      },
      select: {
        id: true,
        date: true,
        startTime: true,
        endTime: true,
        teacherId: true,
        status: true,
        createdById: true,
        trialClass: { select: { id: true, name: true, centerId: true } },
      },
    });
    if (cases.length === 0) return 0;

    const vang = await layGvVangChoCase(db, cases);
    if (vang.size === 0) return 0;

    const trungCase = cases.filter((c) => vang.has(c.id));
    const [giaoVien, soBe] = await Promise.all([
      db.user.findMany({
        where: { id: { in: [...new Set(trungCase.map((c) => c.teacherId!))] } },
        select: { id: true, name: true },
      }),
      db.trialEnrollment.groupBy({
        by: ["scheduledSessionId"],
        where: { scheduledSessionId: { in: trungCase.map((c) => c.id) }, status: "ACTIVE" },
        _count: { _all: true },
      }),
    ]);
    const tenGv = new Map(giaoVien.map((u) => [u.id, u.name ?? "Giáo viên"]));
    const beTheoCase = new Map(soBe.map((r) => [r.scheduledSessionId, r._count._all]));

    let da = 0;
    for (const c of trungCase) {
      const kq = vang.get(c.id)!;
      const nguoiNhan = new Set(await layNguoiDaoTao(c.trialClass.centerId));
      if (c.createdById) nguoiNhan.add(c.createdById);
      if (nguoiNhan.size === 0) continue;
      const nBe = beTheoCase.get(c.id) ?? 0;
      await notifyStaff({
        userIds: [...nguoiNhan],
        dedupeKey: `trial.gv-vang:${c.id}`,
        category: "TRIAL",
        title: "Case trải nghiệm cần đổi giáo viên",
        body:
          `${tenGv.get(c.teacherId!) ?? "Giáo viên"} ${kq.loai === "NGHI" ? "nghỉ" : "đã đổi ca"} ` +
          `${ngayVn(c.date)} — case ${c.startTime}–${c.endTime} lớp ${c.trialClass.name}` +
          `${nBe > 0 ? ` có ${nBe} bé` : ""}. Cần đổi giáo viên.`,
        href: `/lop-trial/${c.trialClass.id}`,
        entityId: c.id,
        reopen: true,
      });
      da += 1;
    }
    return da;
  } catch (e) {
    console.error("[trial:baoCaseTrialGvVang]", e);
    return 0;
  }
}
