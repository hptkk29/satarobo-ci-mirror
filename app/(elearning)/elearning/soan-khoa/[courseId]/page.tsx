import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { docDanBaiChoMan } from "@/lib/elearning/course-authoring";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { PageHeader } from "@/components/admin/ui/page-header";
import { Khoi, QuayLai, TrangQuanTri } from "../../_components/ui/trang";
import { OutlineEditor } from "../_components/outline-editor";
import { EquivalencePanel } from "../_components/equivalence-panel";

/**
 * EL-08 — MÀN SOẠN KHOÁ.
 *
 * Đây là màn mà cổng nghiệm thu GĐ1 bấm giờ: *"tự tạo trọn một khoá đầu-cuối
 * trong ≤60 phút, 0 lần nhờ lập trình viên"*. Mọi thứ cần cho một khoá chạy được
 * phải nằm trên MỘT màn — bắt người soạn nhảy trang giữa chương và bài là tự bỏ
 * thời gian vào chỗ không tạo ra gì.
 *
 * ⚠️ Danh sách lỗi dàn bài hiện NGAY, không đợi bấm Gửi duyệt. Biết trước còn
 * thiếu gì thì sửa một lượt; biết sau khi bấm thì đi qua từng vòng một.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Soạn khoá | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);

  if (!can(actor, "elearning:content:author")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Soạn khoá" />
        <NoPermission permission="elearning:content:author" what="màn soạn khoá" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  const khoa = await db.trnCourse.findFirst({
    where: { id: courseId, deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      sequential: true,
      program: { select: { code: true, title: true } },
    },
  });
  if (!khoa) {
    return (
      <TrangQuanTri rong="hep">
        <QuayLai href="/elearning/soan-khoa">Danh sách khoá</QuayLai>
        <EmptyState
          title="Không tìm thấy khoá học"
          description="Khoá không tồn tại, đã bị xoá hoặc không thuộc phạm vi của bạn."
        />
      </TrangQuanTri>
    );
  }

  const [danBai, phienBan] = await Promise.all([
    docDanBaiChoMan(db, khoa.id),
    db.trnCourseVersion.findMany({
      where: { courseId: khoa.id },
      select: { id: true, major: true, minor: true, status: true },
      orderBy: [{ major: "desc" }, { minor: "desc" }],
      take: 20,
    }),
  ]);

  // Nhân sự có tài khoản — nguồn cho ô chọn người được công nhận tương đương.
  const dsNhanSu = (
    await db.employee.findMany({
      where: { isActive: true, status: "ACTIVE", userAccount: { isNot: null } },
      select: {
        fullName: true,
        employeeCode: true,
        userAccount: { select: { id: true } },
      },
      orderBy: { fullName: "asc" },
      take: 500,
    })
  ).map((n: { fullName: string; employeeCode: string; userAccount: { id: string } | null }) => ({
    userId: n.userAccount!.id,
    ten: `${n.fullName} (${n.employeeCode})`,
  }));

  return (
    <TrangQuanTri rong="vua">
      <div>
        <QuayLai href="/elearning/soan-khoa">Danh sách khoá</QuayLai>
        <PageHeader
          className="mb-0 mt-1"
          title={khoa.title}
          subtitle={
            <>
              <span className="font-mono text-xs">{khoa.code}</span>
              {khoa.program ? ` · Chương trình ${khoa.program.code} — ${khoa.program.title}` : ""}
            </>
          }
        />
      </div>

      <OutlineEditor
        courseId={khoa.id}
        sequential={khoa.sequential}
        trangThaiKhoa={khoa.status}
        chuong={danBai.chuong}
        loiDanBai={danBai.kiem.loi}
        phienBan={phienBan.map(
          (v: { id: string; major: number; minor: number; status: string }) => ({
            nhan: `v${v.major}.${v.minor}`,
            status: v.status,
          }),
        )}
      />

      {/* ── Công nhận tương đương ───────────────────────────────────────────
          ⚠️ `congNhanTuongDuongAction` khai từ EL-09 nhưng 0 màn nào gọi — nên con
          số "công nhận tương đương" trên báo cáo tuân thủ vĩnh viễn bằng 0, không
          phải vì không ai đủ điều kiện mà vì không ai ghi được.
          Chỉ hiện cho người có quyền QUẢN LÝ CHƯƠNG TRÌNH: đây là quyết định về hồ
          sơ đào tạo của người khác, không phải thao tác soạn nội dung. */}
      {can(actor, "elearning:program:manage") ? (
        <Khoi tieuDe="Công nhận tương đương">
          <EquivalencePanel courseId={courseId} nhanSu={dsNhanSu} />
        </Khoi>
      ) : null}
    </TrangQuanTri>
  );
}
