// lib/pdf/trial-eval-response.ts — Đợt C (22/08/2026).
//
// Dựng phản hồi PDF cho phiếu đánh giá trải nghiệm. Tách khỏi route handler vì
// nay có HAI cửa cùng xuất một loại phiếu: site giáo viên (người chấm) và site
// Sale (người dùng phiếu để chốt khách). Nội dung phiếu phải giống hệt nhau —
// hai bản sao là hai bản sẽ trôi khác nhau.
//
// ⚠️ File này KHÔNG kiểm quyền. Mỗi route tự gác theo cách của mình: site giáo
// viên gác own-teacher, site Sale gác theo cách ly cơ sở. Đưa quyền vào đây là
// tạo một đường vòng để lách guard.
import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { withFreshFonts } from "@/lib/pdf/brand";
import { TrialEvalPdf } from "@/lib/pdf/trial-eval";

export type TrialEvalPdfContext = {
  studentName: string;
  existing: {
    /** criterionId → điểm. Prisma trả `JsonValue`, ép ở biên vào cho gọn. */
    scores: Record<string, number>;
    totalScore: number;
    rank: string;
    generalComment: string | null;
    orientation: string | null;
    updatedAt: Date;
    evaluatedByName: string | null;
  };
  /**
   * Hậu tố chèn vào tên file, vd "-Buoi2".
   *
   * GĐ4 — một ca nay có NHIỀU phiếu (mỗi buổi một phiếu). Không có hậu tố thì hai
   * buổi tải về cùng tên và đè lên nhau trong thư mục Tải xuống. Để tuỳ chọn vì site
   * Sale in phiếu theo ca chứ không theo buổi.
   */
  filenameSuffix?: string;
};

/** Bỏ dấu + ký tự lạ để tên file tải về không vỡ trên Windows/macOS. */
function safeFilename(sName: string): string {
  return sName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/_+/g, "_");
}

export async function trialEvalPdfResponse(
  ctx: TrialEvalPdfContext,
): Promise<NextResponse> {
  const dateLabel = ctx.existing.updatedAt.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  });

  let pdf: Buffer;
  try {
    pdf = await withFreshFonts(() =>
      renderToBuffer(
        createElement(TrialEvalPdf, {
          data: {
            studentName: ctx.studentName,
            scores: ctx.existing.scores,
            totalScore: ctx.existing.totalScore,
            rank: ctx.existing.rank,
            generalComment: ctx.existing.generalComment,
            orientation: ctx.existing.orientation,
            evaluatedByName: ctx.existing.evaluatedByName,
            dateLabel,
          },
        }) as unknown as ReactElement<DocumentProps>,
      ),
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Lỗi tạo PDF: ${err instanceof Error ? err.message : "Unknown"}` },
      { status: 500 },
    );
  }

  const filename = `PhieuTrial-${safeFilename(ctx.studentName)}${
    ctx.filenameSuffix ? safeFilename(ctx.filenameSuffix) : ""
  }.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
