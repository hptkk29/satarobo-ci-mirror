import Link from "next/link";
import { FileSpreadsheet, Plus } from "lucide-react";
import { DeleteStudentButton } from "./_components/delete-student-button";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ChonSoDong } from "@/components/ui/chon-so-dong";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import { docSoDong } from "@/lib/ui/phan-trang";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import {
  checkAnyPermission,
  checkPermission,
  checkPermissionDetail,
} from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { getSetting } from "@/lib/settings/service";
import { canViewLeadPii } from "@/lib/auth/check-permission";
import { maskPhone } from "@/lib/utils";
import { StudentStatus, type EnrollmentStatus, type Prisma } from "@prisma/client";
import { phoneSearchTerm } from "@/lib/phone";
import { getCenterOptions } from "@/lib/org/center-options";
import {
  buildLifecycleWhere,
  postFilterFrequentlyAbsent,
  LIFECYCLE_VIEW_LABEL,
  LIFECYCLE_VIEW_DESCRIPTION,
  LIFECYCLE_VIEWS,
  type LifecycleView,
} from "@/lib/students/lifecycle";
import { tinhTinhTrangHoc } from "@/lib/students/tinh-trang-hoc";
import { NutXuat } from "@/components/admin/nut-xuat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Học viên | Admin" };

/** Ô lọc dùng chung — cao 36px cho khớp nút, màu lấy từ token `.admin-scope`. */
const FILTER_FIELD =
  "h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground " +
  "focus:border-[color:var(--primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--primary-soft)]";

const STATUS_INFO: Record<StudentStatus, { label: string; color: string }> = {
  ACTIVE: { label: "Đang học", color: "bg-state-success-soft text-state-success-ink" },
  PAUSED: { label: "Bảo lưu", color: "bg-state-warning-soft text-state-warning-ink" },
  GRADUATED: { label: "Hoàn thành", color: "bg-state-info-soft text-state-info-ink" },
  INACTIVE: { label: "Nghỉ học", color: "bg-muted text-muted-foreground" },
};

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

interface SearchParams {
  searchParams: Promise<{
    q?: string;
    status?: string;
    centerId?: string;
    grade?: string;
    page?: string;
    view?: string;
    size?: string;
  }>;
}

/** Số dòng/trang MẶC ĐỊNH. Người dùng đổi được qua `?size=` — xem `ChonSoDong`. */
const PAGE_SIZE = 20;
const VALID_STATUSES = Object.values(StudentStatus);
const FREQUENT_ABSENT_FETCH_LIMIT = 500;

function isValidView(v: string | undefined): v is LifecycleView {
  return LIFECYCLE_VIEWS.includes(v as LifecycleView);
}

type StudentRow = {
  id: string;
  name: string;
  studentCode: string | null;
  avatarUrl: string | null;
  currentGrade: number | null;
  status: StudentStatus;
  parentName: string | null;
  parentPhone: string | null;
  createdAt: Date;
  enrollmentDate: Date | null;
  preferredCenter: { name: string } | null;
  center: { name: string } | null;
  _count: { enrollments: number };
  enrollments: Array<{ status: EnrollmentStatus }>;
  reserves: Array<{
    id: string;
    startedAt: Date;
    expectedEndAt: Date | null;
    reason: string;
  }>;
};

const STUDENT_LIST_SELECT = {
  id: true,
  name: true,
  studentCode: true,
  avatarUrl: true,
  currentGrade: true,
  status: true,
  parentName: true,
  parentPhone: true,
  createdAt: true,
  enrollmentDate: true,
  preferredCenter: { select: { name: true } },
  center: { select: { name: true } },
  _count: { select: { enrollments: true } },
  // 22/09 — nguồn cho cột "Tình trạng học" (`tinhTinhTrangHoc`). Chỉ lấy đúng cột
  // `status` của ghi danh CÒN SỐNG: `deletedAt` phải có trong `where`, không thì ghi
  // danh đã xoá mềm vẫn được tính và em bị gắn nhãn theo một lớp không còn tồn tại.
  enrollments: {
    where: { deletedAt: null },
    select: { status: true },
  },
  reserves: {
    where: { isActive: true },
    select: {
      id: true,
      startedAt: true,
      expectedEndAt: true,
      reason: true,
    },
    take: 1,
    orderBy: { startedAt: "desc" as const },
  },
} satisfies Prisma.StudentSelect;

export default async function StudentsPage({ searchParams }: SearchParams) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission(PAGE_GATES["/students"]))) redirect("/dashboard");

  const canCreate = await checkPermission("students:create");
  const canUpdate = await checkPermission("students:edit");
  const canDelete = await checkPermission("students:delete");
  const showActions = canUpdate || canDelete;
  // #11 — che SĐT phụ huynh mặc định (đồng nhất với leads/payments); chỉ role có
  // quyền xem PII liên hệ (leads:view-pii) mới thấy đầy đủ.
  const canViewPii = await canViewLeadPii();
  // US-03 (TS-02): DENY cấp trường từ grant nhóm — che parentPhone kể cả khi
  // đường cũ vẫn cho xem PII (mask độc lập với quyết định action).
  const { fieldMask } = await checkPermissionDetail("students:view-all");
  const phoneMasked = fieldMask.includes("parentPhone");

  // Cách ly cơ sở: Student ∈ SCOPED_MODELS (có centerId) → scopedDb tự inject
  // `centerId IN visibleCenters`. Mọi đọc Student đi qua sdb. SUPER_ADMIN/HO bypass.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const sp = await searchParams;
  const view: LifecycleView = isValidView(sp.view) ? sp.view : "all";
  const q = sp.q?.trim() ?? "";
  // SĐT lưu 2 dạng (0… cũ / 84… mới) — tìm theo phần lõi để không sót.
  const qPhone = phoneSearchTerm(q) ?? q;
  const centerId = sp.centerId?.trim() ?? "";
  const gradeRaw = sp.grade?.trim() ?? "";
  const grade =
    gradeRaw && /^\d+$/.test(gradeRaw)
      ? Math.max(1, Math.min(12, Number(gradeRaw)))
      : undefined;
  const statusParam =
    sp.status && VALID_STATUSES.includes(sp.status as StudentStatus)
      ? (sp.status as StudentStatus)
      : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const soDong = docSoDong(sp.size);

  // Build base filters (search, center, grade). Note: centerId param maps
  // to Student.preferredCenterId — same field that the existing list filtered
  // on before lifecycle tabs were added.
  const baseFilters: Prisma.StudentWhereInput = {};
  if (q) {
    // NỢ #11 (search-oracle): chỉ cho tìm theo SĐT khi actor thấy được SĐT thật —
    // cùng điều kiện với hiển thị (canViewPii VÀ không bị DENY cấp trường TS-02).
    // Thiếu quyền mà vẫn filter theo SĐT = dò được số qua kết quả trả về.
    baseFilters.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { studentCode: { contains: q, mode: "insensitive" } },
      { parentName: { contains: q, mode: "insensitive" } },
      ...(canViewPii && !phoneMasked
        ? [
            { parentPhone: { contains: qPhone } },
            { phone: { contains: qPhone } },
          ]
        : []),
    ];
  }
  // 03/09 — LỌC THEO ĐÚNG THỨ CỘT ĐANG HIỂN THỊ.
  //
  // Bản cũ: `baseFilters.preferredCenterId = centerId`. Nhưng cột "Cơ sở" in ra
  // `preferredCenter?.name ?? center?.name` (xem dưới) — hai trường KHÁC NHAU.
  // Đo DB 03/09: 250/250 học viên có `preferredCenterId = NULL` và `centerId` có
  // giá trị, vì đường tạo học viên chính (chốt lead — `lib/crm/convert-lead.ts:130`
  // và `convert-lead-v2.ts:341`) chỉ set `centerId`. Hệ quả đã dựng lại được trên
  // trình duyệt: chọn BẤT KỲ cơ sở nào cũng ra **0 học viên**, kể cả hai cơ sở
  // đang giữ 125 em mỗi nơi — trong khi cột vẫn in đúng tên cơ sở.
  //
  // Điều kiện dưới đây phản chiếu ĐÚNG biểu thức hiển thị: ưu tiên "đơn vị mong
  // muốn", không có thì mới xét cơ sở đang học. Sửa kiểu này không cần đổi dữ
  // liệu và không phụ thuộc việc backfill có chạy hay chưa.
  if (centerId) {
    baseFilters.AND = [
      ...(Array.isArray(baseFilters.AND) ? baseFilters.AND : baseFilters.AND ? [baseFilters.AND] : []),
      {
        OR: [
          { preferredCenterId: centerId },
          { preferredCenterId: null, centerId },
        ],
      },
    ];
  }
  if (grade != null) baseFilters.currentGrade = grade;
  // Status filter only meaningful on "all" view — other views encode status implicitly.
  if (view === "all" && statusParam) baseFilters.status = statusParam;

  const [renewalWindowDays, absentThreshold, absentWindow] = await Promise.all([
    getSetting("student.renewalWindowDays"),
    getSetting("student.frequentAbsentThreshold"),
    getSetting("student.frequentAbsentWindow"),
  ]);
  const where = buildLifecycleWhere(view, baseFilters, renewalWindowDays);

  // ─── DATA FETCH ───
  let students: StudentRow[] = [];
  let totalCount: number;

  if (view === "frequent-absent") {
    // Post-filter approach: load base candidates, then JS-filter.
    const baseStudents = await sdb.student.findMany({
      where,
      select: { id: true },
      take: FREQUENT_ABSENT_FETCH_LIMIT,
    });
    const filteredIds = await postFilterFrequentlyAbsent(
      baseStudents.map((s) => s.id),
      absentThreshold,
      absentWindow,
    );
    const filteredArr = Array.from(filteredIds);
    totalCount = filteredArr.length;
    const pageIds = filteredArr.slice((page - 1) * soDong, page * soDong);

    if (pageIds.length > 0) {
      const rows = await sdb.student.findMany({
        where: { id: { in: pageIds } },
        select: STUDENT_LIST_SELECT,
        orderBy: [{ name: "asc" }],
      });
      students = rows as StudentRow[];
    }
  } else {
    const [count, rows] = await Promise.all([
      sdb.student.count({ where }),
      sdb.student.findMany({
        where,
        select: STUDENT_LIST_SELECT,
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * soDong,
        take: soDong,
      }),
    ]);
    totalCount = count;
    students = rows as StudentRow[];
  }

  // Che SĐT phụ huynh ở SERVER cho actor thiếu quyền (chống leak qua RSC payload).
  // Hiện đầy đủ = có quyền PII VÀ không bị DENY cấp trường (TS-02).
  if (!canViewPii || phoneMasked) {
    students = students.map((s) => ({
      ...s,
      parentPhone: s.parentPhone ? maskPhone(s.parentPhone) : s.parentPhone,
    }));
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / soDong));

  // 03/09 — qua helper dùng chung. Bản cũ `sdb.center.findMany({isActive:true})`
  // bày ra CẢ 6 dòng `Center`: kèm "Hội sở" (không dạy học ⇒ lựa chọn không bao
  // giờ đúng) và 3 dòng mồ côi `ITLI_*` (cặn bộ test). `sdb` không đỡ được vì
  // `Center` thuộc `SCOPE_EXEMPT`, không phải `SCOPED_MODELS`.
  const centers = await getCenterOptions(actor);

  // URL helper preserving filters across tab/page transitions
  function urlFor(
    params: Partial<{
      view: LifecycleView;
      page: number;
      q: string;
      centerId: string;
      grade: string;
      status: string;
    }>,
  ): string {
    const u = new URLSearchParams();
    // Giữ lựa chọn số dòng khi qua trang — mất nó là mỗi lần bấm Sau lại về 20.
    if (soDong !== PAGE_SIZE) u.set("size", String(soDong));
    if (params.view && params.view !== "all") u.set("view", params.view);
    if (params.page && params.page > 1) u.set("page", String(params.page));
    if (params.q) u.set("q", params.q);
    if (params.centerId) u.set("centerId", params.centerId);
    if (params.grade) u.set("grade", params.grade);
    if (params.status) u.set("status", params.status);
    return `/students${u.toString() ? "?" + u.toString() : ""}`;
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Học viên</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {LIFECYCLE_VIEW_DESCRIPTION[view]}
          </p>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <Link
              href="/students/tai-khoan"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
            >
              Tài khoản PH
            </Link>
            <Link
              href="/students/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--primary)] px-4 py-2 text-sm font-semibold text-[color:var(--primary-foreground)] shadow-sm transition-colors hover:bg-[color:var(--primary-dark)]"
            >
              <Plus className="h-4 w-4" />
              Thêm học viên
            </Link>
            <NutXuat ma="hoc-vien" />
            <Link
              href="/students/import"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Import Excel
            </Link>
          </div>
        )}
      </div>

      {/* Lifecycle tabs */}
      <div className="mb-4 border-b border-border">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {LIFECYCLE_VIEWS.map((v) => {
            const active = v === view;
            return (
              <Link
                key={v}
                href={urlFor({
                  view: v,
                  q,
                  centerId,
                  grade: grade != null ? String(grade) : "",
                })}
                // Đổi tab lọc = vẫn ở /students, chỉ đổi tham số truy vấn. Không có
                // `scroll={false}` thì ScrollAndFocusHandler của App Router kéo về đầu
                // trang sau mỗi lần đổi tab, mất chỗ đang xem trong bảng.
                scroll={false}
                className={
                  "whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium " +
                  (active
                    ? "border-[color:var(--primary)] text-[color:var(--primary)]"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground")
                }
              >
                {LIFECYCLE_VIEW_LABEL[v]}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Filters */}
      <form
        method="GET"
        className="mb-4 flex flex-wrap items-center gap-2"
      >
        {view !== "all" && <input type="hidden" name="view" value={view} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Tên / mã / phụ huynh / SĐT phụ huynh..."
          className={`${FILTER_FIELD} min-w-0 flex-1 sm:max-w-xs`}
        />
        {view === "all" && (
          <select
            name="status"
            defaultValue={statusParam ?? ""}
            className={FILTER_FIELD}
          >
            <option value="">Tất cả trạng thái</option>
            {VALID_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_INFO[s].label}
              </option>
            ))}
          </select>
        )}
        <select
          name="centerId"
          defaultValue={centerId}
          className={FILTER_FIELD}
        >
          <option value="">Tất cả cơ sở</option>
          {centers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          name="grade"
          defaultValue={grade != null ? String(grade) : ""}
          className={FILTER_FIELD}
        >
          <option value="">Tất cả lớp</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
            <option key={g} value={g}>
              Lớp {g}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 shrink-0 rounded-lg bg-[color:var(--primary)] px-4 text-sm font-semibold text-[color:var(--primary-foreground)] transition-colors hover:bg-[color:var(--primary-dark)]"
        >
          Áp dụng
        </button>
      </form>

      <div className="mb-2 text-sm text-muted-foreground">
        {totalCount.toLocaleString("vi-VN")} học viên
        {view === "frequent-absent" &&
          totalCount === FREQUENT_ABSENT_FETCH_LIMIT && (
            <span className="ml-2 text-primary">
              (cap {FREQUENT_ABSENT_FETCH_LIMIT} — refine filter để xem hết)
            </span>
          )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted">
              <tr>
                <th className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Ảnh
                </th>
                <th className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Học viên
                </th>
                <th className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Lớp
                </th>
                <th className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Phụ huynh
                </th>
                <th className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Cơ sở
                </th>
                <th className="whitespace-nowrap px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Khoá
                </th>
                {/* "Tình trạng học" chứ không phải "Trạng thái": cột này suy từ ghi danh
                    (đang học / hoàn thành khoá / chờ xếp lớp), khác ô "Trạng thái" trong
                    form sửa học viên — ô đó là `Student.status` do người vận hành đặt. */}
                <th className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Tình trạng học
                </th>
                <th className="whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Ngày tạo
                </th>
                {showActions && (
                  <th className="whitespace-nowrap px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Hành động
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {students.length === 0 ? (
                <tr>
                  <td
                    colSpan={showActions ? 9 : 8}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    Không có học viên trong view này
                  </td>
                </tr>
              ) : (
                students.map((s) => {
                  // 22/09 — cột này in TÌNH TRẠNG HỌC (suy từ ghi danh), KHÔNG phải
                  // `Student.status` trần. Xem `lib/students/tinh-trang-hoc.ts` để biết
                  // vì sao hai thứ đó khác nhau và vì sao không ghi GRADUATED vào DB.
                  // `STATUS_INFO` vẫn dùng cho bộ lọc trạng thái phía trên — đó là ô lọc
                  // theo ĐÚNG `Student.status`, không được trộn với cột này.
                  const statusInfo = tinhTinhTrangHoc({
                    status: s.status,
                    enrollmentStatuses: s.enrollments.map((e) => e.status),
                  });
                  const reserve = s.reserves[0];
                  return (
                    <tr key={s.id} className="hover:bg-muted/60">
                      <td className="whitespace-nowrap px-5 py-3.5">
                        {s.avatarUrl ? (
                          <img
                            src={s.avatarUrl}
                            alt={s.name}
                            className="h-9 w-9 rounded-full border border-border object-cover"
                          />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                            {s.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <div className="font-medium text-foreground">
                          {s.name}
                        </div>
                        {s.studentCode && (
                          <div className="text-xs tabular-nums text-muted-foreground">
                            {s.studentCode}
                          </div>
                        )}
                        {reserve && (
                          <div
                            className="mt-0.5 text-xs text-state-warning-ink"
                            title={reserve.reason}
                          >
                            🟡 Bảo lưu từ {formatDate(reserve.startedAt)}
                            {reserve.expectedEndAt &&
                              ` → ${formatDate(reserve.expectedEndAt)}`}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-sm tabular-nums text-muted-foreground">
                        {s.currentGrade ? `Lớp ${s.currentGrade}` : "—"}
                      </td>
                      {/* max-w + truncate: `whitespace-nowrap` làm bảng rộng hơn khung nên
                          cột "Hành động" phải cuộn mới thấy. Cắt CÓ KIỂM SOÁT đúng hai ô
                          dài nhất (phụ huynh, cơ sở) thay vì để trình duyệt tự vỡ dòng —
                          xem ghi chú luật ở components/admin/ui/table.tsx. `title` để tên
                          bị cắt vẫn đọc được đầy đủ khi rê chuột. */}
                      <td className="whitespace-nowrap px-5 py-3.5 text-sm text-muted-foreground">
                        <div className="max-w-[15rem] truncate" title={s.parentName ?? undefined}>
                          {s.parentName ?? "—"}
                        </div>
                        {s.parentPhone && (
                          <div className="text-xs tabular-nums text-muted-foreground">
                            {s.parentPhone}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-sm text-muted-foreground">
                        <div
                          className="max-w-[12rem] truncate"
                          title={s.preferredCenter?.name ?? s.center?.name ?? undefined}
                        >
                          {s.preferredCenter?.name ?? s.center?.name ?? "—"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right text-sm tabular-nums text-muted-foreground">
                        {s._count.enrollments}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <span
                          className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-sm tabular-nums text-muted-foreground">
                        {formatDate(s.createdAt)}
                      </td>
                      {showActions && (
                        <td className="whitespace-nowrap px-5 py-3.5 text-right">
                          <div className="flex justify-end gap-2">
                            {canUpdate && (
                              <Link
                                href={`/students/${s.id}/edit`}
                                className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted"
                              >
                                Sửa
                              </Link>
                            )}
                            {canDelete && s.status === "INACTIVE" && (
                              <DeleteStudentButton
                                studentId={s.id}
                                studentName={s.name}
                              />
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalCount > 0 && (
        <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <ChonSoDong soDong={soDong} tong={totalCount} tenDonVi="học viên" />
            <span>
              Trang {page}/{totalPages}
            </span>
          </div>
          <DieuHuongTrangLink
            trang={page}
            soTrang={totalPages}
            hrefCua={(n: number) =>
              urlFor({
                view,
                page: n,
                q,
                centerId,
                grade: grade != null ? String(grade) : "",
                status: statusParam,
              })
            }
          />
        </div>
      )}
    </div>
  );
}
