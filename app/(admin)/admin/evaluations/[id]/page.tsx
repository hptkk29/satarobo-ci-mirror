import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { getFormWithQuestions, formHasResponses, parseOptions, type QuestionType } from "@/lib/eval/forms";
import { FormEditor } from "./_edit";

export const metadata = { title: "Sửa form | Admin" };
export const dynamic = "force-dynamic";

const FORM_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Nháp",
  ACTIVE: "Đang dùng",
  ARCHIVED: "Lưu trữ",
};

export default async function FormEditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("evaluations:manage"))) redirect("/dashboard");

  const { id } = await params;
  const form = await getFormWithQuestions(id);
  if (!form) notFound();

  const locked = await formHasResponses(id);

  const initial = form.questions.map((q) => ({
    type: q.type as QuestionType,
    label: q.label,
    options: parseOptions(q.options),
    required: q.required,
    groupLabel: q.groupLabel ?? "",
    allowCustomText: q.allowCustomText,
  }));

  return (
    <div className="max-w-3xl space-y-4 p-6">
      <Link href="/evaluations" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Về danh sách
      </Link>
      <div>
        <h1 className="text-xl font-bold text-foreground">{form.title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {form.scope === "TEACHER_EVAL"
            ? "Đánh giá GV (học viên)"
            : form.scope === "CENTER_SURVEY"
              ? "Khảo sát cơ sở (phụ huynh)"
              : "Đánh giá buổi học (GV chấm HS)"}{" "}
          · {FORM_STATUS_LABEL[form.status] ?? form.status}
        </p>
      </div>
      <FormEditor formId={id} initial={initial} locked={locked} allowPhoto={form.scope === "SESSION_EVAL"} />
    </div>
  );
}
