import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { requireActiveStudent } from "@/lib/portal/session";
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

// PH tải học bạ ĐÃ PHÁT HÀNH của con ĐANG CHỌN. Chỉ PUBLISHED + đúng chủ sở hữu.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { studentId } = await requireActiveStudent();
  const { id } = await params;

  const card = await getPublishedReportCardForStudent(id, studentId);
  if (!card) {
    return NextResponse.json({ error: "Không tìm thấy học bạ đã phát hành" }, { status: 404 });
  }

  let pdf: Buffer;
  try {
    pdf = await withFreshFonts(() =>
      renderToBuffer(createElement(ReportCardPdf, { card }) as unknown as ReactElement<DocumentProps>),
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Lỗi tạo PDF: ${err instanceof Error ? err.message : "Unknown"}` },
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
