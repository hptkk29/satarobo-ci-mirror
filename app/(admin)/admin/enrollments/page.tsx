import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Pencil, Search } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkPermission, checkPermissionDetail } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { getCenterOptions } from "@/lib/org/center-options";
import { EnrollmentStatus, type Prisma } from "@prisma/client";
import { DeleteEnrollmentButton } from "./_components/delete-enrollment-button";
import { formatDateVN } from "@/lib/format/date";
import { canViewLeadPii } from "@/lib/auth/check-permission";
import { maskPhone } from "@/lib/utils";
import { phoneSearchTerm } from "@/lib/phone";
import { ENROLLMENT_ACTIVE_STATUSES } from "@/lib/enrollment-status";
import { OpenDmButton } from "@/components/chat/open-dm-button";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { NutXuat } from "@/components/admin/nut-xuat";
import { PageHeader } from "@/components/admin/ui/page-header";
import { cn } from "@/lib/utils";
import { getSetting } from "@/lib/settings/service";
import { getNearingEndEnrollments } from "@/lib/students/renewal";
import { TabSapHetKhoa } from "./_components/tab-sap-het-khoa";

export const dynamic = "force-dynamic";
export const metadata = { title: "Đăng ký học | Admin" };

const STATUS_INFO: Record<EnrollmentStatus, { label: string; color: string }> = {
  PENDING: { label: "Chờ xếp", color: "bg-muted text-foreground" },
  CONFIRMED: { label: "Đã xếp", color: "bg-state-warning-soft text-state-warning-ink" },
  STUDYING: { label: "Đang học", color: "bg-state-success-soft text-state-success-ink" },
  PAUSED: { label: "Bảo lưu", color: "bg-state-warning-soft text-state-warning-ink" },
  COMPLETED: { label: "Hoàn thành", color: "bg-state-info-soft text-state-info-ink" },
  WITHDREW: { label: "Đã rút", color: "bg-state-danger-soft text-state-danger-ink" },
  TRANSFERRED: { label: "Đã chuyển", color: "bg-primary-soft text-primary" },
  // Legacy values
  ACTIVE: { label: "Đang học (legacy)", color: "bg-state-success-soft text-state-success-ink" },
  CANCELLED: { label: "Đã huỷ", color: "bg-state-danger-soft text-state-danger-ink" },
};

const DEFAULT_ACTIVE_STATUSES: EnrollmentStatus[] = [
  "PENDING",
  "CONFIRMED",
  "STUDYING",
  "ACTIVE",
];

const VALID_STATUSES = Object.values(EnrollmentStatus);

function formatDate(d: Date | null) {
  if (!d) return "—";
  return formatDateVN(d);
}

interface SearchParams {
  searchParams: Promise<{
    q?: string;
    status?: string;
    classId?: string;
    centerId?: string;
    tab?: string;
  }>;
}

// 01/10/2026 — chủ dự án gộp "Sắp hết khoá" (/students/sap-het-khoa) vào đây thành tab thứ
// hai. Hai màn vốn cùng cổng `enrollments:view-all`. Tab 2 nay đọc theo CÙNG tầm nhìn cơ sở
// với tab 1 (bản cũ tự cắt theo `session.user.centerId` chỉ cho vai QLCS).
type Tab = "dang-ky" | "sap-het-khoa";

export default async function EnrollmentsAdminPage({ searchParams }: SearchParams) {
  // P1-a: trang Đăng ký học KHÔNG dành cho GV — chỉ quản lý/sale/kế toán (view-all).
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("enrollments:view-all"))) redirect("/dashboard");
  const canDelete = await checkPermission("enrollments:delete");
  const canViewPii = await canViewLeadPii(); // che SĐT PH nếu thiếu quyền
  // US-03 (TS-02): DENY cấp trường từ grant nhóm — che parentPhone kể cả khi
  // đường cũ vẫn cho xem PII (đồng nhất với trang /students).
  const { fieldMask } = await checkPermissionDetail("students:view-all");
  const phoneMasked = fieldMask.includes("parentPhone");

  // Cách ly cơ sở (FL3-02): Enrollment giờ ∈ SCOPED_MODELS → scopedDb tự inject
  // `Enrollment.centerId IN visibleCenters`. KHÔNG còn scope tay qua class.centerId.
  // Bộ lọc cơ sở của UI (centerFilter) áp thẳng lên Enrollment.centerId; nếu chọn cơ sở
  // ngoài tầm nhìn → auto-scope AND nó về rỗng (không lộ data cơ sở khác).
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  // SĐT lưu 2 dạng (0… cũ / 84… mới) — tìm theo phần lõi để không sót.
  const qPhone = q ? (phoneSearchTerm(q) ?? q) : q;
  const statusParam = sp.status;
  const classFilter = sp.classId?.trim() || undefined;
  const centerFilter = sp.centerId?.trim() || undefined;
  const tab: Tab = sp.tab === "sap-het-khoa" ? "sap-het-khoa" : "dang-ky";

  const statusFilter: EnrollmentStatus | "active" | "all" =
    statusParam === "all"
      ? "all"
      : statusParam && VALID_STATUSES.includes(statusParam as EnrollmentStatus)
        ? (statusParam as EnrollmentStatus)
        : "active";

  const where: Prisma.EnrollmentWhereInput = {};
  if (statusFilter === "active") {
    where.status = { in: DEFAULT_ACTIVE_STATUSES };
  } else if (statusFilter !== "all") {
    where.status = statusFilter;
  }
  if (classFilter) where.classId = classFilter;

  // Bộ lọc cơ sở của UI áp thẳng lên Enrollment.centerId. Cách ly (visibleCenters) do
  // scopedDb auto-inject; chọn cơ sở ngoài tầm nhìn → AND về rỗng, không lộ data.
  if (centerFilter) where.centerId = centerFilter;

  if (q) {
    // NỢ #11 (search-oracle): chỉ cho tìm theo SĐT khi actor thấy được SĐT thật —
    // cùng điều kiện với hiển thị (canViewPii VÀ không bị DENY cấp trường TS-02).
    where.OR = [
      { student: { name: { contains: q, mode: "insensitive" } } },
      ...(canViewPii && !phoneMasked
        ? [
            { student: { parentPhone: { contains: qPhone } } },
            { student: { phone: { contains: qPhone } } },
          ]
        : []),
      { class: { name: { contains: q, mode: "insensitive" } } },
      { class: { classCode: { contains: q, mode: "insensitive" } } },
    ];
  }

  // Tầm nhìn cơ sở cho tab "Sắp hết khoá" (hàm đó đọc db trần): Quản trị/Hội sở thấy hết,
  // còn lại đúng `visibleCenterIds` — cùng luật scopedDb áp cho tab Đăng ký. Bộ lọc cơ sở
  // của UI thu hẹp tiếp trong tầm nhìn đó (chọn ngoài tầm nhìn ⇒ rỗng, không lộ).
  const tamNhin: readonly string[] | undefined =
    actor.isSuperAdmin || actor.isHoLevel ? undefined : actor.visibleCenterIds;
  const coSoTab2 = centerFilter
    ? tamNhin === undefined || tamNhin.includes(centerFilter)
      ? [centerFilter]
      : []
    : tamNhin;

  const [enrollments, classes, centers, sapHet, nguong] = await Promise.all([
    sdb.enrollment.findMany({
      where,
      orderBy: [{ status: "asc" }, { enrolledAt: "desc" }],
      take: 100,
      select: {
        id: true,
        status: true,
        enrolledAt: true,
        startedAt: true,
        // F5 — hai field này là ĐỦ để dựng nút "Nhắn riêng" của sale, và cả hai nằm trên
        // hàng đã fetch sẵn nên KHÔNG tốn thêm truy vấn nào.
        saleId: true,
        student: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            parentPhone: true,
            phone: true,
            parentUserId: true,
          },
        },
        class: {
          select: {
            id: true,
            name: true,
            classCode: true,
            center: { select: { name: true } },
          },
        },
      },
    }),
    sdb.class.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, classCode: true },
      take: 200,
    }),
    // Ô lọc cơ sở: bản cũ (`center.findMany`) bày cả Hội sở, cả dòng Center mồ côi
    // (ITLI_*) và không cắt theo tầm nhìn actor → chọn ra bảng rỗng. Helper lo cả 3.
    getCenterOptions(actor),
    getNearingEndEnrollments({ centerIds: coSoTab2 }),
    getSetting("student.nearEndThreshold"),
  ]);
  const qThuong = q?.toLocaleLowerCase("vi");
  const sapHetLoc = qThuong
    ? sapHet.filter(
        (i) =>
          i.studentName.toLocaleLowerCase("vi").includes(qThuong) ||
          i.className.toLocaleLowerCase("vi").includes(qThuong),
      )
    : sapHet;

  const hrefTab = (k: Tab) => {
    const p = new URLSearchParams();
    if (k !== "dang-ky") p.set("tab", k);
    if (centerFilter) p.set("centerId", centerFilter);
    const s = p.toString();
    return s ? `/enrollments?${s}` : "/enrollments";
  };

  return (
    <div>
      <PageHeader
        title="Đăng ký học"
        subtitle={
          tab === "dang-ky"
            ? enrollments.length > 0
              ? `${enrollments.length} đăng ký${statusFilter === "active" ? " đang hoạt động" : ""}${enrollments.length === 100 ? " (hiện 100 gần nhất — lọc để thu hẹp)" : ""}`
              : "Chưa có đăng ký nào khớp bộ lọc"
            : `Học viên còn ≤ ${nguong} buổi — liên hệ phụ huynh để tái tục`
        }
        actions={
          <>
            <NutXuat ma="ghi-danh" />
            <Link
              href="/enrollments/new"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Đăng ký mới
            </Link>
          </>
        }
      />

      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-border" aria-label="Đăng ký học">
        {(
          [
            ["dang-ky", "Đăng ký", null],
            ["sap-het-khoa", "Sắp hết khoá", sapHet.length],
          ] as const
        ).map(([k, nhan, dem]) => (
          <Link
            key={k}
            href={hrefTab(k)}
            aria-current={tab === k ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex h-10 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors",
              tab === k
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {nhan}
            {dem !== null && dem > 0 && (
              <span className="rounded-full bg-state-warning-soft px-1.5 text-xs font-semibold tabular-nums text-state-warning-ink">
                {dem}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <form method="GET" className="mb-4 flex flex-wrap items-center gap-2">
        {tab !== "dang-ky" && <input type="hidden" name="tab" value={tab} />}
        <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <span className="sr-only">Tìm kiếm</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            name="q"
            defaultValue={q}
            placeholder={tab === "dang-ky" ? "Tìm HS / SĐT PH / tên lớp / mã lớp…" : "Tìm học viên / tên lớp…"}
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </label>
        {tab === "dang-ky" && (
          <>
            <select
              name="status"
              defaultValue={statusParam ?? "active"}
              aria-label="Trạng thái"
              className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus:border-primary focus:outline-none"
            >
              <option value="active">Đang hoạt động</option>
              <option value="all">Tất cả trạng thái</option>
              <option value="PENDING">Chờ xếp</option>
              <option value="CONFIRMED">Đã xếp</option>
              <option value="STUDYING">Đang học</option>
              <option value="PAUSED">Bảo lưu</option>
              <option value="COMPLETED">Hoàn thành</option>
              <option value="WITHDREW">Đã rút</option>
              <option value="TRANSFERRED">Đã chuyển</option>
            </select>
            <select
              name="classId"
              defaultValue={classFilter ?? ""}
              aria-label="Lớp"
              className="h-9 max-w-[220px] rounded-lg border border-border bg-background px-2.5 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">Tất cả lớp</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.classCode ? `${c.classCode} · ` : ""}
                  {c.name}
                </option>
              ))}
            </select>
          </>
        )}
        {centers.length > 1 && (
          <select
            name="centerId"
            defaultValue={centerFilter ?? ""}
            aria-label="Cơ sở"
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm focus:border-primary focus:outline-none"
          >
            <option value="">Tất cả cơ sở</option>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted"
        >
          Lọc
        </button>
      </form>

      {tab === "sap-het-khoa" ? (
        <TabSapHetKhoa items={sapHetLoc} nguong={nguong} />
      ) : (
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Học viên
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Lớp / Cơ sở
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Trạng thái
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Ngày đăng ký
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hành động
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {enrollments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    Chưa có đăng ký nào khớp bộ lọc.{" "}
                    <Link href="/enrollments/new" className="text-primary hover:underline">
                      Tạo đăng ký mới →
                    </Link>
                  </td>
                </tr>
              ) : (
                enrollments.map((e) => {
                  const statusInfo =
                    STATUS_INFO[e.status] ?? {
                      label: e.status,
                      color: "bg-muted text-muted-foreground",
                    };
                  const rawPhone = e.student.parentPhone ?? e.student.phone;
                  // Hiện đầy đủ = có quyền PII VÀ không bị DENY cấp trường (TS-02).
                  const parentPhone =
                    rawPhone && (!canViewPii || phoneMasked)
                      ? maskPhone(rawPhone)
                      : rawPhone;
                  return (
                    <tr key={e.id} className="hover:bg-muted/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {e.student.avatarUrl ? (
                            <img
                              src={e.student.avatarUrl}
                              alt={e.student.name}
                              className="h-9 w-9 rounded-full border border-border object-cover"
                            />
                          ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                              {e.student.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="font-medium text-foreground">{e.student.name}</div>
                            {parentPhone && (
                              <div className="text-xs text-muted-foreground tabular-nums">{parentPhone}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        <div className="font-medium text-foreground">{e.class.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {e.class.classCode ? `${e.class.classCode} · ` : ""}
                          {e.class.center?.name ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
                        {formatDate(e.enrolledAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          {/* F5 — nút CHỈ hiện đúng khi server sẽ cho qua: người xem là
                              sale được gán CỦA CHÍNH ghi danh này, phụ huynh đã có tài
                              khoản, và ghi danh còn hiệu lực. Điều kiện phải TRÙNG KHÍT
                              `findSaleAssignedEnrollmentIds` (lib/chat/dm.ts) — hiện nút
                              rộng hơn server là đẩy người dùng vào PERMISSION_DENIED. */}
                          {e.saleId === session.user.id &&
                            e.student.parentUserId &&
                            (ENROLLMENT_ACTIVE_STATUSES as readonly string[]).includes(e.status) && (
                              <OpenDmButton
                                peerUserId={e.student.parentUserId}
                                kind="SALE_PARENT"
                                // ⚠️ `/admin/tin-nhan` chứ KHÔNG phải `/tin-nhan` (đường
                                // sidebar dùng). Đo trên test 10/08: bấm từ
                                // `/admin/enrollments`, Server Action trả ok kèm
                                // conversationId nhưng `router.push("/tin-nhan?c=…")`
                                // KHÔNG điều hướng — URL đứng nguyên, người dùng thấy nút
                                // như chết. Trang này nằm dưới `/admin/**` nên đi thẳng
                                // đường đã có tiền tố, không nhờ tới lớp rewrite clean-URL
                                // của proxy.
                                hrefTemplate="/admin/tin-nhan?c=:id"
                                label="Nhắn riêng"
                              />
                            )}
                          <Link
                            href={`/enrollments/${e.id}/edit`}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Sửa
                          </Link>
                          {canDelete && <DeleteEnrollmentButton id={e.id} />}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
      )}
    </div>
  );
}
