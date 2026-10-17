import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { scopedDb } from "@/lib/db-scope";
import { ROLE_LABELS } from "@/lib/labels";
import { AssignWizard } from "./_components/assign-wizard";

/**
 * EL-05 — TRÌNH GIAO BÀI 4 BƯỚC (BA §10.3).
 *
 * Trang này chỉ nạp DANH MỤC rồi giao cho trình hướng dẫn ở client. Mọi quyết
 * định "ai nhận bài" nằm ở máy chủ (`lib/elearning/*`), không ở đây.
 *
 * ⚠️ Danh mục chức danh và phòng ban lấy TỪ DỮ LIỆU THẬT, không phải danh sách
 * gõ cứng: `Employee.jobTitle` là chuỗi tự do, nên ô nhập tay trên nó là cách
 * chắc chắn nhất để tạo một luật không khớp ai — và không có gì báo.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Giao bài | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </div>
    );
  }
  const actor = await resolveActor(session.user.id);

  if (!can(actor, "elearning:assignment:create")) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-bold">Không có quyền giao bài</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Việc giao bài thuộc phòng Đào tạo.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg border border-border px-4 py-2 text-sm"
        >
          Về trang chủ khu đào tạo
        </Link>
      </div>
    );
  }

  const db = scopedDb(actor);
  const [khoa, phongBan, coSo, chucDanhRaw, nhanSu] = await Promise.all([
    db.trnCourse.findMany({
      where: { deletedAt: null, status: "PUBLISHED" },
      select: { id: true, title: true, code: true },
      orderBy: { title: "asc" },
      take: 300,
    }),
    db.departmentDef.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { displayOrder: "asc" },
    }),
    db.center.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold">Giao bài</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Bốn bước: chọn nội dung → chọn người học → thời hạn → xác nhận.
      </p>
      <AssignWizard
        khoa={khoa}
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
    </div>
  );
}
