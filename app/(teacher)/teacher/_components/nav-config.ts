import {
  Award,
  BookOpenText,
  Camera,
  CalendarDays,
  ClipboardCheck,
  Clock,
  FileText,
  GraduationCap,
  LayoutDashboard,
  MessageCircle,
  QrCode,
  Sparkles,
  Users,
  type LucideIcon,
  RefreshCw,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Mục có badge số động. `"chat"` = tổng tin nhắn chưa đọc — số do layout (RSC) tính rồi
   * truyền xuống, sidebar chỉ VẼ (cùng nguyên tắc "layout tính, nav vẽ" của admin).
   */
  badge?: "chat";
}

export interface NavGroup {
  label: string;
  /** Nhóm gập sẵn khi mở trang. */
  collapsed?: boolean;
  /** Hiển thị thẳng các mục, không bọc trong nhóm gập (vd: Tổng quan). */
  standalone?: boolean;
  items: NavItem[];
}

/**
 * Điều hướng site giáo viên — cấu trúc 4 nhóm port từ TeachUI (`src/lib/nav.ts`),
 * nhưng GIỮ NGUYÊN slug tiếng Việt `/teacher/*` của repo.
 *
 * Không đổi tên route ⇒ không phải sửa `proxy.ts`, `lib/auth/route-policy.ts`
 * hay e2e test đang bám vào các path này.
 *
 * Trên host `giaovien.satarobo.vn`, proxy rewrite clean URL (`/lich` → `/teacher/lich`),
 * nên `isNavItemActive()` phải khớp cả hai dạng path.
 *
 * "Đơn từ" của TeachUI CHƯA có (cần model mới — batch 2). "Danh sách Trial" đã có
 * (model TrialClassV2 đủ) → thêm nhóm Trial.
 */
export const navGroups: NavGroup[] = [
  {
    label: "Tổng quan",
    standalone: true,
    items: [{ label: "Tổng quan", href: "/teacher", icon: LayoutDashboard }],
  },
  {
    label: "Giảng dạy",
    items: [
      { label: "Lớp của tôi", href: "/teacher/lop", icon: Users },
      { label: "Lịch làm việc", href: "/teacher/lich", icon: CalendarDays },
      // "Điểm danh" (/teacher/diem-danh) + "Nhận xét" (/teacher/nhan-xet) ĐÃ BỎ khỏi
      // sidebar (07/08/2026) vì trùng tab trong hub "Lớp của tôi". Route + chức năng
      // GIỮ NGUYÊN — vẫn vào được từ hub lớp, dashboard và trang Hướng dẫn.
      // "Kho bài tập" ĐÃ BỎ khỏi sidebar (parity 18/08) — kho nằm trong tab
      // "Kho bài tập của tôi" của trang Bài tập; route /teacher/kho-bai-tap GIỮ NGUYÊN.
      { label: "Bài tập", href: "/teacher/cham-bai", icon: ClipboardCheck },
      { label: "Tài liệu", href: "/teacher/tai-lieu", icon: BookOpenText },
      // Sóng 3 Đợt 1 — chat với phụ huynh NGAY TRONG site GV (trước đây phải sang site
      // admin mới nhắn được). Đặt trong "Giảng dạy" vì nhóm lớp bám lớp mình dạy.
      // ⚠️ href PHẢI giữ tiền tố `/teacher`: clean URL `/tin-nhan` trên host giaovien
      // trùng segment admin (`ADMIN_ROUTE_SEGMENTS` có "tin-nhan") nên bị decideRoute
      // đá về trang chủ GV — cùng vết với `hoc-ba`/`don-tu` đã có.
      {
        label: "Tin nhắn",
        href: "/teacher/tin-nhan",
        icon: MessageCircle,
        badge: "chat",
      },
    ],
  },
  {
    label: "Trial",
    items: [
      { label: "Danh sách Trial", href: "/teacher/trial", icon: Sparkles },
      // Học bù (29/09/2026) — buổi dạy bù được xếp cho mình: điểm danh, nhận xét, tài liệu.
      { label: "Học bù", href: "/teacher/hoc-bu", icon: RefreshCw },
    ],
  },
  {
    label: "Học viên & Học bạ",
    items: [
      { label: "Học viên", href: "/teacher/hoc-vien", icon: GraduationCap },
      { label: "Học bạ", href: "/teacher/hoc-ba", icon: BookOpenText },
      { label: "Hoàn thành khoá", href: "/teacher/hoan-thanh", icon: Award },
      { label: "Ảnh lớp", href: "/teacher/anh-lop", icon: Camera },
    ],
  },
  {
    label: "Ca & Chấm công",
    items: [
      // L0 chấm công (05/09/2026) — trang hướng dẫn quét QR; đích thật của mã QR là
      // /teacher/cham-cong/checkin (segment `cham-cong` khai ở TEACHER_ROUTE_SEGMENTS).
      { label: "Chấm công", href: "/teacher/cham-cong", icon: QrCode },
      { label: "Bảng công", href: "/teacher/bang-cong", icon: Clock },
      { label: "Đơn từ", href: "/teacher/don-tu", icon: FileText },
    ],
  },
];

/** Bỏ tiền tố `/teacher` để ra clean URL tương ứng ("/teacher" → "/"). */
function cleanUrl(href: string): string {
  return href === "/teacher" ? "/" : href.slice("/teacher".length);
}

/**
 * Path hiện tại có thuộc mục này không — chấp nhận cả clean URL (host giaovien).
 * Trang con vẫn sáng mục cha (vd `/teacher/lop/abc` → "Lớp của tôi"), TRỪ mục
 * gốc `/teacher` (nếu không nó sáng ở mọi trang).
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  const clean = cleanUrl(href);
  if (href === "/teacher") return pathname === "/teacher" || pathname === "/";
  return (
    pathname === href ||
    pathname === clean ||
    pathname.startsWith(`${href}/`) ||
    pathname.startsWith(`${clean}/`)
  );
}
