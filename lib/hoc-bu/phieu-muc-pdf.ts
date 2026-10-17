// lib/hoc-bu/phieu-muc-pdf.ts — PDF PHIẾU nhận xét MỘT BÀI của bé ở buổi dạy bù (T16b, 09/10/2026).
//
// Cùng mẫu PDF với phiếu nhận xét buổi học ở site giáo viên (`lib/pdf/session-eval.tsx`: đánh giá chung + bảng năng lực 9 tiêu chí) — người dùng
// yêu cầu nhận xét học bù là PHIẾU như bên giáo viên chứ không phải một ô chữ. Khác ở nguồn dữ liệu: phiếu nằm ở MỤC của case (`MakeupCaseStudent`),
// KHÔNG ở `StudentSessionFeedback` của buổi gốc (luật T07: đánh giá bù không đè nhận xét gốc).
//
// File này chỉ DỰNG PDF từ một mục ĐÃ ĐƯỢC ĐỌC. Hai route (admin + site giáo viên) tự kiểm quyền + phạm vi rồi mới đọc, và truyền vào đây.
// ⚠️ Câu 46: PDF chỉ mang tên học viên — không SĐT / email phụ huynh.
import "server-only";
import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeEvalNotes, normalizeEvalRatings } from "@/lib/lms/session-eval-rubric";
import { deriveSessionLabel, deriveSessionProjectName } from "@/lib/lms/session-project-name";
import { withFreshFonts } from "@/lib/pdf/brand";
import { SessionEvalPdf } from "@/lib/pdf/session-eval";

/** Cột cần đọc để dựng phiếu — dùng chung cho hai route để không lệch nhau. */
export const CHON_PHIEU_MUC = {
  id: true,
  lessonId: true,
  teacherEvaluation: true,
  evaluationRubric: true,
  evaluatedById: true,
  participant: { select: { student: { select: { name: true } } } },
  makeupNeed: { select: { class: { select: { name: true, course: { select: { name: true } } } } } },
  case: { select: { date: true } },
} satisfies Prisma.MakeupCaseStudentSelect;

export type MucPhieu = Prisma.MakeupCaseStudentGetPayload<{ select: typeof CHON_PHIEU_MUC }>;

/** Site giáo viên: chỉ mục của case MÀ NGƯỜI NÀY DẠY (đọc bằng `db` trần ở tầng lib như `docChiTietCaseV2ChoGv`; route không được import `@/lib/db`). */
export function docMucPhieuChoGv(teacherId: string, caseStudentId: string): Promise<MucPhieu | null> {
  return db.makeupCaseStudent.findFirst({ where: { id: caseStudentId, case: { teacherId } }, select: CHON_PHIEU_MUC });
}

/** Phiếu có NỘI DUNG khi có chữ hoặc đã chấm bảng năng lực (cùng luật với `ghiDanhGiaMuc`). */
export const phieuCoNoiDung = (m: Pick<MucPhieu, "teacherEvaluation" | "evaluationRubric">): boolean =>
  (m.teacherEvaluation ?? "").trim().length > 0 || (m.evaluationRubric !== null && m.evaluationRubric !== undefined);

const bo = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/_+/g, "_");

const ngayDmy = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

export async function dungPdfPhieuMuc(m: MucPhieu): Promise<NextResponse> {
  if (!phieuCoNoiDung(m)) {
    return NextResponse.json({ error: "Chưa có phiếu nhận xét — hãy lưu phiếu trước khi xuất PDF" }, { status: 404 });
  }
  const [bai, gv] = await Promise.all([
    m.lessonId ? db.lesson.findUnique({ where: { id: m.lessonId }, select: { order: true, title: true, moduleCode: true } }) : Promise.resolve(null),
    m.evaluatedById ? db.user.findUnique({ where: { id: m.evaluatedById }, select: { name: true } }) : Promise.resolve(null),
  ]);
  const ctx = bai ? { lessonOrder: bai.order, lessonTitle: bai.title, moduleCode: bai.moduleCode } : null;
  const ngay = ngayDmy(m.case.date);
  let pdf: Buffer;
  try {
    pdf = await withFreshFonts(() =>
      renderToBuffer(
        createElement(SessionEvalPdf, {
          data: {
            studentName: m.participant?.student.name ?? "Học viên",
            courseName: m.makeupNeed.class.course.name,
            className: `${m.makeupNeed.class.name} · học bù`,
            sessionTopic: (ctx && deriveSessionLabel(ctx)) || "Buổi học bù",
            dateLabel: ngay,
            projectName: ctx ? deriveSessionProjectName(ctx) : "",
            notes: normalizeEvalNotes({ overall: m.teacherEvaluation ?? "" }),
            ratings: normalizeEvalRatings(m.evaluationRubric),
            evaluatedByName: gv?.name ?? null,
            comment: null,
          },
        }) as unknown as ReactElement<DocumentProps>,
      ),
    );
  } catch (err) {
    return NextResponse.json({ error: `Lỗi tạo PDF: ${err instanceof Error ? err.message : "Unknown"}` }, { status: 500 });
  }
  const ten = `${["NhanXetHocBu", bo(m.participant?.student.name ?? "HV"), bo(m.makeupNeed.class.name), bo(ngay)].join("_")}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${ten}"`, "Cache-Control": "no-store" },
  });
}
