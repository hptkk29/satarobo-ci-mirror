import { createElement, type ReactElement } from "react";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { withFreshFonts } from "@/lib/pdf/brand";
import { CertificatePdf, type CertificateData } from "@/lib/pdf/certificate";
import { checkPermission } from "@/lib/auth/check-permission";

export const dynamic = "force-dynamic";
// PDF generation needs Node APIs (fs for font loading); pin runtime.
export const runtime = "nodejs";

function safeFilename(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/_+/g, "_");
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await checkPermission("students:view-all"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Thiếu mã chứng chỉ" }, { status: 400 });
  }

  // CourseCompletion ∉ SCOPED_MODELS → cách ly tay qua student.centerId (Loại B):
  // CM cơ sở này không xuất PDF chứng chỉ của học viên cơ sở khác.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const completion = await sdb.courseCompletion.findUnique({
    where: { certificateCode: code },
    select: {
      certificateCode: true,
      completedAt: true,
      finalGrade: true,
      student: { select: { name: true, studentCode: true, centerId: true } },
      course: { select: { name: true } },
    },
  });
  if (
    !completion ||
    !passesScope("Student", { centerId: completion.student.centerId }, actor)
  ) {
    return NextResponse.json({ error: "Không tìm thấy chứng chỉ" }, { status: 404 });
  }

  const data: CertificateData = {
    studentName: completion.student.name,
    studentCode: completion.student.studentCode,
    courseName: completion.course.name,
    certificateCode: completion.certificateCode,
    completedAt: completion.completedAt.toISOString().slice(0, 10),
    finalGrade: completion.finalGrade,
  };

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await withFreshFonts(() =>
      renderToBuffer(
        createElement(CertificatePdf, { d: data }) as unknown as ReactElement<DocumentProps>,
      ),
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Lỗi tạo PDF: ${err instanceof Error ? err.message : "Unknown"}` },
      { status: 500 },
    );
  }

  const filename = `ChungChi-${safeFilename(completion.student.name)}-${completion.certificateCode}.pdf`;
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
