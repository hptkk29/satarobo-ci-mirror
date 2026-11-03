import Link from "next/link";
import { ChevronLeft, Download, FileText } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { ImportWordClient } from "./_components/import-word-client";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ examId?: string }>;
}

export default async function ImportWordPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("exams:create"))) {
    redirect("/dashboard?error=unauthorized");
  }

  const { examId } = await searchParams;
  const sdb = scopedDb(await resolveActor(session.user.id));

  const exams = await sdb.exam.findMany({
    where: { status: { in: ["DRAFT", "PUBLISHED"] } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, examCode: true },
    take: 200,
  });

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/exams"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Quay lại danh sách
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <FileText className="h-6 w-6 text-primary" />
          Import câu hỏi từ Word (.docx)
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Soạn câu hỏi theo file mẫu (field-template), kèm ảnh nhúng. Hệ thống parse →
          xem trước → sửa lỗi → xác nhận. Câu nhập vào ở trạng thái{" "}
          <strong>nháp (chưa public)</strong>; chỉ Đào tạo/Admin publish.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-state-warning-soft bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
        <a
          href="/templates/mau-de-thi-word-v2.docx"
          download
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-semibold text-white hover:opacity-90"
        >
          <Download className="h-4 w-4" />
          Tải file mẫu (.docx)
        </a>
        <span>
          <strong>KHÔNG đổi tên field</strong> trong mẫu (QUESTION_CODE, QUESTION_TYPE,
          QUESTION_TEXT, OPTION_A..D, CORRECT_ANSWER, SCORE...). Cấu trúc field bị khoá
          để đồng bộ với skill AI sinh đề.
        </span>
      </div>

      <ImportWordClient exams={exams} defaultExamId={examId ?? ""} />
    </div>
  );
}
