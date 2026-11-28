import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { db } from "@/lib/db";
import { resolveActor } from "@/lib/auth/actor";
import {
  actorCapabilities,
  canEditReportCardContent,
  checkEnrollmentScope,
  checkManageWriteScope,
  computeReportCardMetrics,
  getCourseCriteria,
  getEnrollmentContext,
  isReportCardEditable,
  normalizePeriodComments,
  type ReportCardStatusValue,
} from "@/lib/lms/report-card";
import { ensureMilestonePeriods } from "@/lib/lms/report-card-milestone";
import { ReportCardEditor } from "../_components/report-card-editor";

export const metadata = { title: "Nhập học bạ | Admin" };
export const dynamic = "force-dynamic";

export default async function ReportCardEditorPage({
  params,
}: {
  params: Promise<{ enrollmentId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // report-cards:* seed v2 scope GLOBAL cố ý (check ở authContext, cách ly do
  // scopedDb — ReportCard ∈ SCOPED_MODELS từ #03 Pha B 86edfbc) — không
  // truyền target (chưa chắc scope, không đoán mò).
  const canManage = await checkPermission("report-cards:manage");
  const canReview = await checkPermission("report-cards:review");
  if (!canManage && !canReview) redirect("/dashboard");

  const { enrollmentId } = await params;
  const enr = await getEnrollmentContext(enrollmentId);
  if (!enr) redirect("/report-cards");

  const actor = await resolveActor(session.user.id);
  const capabilities = actorCapabilities({ manage: canManage, review: canReview });
  const scope = checkEnrollmentScope({
    actor,
    centerId: enr.centerId,
    classId: enr.classId,
    capabilities,
    // #04 carve-out câu 20 (READ-only, CHỈ đường ĐỌC): QL cơ sở tiếp nhận xem học bạ cũ của
    // HV đã chuyển VỀ cơ sở mình. Đường GHI (_actions.ts) KHÔNG truyền → EDIT vẫn cách ly.
    receivingCenterId: enr.studentCurrentCenterId,
  });

  if (!scope.ok) {
    return (
      <div className="space-y-3 p-4">
        <Link href="/report-cards" className="text-sm text-primary">
          ← Danh sách học bạ
        </Link>
        <p className="text-sm text-state-danger-ink">{scope.error}</p>
      </div>
    );
  }

  // #17 Gap 1 (câu 55): "đạt buổi N" = lớp đã có N buổi COMPLETED (ClassSession không
  // có số thứ tự buổi). Mốc đã đạt → form luôn hiện sẵn ô nhập kỳ tương ứng.
  const [criteria, metrics, rc, completedSessions] = await Promise.all([
    getCourseCriteria(enr.courseId),
    computeReportCardMetrics(enrollmentId),
    db.reportCard.findUnique({
      where: { enrollmentId },
      select: {
        status: true,
        finalComment: true,
        completionStatus: true,
        periodComments: true,
        publishedAt: true,
        scores: { select: { criterionId: true, level: true, note: true } },
      },
    }),
    db.classSession.count({ where: { classId: enr.classId, status: "COMPLETED" } }),
  ]);

  const status = (rc?.status ?? "DRAFT") as ReportCardStatusValue;
  const scoreMap = new Map((rc?.scores ?? []).map((s) => [s.criterionId, s]));

  // FIX A4: `editable` phía UI phải TRÙNG tiêu chí của saveReportCardAction — trước đây
  // chỉ check isReportCardEditable && canManage nên user manage-only mở card RECALLED
  // (hoặc CM tiếp nhận qua carve-out câu 20 chỉ-ĐỌC) thấy form + nút Lưu, gõ xong mới bị
  // server chặn. Server đòi đủ 3 lớp:
  //  (1) checkEnrollmentScope KHÔNG carve-out (đường GHI không truyền receivingCenterId);
  //  (2) checkManageWriteScope — ghi theo cơ sở của quyền manage (vá 24/07 Gói E);
  //  (3) canEditReportCardContent — DRAFT cần 'manage', RECALLED cần 'review' (#17 Gap3).
  const writeEnrollmentScope = checkEnrollmentScope({
    actor,
    centerId: enr.centerId,
    classId: enr.classId,
    capabilities,
  });
  const writeScope = checkManageWriteScope({ actor, centerId: enr.centerId });
  const canWrite = writeEnrollmentScope.ok && writeScope.ok;
  const editable = canEditReportCardContent(status, capabilities) && canWrite;

  return (
    <div className="space-y-5 p-4">
      <div>
        <Link href={`/report-cards?classId=${enr.classId}`} className="text-sm text-primary">
          ← {enr.className}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-foreground">
          Học bạ — {enr.studentName}
          {enr.studentCode ? <span className="text-muted-foreground"> ({enr.studentCode})</span> : null}
        </h1>
        <p className="text-sm text-muted-foreground">
          {enr.courseName} · {enr.className}
        </p>
      </div>

      {criteria.length === 0 ? (
        <div className="rounded-md border border-state-warning bg-state-warning-soft px-4 py-3 text-sm text-state-warning-ink">
          Khoá học <b>{enr.courseName}</b> chưa có tiêu chí năng lực. Đào tạo cần{" "}
          <Link href="/report-cards/criteria" className="font-medium underline">
            cấu hình tiêu chí
          </Link>{" "}
          trước khi nhập học bạ.
        </div>
      ) : null}

      {/* A4: trạng thái cho-sửa nhưng user này KHÔNG đủ quyền ghi → nói rõ ngay thay vì
          để form khoá im lặng (message khớp thực tế quyền: RECALLED cần quyền duyệt KÈM
          quyền nhập tại cơ sở — review-only như Đào tạo@HO cũng chỉ duyệt, không sửa). */}
      {isReportCardEditable(status) && !editable ? (
        <div className="rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          {status === "RECALLED"
            ? "Học bạ đã phát hành và bị thu hồi — chỉ người có quyền duyệt học bạ (Quản lý cơ sở/Đào tạo) kèm quyền nhập tại cơ sở này mới sửa lại nội dung. Bạn chỉ xem."
            : "Bạn chỉ có quyền xem học bạ này — nội dung do giáo viên phụ trách lớp nhập."}
        </div>
      ) : null}

      <ReportCardEditor
        enrollmentId={enrollmentId}
        status={status}
        editable={editable}
        canManage={canManage && canWrite}
        canReview={canReview}
        publishedAt={rc?.publishedAt ? rc.publishedAt.toISOString() : null}
        metrics={metrics}
        criteria={criteria}
        finalComment={rc?.finalComment ?? ""}
        completionStatus={rc?.completionStatus ?? ""}
        periodComments={ensureMilestonePeriods(completedSessions, normalizePeriodComments(rc?.periodComments))}
        scores={criteria.map((c) => {
          const s = scoreMap.get(c.id);
          return { criterionId: c.id, level: s?.level ?? 0, note: s?.note ?? "" };
        })}
      />
    </div>
  );
}
