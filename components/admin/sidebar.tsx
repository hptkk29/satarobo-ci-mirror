"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  // ⚠️ `BadgeCheck` ĐÃ GỠ ở lượt gộp 27/09 — cố ý, không phải sót khi gỡ xung đột.
  // Nó là biểu tượng của mục "Duyệt đơn hàng", mà mục ấy gỡ 25/09 (hàng chờ nay là một
  // KHỐI trong `/orders`). Giữ lại một import không ai dùng thì `lint` kêu, và quan trọng
  // hơn: nó để lại dấu hiệu rằng mục kia "chỉ tạm ẩn", trong khi nó đã đi hẳn.
  // Trophy,
  // tạm ẩn cùng mục "Vinh danh" trong NAV_GROUPS (bật lại: bỏ comment)
  AlertTriangle,
  AlarmClock,
  ArrowLeftRight,
  Award,
  BarChart3,
  Bell,
  BookMarked,
  BookOpen,
  Boxes,
  Briefcase,
  Cake,
  CalendarCheck,
  CheckCheck,
  ChevronDown,
  PanelLeftClose,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Coins,
  CreditCard,
  FileSpreadsheet,
  FlaskConical,
  Gauge,
  GraduationCap,
  HeartHandshake,
  IdCard,
  Image as ImageIcon,
  KeyRound,
  LayoutDashboard,
  ListOrdered,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquarePlus,
  MessageSquareText,
  Clock3,
  MessagesSquare,
  Megaphone,
  Network,
  Newspaper,
  NotebookText,
  Package,
  Package2,
  Plug,
  ReceiptText,
  RefreshCw,
  CirclePause,
  ScrollText,
  Send,
  Settings,
  Share2,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Target,
  type LucideIcon,
  Undo2,
  UserCog,
  UserPlus,
  UserRound,
  TicketPercent,
  Users,
  UsersRound,
  Wallet,
  Waypoints,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatUnread } from "@/components/chat/use-chat-unread";
import { type Action } from "@/lib/auth/permissions";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { QUYEN_TAB } from "@/lib/settings/nhan-van-hanh";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Hiện mục nếu user có quyền với BẤT KỲ action nào trong đây. Bỏ trống = luôn hiện. */
  perm?: Action[];
  /** Mục có badge số động. `"chat"` = tổng tin nhắn chưa đọc (layout tính, sidebar vẽ). */
  badge?: "chat";
  /**
   * Mục gắn feature flag — chỉ hiện khi flag BẬT (R7-16: "eval").
   *
   * ⚠️ "classGroup" là cờ GỠ, không phải cờ mở: mặc định TẮT nên mục biến mất,
   * env `CLASS_GROUP_ENABLED="true"` mới hiện lại. Xem lib/flags.ts.
   *
   * "zalocrm" (S1, 06/09/2026) là cờ MỞ 2 pha: mặc định TẮT cho tới khi máy chủ ZaloCRM
   * chạy thật. Cùng cờ đó cũng làm trang `/zalo-crm` trả 404, nên menu và trang bật/tắt
   * đồng bộ — không có cảnh bấm menu ra 404.
   */
  flag?: "eval" | "scorm" | "classGroup" | "zalocrm" | "hoaDon" | "nguonLead" | "hoaHongEngine";
  /**
   * R3: nhãn cụm con (sub-section) trong 1 NavGroup. Các item liền kề cùng `cluster`
   * được gom dưới 1 nhãn nhỏ — render trước item ĐẦU TIÊN hiển thị của cụm (robust với
   * filter quyền: bất kể package hay course là item đầu còn lại sau lọc).
   */
  cluster?: string;
};

type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Tổng quan",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }, // luôn hiện
      // 27/08 — GỠ mục "Dashboard QLCS" khỏi menu (chủ dự án chốt). Bốn khối của nó nay
      // nằm THẲNG trong "Dashboard" cho Quản lý cơ sở + Quản trị hệ thống, không phân tab
      // nữa: hai vai đó đăng nhập là thấy ngay số của mình, khỏi phải biết có màn thứ hai.
      // Route /dashboard-qlcs GIỮ NGUYÊN (đường dẫn cũ đã gửi đi, và gate trang vẫn cần)
      // nên nó nằm trong ALLOWLIST của components/admin/nav-coverage.test.ts.
      { label: "CRM", href: "/crm", icon: BarChart3, perm: ["leads:view-all"] },
    ],
  },
  {
    label: "CRM & Tuyển sinh",
    items: [
      { label: "Leads", href: "/leads", icon: Users, perm: ["leads:view-all", "leads:view-own"] },
      // Nhập nhanh khách hàng sau đăng nhập, thay biểu mẫu công khai
      // sale.satarobo.vn (nghỉ 22/08/2026). perm khớp PAGE_GATES["/nhap-khach-hang"].
      //
      // 23/08/2026: trang DỜI VÀO ADMIN — bấm mục này nay ở lại trong khung
      // admin thay vì nhảy sang satarobo.vn rồi phải bấm quay lại. Địa chỉ
      // public cũ vẫn sống, đá 307 về đây.
      { label: "Nhập khách hàng", href: "/nhap-khach-hang", icon: UserPlus, perm: ["leads:create"] },
      // PR #81 — nhập liệu ban đầu: import Excel "đã đăng ký" rồi chốt hàng loạt.
      // perm khớp gate trang (leads:view-all AND leads:import) — sidebar dùng OR nên
      // để leads:import (Sale có leads:import nhưng KHÔNG có view-all → trang tự
      // redirect; đặt view-all ở đây để không hiện link chết cho Sale).
      { label: "Chốt hàng loạt", href: "/leads/bulk-convert", icon: Workflow, perm: ["leads:view-all"] },
      // 30/08 — gộp: hai màn cũ (Cấu hình chia lead · Sổ lượt) đã xoá, thay bằng
      // trang trả lời hai nửa của cùng một câu hỏi: chia KIỂU GÌ, và đã chia RA SAO.
      // perm rộng hơn cấu hình (không phải assign-config): người phải trả lời
      // "sao bạn kia nhiều lead hơn" là Quản lý cơ sở, không phải Super Admin.
      // `leads:rotation-view` (S-5, chỉ đọc) đi kèm từ 16/09/2026: màn "Sổ lượt chia
      // lead" đã nhập vào đây. Menu PHẢI khớp cổng trang — lệch là hoặc dead-link
      // (thấy mục, bấm vào bị đá) hoặc hở-quyền-theo-URL (vào được mà không có mục).
      { label: "Quản lý chia lead", href: "/quan-ly-chia-lead", icon: ListOrdered, perm: ["lead_pool:manage", "leads:rotation-view"] },
      // 01/10/2026 — Sale cũng vào được (tab "Chuyển lead", quyền leads:edit); tab "Bàn giao
      // hàng loạt" trong trang vẫn gác leads:assign.
      { label: "Bàn giao lead", href: "/ban-giao-lead", icon: ArrowLeftRight, perm: ["leads:assign", "leads:edit"] },
      { label: "Lead lâu ngày chưa chăm", href: "/lead-nguoi", icon: AlarmClock, perm: ["leads:assign"] },
      { label: "Chuyển lead liên CS", href: "/leads/bao-cao-chuyen", icon: Workflow, perm: ["leads:assign"] },
      // BGĐ 31/07 — nguồn giới thiệu (affiliate): mã + link ?ref= + đối soát.
      { label: "Nguồn giới thiệu", href: "/affiliates", icon: Share2, perm: ["leads:view-all"] },
      // 08/10/2026 — module "Nguồn lead & Chính sách hoa hồng": HAI mục, mỗi mục MỘT cờ (05 §1.5, §2.3).
      // Bộ lọc dưới AND cờ với `perm` tĩnh của MỘT mục, nên một mục mang `perm` = hợp mọi key sẽ hiện cho
      // Sale (chỉ `commission:view-self`) suốt PILOT NGUỒN (cờ nguồn bật, engine tắt) mà bấm vào không mở
      // được tab nào. Tách ra: "Nguồn lead" chỉ cần `sources:view` + cờ nguồn; "Sổ hoa hồng" chỉ cần
      // view-self/view-center + cờ engine. `perm` bằng ĐÚNG `PAGE_GATES[href]` (menu ≡ gate); ca [NHH-FE-02b].
      // Nhãn "Sổ hoa hồng" để khỏi trùng mục cũ "Hoa hồng" (`/crm/commission`, chỉ đọc kỳ trước cutover).
      { label: "Nguồn lead", href: "/nguon-hoa-hong/nguon", icon: Waypoints, perm: [...PAGE_GATES["/nguon-hoa-hong/nguon"]], flag: "nguonLead" },
      { label: "Sổ hoa hồng", href: "/nguon-hoa-hong/so", icon: NotebookText, perm: [...PAGE_GATES["/nguon-hoa-hong/so"]], flag: "hoaHongEngine" },
      // R1-01 — hội thoại Messenger của Page. Trang có thật từ lâu nhưng CHƯA BAO GIỜ
      // có lối vào: chỉ gõ URL mới tới (rà 11/08).
      { label: "Messenger CRM", href: "/crm/messenger", icon: MessagesSquare, perm: ["leads:view-all", "leads:view-own"] },
      // GĐ6 — hai lối vào cũ ĐÃ GỠ khỏi menu. Route /trials và /trial-classes vẫn sống
      // dưới dạng chuyển hướng (thông báo cũ trong DB và tài liệu hướng dẫn còn trỏ tới
      // đó), nhưng không còn là chỗ để người ta bấm vào và nhập liệu song song nữa.
      { label: "Lớp Trial", href: "/lop-trial", icon: FlaskConical, perm: ["trials:view"] },
      // Tra cứu (22/09/2026) — bảng giá khoá + học cụ + lớp còn chỗ, CHỈ ĐỌC. Chuyển
      // từ site Sale (`/sale/tra-cuu`) về admin: màn này dùng TRƯỚC MẶT KHÁCH nên
      // giá trị của nó là tra được ngay, không phải mở ba màn quản trị.
      // `perm` lấy thẳng từ PAGE_GATES — mục menu và cổng trang không được lệch nhau.
      { label: "Tra cứu", href: "/tra-cuu", icon: BookMarked, perm: [...PAGE_GATES["/tra-cuu"]] },
      // 26/09/2026 — văn bản khuyến mãi BLĐ ban hành. Ở nhóm tuyển sinh vì người đọc chính là
      // Sale khi tư vấn; BLĐ ban hành cũng từ đây (nút trong trang gác `promotions:manage`).
      { label: "Khuyến mãi", href: "/khuyen-mai", icon: TicketPercent, perm: [...PAGE_GATES["/khuyen-mai"]] },
    ],
  },
  {
    label: "Học viên & Đăng ký học",
    items: [
      { label: "Học viên", href: "/students", icon: GraduationCap, perm: [...PAGE_GATES["/students"]] },
      // PR #81 — màn vận hành TK phụ huynh chờ kích hoạt (gate students:edit, cùng
      // quyền với nút cấp TK per-student). Thiếu link ở đây thì màn thành ẩn.
      { label: "Tài khoản phụ huynh", href: "/students/tai-khoan", icon: KeyRound, perm: ["students:edit"] },
      { label: "Đăng ký học", href: "/enrollments", icon: ClipboardList, perm: ["enrollments:view-all"] },
      { label: "Chuyển lớp / cơ sở", href: "/chuyen-lop", icon: ArrowLeftRight, perm: [...PAGE_GATES["/chuyen-lop"]] },
      // 08/10/2026 — hồ sơ bảo lưu theo SR.QD.236. Không gắn `flag:` — công tắc là THAM SỐ THEO CƠ SỞ (`pause.enabled`),
      // sidebar không biết cơ sở nào đang xem; màn tự báo "chưa bật" (xem page.tsx). TODO(bao-luu Q-nav-flag).
      { label: "Bảo lưu", href: "/bao-luu", icon: CirclePause, perm: [...PAGE_GATES["/bao-luu"]] },
      { label: "Hoàn thành khoá & chứng chỉ", href: "/hoan-thanh-khoa", icon: Award, perm: ["completions:manage"] },
      { label: "SataCoin", href: "/satacoin", icon: Coins, perm: ["satacoin:manage"] },
    ],
  },
  {
    label: "Lớp học & Lịch học",
    items: [
      // `session-feedback:view-all` tới từ nhánh main (xem nhận xét/đánh giá từng
      // buổi) — giữ nguyên, đừng gỡ khi giải quyết xung đột.
      { label: "Lớp học", href: "/classes", icon: BookOpen, perm: ["classes:view-all", "classes:view-own", "session-feedback:view-all"] },
      // 20/08/2026 — chủ dự án yêu cầu ẩn hẳn tính năng Nhóm lớp khỏi sidebar.
      // Giữ mục lại (thay vì xoá dòng) để bật lại chỉ tốn 1 env, không cần nhớ
      // icon/perm/thứ tự cũ. Route /class-groups cũng đã bị layout chặn.
      { label: "Nhóm lớp", href: "/class-groups", icon: Boxes, perm: ["class_group:view-all"], flag: "classGroup" },
      { label: "Lịch tổng", href: "/lich", icon: CalendarCheck, perm: ["sessions:view", "classes:view-all", "classes:view-own"] },
      // attendance:edit đi kèm vì CSKH (Sale) chỉ có quyền SỬA hồi tố (Task #16),
      // không có attendance:view — thiếu nó thì họ dùng được trang mà không thấy link.
      { label: "Điểm danh", href: "/attendance", icon: ClipboardCheck, perm: ["attendance:view", "attendance:edit"] },
      { label: "Ảnh lớp học", href: "/media", icon: ImageIcon, perm: [...PAGE_GATES["/media"]] },
      // MEDIA-REVIEW (26/08) — cổng duyệt ảnh theo NGÀY → LỚP, tách khỏi "Ảnh lớp học"
      // (thư viện tra cứu). Đặt ngay dưới để hai mục ảnh nằm cạnh nhau.
      { label: "Duyệt ảnh", href: "/duyet-media", icon: CheckCheck, perm: [...PAGE_GATES["/duyet-media"]] },
      { label: "Học bù", href: "/hoc-bu", icon: RefreshCw, perm: [...PAGE_GATES["/hoc-bu"]] },
      // 01/10/2026 — "Phòng học" gộp vào đây (quản lý trong từng cơ sở; /rooms vẫn có link từ /centers).
      { label: "Cơ sở", href: "/centers", icon: MapPin, perm: ["centers:view"] },
      // "Lịch nghỉ" (/holidays) gỡ khỏi đây 06/09: nó đã là tab "Ngày lễ" trong ConfigTabs của
      // Chấm công (components/admin/cham-cong/config-tabs.tsx), và ngày lễ chỉ được khai để
      // tính công chuẩn — không phải việc hằng ngày của người xếp lớp.
    ],
  },
  {
    label: "LMS / Học liệu",
    items: [
      // 01/10/2026 — chủ dự án gỡ khỏi sidebar: Học bạ + Học bạ năng lực (vào từ hồ sơ học viên),
      // Buổi học (từ Lịch tổng / dashboard GV), Đề xuất sửa giáo án (badge ở /curriculums), Khoá
      // tiên quyết (tab Thiết lập của giáo trình), Tài liệu giảng dạy · Bài tập · SCORM (trong chi
      // tiết giáo trình) và Tài liệu lớp tôi (việc của GV — site GV có màn riêng). Route vẫn sống.
      { label: "Chương trình học", href: "/curriculums", icon: BookMarked, perm: ["curriculum:view"] },
      // FL-R2-W5 (R2-LMS-1): 1 entry "Khoá học" → /courses (khoá dạy); gói bán quản lý
      // ngay trong chi tiết khoá. Gộp DB Course/Package + xoá /course-packages = 2-phase
      // deferred (Order đa hình, KHÔNG drop packageId giờ) — route /course-packages GIỮ tạm.
      { label: "Khoá học", href: "/courses", icon: Boxes, perm: ["courses:view"] },
    ],
  },
  {
    label: "CSKH & Phụ huynh",
    items: [
      // FL W0-NAV-2 hygiene: Tin nhắn (CSKH) gate CSKH+GV — ẩn khỏi KT (BA #07 3.C) + MKT/HR/Training.
      { label: "Tin nhắn", href: "/tin-nhan", icon: MessageCircle, perm: [...PAGE_GATES["/tin-nhan"]], badge: "chat" },
      // S1 (tích hợp ZaloCRM) — nhắn khách bằng nick Zalo CÁ NHÂN, qua giao diện fork
      // ZaloCRM nhúng iframe. Đặt cạnh "Tin nhắn" vì cùng một việc dưới mắt Sale: trả lời
      // khách. Cờ `zalocrm` mặc định TẮT ⇒ mục ẩn cho tới khi máy chủ ZaloCRM chạy thật.
      { label: "Zalo CRM", href: "/zalo-crm", icon: MessageSquareText, perm: [...PAGE_GATES["/zalo-crm"]], flag: "zalocrm" },
      // US-15 — tra cứu có lý do + khoá hội thoại. `chat:admin` CHỈ SUPER_ADMIN có
      // (AC5: QLCS không vào được), và nó seed scope GLOBAL nên dùng làm gate cấp trang
      // được — khác chat:read/chat:send (CENTER/ASSIGNED), xem lib/auth/page-gates.ts.
      // KHÔNG đưa vào PAGE_GATES: bảng đó dành cho route có nhiều action OR với nhau.
      { label: "Quản trị hội thoại", href: "/hoi-thoai", icon: MessagesSquare, perm: ["chat:admin"] },
      { label: "Yêu cầu phụ huynh", href: "/parent-requests", icon: MessageSquarePlus, perm: ["parent-requests:manage"] },
      { label: "Đánh giá PH", href: "/parent-feedback", icon: Star, perm: ["parent-feedback:view"] },
      { label: "Khảo sát / NPS", href: "/khao-sat", icon: Gauge, perm: ["parent-feedback:view"] },
      { label: "Đánh giá & Khảo sát", href: "/evaluations", icon: ClipboardList, perm: ["evaluations:manage"], flag: "eval" },
      { label: "Thông báo PH", href: "/notifications", icon: Bell, perm: ["notifications:manage"] },
      // FL W0-NAV-2 hygiene: Cảnh báo rủi ro = CSKH/quản lý (giữ Sale), ẩn khỏi KT (BA #07 3.C) + MKT/HR/Training.
      { label: "Cảnh báo rủi ro", href: "/canh-bao-rui-ro", icon: AlertTriangle, perm: [...PAGE_GATES["/canh-bao-rui-ro"]] },
      // FL W0-NAV-2 hygiene: Chăm sóc HV = CSKH/quản lý + GV (giữ Sale & GV), ẩn khỏi KT.
      { label: "Chăm sóc HV", href: "/cham-soc-hv", icon: HeartHandshake, perm: [...PAGE_GATES["/cham-soc-hv"]] },
      // Sinh nhật HV (06/08/2026) — cùng nhóm chăm sóc; gate students:view-all nên
      // Sale/QLCS/Kế toán/MKT/HR thấy, GV không (GV được báo riêng theo buổi dạy).
      { label: "Sinh nhật HV", href: "/sinh-nhat", icon: Cake, perm: [...PAGE_GATES["/sinh-nhat"]] },
    ],
  },
  {
    label: "Nhân sự & Giáo viên",
    items: [
      { label: "Giáo viên", href: "/teachers", icon: UserCog, perm: ["employees:view-all"] },
      { label: "Nhân sự", href: "/nhan-su", icon: IdCard, perm: ["employees:view-all"] },
      // P2 · US-08/09/10 — vị trí + phân công + điều động. Vị trí mang bộ vai trò nên
      // cùng cổng với cấu hình role (SUPER_ADMIN). Đặt ở nhóm Nhân sự vì đó là luồng
      // công việc thật: xem nhân sự → xếp vị trí → phân công.
      { label: "Vị trí công việc", href: "/nhan-su/vi-tri", icon: Briefcase, perm: [...PAGE_GATES["/nhan-su/vi-tri"]] },
      // Module chấm công v3 — thiết kế lại 06/09/2026 (DESIGN-CHAM-CONG-ADMIN §1.1): sidebar
      // rút 15 mục xuống 5. 10 màn còn lại (khung ca, import, ghi chú, mã ca, loại nghỉ, đối
      // soát, điểm chấm, check-in, đơn của tôi, màn hình QR) KHÔNG mất lối vào — chúng vào qua
      // ModuleNav / ConfigTabs / MeNav trong components/admin/cham-cong/* và nút ở màn cha.
      // DỄ VỠ: nav-coverage.test.ts đòi mọi route tĩnh phải có literal đường dẫn ở đâu đó; gỡ
      // thêm mục ở đây mà không còn nơi trỏ tới là CI đỏ. Route không đổi (href nằm trong DB).
      // 06/09 (đợt 2, chủ dự án): rút tiếp 5 → 3. "Lịch phân ca" và "Kỳ công" đã là hai tab
      // ĐẦU của ModuleNav ngay trong màn Chấm công, nên để ở sidebar là bày cùng một cửa hai
      // lần — người dùng phải đoán hai đường đó khác nhau chỗ nào (thật ra không khác).
      { label: "Chấm công", href: "/cham-cong", icon: Clock, perm: ["hr_attendance:view"] },
      // BGĐ 31/07 — duyệt đơn GV (nghỉ dạy / dạy thay) — duyệt là cập nhật lịch thật.
      { label: "Duyệt đơn từ", href: "/don-tu", icon: ClipboardList, perm: ["hr_attendance:approve"] },
      // Cụm "Của tôi" của nhân viên: vào lịch ca rồi rẽ sang Đơn của tôi / Chấm công bằng MeNav.
      { label: "Của tôi", href: "/cham-cong/lich-ca", icon: UserRound, perm: ["hr_attendance:checkin"] },
      // FL W0-NAV-2 hygiene: Tổng hợp công ca = view tổng hợp (quản lý/HR), ẩn khỏi Sale/KT (BA #07 3.C).
      { label: "Tuyển dụng", href: "/jobs", icon: Briefcase, perm: ["jobs:view"] },
      // Tạm ẩn khu Vinh danh khỏi admin (giữ code + dữ liệu). Bật lại: bỏ comment
      // dòng dưới + import Trophy, và xoá app/(admin)/admin/honors/layout.tsx.
      // { label: "Vinh danh", href: "/honors", icon: Trophy, perm: ["honors:settings"] },
    ],
  },
  {
    label: "Sản phẩm & Kho",
    items: [
      { label: "Học cụ (Kits)", href: "/kits", icon: Package, perm: ["kits:view"] },
      { label: "Sản phẩm bán/thuê", href: "/products", icon: Package2, perm: ["products:view"] },
      // FL W0-NAV-2 (BA #07 3.C): kế toán có quyền inventory:view/audit nhưng thiếu menu kho → thêm.
      { label: "Tồn kho", href: "/inventory/dashboard", icon: Boxes, perm: ["inventory:view"] },
      { label: "Kiểm kê kho", href: "/inventory/audit", icon: ClipboardCheck, perm: ["inventory:audit"] },
    ],
  },
  {
    label: "Tài chính",
    items: [
      { label: "Đơn hàng", href: "/orders", icon: ShoppingBag, perm: ["orders:view"] },
      // ⚠️ MỤC "Duyệt đơn hàng" ĐÃ GỠ 25/09/2026 — cố ý, không phải bỏ sót.
      //
      // Chủ dự án: *"đưa mục duyệt đơn vào trong màn đơn hàng, các đơn hàng cần duyệt thì
      // thiết kế nổi bật lên để QLCS biết"*. Hàng chờ duyệt nay là một KHỐI ở đầu màn
      // `/orders` (`_components/khoi-cho-duyet.tsx`), và nó chỉ hiện khi có việc thật.
      //
      // Vì sao một mục sidebar riêng là sai chỗ: nó chỉ dẫn được người ĐÃ BIẾT là mình
      // phải đi duyệt. Đơn chờ duyệt là đơn không xuất được mã QR — tức đang chặn sale thu
      // tiền — nên tín hiệu phải nằm ở nơi người ta làm việc hằng ngày, chứ không đợi
      // người ta nhớ ra mà bấm vào.
      //
      // `/orders/duyet` vẫn sống, đá 307 về `/orders` cho link cũ và thói quen gõ tay.
      // Ghi nhận khoản thu là việc của quầy (payments:record) — xem ghi chú trong
      // app/(admin)/admin/payments/page.tsx. Đừng thu lại còn mỗi payments:manage.
      { label: "Thanh toán", href: "/payments", icon: CreditCard, perm: ["payments:manage", "payments:record"] },
      // Màn của KẾ TOÁN: tải phiếu thu chờ → tải tệp hoá đơn MISA lên (docs/ke-toan-hoa-don/PLAN.md).
      // Cờ `billing.hoaDonEnabled` (setting DB) — TẮT thì mục ẩn và trang 404.
      { label: "Hoá đơn điện tử", href: "/payments/hoa-don", icon: ReceiptText, perm: [...PAGE_GATES["/payments/hoa-don"]], flag: "hoaDon" },
      { label: "Công nợ", href: "/cong-no", icon: Wallet, perm: ["payments:manage", "payments:view"] },
      // Nhóm HV chốt hàng loạt mà chưa nhập tiền: có ghi danh nhưng KHÔNG có đơn/khoản thu
      // (nhánh allowNoPayment của bulk-convert). Không màn nào khác nhìn thấy nhóm này.
      { label: "Thiếu học phí", href: "/thieu-hoc-phi", icon: Wallet, perm: ["payments:view", "payments:manage"] },
      // Đưa học phí đã đóng TRƯỚC khi lên hệ thống vào hồ sơ từng em — nếu không thì
      // cổng phụ huynh hiện nợ nguyên dù nhà đã đóng đủ. Gác `payments:record` vì đây là
      // đường GHI TIỀN, cùng cổng với màn Thanh toán.
      { label: "Nhập giao dịch cũ", href: "/nhap-giao-dich-cu", icon: FileSpreadsheet, perm: ["payments:record", "payments:manage"] },
      // Đối soát tiền về từ SePay — nơi kiểm "máy đã tự xác nhận đúng chưa".
      { label: "Biến động số dư", href: "/bien-dong-so-du", icon: Wallet, perm: ["payments:manage", "payments:view"] },
      { label: "Hoàn tiền", href: "/hoan-tien", icon: Undo2, perm: ["payments:manage"] },
      // "Phương thức TT" ĐÃ GỠ khỏi sidebar 14/09/2026 theo chốt của chủ dự án: nó nay là
      // một TAB trong Cấu hình vận hành (`/cau-hinh-van-hanh?tab=phuong-thuc-tt`), và
      // `/payment-methods` chuyển hướng về đó. Lối vào duy nhất là
      // `app/(admin)/admin/cau-hinh-van-hanh/_components/config-tabs.tsx`.
      { label: "Hoa hồng", href: "/crm/commission", icon: Coins, perm: ["payments:manage"] },
      // 27/08 — khai QC / quản lý phụ trách cơ sở (nguồn hoa hồng QC 1% + QL TT 2%).
      // Quyền RIÊNG, không phải `payments:manage`: kế toán duyệt và chi, nhưng người
      // chỉ định AI ĐƯỢC NHẬN là chủ dự án (chỉ SUPER_ADMIN).
      {
        label: "Người hưởng hoa hồng",
        href: "/crm/commission/nguoi-huong",
        icon: Coins,
        perm: ["commission-assignee:manage"],
      },
    ],
  },
  {
    label: "Website & Marketing",
    items: [
      { label: "Tin tức", href: "/news", icon: Newspaper, perm: ["news:view"] },
      { label: "Nội dung website", href: "/site-content", icon: ImageIcon, perm: [...PAGE_GATES["/site-content"]] },
      { label: "Tracking", href: "/marketing", icon: BarChart3, perm: [...PAGE_GATES["/marketing"]] },
      { label: "Funnel Marketing", href: "/marketing/funnel", icon: Workflow, perm: ["leads:view-all"] },
    ],
  },
  {
    // Email/OTP TÁCH khỏi "Hệ thống & Cấu hình" (11/08/2026): chủ dự án chốt nhóm hệ
    // thống chỉ SUPER_ADMIN thấy, nhưng `emails:view` là quyền THẬT của Marketing Hội sở
    // (seed-roles.ts) — nhét chung nhóm thì hoặc lộ nhóm hệ thống cho Marketing, hoặc
    // phải cắt quyền họ đang dùng. Tách nhóm giữ đúng cả hai.
    label: "Email & OTP",
    items: [
      { label: "Email Templates", href: "/email-templates", icon: Mail, perm: ["emails:view"] },
      { label: "Email Logs", href: "/email-logs", icon: Send, perm: ["emails:view"] },
      // AUTH-SĐT P4 dựng /otp-logs nhưng quên link — màn trả lời "phụ huynh báo
      // không nhận được mã" mà nhân viên trực phải gõ tay URL thì coi như không có.
      { label: "OTP Logs", href: "/otp-logs", icon: MessageCircle, perm: ["emails:view"] },
    ],
  },
  {
    // ⚠️ CHỈ SUPER_ADMIN (chốt 11/08/2026). Mọi mục ở đây phải gác bằng action mà KHÔNG
    // RoleDef nào giữ (users:manage · user-groups:manage · roles:manage · centers:edit ·
    // audit-logs:view · settings:view) ⇒ vai khác vào chỉ qua bypass SUPER_ADMIN.
    // Thêm mục mới vào nhóm này = kiểm lại danh sách vai giữ action đó TRƯỚC, đừng mượn
    // action rộng như `centers:view` (7 vai giữ — đúng lỗi vừa vá).
    label: "Hệ thống & Cấu hình",
    items: [
      { label: "Tài khoản", href: "/users", icon: KeyRound, perm: ["users:manage"] },
      // US-03 — nhóm người dùng: grant ad-hoc (ALLOW/DENY) không sửa vai chuẩn.
      { label: "Nhóm người dùng", href: "/user-groups", icon: UsersRound, perm: ["user-groups:manage"] },
      // Màn cấu hình VAI TRÒ (RoleDef + RolePermission) — trung tâm của RBAC v2 mà từ
      // trước tới nay chỉ vào được bằng URL.
      { label: "Vai trò & quyền", href: "/roles", icon: KeyRound, perm: ["roles:manage"] },
      // P1 · US-05 AC4 — cây tổ chức (HO → vùng → cơ sở).
      { label: "Cây tổ chức", href: "/to-chuc", icon: Network, perm: [...PAGE_GATES["/to-chuc"]] },
      { label: "Audit Log", href: "/audit-log", icon: ScrollText, perm: ["audit-logs:view"] },
      // C6/NĐ13 — HV quá hạn lưu trữ + xoá ẩn danh / xuất dữ liệu. Trang tự gác bằng
      // `isSuperAdmin`; `settings:view` ở đây chỉ là cổng HIỆN MỤC và cũng chỉ
      // SUPER_ADMIN có, nên hai tầng không lệch nhau.
      { label: "Tuân thủ dữ liệu", href: "/compliance", icon: AlertTriangle, perm: ["settings:view"] },
      { label: "Chạy lại webhook", href: "/crm/webhook-replay", icon: RefreshCw, perm: ["settings:edit"] },
      { label: "Tích hợp", href: "/tich-hop", icon: Plug, perm: ["settings:view"] },
      // ⚠️ QUYỀN HIỆN MỤC LẤY TỪ `QUYEN_TAB`, KHÔNG gõ tay [25/09/2026].
      //
      // Trang này từ 24/09 gác THEO TỪNG TAB: vào được nếu giữ quyền của ít nhất một tab.
      // Nhưng mục sidebar vẫn đứng nguyên ở `settings:view` — quyền mà Quản lý cơ sở CỐ Ý
      // không có (quyết định ký 03/08/2026). Hệ quả đo được: QLCS đăng nhập, cửa đã mở
      // bằng `settings:view-center`, mà trong sidebar KHÔNG có mục nào dẫn tới nó. Chủ dự
      // án báo: *"vào acc QLCS nhưng không thấy cấu hình hệ thống"*.
      //
      // Cửa mở mà không có tay nắm thì cũng bằng cửa khoá — chỉ khác là không ai tìm ra
      // được lý do. Đây là mặt sau của luật 12: affordance THIẾU cũng nói dối.
      //
      // Suy từ `QUYEN_TAB` thay vì liệt kê tay: thêm một tab với quyền mới mà quên sửa
      // dòng này là tái lập đúng con bug vừa vá, và `tsc` sẽ không nói gì.
      {
        label: "Cấu hình vận hành",
        href: "/cau-hinh-van-hanh",
        icon: SlidersHorizontal,
        perm: [...new Set(Object.values(QUYEN_TAB))] as Action[],
      },
      { label: "Cài đặt", href: "/settings", icon: Settings, perm: ["settings:view"] },
    ],
  },
  {
    label: "Báo cáo",
    items: [
      { label: "Báo cáo Lead", href: "/bao-cao/lead", icon: BarChart3, perm: ["leads:view-all", "leads:view-own"] },
      // 23/09/2026 — màn thống kê case theo SALE là màn CHÍNH của báo cáo trải nghiệm;
      // `/bao-cao/trial` (theo cơ sở) đã gỡ, đường cũ chỉ còn chuyển tiếp về đây. `href`
      // phải là chuỗi literal: bộ quét nav đọc văn bản, ghép chuỗi là màn thành mồ côi.
      { label: "Báo cáo trải nghiệm", href: "/bao-cao/trial-sale", icon: FlaskConical, perm: ["trials:view"] },
      // FL W0-NAV-2 hygiene: 3 báo cáo đào tạo gate `courses:create` (Super/Training/CM) — ẩn khỏi Sale/KT
      // (trước đây lọt qua classes:view-all). BA #07 3.C.
      { label: "Báo cáo đào tạo", href: "/bao-cao/dao-tao", icon: BookOpen, perm: [...PAGE_GATES["/bao-cao/dao-tao"]] },
      { label: "Báo cáo trung tâm", href: "/bao-cao/trung-tam", icon: Coins, perm: ["payments:manage"] },
      { label: "Hiệu suất giáo viên", href: "/bao-cao/hieu-suat-gv", icon: GraduationCap, perm: [...PAGE_GATES["/bao-cao/hieu-suat-gv"]] },
      { label: "Cohort tiến độ", href: "/bao-cao/cohort", icon: Users, perm: [...PAGE_GATES["/bao-cao/cohort"]] },
      { label: "Churn / rời bỏ", href: "/bao-cao/churn", icon: BarChart3, perm: ["enrollments:view-all"] },
      // B-01: đọc thẳng bảng gate — menu và cổng trang không thể lệch nhau.
      { label: "Doanh thu vs mục tiêu", href: "/bao-cao/doanh-thu", icon: Coins, perm: [...PAGE_GATES["/bao-cao/doanh-thu"]] },
      // C-01: màn đặt chỉ tiêu lead (số học sinh) theo tháng × cơ sở.
      { label: "Chỉ tiêu lead", href: "/bao-cao/muc-tieu-lead", icon: Target, perm: [...PAGE_GATES["/bao-cao/muc-tieu-lead"]] },
      // D-02: màn đặt chỉ tiêu ngân sách quảng cáo (VNĐ) theo tháng × cơ sở.
      { label: "Chỉ tiêu ngân sách QC", href: "/bao-cao/ngan-sach-quang-cao", icon: Megaphone, perm: [...PAGE_GATES["/bao-cao/ngan-sach-quang-cao"]] },
      // US-16 AC4 — đo pilot chat (kích hoạt TK + đọc thông báo đầu ≤48h) theo từng lớp.
      // `chat:admin` khớp ĐÚNG gate của trang (chỉ SUPER_ADMIN) — không mượn PAGE_GATES vì
      // route này cố ý không khai ở đó.
      { label: "Đo pilot chat", href: "/bao-cao/chat-pilot", icon: MessagesSquare, perm: ["chat:admin"] },
      // GĐ3 tích hợp ZaloCRM — ai đang theo kịp khách, ai không. `inbox:view` khớp ĐÚNG
      // gate của trang; cách ly cơ sở nằm trong truy vấn nên Sale CS1 chỉ thấy số CS1.
      { label: "Phản hồi hộp thư", href: "/bao-cao/phan-hoi-hop-thu", icon: Clock3, perm: ["inbox:view"] },
    ],
  },
];

/**
 * Mục menu CÓ THỂ ẩn theo vai (mọi mục có `perm` — Dashboard luôn hiện, không nằm đây).
 * Màn Vai trò & quyền dựng ô chọn "Mục menu ẩn với vai này" từ danh sách này; lưới
 * `[MG-SEED-02]` đòi mọi đường dẫn khai trong seed vai phải có mặt ở đây (chống gõ sai).
 */
export const MUC_MENU_CO_THE_AN: readonly { nhom: string; label: string; href: string }[] = NAV_GROUPS.flatMap((g) =>
  g.items.filter((it) => it.perm).map((it) => ({ nhom: g.label, label: it.label, href: it.href })),
);

// `granted` do layout tính sẵn ở server bằng grantedMenuActions() — CÙNG hàm quyết định
// với cổng trang (evaluatePermission + cờ RBAC_V2_ENABLED). Sidebar không tự phán quyền
// nữa: trước 10/07 nó gọi can() v1 tĩnh, nên bật cờ là menu và cổng lệch nhau.

const STORAGE_KEY = "satarobo:sidebar:collapsed";

export function Sidebar({
  granted,
  anMenu,
  userId,
  chatUnread = 0,
  evalV2Enabled = false,
  scormEnabled = false,
  classGroupEnabled = false,
  zalocrmEnabled = false,
  hoaDonEnabled = false,
  nguonLeadEnabled = false,
  hoaHongEngineEnabled = false,
  onNavigate,
  thuGon = false,
  onDoiThuGon,
}: {
  granted: string[];
  /**
   * Đường dẫn mục menu ẨN với người đang xem — "menu gọn theo vai" (`lib/auth/menu-gon.ts`,
   * layout tính). CHỈ gọn menu, không phải quyền. BẮT BUỘC, không mặc định: thiếu dây nối thì
   * `tsc` báo, thay vì lặng lẽ hiện đủ menu (luật 11).
   */
  anMenu: readonly string[];
  /** `User.id` — topic realtime `user:{id}` để badge "Tin nhắn" tự nhảy. */
  userId: string;
  /** Số chưa đọc do layout (RSC) tính sẵn; sidebar KHÔNG tự fetch lúc mount. */
  chatUnread?: number;
  evalV2Enabled?: boolean;
  scormEnabled?: boolean;
  /** Cờ GỠ — mặc định false ⇒ mục "Nhóm lớp" ẩn. */
  classGroupEnabled?: boolean;
  /** S1 — mặc định false ⇒ mục "Zalo CRM" ẩn (cùng cờ với trang, xem lib/flags.ts). */
  zalocrmEnabled?: boolean;
  /** Mặc định false ⇒ mục "Hoá đơn điện tử" ẩn (cờ `billing.hoaDonEnabled`, `laHoaDonBat()`). */
  hoaDonEnabled?: boolean;
  /** Mặc định false ⇒ mục "Nguồn lead" ẩn (cờ `nguon.enabled`, `laQuanLyNguonBat()`). */
  nguonLeadEnabled?: boolean;
  /** Mặc định false ⇒ mục "Sổ hoa hồng" ẩn (cờ `hoaHong.engineBat`, `laEngineHoaHongBat()`). */
  hoaHongEngineEnabled?: boolean;
  /**
   * Thu gọn thành DẢI CHỈ-BIỂU-TƯỢNG (rộng 64px). Trạng thái do `AdminShell` giữ.
   *
   * ⚠️ Mặc định `false`, và bản DRAWER trên điện thoại KHÔNG BAO GIỜ nhận `true`: drawer
   * vốn đã rộng 256px và mở ra rồi đóng lại, thu gọn ở đó không giải quyết vấn đề gì mà
   * lại bỏ hết chữ — đúng thứ `[ADMIN-NAV-T01]` sinh ra để canh ("drawer mở ⇒ CÓ mục menu
   * thật để bấm, không phải một tấm rỗng").
   */
  thuGon?: boolean;
  /**
   * Bấm nút thu gọn/mở. `undefined` ⇒ KHÔNG dựng nút.
   *
   * Đây là cách bản drawer không có nút: nó không nhận hàm này. Rẻ hơn thêm một cờ
   * `anNutThuGon` thứ hai rồi phải nhớ hai cờ luôn đi cùng nhau.
   */
  onDoiThuGon?: () => void;
  /**
   * Gọi khi người dùng bấm một mục — để bản DRAWER trên điện thoại tự đóng lại.
   *
   * `undefined` ở bản desktop (thanh cố định, không có gì để đóng). Thiếu nó thì trên điện
   * thoại bấm một mục xong drawer vẫn che kín trang vừa mở — người dùng phải bấm ra ngoài
   * một lần nữa mới thấy nội dung, và đó là kiểu chạm-hai-lần khiến người ta tưởng nút không
   * ăn. Xem `components/admin/admin-shell.tsx`.
   */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  // Số SỐNG: seed = số server, sau đó chỉ nhảy khi kênh `user:{id}` báo có tin mới.
  // Không `router.refresh()` ⇒ trang admin đang mở không bị render lại vì một cái badge.
  const chatCount = useChatUnread(userId, chatUnread);

  // Lọc menu theo quyền — chỉ giữ mục user được phép thấy. Mục không có `perm`
  // (Dashboard) luôn hiện. Mục gắn flag chỉ hiện khi flag bật. Nhóm rỗng sau lọc → ẩn.
  const grantedSet = useMemo(() => new Set(granted), [granted]);
  const anSet = useMemo(() => new Set(anMenu), [anMenu]);
  const visibleGroups = useMemo(() => {
    return NAV_GROUPS.map((g) => ({
      label: g.label,
      items: g.items.filter(
        (it) =>
          (!it.flag ||
            (it.flag === "eval" && evalV2Enabled) ||
            (it.flag === "scorm" && scormEnabled) ||
            (it.flag === "classGroup" && classGroupEnabled) ||
            (it.flag === "zalocrm" && zalocrmEnabled) ||
            (it.flag === "hoaDon" && hoaDonEnabled) ||
            (it.flag === "nguonLead" && nguonLeadEnabled) ||
            (it.flag === "hoaHongEngine" && hoaHongEngineEnabled)) &&
          (!it.perm || it.perm.some((p) => grantedSet.has(p))) &&
          // Menu gọn theo vai: chỉ mục có `perm` mới ẩn được — Dashboard luôn là lối về nhà.
          (!it.perm || !anSet.has(it.href)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [
    grantedSet,
    anSet,
    evalV2Enabled,
    scormEnabled,
    classGroupEnabled,
    zalocrmEnabled,
    hoaDonEnabled,
    nguonLeadEnabled,
    hoaHongEngineEnabled,
  ]);

  // Nhóm đang chứa trang hiện tại (deterministic SSR + client → không hydration mismatch).
  const activeGroupLabel = useMemo(() => {
    for (const g of visibleGroups) {
      if (g.items.some((it) => pathname.startsWith(it.href))) return g.label;
    }
    return visibleGroups[0]?.label ?? null;
  }, [visibleGroups, pathname]);

  // Mục đang mở = href DÀI NHẤT khớp đầu pathname. So `startsWith` riêng từng mục thì "/payments"
  // sáng cùng lúc với "/payments/hoa-don" (chụp 26/09/2026) — hai mục cùng tô là người dùng không
  // biết mình đang ở màn nào.
  const activeHref = useMemo(() => {
    let dai: string | null = null;
    for (const g of visibleGroups) {
      for (const it of g.items) {
        if (pathname.startsWith(it.href) && (dai === null || it.href.length > dai.length)) dai = it.href;
      }
    }
    return dai;
  }, [visibleGroups, pathname]);

  // Collapsed = set tên nhóm đang thu gọn. Mặc định thu gọn mọi nhóm trừ nhóm active.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const g of NAV_GROUPS) if (g.label !== activeGroupLabel) s.add(g.label);
    return s;
  });

  // Sau mount: nạp trạng thái đã lưu (localStorage) — chạy client-only nên không
  // gây hydration mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);

  function toggleGroup(label: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  return (
    <aside
      className={cn(
        // `transition-[width]` chứ không `transition-all`: hoạt ảnh admin chỉ được là
        // CSS transition (DESIGN.md §7) và `all` thì kéo theo cả màu/viền của mọi lượt
        // đổi trạng thái khác — mục đang chọn sẽ "trôi" màu mỗi lần điều hướng.
        "flex h-full flex-col border-r border-border bg-card transition-[width] duration-200",
        thuGon ? "w-16" : "w-64",
      )}
      data-thu-gon={thuGon ? "1" : "0"}
    >
      {/* ĐẦU THANH.
          Thu gọn: bề ngang chỉ 64px, đủ cho ĐÚNG MỘT nút 44px. Nên ở chế độ đó header chỉ
          còn nút thu gọn — lockup "SataRobo" là trang trí, còn nút là chức năng, và đường
          về Dashboard vẫn còn nguyên ở mục đầu tiên của nav ("luôn hiện"). Nhồi cả hai vào
          64px là được một nút bấm 20px và một chữ bị cắt. */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-border",
          thuGon ? "justify-center px-0" : "gap-2 px-6",
        )}
      >
        {!thuGon && (
          <Link
            href="/dashboard"
            onClick={onNavigate}
            aria-label="Sata Robo Admin — về Dashboard"
            className="group min-w-0 flex-1 truncate text-xl font-bold transition-opacity hover:opacity-90"
          >
            {/* DESIGN.md §7 — KHÔNG gradient trong admin. Bản cũ tô "Sata" bằng gradient
                cam→tím và "Robo" bằng tím→cam, tức hai chữ chạy NGƯỢC CHIỀU nhau: chỗ nối
                đổi màu đột ngột, và ở cỡ 20px chữ mảnh bị bệt. Gradient chữ thuộc site
                public. Ở đây dùng hai màu ĐẶC của thương hiệu. */}
            <span className="text-[color:var(--accent)]">Sata</span>
            <span className="text-[color:var(--primary)]">Robo</span>
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">Admin</span>
          </Link>
        )}
        {/* Nút chỉ tồn tại khi có người truyền `onDoiThuGon` — bản drawer thì không. Rẻ hơn
            thêm một cờ thứ hai rồi phải nhớ hai cờ luôn đi cùng nhau.
            44px theo DESIGN.md §2: ngưỡng `md` của thanh cố định gồm cả máy tính bảng, nơi
            người dùng bấm bằng ngón tay chứ không phải trỏ chuột. */}
        {onDoiThuGon && (
          <button
            type="button"
            onClick={onDoiThuGon}
            aria-label={thuGon ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
            title={thuGon ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
            aria-expanded={!thuGon}
            className={cn(
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <PanelLeftClose
              className={cn("h-5 w-5 transition-transform", thuGon && "rotate-180")}
              aria-hidden
            />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-4">
        {visibleGroups.map((group, gIdx) => {
          // ⚠️ Ở chế độ DẢI, bỏ qua trạng thái thu gọn từng nhóm và hiện HẾT mục.
          //
          // Dải chỉ có biểu tượng, không có chỗ cho nhãn nhóm lẫn mũi tên. Một nhóm đang
          // thu gọn trong dải là một vùng chết: không nhãn để đọc, không mũi tên để bấm,
          // và mục bên trong biến mất không dấu vết. Cái giá là dải dài hơn — đổi lại nó
          // làm đúng việc của mình (bấm nhanh), và người cần lọc bớt thì mở rộng ra.
          const isCollapsed = !thuGon && collapsed.has(group.label);
          return (
            <div key={group.label} className={thuGon ? "" : "mb-3"}>
              {thuGon ? (
                // Nhóm vẫn phải NHÌN RA ĐƯỢC khi không có chữ — thay nhãn bằng một vạch.
                // Bỏ hẳn dấu phân nhóm thì dải thành một cột 40 biểu tượng liền khối.
                gIdx > 0 && <div className="mx-3 my-2 border-t border-border" role="presentation" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  className={cn(
                    // ── VIỆC 2: TÊN DANH MỤC PHẢI NỔI HƠN MỤC THƯỜNG ──────────────────
                    // Bản cũ: `text-[10px] text-muted-foreground` — NHỎ HƠN và CÙNG MÀU
                    // với mục con (`text-sm text-muted-foreground`), nên tiêu đề nhóm
                    // LÙI XUỐNG dưới thứ nó đang gán nhãn. Phân cấp ngược.
                    //
                    // Nay tách bằng ba đòn cùng chiều: màu ĐẦY (`text-foreground` vs mục
                    // con `text-muted-foreground`), `font-bold`, và một vạch trên mỗi
                    // nhóm. Cỡ chữ chỉ nhích 10→11px — thứ tạo ra phân cấp là ĐỘ TƯƠNG
                    // PHẢN, không phải kích thước; nhích to nữa sẽ lấn cỡ của mục con.
                    "flex w-full items-center justify-between px-6 py-1.5 text-[11px] font-bold uppercase tracking-wider",
                    "text-foreground transition-colors hover:text-primary",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    gIdx > 0 && "mt-1 border-t border-border pt-3",
                  )}
                  aria-expanded={!isCollapsed}
                >
                  <span className="min-w-0 truncate">{group.label}</span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                      isCollapsed && "-rotate-90",
                    )}
                  />
                </button>
              )}
              {!isCollapsed &&
                group.items.map((item, idx) => {
                  const Icon = item.icon;
                  const active = item.href === activeHref;
                  // R3: nhãn cụm con — chỉ render trước item ĐẦU TIÊN hiển thị của cụm.
                  const showCluster =
                    !!item.cluster && item.cluster !== group.items[idx - 1]?.cluster;
                  return (
                    <Fragment key={item.href}>
                      {/* Nhãn CỤM CON. Bản cũ gần y hệt nhãn nhóm (`text-[10px] uppercase
                          tracking-wider text-muted-foreground`) nên hai tầng khác nhau
                          trông như một. Nay: KHÔNG in hoa, chữ nhạt hơn, và THỤT VÀO
                          thẳng hàng với nhãn mục (28px = biểu tượng 16 + khe 12) — đọc một
                          nhịp là biết nó thuộc về nhóm bên trên chứ không ngang hàng.

                          ⚠️ ĐO 18/09/2026: HIỆN KHÔNG item nào khai `cluster`
                          (`grep -c "cluster:"` → 0), nên nhánh này CHƯA render lần nào.
                          Kiểu dữ liệu và luật R3 vẫn giữ, và lớp CSS trên đã sửa cho đúng
                          phân cấp — nhưng nó CHƯA được xem trên màn hình thật. Ai bật lại
                          `cluster` thì nhớ chụp lại: một tầng chữ chưa ai nhìn là một tầng
                          chữ chưa ai kiểm. */}
                      {showCluster && !thuGon && (
                        <div className="pb-0.5 pl-[3.25rem] pr-6 pt-2 text-[11px] font-medium text-muted-foreground/70">
                          {item.cluster}
                        </div>
                      )}
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        // ⚠️ `title` + `aria-label` CHỈ khi thu gọn, và chúng không phải
                        // trang trí: ở dải thì nhãn bị ẩn, nên một biểu tượng không tên là
                        // lời hứa không đọc được (luật 12). `aria-label` lo trình đọc màn
                        // hình, `title` lo chuột.
                        //
                        // Giới hạn còn lại, nói thẳng: `title` KHÔNG hiện khi đi bằng bàn
                        // phím. Người chỉ dùng bàn phím ở chế độ dải vẫn phải đoán. Vá
                        // đúng là Tooltip của shadcn cho cả ~40 mục — đợt riêng, và khi
                        // làm thì phải đo cả phần tiêu điểm.
                        {...(thuGon ? { title: item.label, "aria-label": item.label } : {})}
                        className={cn(
                          "flex items-center text-sm font-medium transition-colors",
                          thuGon ? "relative justify-center px-0 py-2.5" : "gap-3 px-6 py-2",
                          active
                            ? thuGon
                              ? "bg-primary-soft text-primary"
                              : "bg-primary-soft text-primary border-l-2 border-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {!thuGon && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                        {item.badge === "chat" && chatCount > 0 && (
                          // Thu gọn: badge đổi thành dấu góc trên biểu tượng. Bỏ nó đi ở
                          // dải là người dùng mất hẳn tín hiệu "có tin chưa đọc" — đúng
                          // thứ badge sinh ra để nói.
                          <span
                            className={cn(
                              "inline-flex items-center justify-center rounded-full bg-state-danger font-bold text-white",
                              thuGon
                                ? "absolute right-2 top-1.5 h-4 min-w-4 px-0.5 text-[9px]"
                                : "h-5 min-w-5 shrink-0 px-1 text-[10px]",
                            )}
                            aria-label={`${chatCount} tin chưa đọc`}
                          >
                            {chatCount > 9 ? "9+" : chatCount}
                          </span>
                        )}
                      </Link>
                    </Fragment>
                  );
                })}
            </div>
          );
        })}
      </nav>

      {/* Chân thanh: thu gọn thì chỉ còn số phiên bản. Hai dòng chữ trong 64px sẽ bị
          xuống dòng thành bốn dòng vụn — mà đây là khối ít quan trọng nhất của thanh. */}
      <div
        className={cn(
          "border-t border-border text-xs text-muted-foreground",
          thuGon ? "px-1 py-3 text-center" : "p-4",
        )}
      >
        {thuGon ? (
          <p className="tabular-nums" title="Sata Robo Admin · v4.UI.FINAL · 2026">
            v4
          </p>
        ) : (
          <>
            <p className="font-medium">Sata Robo Admin</p>
            <p>v4.UI.FINAL · 2026</p>
          </>
        )}
      </div>
    </aside>
  );
}
