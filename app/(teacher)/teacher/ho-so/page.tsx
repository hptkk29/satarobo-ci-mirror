// app/(teacher)/teacher/ho-so/page.tsx — #06 (L6): màn "Hồ sơ cá nhân" site GV
// (port visual từ mock satarobo-ui-giaovien profile/page.tsx + phần Bảo mật của
// settings/page.tsx — GỘP 1 màn; bỏ mục thông báo/giao diện vì chưa có backend).
//
// Data thật, CHỈ ĐỌC — không cho sửa role/cơ sở (thông tin do quản trị cấp):
// • Danh tính: User qua scopedDb (User/Center ∈ SCOPE_EXEMPT → pass-through,
//   giữ chuẩn app/(teacher) không import @/lib/db trần). SĐT + ngày vào làm đọc
//   qua quan hệ 1-1 User.employee (Employee.phone/joinedAt) — nested select KHÔNG
//   bị auto-scope, nhưng đây là employee record của CHÍNH GV (câu 46: SĐT GV được
//   phép hiện; joinedAt = ngày vào làm, chỉ đổi nhãn khi thật sự có).
// • Lớp đang phụ trách: actor.assignedClassIds → Class qua withMakeupException
//   (như lop/page.tsx — GV kiêm nhiệm/dạy lớp ở cơ sở khác vẫn thấy đủ lớp mình).
// • Đổi mật khẩu: ChangePasswordDialog (bản teacher mỏng) TÁI DÙNG action
//   changePassword của admin settings — self-service, không viết action mới.
//
// ⚠️ Câu 46: màn này KHÔNG đụng học viên/phụ huynh — chỉ tên lớp + sĩ số (con số).
import Link from "next/link";
import type { ClassStatus, Role } from "@prisma/client";
import {
  ArrowRight,
  BookOpen,
  BookOpenText,
  CalendarDays,
  Lock,
  Mail,
  MapPin,
  Phone,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { BatThongBao } from "@/components/push/bat-thong-bao";
import { layThietBiCuaToi } from "@/lib/push/thiet-bi";
import { resolveActor } from "@/lib/auth/actor";
import { actorGiangDay, scopedDb, withMakeupException } from "@/lib/db-scope";
import { rosterWhere } from "@/lib/enrollment-scope";
import { roleLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "../_components/ui/empty-state";
import { PageHeader } from "../_components/ui/page-header";
import { ChangePasswordDialog } from "./_components/change-password-dialog";
import { initialsOf } from "@/lib/ui/initials";
import { ngayVaoLamHopLe } from "@/lib/hr/ngay-vao-lam";

export const metadata = { title: "Hồ sơ cá nhân | Giáo viên Sata Robo" };

// Nhãn trạng thái lớp — đồng bộ STATUS_INFO của /admin/classes.
const CLASS_STATUS: Record<ClassStatus, { label: string; cls: string }> = {
  PLANNED: { label: "Đang lên KH", cls: "bg-muted text-muted-foreground" },
  RECRUITING: {
    label: "Tuyển sinh",
    cls: "bg-state-warning-soft text-state-warning-ink",
  },
  PENDING_APPROVAL: {
    label: "Chờ duyệt",
    cls: "bg-primary-soft text-primary-ink",
  },
  ACTIVE: {
    label: "Đang dạy",
    cls: "bg-state-success-soft text-state-success-ink",
  },
  COMPLETED: {
    label: "Hoàn thành",
    cls: "bg-state-info-soft text-state-info-ink",
  },
  CANCELLED: {
    label: "Huỷ",
    cls: "bg-state-danger-soft text-state-danger-ink",
  },
};

const DAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** Lịch học hiển thị: scheduleDays + khung giờ; thiếu → fallback free-text cũ. */
function scheduleText(c: {
  schedule: string | null;
  scheduleDays: number[];
  startTime: string | null;
  endTime: string | null;
}): string {
  const days = c.scheduleDays
    .filter((d) => d >= 0 && d <= 6)
    .map((d) => DAY_LABELS[d])
    .join(", ");
  const time = c.startTime && c.endTime ? `${c.startTime}–${c.endTime}` : "";
  return [days, time].filter(Boolean).join(" · ") || c.schedule || "—";
}

// "MM/YYYY" giờ VN — mốc ngày vào làm (Employee.joinedAt nếu có) hoặc tham gia
// hệ thống (User.createdAt) khi chưa có hồ sơ nhân sự.
const joinFmt = new Intl.DateTimeFormat("vi-VN", {
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

export default async function TeacherProfilePage() {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate — guard cho type-narrow

  const actor = await resolveActor(session.user.id);
  // Web Push Đợt 3 — thiết bị của CHÍNH giáo viên đang đăng nhập.
  const thietBiPush = await layThietBiCuaToi(session.user.id);
  const sdb = scopedDb(actorGiangDay(actor));
  const xdb = withMakeupException(actorGiangDay(actor));
  const classIds = [...actor.assignedClassIds];

  const [user, classes] = await Promise.all([
    // Danh tính CHÍNH MÌNH (where id = mình) — User ∈ SCOPE_EXEMPT nên pass-through.
    sdb.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        role: true,
        roles: true,
        createdAt: true,
        center: { select: { name: true } },
        // Hồ sơ nhân sự CHÍNH GV (1-1 qua employeeId) — chỉ SĐT + ngày vào làm.
        // Câu 46: đây là dữ liệu của chính GV, KHÔNG phải học viên/phụ huynh.
        employee: { select: { phone: true, joinedAt: true } },
      },
    }),
    // Lớp mình phụ trách (teacher/assistant) — Class ∈ MAKEUP_EXCEPTION_MODELS,
    // đọc qua withMakeupException để lớp kiêm nhiệm ở cơ sở khác không bị ẩn oan.
    // Câu 46: chỉ tên lớp/khoá/cơ sở/lịch + SĨ SỐ (con số) — không dữ liệu HV/PH.
    classIds.length
      ? xdb.class.findMany({
          where: { id: { in: classIds } },
          select: {
            id: true,
            name: true,
            schedule: true,
            scheduleDays: true,
            startTime: true,
            endTime: true,
            status: true,
            maxStudents: true,
            course: { select: { name: true } },
            center: { select: { name: true } },
            // Trước đây `enrollments: true` trần — đếm CẢ ghi danh đã gỡ mềm, đã
            // nghỉ, đã huỷ và cả "chờ xác nhận", nên sĩ số ở hồ sơ GV luôn cao hơn
            // mọi màn khác. Đây là hình dạng thứ năm của cùng một truy vấn.
            _count: {
              select: { enrollments: { where: rosterWhere("dang-hoc") } },
            },
          },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  if (!user) return null; // layout liveness đã chặn user xoá/disable

  const displayName = user.name ?? user.email ?? "Giáo viên";
  // Vai trò = union role chính + roles[] (đa vai trò) — CHỈ ĐỌC, không cho sửa.
  const roleCodes: Role[] = [...new Set<Role>([user.role, ...user.roles])];

  // SĐT + ngày vào làm từ hồ sơ nhân sự (nếu GV có Employee record 1-1).
  const phone = user.employee?.phone ?? null;
  // Chỉ đổi nhãn "Tham gia hệ thống"→"Ngày vào làm" khi thật sự có joinedAt;
  // nếu chỉ có User.createdAt (chưa có hồ sơ NS) thì giữ nhãn cũ (đừng bịa).
  // Cổng `ngayVaoLamHopLe` loại mốc Unix 1970 (NULL bị ghi thành 0 — 13 hồ sơ trên prod
  // 08/09/2026). Không có cổng thì giáo viên thấy "Ngày vào làm: 01/1970" trong hồ sơ
  // của chính mình. Rơi về `user.createdAt` với nhãn "Tham gia hệ thống" là câu ĐÚNG:
  // nó nói thứ hệ thống thật sự biết, thay vì bịa một ngày.
  const hireDate = ngayVaoLamHopLe(user.employee?.joinedAt);
  const joinLabel = hireDate ? "Ngày vào làm" : "Tham gia hệ thống";
  const joinValue = joinFmt.format(hireDate ?? user.createdAt);

  return (
    <div>
      <PageHeader
        title="Hồ sơ cá nhân"
        subtitle="Thông tin tài khoản và lớp phụ trách của bạn — vai trò/cơ sở do quản trị cấp, liên hệ quản lý nếu cần thay đổi."
      />

      <div className="space-y-5">
        {/* Danh tính (port card đầu của mock profile) */}
        <Card>
          <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center">
            <span className="brand-gradient flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white">
              {initialsOf(displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-extrabold text-foreground">
                  {displayName}
                </h2>
                {roleCodes.map((code) => (
                  <span
                    key={code}
                    className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary-ink"
                  >
                    {roleLabel(code)}
                  </span>
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-4 w-4" aria-hidden />
                  {user.email}
                </span>
                {phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="h-4 w-4" aria-hidden />
                    {phone}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" aria-hidden />
                  {user.center?.name ?? "Chưa gán cơ sở"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Lớp đang phụ trách */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-primary-ink" aria-hidden />
              Lớp đang phụ trách
            </CardTitle>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              {classes.length} lớp
            </span>
          </CardHeader>
          <CardContent className="space-y-3">
            {classes.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="Bạn chưa được phân công lớp nào."
              />
            ) : (
              classes.map((c) => (
                <Link
                  key={c.id}
                  href={`/teacher/lop?classId=${c.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 transition-colors hover:bg-muted/50"
                  title="Mở buổi học của lớp"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">
                      {c.name}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {c.course.name}
                      {c.center?.name ? ` · ${c.center.name}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="h-4 w-4" aria-hidden />
                      {scheduleText(c)}
                    </span>
                    <span>
                      {c._count.enrollments}/{c.maxStudents} HV
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        CLASS_STATUS[c.status].cls,
                      )}
                    >
                      {CLASS_STATUS[c.status].label}
                    </span>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Thông tin cá nhân (grid Field như mock) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Thông tin cá nhân</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field label="Họ và tên" value={displayName} />
            <Field
              label="Vai trò"
              value={roleCodes.map(roleLabel).join(", ")}
            />
            <Field label="Email" value={user.email ?? "—"} />
            <Field label="Số điện thoại" value={phone ?? "Chưa cập nhật"} />
            <Field
              label="Cơ sở"
              value={user.center?.name ?? "Chưa gán cơ sở"}
            />
            <Field label={joinLabel} value={joinValue} />
            <Field label="Lớp đang phụ trách" value={`${classes.length} lớp`} />
          </CardContent>
        </Card>

        {/* Bảo mật (port card Bảo mật của mock settings — chỉ giữ đổi mật khẩu) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4 text-primary-ink" aria-hidden />
              Bảo mật
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Mật khẩu</p>
              <p className="text-xs text-muted-foreground">
                Đổi mật khẩu đăng nhập của bạn — nên đổi định kỳ.
              </p>
            </div>
            <ChangePasswordDialog />
          </CardContent>
        </Card>

        {/* Thông báo đẩy (Web Push Đợt 3) — cùng khuôn card Bảo mật ngay trên, và dùng CHUNG
            component + Server Action với màn /settings của admin, đúng tiền lệ
            ChangePasswordDialog. Giáo viên THUẦN làm việc ở host này chứ không phải admin
            (TEACHER_SITE_ENABLED mặc định ON), nên thiếu khối này là đúng nhóm người đó
            không có đường bật thông báo. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="h-4 w-4 text-primary-ink" aria-hidden />
              Thông báo đẩy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BatThongBao thietBi={thietBiPush} nguoiDung={session.user.id} />
          </CardContent>
        </Card>

        {/* Hướng dẫn sử dụng — lối vào bộ tài liệu hướng dẫn từng trang của site GV */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpenText className="h-4 w-4 text-primary-ink" aria-hidden />
              Hướng dẫn sử dụng
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Tài liệu hướng dẫn từng trang của site giáo viên
              </p>
              <p className="text-xs text-muted-foreground">
                Chia theo nhóm chức năng — mỗi bài có các bước thao tác chi tiết
                và đường dẫn mở thẳng trang tương ứng.
              </p>
            </div>
            <Link
              href="/teacher/huong-dan"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring outline-none"
            >
              Mở hướng dẫn
              <ArrowRight
                className="h-4 w-4 text-muted-foreground"
                aria-hidden
              />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
