import { Prisma } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";
import { formatDateVN } from "@/lib/format/date";
import { dieuKienKhaoSatMucGopY } from "@/lib/portal/gop-y-thuan";
import { getCenterSurveys } from "@/lib/portal/surveys";

import { kiemDapAnKhaoSat, type CauKhaoSat } from "../khao-sat-dap-an";
import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile } from "../xac-thuc/dich-vu";

/**
 * OD-16 (chủ dự án chốt 19/11/2026): góp ý + KHẢO SÁT THÁNG, thang 0–10, có lịch sử và trạng thái, KHÔNG ẩn danh.
 * Dùng lại model `Survey` / `SurveyQuestion` / `SurveyResponse` và loader `getCenterSurveys` của cổng phụ huynh web (chỉ khảo sát «mục góp ý» GENERAL, theo cơ sở của con) —
 * nhân sự tạo khảo sát mỗi tháng ở `/admin/khao-sat` như hiện nay; không có bảng mới, không migration.
 *
 * ⚠️ Mỗi bản ghi mang `parentUserId` do MÁY CHỦ gắn từ phiên (client không gửi được). Không có cờ/cột/tham số ẩn danh ở bất kỳ lớp nào (lưới `[KS-ANON-*]`).
 * Hạn nộp: cột `Survey.closesAt` (migration `20261204091000`, NULL = không hạn). Còn hạn ⇒ trả `han` (ISO) cho dòng «Hạn dd/mm»; QUÁ hạn ⇒ không còn trong `dangMo` và máy chủ từ chối ghi (cùng điều kiện — không tin đồng hồ máy khách).
 */
export type CauHoiDto = { id: string; nhan: string; loai: "NPS" | "RATING" | "TEXT" };
export type KhaoSatMoDto = { id: string; tieuDe: string; moTa: string | null; phut: number; han: string | null; cauHoi: CauHoiDto[] };
export type KhaoSatDaLamDto = { id: string; khaoSatId: string; tieuDe: string; ngayGui: string; diemNps: number | null; trangThai: "DA_GUI" };
export type KhaoSatDto = { dangMo: KhaoSatMoDto[]; daLam: KhaoSatDaLamDto[] };

export async function layKhaoSat(hs: MaHocVienDaKiem, now: Date = new Date()): Promise<KhaoSatDto> {
  const [{ cards }, daLam] = await Promise.all([
    getCenterSurveys(hs),
    db.surveyResponse.findMany({
      where: { studentId: hs, survey: { ...dieuKienKhaoSatMucGopY() } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, surveyId: true, npsScore: true, createdAt: true, survey: { select: { title: true } } },
    }),
  ]);
  const mo = cards.filter((c) => !c.done && c.questions.length > 0);
  const han = new Map(
    (await db.survey.findMany({ where: { id: { in: mo.map((c) => c.id) } }, select: { id: true, closesAt: true } })).map((r) => [r.id, r.closesAt] as const),
  );
  return {
    dangMo: mo
      .filter((c) => {
        const h = han.get(c.id);
        return !h || h.getTime() > now.getTime();
      })
      .map((c) => ({ id: c.id, tieuDe: c.title, moTa: c.description, phut: c.minutes, han: han.get(c.id)?.toISOString() ?? null, cauHoi: c.questions.map((q) => ({ id: q.id, nhan: q.text, loai: q.type })) })),
    daLam: daLam.map((r) => ({ id: r.id, khaoSatId: r.surveyId, tieuDe: r.survey.title, ngayGui: formatDateVN(r.createdAt), diemNps: r.npsScore, trangThai: "DA_GUI" as const })),
  };
}

export const guiKhaoSatSchema = z.object({
  dapAn: z
    .array(z.object({ questionId: z.string().min(1).max(64), value: z.union([z.number(), z.string().max(2100)]) }))
    .min(1, "Ba mẹ trả lời khảo sát giúp nhé.")
    .max(100),
});
export type GuiKhaoSatInput = z.infer<typeof guiKhaoSatSchema>;

const sai = (m: string) => new LoiApiMobile("VALIDATION", 400, m);

export async function guiKhaoSat(hs: MaHocVienDaKiem, parentUserId: string, surveyId: string, input: GuiKhaoSatInput, now: Date = new Date()): Promise<{ id: string }> {
  const sv = await db.student.findUniqueOrThrow({ where: { id: hs }, select: { centerId: true, preferredCenterId: true } });
  const centerIds = [sv.centerId, sv.preferredCenterId].filter((x): x is string => !!x);
  // KHÔNG tin surveyId từ client: khảo sát phải tồn tại, đang mở, thuộc «mục góp ý» và trong phạm vi cơ sở của con (centerId null = toàn hệ thống).
  const khaoSat = await db.survey.findFirst({
    where: {
      id: surveyId,
      isActive: true,
      ...dieuKienKhaoSatMucGopY(),
      // Hai điều kiện OR độc lập ⇒ AND: (đúng cơ sở của con) VÀ (chưa quá hạn).
      AND: [{ OR: [{ centerId: null }, ...(centerIds.length ? [{ centerId: { in: centerIds } }] : [])] }, { OR: [{ closesAt: null }, { closesAt: { gt: now } }] }],
    },
    select: { id: true, questions: { orderBy: { order: "asc" }, select: { id: true, text: true, type: true } } },
  });
  if (!khaoSat) throw new LoiApiMobile("NOT_FOUND", 404, "Khảo sát không tồn tại hoặc đã đóng.");

  const kq = kiemDapAnKhaoSat(khaoSat.questions as CauKhaoSat[], input.dapAn);
  if (!kq.ok) throw sai(kq.loi);

  const dup = await db.surveyResponse.findFirst({ where: { surveyId, studentId: hs }, select: { id: true } });
  if (dup) throw new LoiApiMobile("VALIDATION", 409, "Ba mẹ đã trả lời khảo sát này rồi.", undefined, "KHAO_SAT_DA_TRA_LOI");

  // Gắn cơ sở / lớp / giáo viên / CSKH để làm cơ sở KPI — đúng như web.
  const [enr, care] = await Promise.all([
    db.enrollment.findFirst({
      where: { studentId: hs, status: { in: ["CONFIRMED", "STUDYING", "ACTIVE"] }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { class: { select: { id: true, centerId: true, teacherId: true } } },
    }),
    db.studentCareTask.findFirst({ where: { studentId: hs, assignedToId: { not: null } }, orderBy: { createdAt: "desc" }, select: { assignedToId: true } }),
  ]);
  try {
    const r = await db.surveyResponse.create({
      data: {
        surveyId,
        studentId: hs,
        parentUserId, // do MÁY CHỦ gắn từ phiên — không nhận từ client; không có chế độ ẩn danh
        centerId: enr?.class.centerId ?? null,
        classId: enr?.class.id ?? null,
        teacherId: enr?.class.teacherId ?? null,
        csmId: care?.assignedToId ?? null,
        npsScore: kq.npsScore,
        answers: kq.answers,
      },
      select: { id: true },
    });
    return { id: r.id };
  } catch (e) {
    // Chốt chống trùng bằng UNIQUE (surveyId, studentId): double-submit (hai máy / mất mạng gửi lại) chạm P2002 ở đây.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new LoiApiMobile("VALIDATION", 409, "Ba mẹ đã trả lời khảo sát này rồi.", undefined, "KHAO_SAT_DA_TRA_LOI");
    throw e;
  }
}
