import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { getModelVisibleCenterIds, scopedDb } from "@/lib/db-scope";
import { getCenterOptions } from "@/lib/org/center-options";
import { listForms } from "@/lib/eval/forms";
import { listRounds } from "@/lib/eval/rounds";
import type { EvalScopeValue } from "@/lib/eval/schema";
import { FormsManager } from "./_components/forms-manager";
import { RoundsManager } from "./_components/rounds-manager";
import { PageHelp } from "@/components/admin/ui/page-help";

export const metadata = { title: "Đánh giá & Khảo sát | Admin" };
export const dynamic = "force-dynamic";

export default async function EvaluationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("evaluations:manage"))) redirect("/dashboard");

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  // Vá 24/07: bỏ isHoLevel trần → scope per-model EvaluationRound — role HO không có
  // evaluations:* scope ALL (Toại TRAINING@HO) chỉ thấy đợt CS mình + SYSTEM; role HO
  // có quyền / SUPER_ADMIN → "ALL" = null (không filter, như cũ).
  const roundScope = getModelVisibleCenterIds("EvaluationRound", actor);
  const centerScope = roundScope === "ALL" ? null : roundScope;

  const [forms, rounds, centerLookup, courses, centerOptions] =
    await Promise.all([
      listForms(),
      listRounds({ centerIds: centerScope }),
      // Bảng tra TÊN cho các đợt đã tạo — phải giữ đủ mọi cơ sở (kể cả Hội sở),
      // không dùng danh sách đã lọc kẻo đợt cũ mất tên hiển thị.
      sdb.center.findMany({
        where: { isActive: true },
        orderBy: { displayOrder: "asc" },
        select: { id: true, name: true },
      }),
      sdb.course.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      // Ô chọn cơ sở khi tạo đợt: bản cũ bày cả Hội sở, dòng mồ côi (ITLI_*) và
      // không cắt theo tầm nhìn người dùng.
      getCenterOptions(actor),
    ]);

  const centerName = new Map(centerLookup.map((c) => [c.id, c.name]));

  return (
    <div className="max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <ClipboardList className="h-6 w-6 text-primary" /> Đánh giá & Khảo sát
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Phiếu đánh giá giáo viên và khảo sát cơ sở
        </p>
      </div>

      <PageHelp>
        <p>
          Form builder (4 loại câu hỏi) cho đánh giá GV của học viên và khảo sát
          cơ sở của phụ huynh.
        </p>
      </PageHelp>

      {/* FL4-01: trang này quản lý cả 3 phạm vi — TEACHER_EVAL + CENTER_SURVEY + SESSION_EVAL
          (phiếu đánh giá buổi học, GV điền ở UI buổi học). */}
      <FormsManager
        forms={forms.map((f) => ({
          id: f.id,
          title: f.title,
          scope: f.scope as EvalScopeValue,
          status: f.status,
          questions: f._count.questions,
          rounds: f._count.rounds,
        }))}
      />

      <RoundsManager
        rounds={rounds.map((r) => ({
          id: r.id,
          name: r.name,
          scope: r.scope as EvalScopeValue,
          status: r.status,
          formTitle: r.form.title,
          centerName: r.centerId ? (centerName.get(r.centerId) ?? null) : null,
          responses: r._count.responses,
        }))}
        forms={forms
          .filter((f) => f.status === "ACTIVE")
          .map((f) => ({
            id: f.id,
            title: f.title,
            scope: f.scope as EvalScopeValue,
          }))}
        centers={centerOptions}
        courses={courses}
      />
    </div>
  );
}
