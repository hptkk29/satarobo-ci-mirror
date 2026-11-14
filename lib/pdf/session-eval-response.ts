// lib/pdf/session-eval-response.ts — dựng phản hồi PDF phiếu nhận xét MỘT buổi của MỘT học viên.
//
// Tách khỏi route site giáo viên vì nay có HAI cửa cùng xuất một loại phiếu: site giáo viên
// (người viết phiếu) và hồ sơ học viên ở admin (QLCS / Sale lấy phiếu về gửi phụ huynh qua Zalo).
// Nội dung phiếu phải giống hệt nhau — hai bản sao là hai bản sẽ trôi khác nhau (cùng lý do
// `trial-eval-response.ts`).
//
// ⚠️ File này KHÔNG kiểm quyền và KHÔNG kiểm cách ly cơ sở. Mỗi route tự gác theo cách của mình
// (site GV: ownership buổi; admin: `session-feedback:share` + học viên/buổi nằm trong tầm nhìn
// `scopedDb`) rồi mới đọc và truyền vào đây. Đưa quyền vào đây là tạo đường vòng để lách guard.
// ⚠️ Câu 46: PDF chỉ mang tên học viên — không SĐT / email phụ huynh.
import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { Prisma } from "@prisma/client";
import type { scopedDb } from "@/lib/db-scope";
import { normalizeEvalNotes, normalizeEvalRatings } from "@/lib/lms/session-eval-rubric";
import { buildSessionNumberMap } from "@/lib/lms/session-order";
import { deriveSessionLabel, resolveDisplayProjectName } from "@/lib/lms/session-project-name";
import { withFreshFonts } from "@/lib/pdf/brand";
import { sapXepTheoBuoi } from "@/lib/pdf/sap-xep-buoi";
import { SessionEvalBundlePdf, SessionEvalPdf, type SessionEvalPdfData } from "@/lib/pdf/session-eval";

/** Cột cần đọc của BUỔI — dùng chung cho mọi route để không lệch nhau. */
export const CHON_BUOI_PHIEU = {
  id: true,
  centerId: true, // model scoped — findUnique lọc hậu kỳ theo field này
  classId: true,
  substituteTeacherId: true,
  actualTeacherId: true,
  date: true,
  topic: true,
  plan: { select: { customTitle: true, order: true } },
  lesson: { select: { order: true, title: true, moduleCode: true } },
  class: {
    select: {
      name: true,
      centerId: true,
      course: { select: { name: true } },
    },
  },
} satisfies Prisma.ClassSessionSelect;

/** Cột cần đọc của PHIẾU. `classSessionId` + `studentId` để route tra theo id phiếu biết buổi/học viên nào. */
export const CHON_PHIEU_BUOI = {
  classSessionId: true,
  studentId: true,
  projectName: true,
  notes: true,
  rubric: true,
  comment: true,
  rating: true,
  updatedAt: true,
  createdById: true,
} satisfies Prisma.StudentSessionFeedbackSelect;

export type BuoiPhieu = Prisma.ClassSessionGetPayload<{ select: typeof CHON_BUOI_PHIEU }>;
export type PhieuBuoi = Prisma.StudentSessionFeedbackGetPayload<{ select: typeof CHON_PHIEU_BUOI }>;

function safeFilename(sName: string): string {
  return sName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/_+/g, "_");
}

type Sdb = ReturnType<typeof scopedDb>;

/** Hạng "buổi thứ mấy" của MỌI buổi trong một lớp (lib/lms/session-order: hạng theo ngày). */
async function bangSoBuoiCuaLop(sdb: Sdb, classId: string): Promise<Map<string, number>> {
  return buildSessionNumberMap(
    await sdb.classSession.findMany({ where: { classId }, select: { id: true, date: true } }),
  );
}

function nhanNgay(d: Date): string {
  return d.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

/** Dựng dữ liệu MỘT trang phiếu. Thuần — số buổi và tên người viết phiếu do chỗ gọi tra sẵn. */
function dungDuLieuPhieu(ctx: {
  sess: BuoiPhieu;
  fb: PhieuBuoi;
  studentName: string;
  sessionNo: number | null;
  gvName: string | null;
}): SessionEvalPdfData {
  const { sess, fb, studentName, sessionNo, gvName } = ctx;
  // 26/08 — tên dự án in ra PDF gửi phụ huynh suy từ BUỔI, không lấy bản sao đông
  // cứng trên phiếu (xem resolveDisplayProjectName). Số buổi tính trên TOÀN BỘ buổi
  // của lớp, không phải chỉ mình buổi này.
  const nguCanh = {
    sessionNumber: sessionNo,
    planTitle: sess.plan?.customTitle,
    planOrder: sess.plan?.order,
    lessonTitle: sess.lesson?.title,
    lessonOrder: sess.lesson?.order,
    moduleCode: sess.lesson?.moduleCode,
    topic: sess.topic,
  };
  return {
    studentName,
    courseName: sess.class.course.name,
    className: sess.class.name,
    // NHÃN BUỔI cho phiếu GỬI PHỤ HUYNH. `sess.topic` thô với giáo trình Sata chính là
    // chuỗi "Buổi học"/"Buổi 10", nên bản cũ (`sess.topic ?? "Buổi học"`) in ra
    // "Buổi học: Buổi học" trên tài liệu ra ngoài — đây là bản in trên PROD, không phải
    // chuyện của UAT (QA vòng 1, BUG-008).
    sessionTopic: deriveSessionLabel(nguCanh) || "Buổi học",
    dateLabel: nhanNgay(sess.date),
    projectName: resolveDisplayProjectName(nguCanh, fb.projectName),
    notes: normalizeEvalNotes(fb.notes),
    ratings: normalizeEvalRatings(fb.rubric),
    evaluatedByName: gvName,
    comment: fb.comment,
  };
}

const loiPdf = (err: unknown) =>
  NextResponse.json(
    { error: `Lỗi tạo PDF: ${err instanceof Error ? err.message : "Unknown"}` },
    { status: 500 },
  );

function traPdf(pdf: Buffer, filename: string): NextResponse {
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function sessionEvalPdfResponse(ctx: {
  /** Client đã scope của người gọi — dùng để đếm "buổi thứ mấy" và tra tên người viết phiếu. */
  sdb: Sdb;
  sess: BuoiPhieu;
  fb: PhieuBuoi;
  studentName: string;
}): Promise<NextResponse> {
  const { sdb, sess, fb, studentName } = ctx;
  const [gv, bang] = await Promise.all([
    fb.createdById
      ? sdb.user.findUnique({ where: { id: fb.createdById }, select: { name: true } })
      : Promise.resolve(null),
    bangSoBuoiCuaLop(sdb, sess.classId),
  ]);
  const sessionNo = bang.get(sess.id) ?? null;
  const data = dungDuLieuPhieu({ sess, fb, studentName, sessionNo, gvName: gv?.name ?? null });

  let pdf: Buffer;
  try {
    pdf = await withFreshFonts(() =>
      renderToBuffer(createElement(SessionEvalPdf, { data }) as unknown as ReactElement<DocumentProps>),
    );
  } catch (err) {
    return loiPdf(err);
  }

  // Tên tệp mang đủ ngữ cảnh: phụ huynh và giáo viên đều lưu nhiều phiếu vào một thư
  // mục, `PhieuNhanXet-Dang_Cong_Tri.pdf` của 10 buổi khác nhau thì đè lên nhau.
  const filename = `${[
    "NhanXet",
    safeFilename(studentName),
    safeFilename(sess.class.name),
    sessionNo ? `Buoi${sessionNo}` : null,
    safeFilename(data.dateLabel),
  ]
    .filter(Boolean)
    .join("_")}.pdf`;
  return traPdf(pdf, filename);
}

/**
 * PDF GỘP nhiều buổi của MỘT học viên — mỗi buổi một trang, xếp theo thứ tự buổi (xem `sapXepTheoBuoi`).
 * Chỗ gọi đã gác quyền + cách ly cơ sở và đã kiểm mọi phiếu thuộc đúng học viên này.
 */
export async function sessionEvalBundlePdfResponse(ctx: {
  sdb: Sdb;
  studentName: string;
  items: { sess: BuoiPhieu; fb: PhieuBuoi }[];
}): Promise<NextResponse> {
  const { sdb, studentName, items } = ctx;
  const classIds = [...new Set(items.map((x) => x.sess.classId))];
  const gvIds = [...new Set(items.map((x) => x.fb.createdById).filter((x): x is string => !!x))];
  const [bangs, gvs] = await Promise.all([
    Promise.all(classIds.map(async (id) => [id, await bangSoBuoiCuaLop(sdb, id)] as const)),
    gvIds.length
      ? sdb.user.findMany({ where: { id: { in: gvIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const bangTheoLop = new Map(bangs);
  const tenGv = new Map(gvs.map((g) => [g.id, g.name]));

  const trang = sapXepTheoBuoi(
    items.map(({ sess, fb }) => {
      const soBuoi = bangTheoLop.get(sess.classId)?.get(sess.id) ?? null;
      return {
        lop: sess.class.name,
        soBuoi,
        ngay: sess.date.getTime(),
        data: dungDuLieuPhieu({
          sess,
          fb,
          studentName,
          sessionNo: soBuoi,
          gvName: fb.createdById ? (tenGv.get(fb.createdById) ?? null) : null,
        }),
      };
    }),
  );

  let pdf: Buffer;
  try {
    pdf = await withFreshFonts(() =>
      renderToBuffer(
        createElement(SessionEvalBundlePdf, {
          items: trang.map((t) => t.data),
          title: `Nhận xét học viên — ${studentName} — ${trang.length} buổi`,
        }) as unknown as ReactElement<DocumentProps>,
      ),
    );
  } catch (err) {
    return loiPdf(err);
  }
  const mot = trang.length === 1 ? trang[0] : null;
  const filename = `${[
    "NhanXet",
    safeFilename(studentName),
    mot ? safeFilename(mot.lop) : `${trang.length}buoi`,
    mot?.soBuoi ? `Buoi${mot.soBuoi}` : null,
  ]
    .filter(Boolean)
    .join("_")}.pdf`;
  return traPdf(pdf, filename);
}
