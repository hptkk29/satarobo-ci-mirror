// app/(teacher)/teacher/day-thay/[sessionId]/page.tsx — chi tiết MỘT buổi dạy thay (11/10/2026).
//
// Năm tab, một buổi: Học viên · Điểm danh · Nhận xét · Bài tập · Giáo án. Mọi tab đọc/ghi CHÍNH các bảng của buổi
// (Attendance, StudentSessionFeedback, Document/ScormPackage, HomeworkAssignment) và đi qua CÙNG hàm gác với giáo viên
// chính — màn này không có kho dữ liệu riêng, nên admin và giáo viên phụ trách thấy mọi thứ người dạy thay làm.
//
// Cổng vào DUY NHẤT: `docChiTietDayThay` (null nếu không phải buổi mình dạy thay). Buổi của người khác, buổi đã huỷ,
// id lạ đều ra cùng một màn "không phải buổi của bạn" — không phân biệt, chống dò id.
import Link from "next/link";
import { Info, UserX } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { decidePermissionWithGrant } from "@/lib/auth/check-permission";
import { actorChoBuoiDayThay, dauNgayVn, docChiTietDayThay, docTienDoDayThay } from "@/lib/teachers/day-thay";
import { HelpHint } from "@/components/admin/ui/help-hint";
import { BackLink } from "../../_components/ui/back-link";
import { EmptyState } from "../../_components/ui/empty-state";
import { PageHeader } from "../../_components/ui/page-header";
import { SessionStatusPill } from "../../_components/ui/session-status-pill";
import { DayThayTabBar, parseTab, tabMacDinh } from "../_components/tab-bar";
import { TabDiemDanh } from "../_components/tab-diem-danh";
import { TabHocVien } from "../_components/tab-hoc-vien";
// Ba tab dưới là CHÍNH các tab của Class Hub (/teacher/lop?classId=…&tab=…), nhúng ở chế độ một-buổi — không có bản
// sao: sửa tab ở hub là màn Dạy thay đổi theo, và dữ liệu là dữ liệu của lớp (admin / giáo viên phụ trách thấy y hệt).
import { HubAssignmentsTab } from "../../lop/_components/hub-assignments-tab";
import { HubMaterialsTab } from "../../lop/_components/hub-materials-tab";
import { HubReviewsTab } from "../../lop/_components/hub-reviews-tab";

export const dynamic = "force-dynamic";
export const metadata = { title: "Buổi dạy thay | Giáo viên Sata Robo" };

const ngayFmt = new Intl.DateTimeFormat("vi-VN", {
  weekday: "long",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

const NGAY_MS = 24 * 60 * 60 * 1000;

export default async function TeacherDayThayChiTietPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ tab?: string; asgId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate
  const userId = session.user.id;
  const [{ sessionId }, { tab: tabRaw, asgId }] = await Promise.all([params, searchParams]);

  const ct = await docChiTietDayThay(userId, sessionId);
  if (!ct) return <KhongPhaiBuoiCuaBan />;

  const now = new Date();
  const daToiNgay = ct.date.getTime() < dauNgayVn(now).getTime() + NGAY_MS;
  const tab = parseTab(tabRaw, tabMacDinh(daToiNgay));
  const [actorGoc, tienDo] = await Promise.all([resolveActor(userId), docTienDoDayThay(ct)]);
  // Actor để ĐỌC các tab hub của lớp (cơ sở của lớp tính là cơ sở dạy) — xem `actorChoBuoiDayThay`.
  const actor = actorChoBuoiDayThay(actorGoc, ct);
  const urlBuoi = `/teacher/day-thay/${ct.id}`;
  // Giao bài của buổi dạy thay: cùng pipeline quyền với server (`assignTemplateAction`) — actor bổ sung ĐÚNG lớp của
  // buổi (đã chứng minh là của mình bởi `docChiTietDayThay`). Chỉ quyết định có VẼ nút hay không.
  const choGiaoBai = decidePermissionWithGrant({
    sessionUser: session.user,
    actor: { ...actor, assignedClassIds: new Set([...actor.assignedClassIds, ct.classId]) },
    action: "assignments:assign-own",
    target: { classId: ct.classId, centerId: ct.centerId },
  });

  return (
    <div>
      <BackLink className="mb-4" href="/teacher/day-thay" label="Dạy thay" />
      <PageHeader
        title={ct.lop}
        subtitle={[
          ct.nhanBuoi,
          ngayFmt.format(ct.date),
          ct.startTime && ct.endTime ? `${ct.startTime}–${ct.endTime}` : null,
          ct.phong ? `Phòng ${ct.phong}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={<SessionStatusPill status={ct.status} />}
      />

      <p className="mb-5 flex items-start gap-2 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          {ct.gvChinh ? (
            <>
              Bạn dạy thay <strong className="font-semibold text-foreground">{ct.gvChinh}</strong>.{" "}
            </>
          ) : (
            "Bạn được xếp dạy thay buổi này. "
          )}
          Điểm danh và nhận xét bạn lưu ghi thẳng vào buổi của lớp — giáo viên phụ trách và quản lý cơ sở thấy ngay, và công
          dạy thay tính cho bạn.
        </span>
      </p>

      {/* Sổ bàn giao của lớp — đặt TRÊN thanh tab để hiện ở mọi tab (cùng chỗ với Class Hub): người nhận dạy thay cần đọc
          trước khi làm bất cứ việc gì. Rỗng thì không vẽ. */}
      {ct.ghiChuLop && (
        <section className="mb-6 rounded-xl border border-border bg-muted/40 p-4">
          <h2 className="mb-2 flex items-center gap-1 text-sm font-bold text-foreground">
            Mô tả đặc thù lớp học
            <HelpHint label="Ai đọc được mô tả này">
              Ghi chú bàn giao nội bộ — chỉ nhân sự và giáo viên của lớp đọc được, KHÔNG hiển thị cho phụ huynh. Cần sửa thì
              báo quản lý cơ sở.
            </HelpHint>
          </h2>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{ct.ghiChuLop}</p>
        </section>
      )}

      <DayThayTabBar
        active={tab}
        conLaiDiemDanh={daToiNgay ? Math.max(0, tienDo.siSo - tienDo.daDiemDanh) : 0}
        conLaiNhanXet={Math.max(0, tienDo.coMat - tienDo.daNhanXet)}
      />

      {tab === "hoc-vien" && <TabHocVien ct={ct} actor={actor} />}
      {tab === "diem-danh" && <TabDiemDanh ct={ct} actor={actor} userId={userId} now={now} />}
      {tab === "nhan-xet" && (
        <HubReviewsTab
          actor={actor}
          classId={ct.classId}
          reviewSessionId={ct.id}
          dieuHuong={{ veDanhSach: null, diemDanh: `${urlBuoi}?tab=diem-danh`, chonAnh: false }}
        />
      )}
      {tab === "bai-tap" && (
        <HubAssignmentsTab
          actor={actor}
          classId={ct.classId}
          className={ct.lop}
          assignmentId={asgId}
          phamVi={{ goc: "?tab=bai-tap", sessionId: ct.id, lessonId: ct.lessonId, choGiaoBai }}
        />
      )}
      {tab === "tai-lieu" && (
        <HubMaterialsTab
          actor={actor}
          classId={ct.classId}
          phamVi={{ sessionId: ct.id, lessonId: ct.lessonId, quayVe: `${urlBuoi}?tab=tai-lieu` }}
        />
      )}
    </div>
  );
}

function KhongPhaiBuoiCuaBan() {
  return (
    <div className="space-y-4">
      <BackLink href="/teacher/day-thay" label="Dạy thay" />
      <EmptyState
        icon={UserX}
        title="Đây không phải buổi bạn được xếp dạy thay."
        description="Buổi có thể đã đổi người, đã huỷ, hoặc đường dẫn không đúng. Xem lại danh sách buổi dạy thay của bạn."
      />
      <div className="text-center">
        <Link
          href="/teacher/day-thay"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Về danh sách dạy thay
        </Link>
      </div>
    </div>
  );
}
