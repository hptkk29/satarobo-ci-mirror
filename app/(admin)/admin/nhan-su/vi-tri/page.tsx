// P2 · US-08 — MÀN QUẢN TRỊ VỊ TRÍ CÔNG VIỆC.
//
// Cổng `roles:manage` (chỉ SUPER_ADMIN): vị trí mang bộ vai trò, nên sửa vị trí = sửa
// quyền của mọi người đang giữ nó. Cùng hạng nguy hiểm với sửa RoleDef.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { ViTriEditor } from "./_components/vi-tri-editor";
import { PhanCongEditor } from "./_components/phan-cong-editor";
import { DieuDongEditor } from "./_components/dieu-dong-editor";
import { vnYmd } from "@/lib/time/vn";
import { PageHelp } from "@/components/admin/ui/page-help";

export const dynamic = "force-dynamic";

export default async function ViTriPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission([...PAGE_GATES["/nhan-su/vi-tri"]]))) {
    redirect("/dashboard?error=unauthorized");
  }

  // `scopedDb` chứ không `db` trần (luật R6-F1). Ba model mới KHÔNG nằm trong
  // SCOPED_MODELS nên đi qua đây không bị lọc — vị trí là dữ liệu tổ chức mức hệ thống.
  const sdb = scopedDb(await resolveActor(session.user.id));
  const [positions, orgUnits, roles] = await Promise.all([
    sdb.position.findMany({
      where: { deletedAt: null },
      orderBy: [{ isActive: "desc" }, { title: "asc" }],
      select: {
        id: true,
        title: true,
        orgUnitId: true,
        isManagerial: true,
        isActive: true,
        reportsToPositionId: true,
        roles: { select: { roleId: true } },
        _count: { select: { assignments: true } },
      },
    }),
    sdb.orgUnit.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, type: true },
    }),
    sdb.roleDef.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  // US-09 — phân công + danh sách người có thể phân công.
  // Lấy CẢ phân công đã hết hiệu lực: AC3 nói lịch sử không xoá, nên nó phải NHÌN THẤY
  // được ở đâu đó, nếu không thì "không xoá" chỉ là chuyện của bảng.
  const [assignments, nhanSu] = await Promise.all([
    sdb.positionAssignment.findMany({
      orderBy: [{ effectiveFrom: "desc" }],
      select: {
        id: true,
        positionId: true,
        userId: true,
        kind: true,
        effectiveFrom: true,
        effectiveTo: true,
        status: true,
        note: true,
        user: { select: { name: true, email: true } },
        // US-10 — điều động treo trên phân công. Lấy CẢ bản ghi đã hết hạn (lịch sử
        // "ai từng tác nghiệp ở đâu" là thứ phải tra được).
        workScopes: {
          orderBy: { effectiveFrom: "desc" },
          select: {
            id: true,
            orgUnitId: true,
            reason: true,
            effectiveFrom: true,
            effectiveTo: true,
            note: true,
          },
        },
      },
    }),
    // Chỉ nhân sự: phụ huynh không giữ vị trí công việc (vai quan hệ, xem CLAUDE.md).
    sdb.user.findMany({
      where: { isActive: true, deletedAt: null, role: { not: "PARENT" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);

  const bayGio = new Date();
  const tenViTri = new Map(positions.map((p) => [p.id, p.title]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Vị trí công việc</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quyền gắn theo vị trí, không gắn theo người
        </p>
      </div>

      <PageHelp>
        <p>
          Quyền gắn vào <strong>vị trí</strong>, không gắn vào người. Người nghỉ
          thì gỡ phân công — vị trí giữ nguyên bộ quyền cho người kế nhiệm. Cây
          báo cáo (&ldquo;báo cáo cho&rdquo;) là cây riêng, dùng cho luồng
          duyệt, không dùng để tính phạm vi dữ liệu.
        </p>
      </PageHelp>

      <ViTriEditor
        positions={positions.map((p) => ({
          id: p.id,
          title: p.title,
          orgUnitId: p.orgUnitId,
          isManagerial: p.isManagerial,
          isActive: p.isActive,
          reportsToPositionId: p.reportsToPositionId,
          roleIds: p.roles.map((r) => r.roleId),
          soNguoiGiu: p._count.assignments,
        }))}
        orgUnits={orgUnits}
        roles={roles}
      />

      <PhanCongEditor
        positions={positions.map((p) => ({
          id: p.id,
          title: p.title,
          isActive: p.isActive,
        }))}
        nhanSu={nhanSu.map((u) => ({
          id: u.id,
          ten: u.name ?? u.email ?? u.id,
        }))}
        assignments={assignments.map((a) => ({
          id: a.id,
          positionId: a.positionId,
          userId: a.userId,
          hoTen: a.user.name ?? a.user.email ?? a.userId,
          kind: a.kind,
          effectiveFrom: a.effectiveFrom.toISOString(),
          effectiveTo: a.effectiveTo?.toISOString() ?? null,
          // Ngày cho ô `<input type="date">` phải tính theo GIỜ VN. Cắt 10 ký tự đầu của
          // chuỗi ISO (UTC) là lệch một ngày với mọi mốc trước 07:00 VN — mà 00:00 VN,
          // đúng thứ ta lưu, luôn rơi vào đó.
          tuNgay: vnYmd(a.effectiveFrom),
          denNgay: a.effectiveTo ? vnYmd(a.effectiveTo) : null,
          status: a.status,
          note: a.note,
        }))}
      />

      <DieuDongEditor
        phanCongs={assignments
          .filter(
            (a) =>
              a.status === "ACTIVE" &&
              a.effectiveFrom <= bayGio &&
              (a.effectiveTo === null || a.effectiveTo >= bayGio),
          )
          .map((a) => ({
            id: a.id,
            nhan: `${a.user.name ?? a.user.email ?? a.userId} — ${tenViTri.get(a.positionId) ?? "?"}`,
          }))}
        donVis={orgUnits}
        dieuDongs={assignments.flatMap((a) =>
          a.workScopes.map((w) => ({
            id: w.id,
            assignmentId: a.id,
            nhanPhanCong: `${a.user.name ?? a.user.email ?? a.userId} — ${tenViTri.get(a.positionId) ?? "?"}`,
            orgUnitId: w.orgUnitId,
            reason: w.reason,
            effectiveFrom: w.effectiveFrom.toISOString(),
            effectiveTo: w.effectiveTo?.toISOString() ?? null,
            tuNgay: vnYmd(w.effectiveFrom),
            denNgay: w.effectiveTo ? vnYmd(w.effectiveTo) : null,
            note: w.note,
          })),
        )}
      />
    </div>
  );
}
