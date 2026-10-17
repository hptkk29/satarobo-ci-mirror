import { createElement, type ReactElement } from "react";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { getStudentTranscript } from "@/lib/transcript/service";
import { withFreshFonts } from "@/lib/pdf/brand";
import { TranscriptPdf } from "@/lib/pdf/transcript";

export const dynamic = "force-dynamic";
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
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await checkPermission("students:view-all"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const studentId = req.nextUrl.searchParams.get("studentId");
  if (!studentId) return NextResponse.json({ error: "Thiếu studentId" }, { status: 400 });

  // Cách ly cơ sở: Student ∈ SCOPED_MODELS → sdb tự inject centerId IN tầm nhìn actor
  // (thay check legacy CENTER_MANAGER × User.centerId — giờ áp cho MỌI actor không
  // cross-center, SUPER_ADMIN/HO bypass). Ngoài tầm nhìn → như không tồn tại (chống IDOR).
  const actor = await resolveActor(session.user.id);
  const ok = await scopedDb(actor).student.findFirst({
    where: { id: studentId },
    select: { id: true },
  });
  if (!ok) return NextResponse.json({ error: "Không tìm thấy học viên" }, { status: 404 });

  const t = await getStudentTranscript(studentId);
  if (!t) return NextResponse.json({ error: "Không tìm thấy học viên" }, { status: 404 });

  let pdf: Buffer;
  try {
    pdf = await withFreshFonts(() =>
      renderToBuffer(createElement(TranscriptPdf, { t }) as unknown as ReactElement<DocumentProps>),
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Lỗi tạo PDF: ${err instanceof Error ? err.message : "Unknown"}` },
      { status: 500 },
    );
  }

  const filename = `HocBa-${safeFilename(t.student.name)}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
