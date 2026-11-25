import type { ScopedDb } from "@/lib/actions/factory";
import {
  gomTheoNhom,
  gopNhomNho,
  type DongR4,
  type LuotDeGop,
} from "@/lib/elearning/report-r4";
import {
  phanTichCauHoi,
  tongHopDeThi,
  type PhanTichCau,
  type TongHopDeThi,
} from "@/lib/elearning/report-r5";

/** EL-17 — nạp dữ liệu cho R4 và R5. */

export type DuLieuR4 = {
  theoPhongBan: DongR4[];
  theoDonVi: DongR4[];
  /** Số lượt KHÔNG có ảnh chụp phòng ban — đếm được, không lặng lẽ bỏ. */
  soLuotChuaGanPhongBan: number;
  soLuotChuaGanQuanLy: number;
};

export async function napR4(db: ScopedDb, now = new Date()): Promise<DuLieuR4> {
  const ds = await db.trnEnrollment.findMany({
    select: {
      // Cần để ngưỡng ẩn danh đếm NGƯỜI (xem `DongR4.soNguoi`), không đếm lượt.
      userId: true,
      snapDepartmentId: true,
      snapOrgUnitId: true,
      snapManagerUserId: true,
      verifiedAt: true,
      dueAtOriginal: true,
      dueAt: true,
      startedAt: true,
      status: true,
      progressPercent: true,
      pausedAt: true,
      createdAt: true,
    },
    take: 2000,
  });

  const tenPhong = new Map(
    (
      await db.departmentDef.findMany({ select: { id: true, name: true } })
    ).map((d) => [d.id, d.name] as const),
  );
  const tenDonVi = new Map(
    (
      await db.orgUnit.findMany({ select: { id: true, code: true, name: true } })
    ).map((o) => [o.id, `${o.code} — ${o.name}`] as const),
  );

  const lam = (lay: (r: (typeof ds)[number]) => string | null): LuotDeGop[] =>
    ds.map((r) => ({
      userId: r.userId,
      nhomId: lay(r),
      verifiedAt: r.verifiedAt,
      dueAtOriginal: r.dueAtOriginal,
      dueAt: r.dueAt,
      startedAt: r.startedAt,
      status: r.status,
      progressPercent: r.progressPercent,
      pausedAt: r.pausedAt,
    }));

  // Mốc mặc định khi lượt chưa có `startedAt`: ngày được giao. Lấy "bây giờ" làm mốc
  // sẽ cho ra "đã trôi 0%" ⇒ ai cũng kịp nhịp, tức chỉ số luôn xanh.
  const batDauMacDinh = ds.reduce<Date>(
    (m, r) => (r.createdAt < m ? r.createdAt : m),
    now,
  );

  return {
    theoPhongBan: gopNhomNho(
      gomTheoNhom(
        lam((r) => r.snapDepartmentId),
        (id) => (id == null ? "Chưa gán phòng ban" : tenPhong.get(id) ?? id),
        now,
        batDauMacDinh,
      ),
    ),
    theoDonVi: gopNhomNho(
      gomTheoNhom(
        lam((r) => r.snapOrgUnitId),
        (id) => (id == null ? "Chưa gán đơn vị" : tenDonVi.get(id) ?? id),
        now,
        batDauMacDinh,
      ),
    ),
    soLuotChuaGanPhongBan: ds.filter((r) => r.snapDepartmentId == null).length,
    // ⚠️ Đếm riêng và HIỆN RA: kế hoạch chốt "báo cáo R4 phải có ô 'chưa gán quản lý'
    // đếm được, không được im lặng bỏ người đó khỏi mẫu số". Đo prod 20/08/2026:
    // 2/15 người chưa có `managerId`.
    soLuotChuaGanQuanLy: ds.filter((r) => r.snapManagerUserId == null).length,
  };
}

export type DuLieuR5 = {
  deThi: (TongHopDeThi & { tenDe: string })[];
  cauHoi: (PhanTichCau & { noiDung: string })[];
};

export async function napR5(db: ScopedDb): Promise<DuLieuR5> {
  // Chỉ lượt ĐÃ CHẤM XONG. Lượt đang làm dở không nói gì về đề thi, và đưa vào là kéo
  // mọi con số xuống theo một cách không có ý nghĩa.
  const luot = await db.trnExamAttempt.findMany({
    where: { status: "GRADED" },
    select: {
      id: true,
      userId: true,
      examId: true,
      attemptNo: true,
      totalScore: true,
      passed: true,
    },
    take: 3000,
  });

  const tenDe = new Map(
    luot.length === 0
      ? []
      : (
          await db.trnExam.findMany({
            where: { id: { in: [...new Set(luot.map((l) => l.examId))] } },
            select: { id: true, title: true },
          })
        ).map((e) => [e.id, e.title] as const),
  );

  const traLoi =
    luot.length === 0
      ? []
      : await db.trnExamAnswer.findMany({
          where: { attemptId: { in: luot.map((l) => l.id) } },
          select: { attemptId: true, examQuestionId: true, isCorrect: true },
          take: 20000,
        });

  const cau = phanTichCauHoi(traLoi);

  const noiDungCau = new Map(
    cau.length === 0
      ? []
      : (
          await db.trnExamQuestion.findMany({
            where: { id: { in: cau.map((c) => c.examQuestionId) } },
            select: { id: true, question: { select: { stem: true } } },
          })
        ).map((q) => [q.id, q.question?.stem ?? "(câu đã gỡ)"] as const),
  );

  return {
    deThi: tongHopDeThi(
      luot.map((l) => ({
        attemptId: l.id,
        userId: l.userId,
        examId: l.examId,
        attemptNo: l.attemptNo,
        totalScore: l.totalScore,
        passed: l.passed,
      })),
    ).map((t) => ({ ...t, tenDe: tenDe.get(t.examId) ?? "(đề đã gỡ)" })),
    cauHoi: cau.map((c) => ({
      ...c,
      noiDung: noiDungCau.get(c.examQuestionId) ?? "(câu đã gỡ)",
    })),
  };
}
