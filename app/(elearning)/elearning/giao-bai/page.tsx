import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { ROLE_LABELS } from "@/lib/labels";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState, NoPermission } from "@/components/admin/ui/states";
import { TrangQuanTri } from "../_components/ui/trang";
import { AssignWizard } from "./_components/assign-wizard";
import { isElearningDynamicAssignEnabled } from "@/lib/flags";
import { whereCoSoHienThi } from "@/lib/elearning/report-scope";

/**
 * EL-05 — TRÌNH GIAO BÀI 4 BƯỚC (BA §10.3).
 *
 * Trang này chỉ nạp DANH MỤC rồi giao cho trình hướng dẫn ở client. Danh sách "Lượt giao đã tạo" nay ở route riêng `/elearning/luot-giao` (QtLuotGiao). Mọi quyết
 * định "ai nhận bài" nằm ở máy chủ (`lib/elearning/*`), không ở đây.
 *
 * ⚠️ Danh mục chức danh và phòng ban lấy TỪ DỮ LIỆU THẬT, không phải danh sách
 * gõ cứng: `Employee.jobTitle` là chuỗi tự do, nên ô nhập tay trên nó là cách
 * chắc chắn nhất để tạo một luật không khớp ai — và không có gì báo.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Giao khoá | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ nguoi?: string | string[] }> }) {
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const actor = await resolveActor(session.user.id);

  if (!can(actor, "elearning:assignment:create")) {
    return (
      <TrangQuanTri rong="hep">
        <PageHeader title="Giao khoá" />
        <NoPermission permission="elearning:assignment:create" what="màn giao khoá" askWho="phòng Đào tạo" />
      </TrangQuanTri>
    );
  }

  const db = scopedDb(actor);
  const [khoa, phongBan, coSo, chucDanhRaw, nhanSu] = await Promise.all([
    db.trnCourse.findMany({
      where: { deletedAt: null, status: "PUBLISHED" },
      select: {
        id: true,
        title: true,
        code: true,
        // Bản đang phát hành mới nhất — chỉ để hiện "bản vX.Y · N bài" dưới tên khoá (thiết kế QtGiaoKhoa1).
        versions: { where: { status: "PUBLISHED" }, orderBy: [{ major: "desc" }, { minor: "desc" }], take: 1, select: { major: true, minor: true, _count: { select: { lessons: true } } } },
      },
      orderBy: { title: "asc" },
      take: 300,
    }),
    db.departmentDef.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { displayOrder: "asc" },
    }),
    // F-02: `Center` là SCOPE_EXEMPT nên `scopedDb` không lọc — tự giới hạn, kẻo quản lý CS1 thấy tên cơ sở khác trong bộ lọc.
    db.center.findMany({
      where: whereCoSoHienThi(actor),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.employee.findMany({
      where: { isActive: true },
      select: { jobTitle: true },
      distinct: ["jobTitle"],
      orderBy: { jobTitle: "asc" },
    }),
    db.employee.findMany({
      where: { isActive: true, status: "ACTIVE", userAccount: { isNot: null } },
      select: {
        employeeCode: true,
        fullName: true,
        jobTitle: true,
        userAccount: { select: { id: true } },
      },
      orderBy: { fullName: "asc" },
      take: 500,
    }),
  ]);

  // Gộp biến thể hoa/thường/khoảng trắng thành MỘT nhãn để chọn. Máy chủ nở lại
  // nhãn đó ra đủ biến thể thật lúc dựng `where` (xem `khopChucDanh`).
  const chucDanh = [
    ...new Map(
      chucDanhRaw
        .map((x: { jobTitle: string }) => x.jobTitle.trim())
        .filter(Boolean)
        .map((t: string) => [t.toLocaleLowerCase("vi-VN"), t] as const),
    ).values(),
  ].sort((a, b) => a.localeCompare(b, "vi-VN"));

  // `?nguoi=a,b` (từ màn Người học): chỉ nhận id THẬT SỰ có trong danh sách nhân sự đang hiện — id lạ bị bỏ, không báo lỗi.
  const chonSanTho = (Array.isArray(sp.nguoi) ? sp.nguoi[0] : sp.nguoi)?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
  const coTrongDs = new Set(nhanSu.map((n: { userAccount: { id: string } | null }) => n.userAccount!.id));
  const chonSan = [...new Set(chonSanTho)].filter((id) => coTrongDs.has(id)).slice(0, 500);

  return (
    <TrangQuanTri rong="vua">
      <AssignWizard
        tapDongBat={isElearningDynamicAssignEnabled()}
        themTayBanDau={chonSan}
        khoa={khoa.map((k: { id: string; title: string; code: string; versions: { major: number; minor: number; _count: { lessons: number } }[] }) => ({
          id: k.id,
          title: k.title,
          code: k.code,
          banMoi: k.versions[0] ? { nhan: `v${k.versions[0].major}.${k.versions[0].minor}`, soBai: k.versions[0]._count.lessons } : null,
        }))}
        phongBan={phongBan}
        coSo={coSo}
        chucDanh={chucDanh}
        vai={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))}
        nhanSu={nhanSu.map(
          (n: {
            employeeCode: string;
            fullName: string;
            jobTitle: string;
            userAccount: { id: string } | null;
          }) => ({
            userId: n.userAccount!.id,
            employeeCode: n.employeeCode,
            fullName: n.fullName,
            jobTitle: n.jobTitle,
          }),
        )}
      />
    </TrangQuanTri>
  );
}
