import { Info, Lock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ba trong bốn trạng thái bắt buộc của DESIGN.md §5 (trạng thái thứ tư — đang tải —
 * là skeleton, thuộc về từng trang vì nó phải mang đúng hình dạng nội dung thật).
 *
 * `NoPermission` là màn hạng NHẤT ở hệ này, không phải ca hiếm: phân quyền theo
 * module × cơ sở nên người dùng gặp nó hằng ngày. Nó phải nói ĐANG THIẾU QUYỀN NÀO và
 * HỎI AI — một cái 403 trần chỉ khiến người ta nhắn tin cho dev.
 */

function Shell({
  icon,
  title,
  children,
  action,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  tone: "muted" | "danger" | "warning";
}) {
  const tint = {
    muted: "bg-muted text-muted-foreground",
    danger: "bg-[color:var(--state-danger-soft)] text-[color:var(--state-danger)]",
    warning: "bg-[color:var(--state-warning-soft)] text-[color:var(--state-warning)]",
  }[tone];

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-12 text-center">
      <span className={cn("mb-3 flex h-11 w-11 items-center justify-center rounded-full", tint)}>
        {icon}
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {children && (
        <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Rỗng — phải nói VÌ SAO rỗng và LÀM GÌ TIẾP, không chỉ "Không có dữ liệu". */
export function EmptyState({
  title = "Chưa có dữ liệu",
  description,
  action,
}: {
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Shell tone="muted" icon={<Info className="h-5 w-5" aria-hidden />} title={title} action={action}>
      {description}
    </Shell>
  );
}

/** Lỗi — câu tiếng Việt người thường đọc được, kèm đường thử lại. */
export function ErrorState({
  title = "Không tải được dữ liệu",
  description = "Có lỗi khi đọc dữ liệu từ máy chủ. Thử tải lại trang; nếu vẫn lỗi, báo bộ phận kỹ thuật.",
  action,
}: {
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Shell
      tone="danger"
      icon={<TriangleAlert className="h-5 w-5" aria-hidden />}
      title={title}
      action={action}
    >
      {description}
    </Shell>
  );
}

/**
 * Không có quyền. `permission` là KEY THẬT trong registry quyền (vd `students:view-all`)
 * — in ra để người dùng nhắn đúng thứ cần xin, thay vì mô tả mơ hồ.
 */
export function NoPermission({
  permission,
  what = "mục này",
  askWho = "quản trị viên hệ thống",
}: {
  permission?: string;
  what?: string;
  askWho?: string;
}) {
  return (
    <Shell
      tone="warning"
      icon={<Lock className="h-5 w-5" aria-hidden />}
      title={`Bạn không có quyền xem ${what}`}
    >
      <p>
        Tài khoản của bạn chưa được cấp quyền cho phần này. Liên hệ {askWho} để xin cấp.
      </p>
      {permission && (
        <p className="mt-2">
          Quyền cần xin:{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
            {permission}
          </code>
        </p>
      )}
    </Shell>
  );
}
