// PDF học bạ (site GV): xuất học bạ ĐÃ PHÁT HÀNH (PUBLISHED) của HV thuộc lớp mình.
// Guard own-class qua actor.assignedClassIds (đọc reportCard→enrollment→classId). Tái
// dùng renderer ReportCardPdf + snapshot PUBLISHED như cổng phụ huynh (khác gate: đây
// gác theo lớp GV, không phải session PH). ⚠️ Câu 46: học bạ chỉ dữ liệu học tập HV.
import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb } from "@/lib/db-scope";
import { rosterWhere } from "@/lib/enrollment-scope";
import { getPublishedReportCardForStudent } from "@/lib/lms/report-card";
import { withFreshFonts } from "@/lib/pdf/brand";
import { ReportCardPdf } from "@/lib/pdf/report-card";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeFilename(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/_+/g, "_");
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ enrollmentId: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  const { enrollmentId } = await params;

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));
  const classIds = [...actor.assignedClassIds];

  // Own-class + studentId đọc QUA quan hệ class (enrollment dev centerId=null bị
  // scopedDb lọc nếu query thẳng). Ghi danh phải nằm trong lớp GV phụ trách.
  const clsWithEnr = classIds.length
    ? await sdb.class.findMany({
        where: { id: { in: classIds } },
        select: {
          // Guard cũ chỉ hỏi "ghi danh này có thuộc lớp mình không" — ghi danh đã gỡ
          // mềm hoặc HV đã xoá khỏi hệ thống vẫn xuất được PDF học bạ mang tên em.
          enrollments: {
            where: { id: enrollmentId, ...rosterWhere("lich-su") },
            select: { studentId: true },
          },
        },
      })
    : [];
  const studentId =
    clsWithEnr.flatMap((c) => c.enrollments)[0]?.studentId ?? null;
  if (!studentId) {
    // Hai ca rất khác nhau nhưng trước đây in CÙNG một câu, nên sự cố thiếu
    // UserOrgRole (prod 07/08) đọc ra y hệt lỗi IDOR và dev đi soi nhầm hướng:
    //   • classIds rỗng   → tài khoản chưa được phân lớp nào, HOẶC actor tự mâu
    //     thuẫn (có lớp nhưng visibleCenterIds rỗng ⇒ scopedDb lọc sạch). Xem
    //     cảnh báo "[actor] Phạm vi tự mâu thuẫn" trong log.
    //   • có lớp nhưng không khớp ghi danh → đúng nghĩa "không phải lớp của bạn".
    const noClasses = classIds.length === 0;
    return NextResponse.json(
      {
        error: noClasses
          ? "Tài khoản của bạn chưa được phân lớp nào — liên hệ quản lý cơ sở để được gán lớp."
          : "Học bạ không thuộc lớp bạn phụ trách",
        code: noClasses ? "NO_ASSIGNED_CLASS" : "NOT_YOUR_CLASS",
      },
      { status: 404 },
    );
  }

  const rc = await sdb.reportCard.findFirst({
    where: { enrollmentId },
    select: { id: true, status: true },
  });
  if (!rc || rc.status !== "PUBLISHED") {
    return NextResponse.json(
      { error: "Học bạ chưa phát hành — chỉ xuất được học bạ đã duyệt" },
      { status: 404 },
    );
  }

  const card = await getPublishedReportCardForStudent(rc.id, studentId);
  if (!card) {
    return NextResponse.json(
      { error: "Không dựng được học bạ" },
      { status: 404 },
    );
  }

  let pdf: Buffer;
  try {
    pdf = await withFreshFonts(() =>
      renderToBuffer(
        createElement(ReportCardPdf, {
          card,
        }) as unknown as ReactElement<DocumentProps>,
      ),
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: `Lỗi tạo PDF: ${err instanceof Error ? err.message : "Unknown"}`,
      },
      { status: 500 },
    );
  }

  const filename = `HocBa-${safeFilename(card.student.name)}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
