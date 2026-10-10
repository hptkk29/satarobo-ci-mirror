import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { getStudentTranscript } from "@/lib/transcript/service";
import { TranscriptView } from "@/components/transcript/transcript-view";

export const metadata = { title: "Học bạ | Admin" };
export const dynamic = "force-dynamic";

export default async function AdminTranscriptPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate 10/07 (BGĐ chốt) — học bạ = hồ sơ học tập + xuất PDF: chỉ Đào tạo, QL cơ sở,
  // GV. Trước đó gác bằng `students:view-all` ⇒ HR, Kế toán, Marketing, Sale, Giáo vụ
  // đều tải được học bạ mọi HV bằng URL (menu thì gác `curriculum:view`, nên giấu).
  if (!(await checkAnyPermission(PAGE_GATES["/hoc-ba"]))) {
    redirect("/dashboard");
  }

  // Cách ly cơ sở: Student ∈ SCOPED_MODELS → scopedDb auto-inject centerId theo
  // tầm nhìn của actor. SUPER_ADMIN/HO → "ALL" (không lọc); center-level → chỉ cơ
  // sở được phép. Thay manual centerScope (chỉ phủ CENTER_MANAGER → lọt role khác).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const students = await sdb.student.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    take: 500,
    select: { id: true, name: true, studentCode: true },
  });

  const { studentId } = await searchParams;

  // Center scope guard cho transcript đang xem: findFirst qua sdb (auto-scope) →
  // null nếu HS ngoài tầm nhìn cơ sở (chống IDOR). SUPER_ADMIN/HO thấy mọi HS.
  // Bọc try/catch để lỗi tổng hợp không làm trắng trang.
  let t = null;
  if (studentId) {
    try {
      const inScope = await sdb.student.findFirst({
        where: { id: studentId, deletedAt: null },
        select: { id: true },
      });
      if (inScope) t = await getStudentTranscript(studentId);
    } catch (err) {
      console.error("[hoc-ba] transcript error:", err);
    }
  }

  return (
    <div className="space-y-5 p-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Học bạ học viên</h1>
        <p className="text-sm text-muted-foreground">Chọn học viên để xem quá trình học tổng hợp + xuất PDF.</p>
      </div>

      {/* KHÔNG đặt action tuyệt đối — submit về CHÍNH trang (đúng cả khi admin
          chạy ở host admin.satarobo.vn nơi route ở gốc /hoc-ba). */}
      <form className="flex gap-2" method="get">
        <select name="studentId" defaultValue={studentId ?? ""} className="rounded-md border border-border px-3 py-2 text-sm">
          <option value="">— Chọn học viên —</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.studentCode ? ` (${s.studentCode})` : ""}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md bg-neutral-800 px-4 py-2 text-sm font-medium text-white">
          Xem
        </button>
      </form>

      {studentId && !t ? (
        <p className="text-sm text-state-danger-ink">Không tìm thấy học viên hoặc ngoài phạm vi cơ sở.</p>
      ) : null}
      {t ? <TranscriptView t={t} pdfHref={`/api/admin/reports/transcript?studentId=${studentId}`} /> : null}
    </div>
  );
}
