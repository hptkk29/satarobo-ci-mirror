import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { requireActiveStudent } from "@/lib/portal/session";
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

// Phụ huynh tải học bạ của con ĐANG CHỌN (active student) — không lộ con khác.
export async function GET() {
  const { studentId } = await requireActiveStudent();

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
