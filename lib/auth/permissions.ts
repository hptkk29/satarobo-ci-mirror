import type { Role } from "@prisma/client";

// =============================================================================
// PERMISSION MATRIX — Phase 5.2 (Expanded from 26 to 70+ actions)
// =============================================================================
//
// HISTORY:
// - Phase 4.7: 26 actions covering employees, honors, jobs, leads, blog, payroll
// - Phase 5.2: Expanded to 70+ actions to close RBAC gaps for ALL admin resources
//   + merged with legacy lib/permissions.ts (which had 6 roles missing HR).
//
// PATTERN:
// - Action format: `<resource>:<verb>` — verb is one of view-all, view-own,
//   view-public, create, edit, delete, settings, view-salary, view-personal.
// - Check: `can(role, action)` returns boolean.
// - Enforce in Server Action: `assertCan(role, action)` throws on deny.
// - Field-level for Employee: `getEmployeeFieldVisibility(role)` returns object.
//
// ALL 9 ROLES (Phase T0.1 — rename MANAGER->CENTER_MANAGER, SALES->SALES_CSM,
// thêm PARENT; TRAINING thêm sau ở migration 20260624000000_fl_foundation — comment
// này trước đó bị bỏ sót, sửa 06/07/2026):
// SUPER_ADMIN, CENTER_MANAGER, HR, SALES_CSM, TEACHER, TRAINING, MARKETING, ACCOUNTANT, PARENT
//
// PARENT = phụ huynh (portal hocvien.satarobo.vn). KHÔNG có quyền admin nào —
// không xuất hiện trong bất kỳ array PERMISSIONS nào → can(PARENT, adminAction)
// luôn false. Quyền portal (xem data con) check riêng qua activeSite, không qua
// matrix này. NGOẠI LỆ DUY NHẤT (US-05 chat, 08/08/2026): `chat:read`/`chat:send`
// — chat là tính năng dùng chung portal+admin+teacher, PH là vai chat hạng nhất
// (docs/chat-realtime/permissions.md); các action chat:* còn lại PARENT vẫn false.
//
// Legacy lib/permissions.ts (6 roles, missing HR) đã xoá ở Sprint 5.2.
// 15 callsite cũ migrated sang can(role, "resource:action") trực tiếp.
//
// =============================================================================

export type Action =
  // --- Employees (existing) ---
  | "employees:view-all"
  | "employees:view-public"
  | "employees:create"
  | "employees:edit"
  | "employees:delete"
  | "employees:view-salary"
  | "employees:view-personal"

  // --- Honors (existing) ---
  | "honors:view"
  | "honors:create"
  | "honors:edit"
  | "honors:delete"
  | "honors:settings"

  // --- Jobs (existing) ---
  | "jobs:view"
  | "jobs:create"
  | "jobs:edit"
  | "jobs:delete"

  // --- Leads (expanded) ---
  | "leads:view-all"
  | "leads:view-own"
  | "leads:create"
  | "leads:edit"
  // 27/08/2026 — đổi trạng thái lead TÁCH khỏi `leads:edit`: chỉ Sale được đẩy
  // lead trên phễu. Quản lý cơ sở / Marketing vẫn sửa được hồ sơ, chỉ không đổi bậc.
  | "leads:change-status"
  // 23/08/2026 — sửa HẸP: chỉ những ô CÓ TRONG biểu mẫu `/nhap-khach-hang`, và
  // chỉ trên phiếu do CHÍNH MÌNH nhập (`Lead.createdById`).
  //
  // ⚠️ CỐ Ý TÁCH KHỎI `leads:edit`. Quyền đó đang gác ~10 action khác —
  // đổi trạng thái, giao việc, chuyển cơ sở, thêm/sửa con, ghi chú, bàn giao.
  // Cấp `leads:edit` cho Sale Hội sở là mở toang cả chuỗi đó, trong khi chủ dự
  // án chốt họ chỉ được sửa đúng bộ ô mình đã gõ; Sale cơ sở mới toàn quyền.
  | "leads:edit-own-intake"
  | "leads:overwrite"
  | "leads:assign"
  | "leads:assign-config" // 03/08 — tách riêng màn "Cấu hình chia lead" khỏi leads:assign
  // S-5 — XEM sổ lượt chia lead (`/leads/so-luot`). Key ĐỌC riêng, cố ý tách khỏi
  // `leads:view-all`: sổ lượt là màn kiểm chứng viết CHO tổ Sale (plan/15 §5), mà
  // `leads:view-all` là quyền quản lý gác ~8 màn khác — nới nó để Sale xem được sổ
  // là mở kèm cả chùm. Cũng KHÔNG mượn `leads:assign-config` (chỉ SUPER_ADMIN, và
  // đó là quyền SỬA cách chia — sổ này chỉ đọc).
  | "leads:rotation-view"
  | "lead_pool:manage" // 29/08 — màn "Quản lý chia lead": ai đang nhận lead
  | "leads:delete"
  | "leads:export"
  | "leads:import" // Task #07 — import danh sách "khách đã đăng ký" từ Excel (Lead REGISTERED + LeadChild)
  // C-01 — đặt/sửa chỉ tiêu SỐ HỌC SINH theo tháng × cơ sở (bảng LeadTarget).
  // Key RIÊNG theo chốt kỹ thuật 24/08/2026 (OQ-C5) — KHÔNG dùng lại `leads:assign-config`,
  // vì key đó đang gác màn "Cấu hình chia lead tự động": cấp cho QLCS để họ gõ một con số
  // là mở kèm một năng lực khác hẳn mà không ai định trao.
  | "lead_targets:manage"
  // D-02 — đặt/sửa chỉ tiêu NGÂN SÁCH QUẢNG CÁO theo tháng × cơ sở (bảng AdsBudgetTarget).
  // Key RIÊNG, đúng tiền lệ `revenue_targets:manage` (B-01) + `lead_targets:manage` (C-01).
  // KHÔNG mượn `leads:view-all` (key đang gác /admin/marketing/funnel — mượn là mở màn ĐẶT
  // chỉ tiêu cho QLCS lẫn Sale), và KHÔNG lan thêm call-site cho `canEditAds`
  // (lib/crm/ads-insights.ts so roleCode bằng tay — vi phạm luật Nền Hệ thống #1).
  | "ads_budget_targets:manage"
  // #11 T2 (OI-4) — xem PII lead: SĐT/email/tên PH-HS/ghi chú tư vấn.
  // ⚠️ MARKETING **CÓ** quyền này (user chốt 21/07, ĐẢO quyết định "che PII cho
  // MARKETING" ngày 10-20/07 — lý do đầy đủ ở ma trận bên dưới). Comment cũ ghi
  // ngược đã khiến 2 lần rà soát kết luận nhầm là "lỗ hở quyền"; danh sách vai
  // là nguồn đúng duy nhất, đừng suy từ comment.
  | "leads:view-pii"

  // --- Trial classes (Phase T1.4) ---
  | "trials:view"
  | "trials:manage"
  | "trials:feedback"
  // GĐ4 — điểm danh buổi trải nghiệm. TÁCH khỏi `trials:feedback` vì hai việc thuộc
  // hai vai khác nhau: Sale điểm danh, giáo viên nộp phiếu đánh giá.
  | "trials:attendance"
  // --- Trial class V2 (R7-02) ---
  | "trials:assign-teacher"
  // 17/09/2026 — TẦNG QUẢN LÝ CƠ SỞ của việc xếp giáo viên buổi trải nghiệm.
  // Vì sao phải có khoá RIÊNG chứ không tái dùng `trials:assign-teacher`: chủ dự án
  // chốt ba tầng (Đào tạo → FULL · Quản lý cơ sở → GV của cơ sở mình · Sale → lọc
  // theo ca). Trước khoá này, CENTER_MANAGER và SALES_CSM mang BỘ `trials:*` GIỐNG
  // NHAU ở phần dùng được (view/manage/attendance/override-capacity) ⇒ màn xếp GV
  // KHÔNG phân biệt nổi hai tầng, mà đọc thẳng `session.user.role` thì vi phạm luật
  // cứng #1 (mọi kiểm quyền qua `can()`).
  // KHÔNG mở rộng `trials:assign-teacher` cho CENTER_MANAGER: khoá đó là tầng Đào tạo
  // (FULL, mọi cơ sở) — GĐ3 đã cố ý GỠ nó khỏi Quản lý cơ sở, trả lại là đảo quyết định.
  | "trials:assign-teacher-center"
  // 22/09/2026 — TẠO LỚP trải nghiệm tách khỏi `trials:manage`.
  //
  // Chủ dự án: "chỉ cho QL tạo và sale chỉ vào chọn lớp trial theo ngày đặt lịch và add
  // học viên". Trước khoá này `trials:manage` gộp CẢ HAI việc (tạo lớp + xếp học viên),
  // mà Sale bắt buộc phải có `trials:manage` để xếp học viên — nên không có cách nào
  // chặn Sale tạo lớp nếu không tách khoá. Chính seed-roles.ts đã ghi nhận bế tắc đó:
  // "không tách nổi QL cơ sở khỏi Sale — hai vai đang mang bộ `trials:*` giống hệt".
  | "trials:create-class"
  | "trials:override-capacity"
  | "training:manage"
  | "reports:training"
  // FL W0-NAV-2 (QĐ-T3b) — 2 việc vận hành CM giữ qua action RIÊNG (KHÔNG trả training:manage):
  | "trials:config" // cấu hình số buổi lớp trải nghiệm
  | "lesson-change:approve" // duyệt LessonChangeRequest (chấp nhận/từ chối đề xuất chỉnh bài)

  // --- Notifications (Phase NHÓM 3) ---
  | "notifications:manage"

  // --- Parent requests (Phase NHÓM 3) ---
  | "parent-requests:manage"

  // --- Parent feedback (Phase NHÓM 3) ---
  | "parent-feedback:view"

  // --- Media / ảnh lớp (Phase NHÓM 3) ---
  | "media:view"
  | "media:upload"
  // Đưa ảnh vào KHO của lớp (status DRAFT) — KHÔNG được gửi phụ huynh. Tách khỏi
  // `media:upload` (11/08, chủ dự án chốt): Marketing + Giáo vụ góp ảnh vào thư
  // viện lớp, giáo viên mới là người chọn ảnh gửi PH. Xem canStageToClass /
  // canPublishToClass trong app/(admin)/admin/media/actions.ts.
  | "media:upload-draft"
  | "media:approve"

  // --- HR attendance / chấm công QR (Phase NHÓM 4) ---
  | "hr_attendance:checkin"
  | "hr_attendance:view"
  | "hr_attendance:adjust"
  // Module chấm công v3 (L1 · 06/09/2026) — kế hoạch §5. Khai đồng thời 4 nơi:
  // union này + ma trận PERMISSIONS + lib/permissions/registry/hr.ts + prisma/seed-roles.ts.
  | "hr_attendance:assign"
  | "hr_attendance:approve"
  | "hr_attendance:close-period"
  | "hr_attendance:export"
  | "hr_attendance:config"

  // --- Blog / News (existing + expanded) ---
  | "blog:view"
  | "blog:create"
  | "blog:edit"
  | "blog:delete"
  | "news:view"
  | "news:create"
  | "news:edit"
  | "news:delete"
  | "news:publish"

  // --- Payroll (existing) ---
  | "payroll:view"
  | "payroll:edit"

  // --- Students (NEW) ---
  | "students:view-all"
  | "students:view-own-class"
  | "students:create"
  | "students:edit"
  | "students:change-code"
  | "students:delete"
  | "students:import"

  // --- Classes (NEW) ---
  | "classes:view-all"
  | "classes:view-own"
  | "classes:create"
  | "classes:edit"
  | "classes:delete"

  // --- Class groups (Phase T0.2) ---
  | "class_group:view-all"
  | "class_group:create"
  | "class_group:edit"
  | "class_group:delete"

  // --- Enrollments (NEW) ---
  | "enrollments:view-all"
  | "enrollments:view-own"
  | "enrollments:create"
  | "enrollments:edit"
  | "enrollments:transfer"
  | "enrollments:cancel"
  | "enrollments:delete"
  /**
   * Vượt luật TIẾN ĐỘ khi xếp học viên vào lớp [29/09/2026].
   *
   * Chủ dự án: *"nếu đăng ký 48 mà lớp đã học >4 buổi thì tất cả các role khác không
   * thêm vào được nữa, chỉ admin vẫn toàn quyền thêm được cho tất cả các trường hợp"*.
   *
   * ⚠️ CHỈ vượt luật TIẾN ĐỘ. Sĩ số lớp thì KHÔNG ai vượt được — `enrollStudent` từ
   * chối `CLASS_FULL` vô điều kiện, và màn chuyển đổi cũng vậy.
   *
   * ⚠️ Không cần chạy `seed-prod-roles.yml`: `can()` v2 trả `true` ngay cho
   * `isSuperAdmin` (`lib/auth/can.ts:52`) và false cho mọi vai chưa được cấp — tức
   * đúng hành vi mong muốn, fail-closed, không có quãng "chưa seed nên không ai làm
   * được" như quyền duyệt đơn từng vấp.
   */
  | "enrollments:override-progress"

  // --- Evaluations / surveys (R7-16) ---
  | "evaluations:manage"
  | "evaluations:view-aggregate"
  | "evaluations:view-detail"

  // --- Report cards (R7-15) ---
  | "report-cards:manage"
  | "report-cards:review"

  // --- Course completion (B4) ---
  | "completions:manage"
  | "completions:propose-own"

  // --- SataCoin (C4) ---
  | "satacoin:manage"

  // --- Class sessions + Attendance (NEW) ---
  | "sessions:view"
  | "sessions:create"
  | "sessions:edit"
  // ĐỌC phiếu nhận xét buổi (StudentSessionFeedback) của cả lớp. Tách riêng khỏi
  // `sessions:view` để mở cho Đào tạo mà KHÔNG mở luôn module Buổi học/lịch —
  // đợt khoá chặt 24/07 cố ý gỡ classes/sessions khỏi TRAINING.
  | "session-feedback:view-all"
  | "attendance:view"
  | "attendance:mark"
  | "attendance:edit"

  // --- Courses + Packages (NEW) ---
  | "courses:view"
  | "courses:create"
  | "courses:edit"
  | "courses:delete"
  | "course-packages:view"
  | "course-packages:edit"

  // --- Curriculum + Lessons (NEW) ---
  | "curriculum:view"
  | "curriculum:create"
  | "curriculum:edit"
  | "curriculum:delete"

  // --- Questions + Exams + Assignments (NEW) ---
  | "questions:view"
  | "questions:author"
  | "questions:edit"
  | "questions:delete"
  | "exams:view"
  | "exams:create"
  | "exams:edit"
  | "exams:grade"
  | "exams:delete"
  | "assignments:view"
  | "assignments:create"
  | "assignments:edit"
  | "assignments:grade"
  | "assignments:delete"
  | "assignments:assign-own"
  | "assignments:author-own"

  // --- Documents (NEW) ---
  | "documents:view"
  | "documents:upload"
  | "documents:delete"

  // --- Teaching materials (FL W0 — GV xem tài liệu giảng dạy lớp mình) ---
  | "teaching-materials:view-own-class"

  // --- Centers + Rooms + Holidays (NEW) ---
  | "centers:view"
  | "centers:edit"
  | "rooms:view"
  | "rooms:edit"
  | "holidays:view"
  | "holidays:edit"

  // --- Inventory (NEW) ---
  | "inventory:view"
  | "inventory:edit"
  | "inventory:movement"
  | "inventory:audit"

  // --- ZMRoboKit (NEW) ---
  | "kits:view"
  | "kits:edit"

  // --- Site content / CMS (NEW) ---
  | "site-content:view"
  | "site-content:edit"

  // --- Audit logs (NEW) ---
  | "audit-logs:view"
  // #05 — break-glass: xem đầy đủ PII (bỏ mask) trong audit viewer, kèm reason + log riêng.
  | "audit-logs:view-pii"

  // --- Dashboard QLCS 4 tab (A-02) ---
  // Cổng VÀO màn `/dashboard-qlcs`. Key RIÊNG theo chốt kỹ thuật 24/08/2026 (E/OQ-4),
  // vì mọi key sẵn có đều sai một trong hai kiểu:
  //  • `chat:read` (ứng viên đầu cho tab E) seed scope CENTER/ASSIGNED ⇒ gate cấp trang
  //    gọi KHÔNG target luôn trả false trên prod (v2) trong khi local (v1) vẫn xanh —
  //    đúng loại "chạy máy tôi thì được". Bất biến này có test: page-gates.test.ts.
  //  • `payments:*` / `leads:*` gác được đúng MỘT tab, mượn làm cổng chung là hoặc khoá
  //    cửa của người chỉ cần tab kia, hoặc mở kèm năng lực không ai định trao.
  // Cách ly cơ sở KHÔNG đến từ đây — nó đến từ `resolveScopeFilters()` (giao
  // visibleCenterIds × cơ sở chọn trong URL) + `scopedDb` ở từng hàm số liệu.
  | "dashboard:view"

  // --- Settings / system (NEW) ---
  | "settings:view"
  | "settings:view-center"
  | "settings:edit"
  | "users:manage" // CRUD User accounts (different from Employee records)
  | "roles:assign"
  | "roles:manage" // A0-02 — CRUD RoleDef + gán RolePermission (chỉ SUPER_ADMIN)
  | "user-groups:manage" // US-03 — CRUD UserGroup + thành viên + grant nhóm (chỉ SUPER_ADMIN)

  // --- Phase 5.6 — Financial (Payment + Order) ---
  | "payments:manage"
  | "payments:view" // 03/08 — chỉ XEM đối soát (Công nợ, Biến động số dư); không thao tác
  | "payments:record" // R7-04 — Sale ghi nhận khoản
  | "payments:confirm" // R7-04 — Kế toán xác nhận (tách nhiệm vụ)
  | "payments:adjust" // 07/09 — ĐIỀU CHỈNH khoản thu (bút toán delta). Vai nghiệp vụ nhận ở v2
  | "payments:view-pii" // #15 (câu 32) — break-glass xem đầy đủ CCCD PH + địa chỉ (reason + audit)
  | "payments:import-pos" // 29/09 — import file giao dịch thẻ SmartPOS + tab Máy POS + đóng cảnh báo hủy
  | "payments:pos-check" // 06/10 — GĐ1 POS: tạo phiếu thu thẻ + kiểm tra + báo admin
  | "revenue_targets:manage" // B-01 — đặt mục tiêu doanh thu tháng × cơ sở (KHÔNG phải quyền thao tác tiền)
  | "commission_periods:manage" // 27/08 — CHỐT/DUYỆT/MỞ LẠI kỳ hoa hồng (việc toàn hệ, tách khỏi payments:manage)
  // --- Nguồn lead & Chính sách hoa hồng (08/10/2026, docs/source-commission/05 §1.2) ---
  // Chín key MỚI. `leads:overwrite` (đổi nguồn trước thực thu) + `commission_periods:manage` (tính/duyệt/
  // khoá kỳ) ĐÃ CÓ — dùng lại, đừng đẻ bản thứ hai. Ma trận vai ở §1.3 của tài liệu; seed v2 ở
  // `prisma/seed-roles.ts` (GLOBAL hết — key gác trang gọi trần, CENTER sẽ FALSE trên prod).
  // ⚠️ Key mới ⇒ sau `test` → `main` PHẢI bấm `seed-prod-roles.yml`.
  | "sources:view" // xem danh mục nguồn, attribution, hàng chờ nguồn, Page mapping
  | "sources:manage" // thêm/sửa/đổi trạng thái nguồn, Page mapping
  | "sources:override-after-payment" // đổi nguồn lead ĐÃ có thực thu ⇒ sinh Adjustment (chỉ SUPER_ADMIN)
  | "commission_policies:view" // xem chính sách + version + văn bản
  | "commission_policies:manage" // soạn nháp, tạo version, gắn văn bản, thử tính
  | "commission_policies:activate" // kích hoạt / cho hết hiệu lực (tách khỏi manage để giao BLĐ)
  | "commission:view-self" // xem dòng sổ của CHÍNH MÌNH (hàm đọc ép beneficiaryUserId = actor)
  | "commission:view-center" // xem mọi dòng/kỳ trong tầm nhìn cơ sở (neo HO ⇒ toàn hệ)
  | "commission_disputes:review" // nhận và quyết khiếu nại hoa hồng
  // 27/08 — khai "QC nào / quản lý nào phụ trách cơ sở nào" cho hoa hồng QC 1% + QL TT 2%.
  // Key RIÊNG, KHÔNG mượn `payments:manage`: quyền đó là của KẾ TOÁN (mở/huỷ/hoàn tiền,
  // duyệt bảng kê). Người TRẢ tiền không nên đồng thời là người chỉ định AI ĐƯỢC NHẬN —
  // và cũng không mượn `centers:edit` (sửa địa chỉ/giờ mở cửa), vì nới quyền sửa cơ sở
  // về sau sẽ vô tình nới luôn quyền chuyển hướng tiền hoa hồng.
  | "commission-assignee:manage"
  | "installments:approve" // FIX lead→payment→enroll (C4) — duyệt kế hoạch trả góp 2 đợt
  | "discounts:approve" // BGĐ 31/07 — duyệt giảm giá nhập tay (kèm giải trình)
  | "orders:view"
  | "orders:manage"
  | "orders:create" // G-A (21/08/2026) — quyền HẸP: tạo đơn GẮN LEAD CỦA MÌNH (lib/orders/create-guard.ts)
  | "orders:view-pii" // che SĐT/email/địa chỉ khách trên đơn hàng — vai CRM/kế toán mới xem đầy đủ

  // --- Phase 5.7 — Vouchers ---

  // --- Phase 5.10 — Products (sales/rental catalog) ---
  | "products:view"
  | "products:manage"

  // --- Phase 5.13 — Email System ---
  | "emails:view"
  | "emails:manage"

  // --- Chat realtime (US-05, Đợt 0 — docs/chat-realtime/permissions.md) ---
  | "chat:read"
  | "chat:send"
  | "chat:announce"
  | "chat:moderate"
  | "chat:admin"

  // --- Đào tạo nội bộ (EL-02 — lib/permissions/registry/elearning.ts) ---
  // Key 3 đoạn, khác 2 đoạn của mọi key cũ. Có chủ đích: `resource:verb` không đủ chỗ
  // cho một module 17 quyền trải trên 8 nhóm đối tượng. Test parity (b) trong
  // `registry.test.ts` chỉ soát key 2 đoạn nên bỏ qua nhóm này; parity (a) vẫn phủ.
  | "elearning:portal:access"
  | "elearning:lesson:learn"
  | "elearning:program:manage"
  | "elearning:content:author"
  | "elearning:content:publish"
  | "elearning:assignment:create"
  | "elearning:assignment:extend"
  | "elearning:requirement:manage"
  | "elearning:progress:view-own"
  | "elearning:progress:view-team"
  | "elearning:progress:view-all"
  | "elearning:video-analytics:view"
  | "elearning:exam:grade"
  | "elearning:exam:unlock"
  | "elearning:certificate:issue"
  | "elearning:certificate:revoke"
  | "elearning:report:export"

  // --- Hộp thư đa kênh (Zalo OA / Messenger) — hội thoại với KHÁCH ngoài hệ ---
  // ⚠️ CỐ Ý KHÔNG mượn `chat:*`. Hai thứ khác hẳn nhau và trộn là hỏng cả hai:
  //   • `chat:*` là chat NỘI BỘ giữa người CÓ TÀI KHOẢN (GV ↔ PH), quyền theo
  //     tư cách thành viên hội thoại, seed scope OWN/ASSIGNED/CENTER.
  //   • `inbox:*` là hội thoại với người NGOÀI hệ (khách trên Zalo/Facebook),
  //     phạm vi theo đơn vị, và người trực không phải là "thành viên" của gì cả.
  // Thêm nữa `chat:read` seed non-GLOBAL nên không dùng làm cổng trang được —
  // đúng cái bẫy đã suýt khoá cửa /tin-nhan của cả GV lẫn QLCS trên prod.
  | "inbox:view"
  | "inbox:reply"
  | "inbox:assign"

  // --- Tích hợp ZaloCRM (nick Zalo CÁ NHÂN, màn nhúng qua SSO) ---
  // ⚠️ CỐ Ý KHÔNG mượn `inbox:*`. Ba thứ dễ lẫn nhau, tách rạch ròi mới đúng:
  //   • `chat:*`    — chat NỘI BỘ giữa người CÓ TÀI KHOẢN (GV ↔ PH).
  //   • `inbox:*`   — hộp thư đa kênh của CHÍNH repo này (Zalo OA / Messenger),
  //                   dữ liệu nằm ở ba bảng `Inbox*`, người trực là Sale.
  //   • `zalocrm:*` — màn của một ỨNG DỤNG NGOÀI nhúng bằng iframe + SSO, nói chuyện
  //                   qua nick Zalo cá nhân của nhân viên. Không phải Zalo OA, không
  //                   chung hạn mức, không chung dữ liệu, và có thể tắt/bật độc lập
  //                   bằng cờ `ZALOCRM_ENABLED` mà hộp thư vẫn chạy.
  // Gộp vào `inbox:view` thì không còn cách nào cho một cơ sở dùng hộp thư mà không
  // dùng ZaloCRM — mà đó đúng là trạng thái lúc bật dần từng cơ sở.
  //
  // MỘT quyền cho cả "mở màn" lẫn "nhắn khách": bên trong iframe là app ngoài, repo
  // này không chặn được từng thao tác, nên tách `view`/`reply` sẽ là quyền GIẢ —
  // hứa một lớp gác không tồn tại.
  | "zalocrm:use"
  | "zalocrm:manage-nick"
  // --- Chính sách khuyến mãi (26/09/2026) — BLĐ ban hành, Sale tra cứu ---
  // view = xem chính sách + mã voucher đang/đã áp dụng · manage = ban hành/sửa/thu hồi
  // chính sách và mã voucher của nó. Chưa gắn vào thanh toán (xem lib/khuyen-mai).
  | "promotions:view"
  | "promotions:manage"
  // --- Học bù đời mới (29/09/2026, docs/hoc-bu/DAC-TA.md) ---
  // view = xem danh sách cần bù + case · manage = tạo case, xếp bé (Sale + quản lý lớp)
  // · waive = huỷ không bù / duyệt miễn phí ngoại lệ, BẮT BUỘC lý do (QLCS, Giám đốc, Admin).
  | "makeup:view"
  // view-all = thấy MỌI học viên cần bù của cơ sở; thiếu nó (Sale) chỉ thấy học viên mình phụ trách.
  | "makeup:view-all"
  | "makeup:manage"
  | "makeup:waive"
  // attend = giáo viên điểm danh buổi DẠY BÙ mình dạy (site GV). GLOBAL có chủ đích: case bù gom
  // bé từ nhiều lớp nên không có `classId` để làm target; "đúng giáo viên của case" chốt ở luật
  // nghiệp vụ (`diemDanhBu` · `chiGiaoVien`).
  | "makeup:attend"
  // --- Bảo lưu học viên (08/10/2026, docs/bao-luu/spec.md §C) ---
  // view = xem hồ sơ + sự kiện · create = lập hồ sơ, đề nghị gia hạn, báo phục học, huỷ hồ sơ chưa bắt đầu
  // · approve = duyệt/từ chối, lùi ngày, xác nhận lớp phục học · extend = duyệt GIA HẠN · exception =
  // vượt trần, ngoại lệ, khôi phục hồ sơ chấm dứt (chỉ BGĐ) · center-pause = bảo lưu do Trung tâm ·
  // settings = sửa tham số pause.* · refund-request = sinh yêu cầu hoàn gửi Kế toán.
  // ⚠️ Người LẬP hồ sơ không được DUYỆT hồ sơ của chính mình, và người đề nghị gia hạn không duyệt gia hạn:
  // luật đó nằm ở SERVER ACTION (maker–checker), không ở bảng quyền này.
  | "bao-luu:view"
  | "bao-luu:create"
  | "bao-luu:approve"
  | "bao-luu:extend"
  | "bao-luu:exception"
  | "bao-luu:center-pause"
  | "bao-luu:settings"
  | "bao-luu:refund-request";

// =============================================================================
// MATRIX — Mỗi action liệt kê rõ những role được phép.
// =============================================================================

export const PERMISSIONS: Record<Action, Role[]> = {
  // --- Employees ---
  "employees:view-all": ["SUPER_ADMIN", "HR"],
  "employees:view-public": [
    "SUPER_ADMIN", "CENTER_MANAGER", "HR", "SALES_CSM", "TEACHER", "MARKETING", "ACCOUNTANT",
  ],
  "employees:create": ["SUPER_ADMIN", "HR"],
  "employees:edit": ["SUPER_ADMIN", "HR", "CENTER_MANAGER"],
  "employees:delete": ["SUPER_ADMIN"],
  "employees:view-salary": ["SUPER_ADMIN", "HR", "ACCOUNTANT"],
  "employees:view-personal": ["SUPER_ADMIN", "HR"],

  // --- Honors ---
  "honors:view": [
    "SUPER_ADMIN", "CENTER_MANAGER", "HR", "SALES_CSM", "TEACHER", "MARKETING", "ACCOUNTANT",
  ],
  "honors:create": ["SUPER_ADMIN", "CENTER_MANAGER", "HR", "MARKETING"],
  "honors:edit": ["SUPER_ADMIN", "CENTER_MANAGER", "HR", "MARKETING"],
  "honors:delete": ["SUPER_ADMIN"],
  "honors:settings": ["SUPER_ADMIN"],

  // --- Jobs ---
  // FL W0-NAV-2 hygiene: SALES_CSM bỏ Tuyển dụng (HR/Marketing/quản lý mới cần).
  "jobs:view": ["SUPER_ADMIN", "CENTER_MANAGER", "HR", "MARKETING"],
  "jobs:create": ["SUPER_ADMIN", "CENTER_MANAGER", "HR"],
  "jobs:edit": ["SUPER_ADMIN", "CENTER_MANAGER", "HR"],
  "jobs:delete": ["SUPER_ADMIN", "HR"],

  // --- Leads ---
  "leads:view-all": ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING"],
  // SUPER_ADMIN có mặt ở mọi action *-own để khớp bypass `isSuperAdmin` của can() v2
  // (lib/auth/can.ts) — nếu thiếu, shadow-compare đẻ lệch v1=false/v2=true mỗi lần
  // admin chạm trang này. Behavior-neutral: call-site chỉ thu hẹp khi `!viewAll && viewOwn`.
  "leads:view-own": ["SUPER_ADMIN", "SALES_CSM"],
  // AI XEM ĐƯỢC SĐT / EMAIL / TÊN / GHI CHÚ TƯ VẤN CỦA LEAD.
  //
  // 30/08/2026 — QUẢN LÝ CƠ SỞ ĐƯỢC XEM LẠI (chủ dự án chốt). Đây là lần ĐẢO THỨ HAI
  // của cùng một câu hỏi, ghi cả ba mốc để lần sau không ai phải đoán:
  //   · 10/07 (#11 T2, Q9) — CENTER_MANAGER CÓ quyền;
  //   · 22/08 (Đợt E, Q9)  — GỠ: "Quản lý cơ sở KHÔNG thấy SĐT lead";
  //   · 30/08              — TRẢ LẠI. Quyết định ký SAU thắng.
  //
  // Hệ quả đi kèm, đừng gỡ riêng lẻ: `canSearchPhone` ở /admin/leads bật theo chính
  // quyền này (che mà vẫn tìm được theo số thì che chỉ là hình thức — dò từng số cũng
  // ra khách). Cách ly cơ sở vẫn do `scopedDb`, không do quyền này.
  //
  // MARKETING giữ quyền từ 21/07 (làm outreach cần liên hệ) — không đụng.
  // Khoá bằng test: lib/auth/lead-pii-policy.test.ts. Sửa đây PHẢI sửa seed-roles.ts.
  "leads:view-pii": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "MARKETING"],
  "leads:create": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "MARKETING"],
  // v1 KHÔNG có vai "Sale Hội sở" (nó chỉ tồn tại ở RBAC v2, gán tay ở
  // /admin/users/[id]/org-roles). Để trống ngoài SUPER_ADMIN là ĐÚNG, không
  // phải sót: nơi nào còn enforce v1 thì tính năng này chưa có mặt.
  "leads:edit-own-intake": ["SUPER_ADMIN"],
  // 17/09/2026 — quyền LÀM MẤT dữ liệu người khác đã ghi trên một lead ĐÃ CÓ:
  // sửa tay ba ô khoá (SĐT · đơn vị · nguồn), bật cột "Đè" khi nhập Excel, và
  // thay thế (thay vì nối thêm) ghi chú. Luật + danh sách ô ở `lib/lead/quyen-sua-lead.ts`.
  //
  // CỐ Ý KHÔNG có SALES_CSM và KHÔNG có MARKETING: chủ dự án chốt "chỉ quản lý cơ sở
  // hoặc admin mới có quyền đè". Sale vẫn giữ `leads:edit` nên sửa được tên PH, email,
  // tên con, tuổi con, khoá quan tâm, ghi chú — chỉ không đè được ba ô kia.
  "leads:overwrite": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "leads:edit": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "MARKETING"],
  // CHỈ Sale (+ Quản trị hệ thống để còn gỡ kẹt). CỐ Ý KHÔNG có CENTER_MANAGER và
  // MARKETING — đó chính là thay đổi mà chủ dự án yêu cầu 27/08/2026.
  // ⚠️ v1 không có vai "Sale Hội sở"; ở v2 HO_SALE cũng KHÔNG được cấp key này
  // (chốt cũ: Sale Hội sở XEM lead toàn hệ thống, KHÔNG sửa).
  "leads:change-status": ["SUPER_ADMIN", "SALES_CSM"],
  "leads:assign": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "leads:assign-config": ["SUPER_ADMIN"],
  // S-5 — XEM sổ lượt chia lead. SALES_CSM có mặt ở đây là CẢ ĐIỂM của ticket:
  // trước đó màn kiểm chứng gác bằng `leads:view-all` nên chính tổ Sale — người
  // mà bằng chứng viết cho — là người duy nhất không mở được.
  // Phạm vi CƠ SỞ do `rotationBoardScope` (lib/lead/rotation.ts) chặn, không do
  // key này: Sale chỉ thấy sổ của cơ sở mình. Sale Hội sở CỐ Ý không có — phiếu họ
  // tự nhập không tiêu lượt nên họ không đứng trong vòng luân phiên nào.
  "leads:rotation-view": ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING", "SALES_CSM"],
  // Quản lý cơ sở điều hành được vòng chia của CƠ SỞ MÌNH (chủ dự án 29/08). Cách ly
  // cơ sở KHÔNG nằm ở đây mà ở truy vấn — xem ghi chú trong registry.
  "lead_pool:manage": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "leads:delete": ["SUPER_ADMIN", "CENTER_MANAGER"],
  // 31/08/2026 — GỠ MARKETING. Chủ dự án chốt: chỉ Quản lý cơ sở + Quản trị tối cao
  // được xuất danh sách lead ra file mang đi được. (Route /api/admin/leads/export cũng
  // đổi cổng sang ĐÚNG quyền này — trước đó nó gác nhầm bằng `leads:view-all`.)
  "leads:export": ["SUPER_ADMIN", "CENTER_MANAGER"],
  // Task #07 — theo pattern students:import. SALES_CSM được cấp theo quyết định
  // user 07/07/2026 (Sale là người giữ danh sách đăng ký thật — câu 33 phiếu Sale).
  // v2: đã seed CENTER scope cho CENTER_SALES_CSM trong seed-roles.ts cùng ngày.
  "leads:import": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"],
  // C-01 — chỉ tiêu lead theo tháng × cơ sở. Chỉ QLCS + Admin (chốt 24/08/2026, OQ-C5).
  // Sale KHÔNG có: chỉ tiêu là thứ người ta bị đo, không phải thứ tự đặt cho mình.
  // Cách ly cơ sở KHÔNG đến từ đây — `LeadTarget` ∈ SCOPE_EXEMPT nên `scopedDb` là
  // pass-through; luật "chỉ cơ sở mình quản" ép TAY trong action bằng
  // `checkRevenueTargetScope` (lib/reports/revenue-target-scope.ts, có test).
  "lead_targets:manage": ["SUPER_ADMIN", "CENTER_MANAGER"],
  // D-02 — chỉ tiêu ngân sách quảng cáo theo tháng × cơ sở. Marketing + Admin.
  //
  // ⚠️ KHÁC C-01 ở đúng một vai: **KHÔNG có CENTER_MANAGER**. PRD CDB-dashboard §D.4
  // chia đôi rành mạch — Marketing ĐẶT chỉ tiêu ngân sách, QLCS XEM chi phí + CPL + CPA
  // của riêng cơ sở mình. Tiền quảng cáo tiêu từ tài khoản ads của Hội sở, QLCS không
  // cầm ví đó; cho họ tự khai chỉ tiêu là để D-03 ("% thực tế / chỉ tiêu") tự chấm điểm
  // mình. Nới thêm vai sau này là một dòng seed; thu lại vai đã cấp thì phải đi hỏi
  // từng người xem ai đã đặt số gì — nên mặc định đi hướng đóng.
  //
  // Cách ly cơ sở KHÔNG đến từ đây — `AdsBudgetTarget` ∈ SCOPE_EXEMPT nên `scopedDb` là
  // pass-through; luật "chỉ cơ sở mình quản" ép TAY trong action bằng
  // `checkRevenueTargetScope` (lib/reports/revenue-target-scope.ts, có test).
  "ads_budget_targets:manage": ["SUPER_ADMIN", "MARKETING"],

  // --- Trial classes (Phase T1.4) ---
  // TRAINING phải có `trials:view`, nếu không thì cấp `trials:assign-teacher` cho họ
  // là vô nghĩa: cả ba trang của màn Lớp Trial đều gác bằng `trials:view`, nên Đào tạo
  // bị đá về /dashboard trước khi thấy được nút phân công. GĐ3 và bản 23/08 của main
  // sửa CÙNG dòng này một cách độc lập — giữ lời giải thích, dòng thì y hệt nhau.
  // GĐ3 — TRAINING phải có `trials:view`, nếu không thì cấp `trials:assign-teacher`
  // cho họ là vô nghĩa: cả ba trang của màn Lớp Trial đều gác bằng `trials:view`, nên
  // Đào tạo bị đá về /dashboard trước khi thấy được nút phân công. Seed v2 đã có, đây
  // là bản v1 — mà local/dev/CI chạy v1 (lib/flags.ts:8 mặc định OFF).
  "trials:view": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "TEACHER", "TRAINING"],
  // ⚠️ 08/09/2026 — ĐẢO ranh giới chốt 23/08. Chủ dự án: "Đào tạo được sử dụng FULL
  // quyền trong màn Lớp Trial."
  //   ~~CỐ Ý KHÔNG cấp `trials:manage` cho TRAINING: quản lý toàn bộ GV ≠ điều hành
  //     tuyển sinh lớp thử~~ **[ĐẢO 08/09]** — nay Đào tạo làm được MỌI việc trong màn
  //     `/admin/lop-trial`: tạo lớp, thêm/bớt buổi, xếp & gỡ học viên, huỷ lớp.
  // Ba khoá thêm cho TRAINING là ĐÚNG BỘ mà màn đó gác: `trials:manage` ·
  // `trials:attendance` · `trials:override-capacity` (view + assign-teacher đã có).
  // KHÔNG kèm `trials:config` (cấu hình số buổi — màn khác, vẫn của QLCS theo QĐ-T3b)
  // và KHÔNG kèm `trials:feedback` (chấm phiếu nằm trọn ở site giáo viên; màn này chỉ
  // ĐỌC phiếu và quyền đọc là `trials:view` — xem chú thích lop-trial/[id]/page.tsx:60).
  "trials:manage": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "TRAINING"],
  // GĐ4 (25/08/2026) — tách đôi theo ma trận đặc tả §8.2. Trước GĐ4 cả điểm danh lẫn
  // nộp phiếu đều dùng chung `trials:feedback`, nên Sale KHÔNG điểm danh được còn
  // giáo viên thì điểm danh được — ngược hẳn quy trình đã chốt.
  "trials:feedback": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  "trials:attendance": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "TRAINING"],
  // R7-02 — gán GV + override sĩ số chỉ quản lý cơ sở; cấu hình số buổi = Đào tạo/Admin.
  // GĐ3 (chủ dự án chốt câu 2, 25/08/2026): CHỐT giáo viên là việc của Đào tạo.
  // Sale chỉ ĐỀ XUẤT; Quản lý cơ sở giữ mọi việc trial còn lại.
  "trials:assign-teacher": ["SUPER_ADMIN", "TRAINING"],
  // 17/09/2026 — tầng Quản lý cơ sở (xem chú thích ở union `Action`). Đúng HAI vai:
  // thêm SALES_CSM vào đây là xoá luôn ranh giới mà khoá này sinh ra để vẽ.
  // ⚠️ Dòng map này KHÔNG được quên: `ALL_ACTIONS = Object.keys(PERMISSIONS)` và
  // `buildActor()` lọc mọi grant theo đúng tập đó — khai ở union mà thiếu ở đây thì
  // khoá VÔ HÌNH với cả `PermissionGrant` lẫn `UserPermissionGrant`.
  "trials:assign-teacher-center": ["SUPER_ADMIN", "CENTER_MANAGER"],
  // 22/09/2026 — chủ dự án chốt: Quản lý cơ sở + Đào tạo được mở lớp trải nghiệm.
  // SALES_CSM CỐ Ý không có: họ giữ `trials:manage` (thêm case, xếp học viên, điểm danh)
  // nhưng mất nút tạo lớp. Thêm SALES_CSM vào đây là xoá đúng ranh giới vừa dựng.
  "trials:create-class": ["SUPER_ADMIN", "CENTER_MANAGER", "TRAINING"],
  "trials:override-capacity": ["SUPER_ADMIN", "CENTER_MANAGER", "TRAINING"],
  // FL W0 (QĐ-T1): cấu hình đào tạo/LMS = TRAINING (Đào tạo). CENTER_MANAGER chỉ xem nội dung LMS.
  "training:manage": ["SUPER_ADMIN", "TRAINING"],
  // 10/07 — BGĐ: "báo cáo của chức năng nào thì role chức năng đó xem". Ba báo cáo đào
  // tạo trước đây gác bằng `classes:view-all` ⇒ HR/Kế toán/Marketing mở được bằng URL.
  // Không tái dùng `training:manage` (QL cơ sở sẽ mất báo cáo lớp của chính mình) cũng
  // không dùng `curriculum:view` (kéo cả GV vào xem hiệu suất đồng nghiệp).
  "reports:training": ["SUPER_ADMIN", "CENTER_MANAGER"],
  // FL W0-NAV-2 (QĐ-T3b): trả lại cho CM 2 việc vận hành qua action riêng — KHÔNG mở lại training:manage.
  // CM cần cấu hình số buổi lớp trải nghiệm + duyệt đề xuất chỉnh bài của GV.
  "trials:config": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "lesson-change:approve": ["SUPER_ADMIN", "TRAINING"],

  // --- Notifications (Phase NHÓM 3) ---
  "notifications:manage": ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING"],

  // --- Parent requests (Phase NHÓM 3) ---
  "parent-requests:manage": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"],

  // --- Parent feedback (Phase NHÓM 3) ---
  "parent-feedback:view": ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING"],

  // --- Media / ảnh lớp (Phase NHÓM 3) ---
  // MARKETING thêm 11/08 (chủ dự án chốt): góp ảnh vào KHO của lớp để GV chọn gửi
  // PH — chỉ `media:view` + `media:upload-draft`, KHÔNG `media:upload` (đăng thẳng
  // tới PH) và KHÔNG `media:approve`.
  "media:view": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER", "MARKETING"],
  "media:upload": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  // ⚠️ CỐ Ý CHỈ có vai "chỉ góp ảnh". KHÔNG thêm TEACHER (GV đã vào kho được qua
  // đường phụ trách lớp — cấp thêm sẽ nới GV ra MỌI lớp trong cơ sở) và KHÔNG thêm
  // CENTER_MANAGER (đã có media:approve nên qua canPublishToClass; khai thừa ở v1
  // còn làm rbac-parity đỏ vì RoleDef v2 của vai này không giữ action này).
  // Vai chỉ-góp-ảnh của v2 (`CENTER_CLASS_MANAGER` — Giáo vụ) không có ở enum v1.
  "media:upload-draft": ["SUPER_ADMIN", "MARKETING"],
  "media:approve": ["SUPER_ADMIN", "CENTER_MANAGER"],

  // --- HR attendance / chấm công QR (Phase NHÓM 4) ---
  // checkin = mọi nhân viên (không gồm PARENT). view = quản lý cơ sở + HR.
  // TRAINING thêm 03/08: checkin là self-action của MỌI nhân viên, sót role này
  // từ khi thêm TRAINING (FL W0) ⇒ tài khoản chỉ-Đào-tạo bị đá khỏi cả 4 trang
  // chấm công (checkin, lich-ca, yeu-cau-cong, chinh-cong) — không chấm công được ngày nào.
  "hr_attendance:checkin": [
    "SUPER_ADMIN", "CENTER_MANAGER", "HR", "SALES_CSM", "TEACHER", "MARKETING", "ACCOUNTANT",
    "TRAINING",
  ],
  "hr_attendance:view": ["SUPER_ADMIN", "CENTER_MANAGER", "HR", "ACCOUNTANT"],
  // Chỉnh bản ghi công + duyệt yêu cầu chỉnh công (giới hạn thời gian áp ở action).
  "hr_attendance:adjust": ["SUPER_ADMIN", "CENTER_MANAGER"],
  // Module chấm công v3 (L1 · 06/09/2026) — kế hoạch §5. v1 là ma trận tĩnh chạy ở
  // local/dev; scope CENTER/GLOBAL thật nằm ở seed-roles (v2, prod).
  "hr_attendance:assign": ["SUPER_ADMIN", "CENTER_MANAGER", "HR"], // khung ca, lưới, import
  "hr_attendance:approve": ["SUPER_ADMIN", "CENTER_MANAGER"], // duyệt đơn (Q-11, T-06)
  "hr_attendance:close-period": ["SUPER_ADMIN", "CENTER_MANAGER", "ACCOUNTANT"], // chốt kỳ (Q-10)
  "hr_attendance:export": ["SUPER_ADMIN", "CENTER_MANAGER", "ACCOUNTANT"],
  "hr_attendance:config": ["SUPER_ADMIN", "CENTER_MANAGER", "HR", "ACCOUNTANT"], // danh mục ca, lễ + hệ số (T-04)

  // --- Blog / News ---
  "blog:view": [
    "SUPER_ADMIN", "CENTER_MANAGER", "HR", "SALES_CSM", "TEACHER", "MARKETING", "ACCOUNTANT",
  ],
  "blog:create": ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING"],
  "blog:edit": ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING"],
  "blog:delete": ["SUPER_ADMIN"],
  // FL W0-NAV-2 hygiene: SALES_CSM + ACCOUNTANT bỏ Tin tức (nội dung website = Marketing/quản lý/HR/GV).
  "news:view": [
    "SUPER_ADMIN", "CENTER_MANAGER", "HR", "TEACHER", "MARKETING",
  ],
  "news:create": ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING"],
  "news:edit": ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING"],
  "news:delete": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "news:publish": ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING"],

  // --- Payroll ---
  "payroll:view": ["SUPER_ADMIN", "ACCOUNTANT", "HR"],
  "payroll:edit": ["SUPER_ADMIN", "ACCOUNTANT"],

  // --- Students ---
  "students:view-all": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "MARKETING", "ACCOUNTANT", "HR"],
  "students:view-own-class": ["SUPER_ADMIN", "TEACHER", "CENTER_MANAGER"],
  "students:create": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"],
  // FL W0 (QĐ-T4): kế toán KHÔNG sửa hồ sơ học viên (gỡ ACCOUNTANT).
  "students:edit": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"],
  "students:change-code": ["SUPER_ADMIN"], // R7-05 C10 — chỉ SUPER_ADMIN sửa mã HV (audit + reason)
  "students:delete": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "students:import": ["SUPER_ADMIN", "CENTER_MANAGER"],

  // --- Classes ---
  "classes:view-all": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "ACCOUNTANT", "HR", "MARKETING", "TRAINING"],
  "classes:view-own": ["SUPER_ADMIN", "TEACHER"],
  "classes:create": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "classes:edit": ["SUPER_ADMIN", "CENTER_MANAGER", "TRAINING"],
  "classes:delete": ["SUPER_ADMIN"],

  // --- Class groups (Phase T0.2) ---
  "class_group:view-all": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "class_group:create": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "class_group:edit": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "class_group:delete": ["SUPER_ADMIN"],

  // --- Enrollments ---
  "enrollments:view-all": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "ACCOUNTANT"],
  "enrollments:override-progress": ["SUPER_ADMIN"],
  "enrollments:view-own": ["SUPER_ADMIN", "TEACHER"],
  "enrollments:create": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"],
  "enrollments:edit": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"],
  "enrollments:transfer": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "completions:manage": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  // GV chỉ ĐỀ XUẤT hoàn thành khoá (xác nhận thật = completions:manage của trung tâm).
  "completions:propose-own": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],

  // --- Evaluations / surveys (R7-16) ---
  "evaluations:manage": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "evaluations:view-aggregate": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  "evaluations:view-detail": ["SUPER_ADMIN", "CENTER_MANAGER"],

  // --- Report cards (R7-15) ---
  // #17 (câu 55, Đào tạo & GV — Toại 06/07/2026): sau khi PHÁT HÀNH học bạ chỉ QL cơ
  // sở + Phan Thành Toại (Đào tạo/TRAINING) được sửa; Toại giữ quyền duyệt/phát hành.
  // → TRAINING nhận CẢ manage (để nộp lại RECALLED→PENDING_REVIEW) LẪN review (duyệt/
  // phát hành/thu hồi). GIỮ TEACHER ở manage (GV vẫn viết DRAFT + đánh giá buổi). Việc
  // "siết sửa-sau-thu-hồi về đúng review-havers (QL/Đào tạo/Admin), chặn GV" làm ở tầng
  // action (saveReportCardAction → canEditReportCardContent), KHÔNG gỡ TEACHER ở đây.
  "report-cards:manage": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  "report-cards:review": ["SUPER_ADMIN", "CENTER_MANAGER", "TRAINING"],
  "satacoin:manage": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  "enrollments:cancel": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "enrollments:delete": ["SUPER_ADMIN", "CENTER_MANAGER"],

  // --- Sessions + Attendance ---
  // FL W0-NAV-2 hygiene (BA #07 3.C): SALES_CSM bỏ Buổi học/Điểm danh (module dư — Sale lo lead/tuyển sinh).
  "sessions:view": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  "sessions:create": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  "sessions:edit": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  // 18/08 (chủ dự án): "admin hoặc đào tạo xem được HẾT đánh giá/nhận xét các buổi
  // học trong lớp, của từng học viên qua từng buổi". CHỈ ĐỌC. TRAINING có mặt ở đây
  // là ngoại lệ hẹp của đợt khoá chặt 24/07 — Đào tạo cần đọc nội dung giảng dạy để
  // giám sát chất lượng, nhưng vẫn KHÔNG có sessions:* (không sửa/không quản lịch).
  "session-feedback:view-all": ["SUPER_ADMIN", "CENTER_MANAGER", "TRAINING", "TEACHER"],
  "attendance:view": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  "attendance:mark": ["TEACHER", "SUPER_ADMIN", "CENTER_MANAGER"],
  // Task #16 (Kiệt duyệt 07/07/2026, Phương án A): CSKH (SALES_CSM) được SỬA/hồi tố
  // điểm danh — cửa sổ 7 ngày enforce ở call-site (markAttendance). v2 seed CENTER cho
  // CENTER_SALES_CSM + RoleDef mới CENTER_CLASS_MANAGER (prisma/seed-roles.ts).
  "attendance:edit": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"],

  // --- Courses + Packages ---
  // FL W0-NAV-2 hygiene: SALES_CSM + ACCOUNTANT bỏ "Khoá dạy" (Sale bán qua Gói học = course-packages; KT không cần).
  // 03/08 — gỡ CENTER_MANAGER: chủ dự án chặn phần LMS ở vai Quản lý cơ sở.
  "courses:view": ["SUPER_ADMIN", "TRAINING", "HR", "TEACHER", "MARKETING"],
  // Chỉnh chương trình học (curriculum + khóa học + gói combo) CHỈ Đào tạo + SUPER_ADMIN
  // (user chốt 24/07): gỡ khỏi CENTER_MANAGER + MARKETING.
  "courses:create": ["SUPER_ADMIN", "TRAINING"],
  "courses:edit": ["SUPER_ADMIN", "TRAINING"],
  "courses:delete": ["SUPER_ADMIN", "TRAINING"],
  "course-packages:view": [
    "SUPER_ADMIN", "TRAINING", "CENTER_MANAGER", "SALES_CSM", "MARKETING",
  ],
  // FL-R2 W5 — course-packages = GIÁ/BÁN (tiền) → siết về [SUPER_ADMIN, CENTER_MANAGER]
  // cho khớp action requireAdmin (course-packages/_actions.ts). Trước đây matrix nới
  // TRAINING/MARKETING nhưng action chặn → mở form được mà submit fail (mất công nhập).
  "course-packages:edit": ["SUPER_ADMIN", "TRAINING"],

  // --- Curriculum + Lessons ---
  // FL W0 (QĐ-T1): biên soạn nội dung LMS = TRAINING (Đào tạo). TEACHER + CENTER_MANAGER chỉ XEM.
  "curriculum:view": ["SUPER_ADMIN", "TRAINING", "TEACHER"],
  "curriculum:create": ["SUPER_ADMIN", "TRAINING"],
  "curriculum:edit": ["SUPER_ADMIN", "TRAINING"],
  "curriculum:delete": ["SUPER_ADMIN", "TRAINING"],

  // --- Questions / Exams / Assignments ---
  // FL W0 (QĐ-T1): kho câu hỏi/đề thi/bài tập biên soạn bởi TRAINING. TEACHER chỉ XEM + chấm bài/đề.
  "questions:view": ["SUPER_ADMIN", "TRAINING", "TEACHER"],
  "questions:author": ["SUPER_ADMIN", "TRAINING"],
  "questions:edit": ["SUPER_ADMIN", "TRAINING"],
  "questions:delete": ["SUPER_ADMIN", "TRAINING"],
  "exams:view": ["SUPER_ADMIN", "TRAINING", "TEACHER"],
  "exams:create": ["SUPER_ADMIN", "TRAINING"],
  "exams:edit": ["SUPER_ADMIN", "TRAINING"],
  "exams:grade": ["TEACHER", "SUPER_ADMIN", "TRAINING", "CENTER_MANAGER"],
  "exams:delete": ["SUPER_ADMIN", "TRAINING"],
  "assignments:view": ["SUPER_ADMIN", "TRAINING", "TEACHER"],
  "assignments:create": ["SUPER_ADMIN", "TRAINING"],
  "assignments:edit": ["SUPER_ADMIN", "TRAINING"],
  "assignments:grade": ["TEACHER", "SUPER_ADMIN", "TRAINING", "CENTER_MANAGER"],
  "assignments:delete": ["SUPER_ADMIN", "TRAINING"],
  // Site GV (L6): GV GIAO bài từ template có sẵn cho LỚP MÌNH phụ trách. KHÁC
  // assignments:create (TRAINING soạn kho toàn hệ thống) — capability này CHỈ cho
  // giao lại template, và action tự khoá classId ∈ assignedClassIds (cấp LỚP,
  // không phải cấp cơ sở). GV KHÔNG soạn kho/không sửa bài admin.
  "assignments:assign-own": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  // Site GV (L6) — "Kho bài tập của tôi": GV TỰ SOẠN đề trắc nghiệm/tự luận + tự
  // xoá đề của MÌNH (AssignmentTemplate.createdById = employeeId/userId của GV).
  // KHÁC assignments:create (TRAINING soạn kho toàn hệ thống) — capability này chỉ
  // đụng template do chính GV tạo (own-scope qua createdById), KHÔNG sửa/xoá bài admin.
  "assignments:author-own": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],

  // --- Documents ---
  // FL W0 (QĐ-T1): tài liệu LMS biên soạn/upload bởi TRAINING. TEACHER + CENTER_MANAGER chỉ XEM.
  "documents:view": ["SUPER_ADMIN", "TRAINING", "TEACHER"],
  "documents:upload": ["SUPER_ADMIN", "TRAINING"],
  "documents:delete": ["SUPER_ADMIN", "TRAINING"],

  // --- Teaching materials (FL W0) — GV xem tài liệu giảng dạy của lớp mình ---
  "teaching-materials:view-own-class": ["SUPER_ADMIN", "TRAINING", "TEACHER"],

  // --- Centers / Rooms / Holidays ---
  // 29/08/2026 — SALES_CSM ĐÃ GỠ khỏi 3 dòng `centers:view` / `holidays:view` /
  // `kits:view` (chủ dự án chốt: ẩn "Cơ sở" · "Lịch nghỉ" · "Học cụ" khỏi sidebar
  // Sale). Gỡ ở CẢ v1 lẫn v2 (`prisma/seed-roles.ts`, vai `CENTER_SALES_CSM`) để
  // local/dev không nói khác prod.
  "centers:view": [
    "SUPER_ADMIN", "CENTER_MANAGER", "HR", "TEACHER", "MARKETING", "ACCOUNTANT",
  ],
  "centers:edit": ["SUPER_ADMIN"],
  // FL W0-NAV-2 hygiene: SALES_CSM bỏ Phòng học (module dư).
  "rooms:view": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  "rooms:edit": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "holidays:view": [
    "SUPER_ADMIN", "CENTER_MANAGER", "HR", "TEACHER", "MARKETING", "ACCOUNTANT",
  ],
  "holidays:edit": ["SUPER_ADMIN", "CENTER_MANAGER"],

  // --- Inventory ---
  "inventory:view": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER", "ACCOUNTANT"],
  "inventory:edit": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "inventory:movement": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  "inventory:audit": ["SUPER_ADMIN", "ACCOUNTANT"],

  // --- ZMRoboKit ---
  "kits:view": [
    "SUPER_ADMIN", "CENTER_MANAGER", "MARKETING",
  ],
  "kits:edit": ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING"],

  // --- Site content / CMS ---
  "site-content:view": ["SUPER_ADMIN", "MARKETING"],
  "site-content:edit": ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING"],

  // --- Audit logs ---
  // Câu 13 BGĐ (đã ký): BGĐ (SUPER_ADMIN) + Quản lý cơ sở (CENTER_MANAGER, mỗi
  // người chỉ xem cơ sở mình — scope ép ở tầng query theo orgUnit) được xem; PII
  // che mặc định. view-pii = break-glass "xem đầy đủ" có kiểm soát (reason + log
  // riêng audit.pii-unmasked). Cùng tập role với view — kiểm soát nằm ở reason+audit.
  "audit-logs:view": ["SUPER_ADMIN"],
  "audit-logs:view-pii": ["SUPER_ADMIN"],

  // --- Dashboard QLCS 4 tab (A-02) ---
  // Chốt 24/08/2026: `SUPER_ADMIN` + `CENTER_MANAGER` + vai Hội sở.
  // Enum `Role` của v1 không có tầng HO/CENTER, nên hai vai HO đại diện được ở đây là
  // ACCOUNTANT (→ HO_ACCOUNTANT) và MARKETING (→ HO_MARKETING) — đúng ánh xạ
  // LEGACY_TO_V2 của rbac-parity.test.ts. `HO_HR` chỉ tồn tại ở v2 nên được seed thẳng
  // trong prisma/seed-roles.ts; KHÔNG thêm "HR" vào đây, vì HR ở v1 ánh xạ sang
  // **CENTER_HR** (nhân sự CƠ SỞ) — thêm là parity đòi cấp cho cả vai cấp cơ sở đó.
  // `HO_SALE` cố ý KHÔNG có: vai đó là "phiếu mình nhập" (RoleDef ghi rõ), cho họ màn
  // tổng quan toàn cơ sở là ngược hẳn phạm vi vai. Mở thêm sau = một dòng seed.
  //
  // ⚠️ Vào được TRANG ≠ xem được mọi tab. Gate từng tab (B → payments:view ·
  // C → leads:view-all · D/E → dashboard:view — chốt 24/08) đi kèm nội dung tab.
  "dashboard:view": ["SUPER_ADMIN", "CENTER_MANAGER", "ACCOUNTANT", "MARKETING"],

  // --- Settings / system ---
  "settings:view": ["SUPER_ADMIN"],
  // Cua HEP: chi mo trang o che do cai-rieng-theo-co-so. Cach ly nam o duong ghi
  // (`setCenterSetting` doi vai quan ly tai dung orgUnitId).
  "settings:view-center": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "settings:edit": ["SUPER_ADMIN"],
  "users:manage": ["SUPER_ADMIN"], // create/disable User accounts
  "roles:assign": ["SUPER_ADMIN"],
  "roles:manage": ["SUPER_ADMIN"], // A0-02 — chỉ SUPER_ADMIN cấu hình role/permission
  "user-groups:manage": ["SUPER_ADMIN"], // US-03 — chỉ SUPER_ADMIN quản nhóm + grant nhóm

  // --- Phase 5.6 — Financial ---
  "payments:manage": ["SUPER_ADMIN", "ACCOUNTANT"],
  "payments:view": ["SUPER_ADMIN", "CENTER_MANAGER", "ACCOUNTANT"],
  "payments:record": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "ACCOUNTANT"],
  "payments:confirm": ["SUPER_ADMIN", "ACCOUNTANT"],
  // ⚠️ 07/09/2026 — CHỈ SUPER_ADMIN Ở ĐÂY LÀ CỐ Ý, KHÔNG PHẢI SÓT.
  //
  // Vai nghiệp vụ (kế toán Hội sở + kế toán cơ sở) nhận `payments:adjust` DUY NHẤT ở
  // RBAC v2 — `prisma/seed-roles.ts`. Prod đang bật `RBAC_V2_ENABLED` nên kế toán dùng
  // được thật; máy dev/CI chạy v1 nên ở đó chỉ SUPER_ADMIN thấy nút. Chênh lệch đó là
  // ĐÃ BIẾT, không phải bug: đừng "sửa cho khớp" bằng cách thêm ACCOUNTANT vào đây mà
  // không hỏi — chủ dự án chốt giữ ma trận v1 nguyên trạng.
  //
  // Vì sao danh sách không được RỖNG: repo có bất biến "mọi action phải cấp cho
  // SUPER_ADMIN", canh bằng `permissions.test.ts` ("SUPER_ADMIN phủ toàn bộ action
  // (khớp bypass v2)"). `can()` v2 (lib/auth/can.ts:52) trả true VÔ ĐIỀU KIỆN cho
  // SUPER_ADMIN, nên v1 thiếu SUPER_ADMIN là mỗi lượt admin chạm call-site đẻ một dòng
  // `RbacShadowDiff` (v1=false, v2=true) và cổng `isSafeToEnableRbacV2` không bao giờ
  // về 0.
  //
  // Lịch sử: từ 07/09 đến khi Bước 6 xanh, ô này còn kèm một CẦU DAO ở tầng tính năng
  // (`lib/finance/cau-dao-dieu-chinh.ts`) chặn cả SUPER_ADMIN, vì ma trận không khoá
  // được admin. Cầu dao đã gỡ ở Bước 7 — xem docs/dieu-chinh-khoan-thu.md.
  "payments:adjust": ["SUPER_ADMIN"],
  // #15 (câu 32) — CCCD PH + địa chỉ mask mặc định; break-glass "Xem đầy đủ" (reason
  // ≥10 ký tự + audit) chỉ cho kế toán + admin. v2: HO_ACCOUNTANT GLOBAL,
  // CENTER_ACCOUNTANT CENTER (prisma/seed-roles.ts). KHÔNG mở cho CENTER_MANAGER.
  "payments:view-pii": ["SUPER_ADMIN", "ACCOUNTANT"],
  // 29/09/2026 — import giao dịch thẻ SmartPOS (docs/pos-the-smartpos.md, Q-D): chỉ Kế toán
  // HO + Quản trị tối cao. v2: HO_ACCOUNTANT GLOBAL (prisma/seed-roles.ts), KHÔNG cấp
  // CENTER_ACCOUNTANT. v1 không tách kế toán HO/cơ sở nên ACCOUNTANT là gần nhất.
  "payments:import-pos": ["SUPER_ADMIN", "ACCOUNTANT"],
  // 06/10/2026 — GĐ1 POS (docs/pos-gd1-thiet-ke.md §6.5): tạo phiếu thu thẻ + bấm "Kiểm tra
  // thanh toán" + "Báo admin". Bằng ĐÚNG `payments:record` — v1 không tách kế toán HO/cơ sở.
  // v2: HO_ACCOUNTANT + CENTER_MANAGER + CENTER_SALES_CSM GLOBAL (prisma/seed-roles.ts);
  // CENTER_ACCOUNTANT cố ý KHÔNG (T16). Lưới `[POS1-Q-06]`/`[POS1-Q-07]`.
  "payments:pos-check": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "ACCOUNTANT"],
  // B-01 — đặt mục tiêu doanh thu theo tháng × cơ sở. Key RIÊNG, KHÔNG mượn
  // `payments:manage`: quyền đó là mở/huỷ/hoàn tiền + cấu hình phương thức thanh toán +
  // hoa hồng toàn hệ, cố ý không nằm ở Quản lý cơ sở (#09, giữ nguyên sau đảo 03/08).
  // Cũng KHÔNG mượn `payments:view` — đó là quyền ĐỌC đối soát, mượn nó để GHI thì mọi
  // vai chỉ-đọc về sau tự nhiên ghi được. Cách ly cơ sở KHÔNG đến từ đây: `RevenueTarget`
  // ∈ SCOPE_EXEMPT nên scopedDb pass-through — luật "chỉ cơ sở mình quản" ép TAY trong
  // action qua `checkRevenueTargetScope` (lib/reports/revenue-target-scope.ts).
  "revenue_targets:manage": ["SUPER_ADMIN", "CENTER_MANAGER", "ACCOUNTANT"],
  // 27/08/2026 — CHỐT / DUYỆT / MỞ LẠI kỳ hoa hồng. Key RIÊNG, tách khỏi
  // `payments:manage` vì bảng kê hoa hồng là bảng KỲ TOÀN HỆ THỐNG
  // (`CommissionStatement.period` @unique, KHÔNG có `centerId`) ⇒ đường GHI không có
  // gì cắt theo cơ sở, mà `payments:manage` thì cả `CENTER_ACCOUNTANT` cũng đang giữ
  // ở scope GLOBAL. Hệ quả trước khi tách: kế toán MỘT cơ sở bấm chốt được kỳ hoa
  // hồng của CẢ CÔNG TY.
  // Không gỡ `payments:manage` của kế toán cơ sở (họ còn thu/chi hằng ngày), cũng
  // không hạ nó xuống scope CENTER (mọi call-site gọi trần ⇒ `can()` v2 trả false ⇒
  // mất sạch quyền tiền). Tiền lệ tách key: `revenue_targets:manage` (B-01),
  // `ads_budget_targets:manage` (D-02).
  // v2: seed CHỈ cho HO_ACCOUNTANT (prisma/seed-roles.ts) — legacy `ACCOUNTANT` ánh
  // xạ sang HO_ACCOUNTANT, nên hai tầng khớp nhau.
  "commission_periods:manage": ["SUPER_ADMIN", "ACCOUNTANT"],
  // 08/10/2026 — module Nguồn lead & Chính sách hoa hồng (05 §1.3, phần v1). v1 chỉ chạy ở local/dev/CI;
  // prod đọc v2 từ DB. `GIAM_DOC` KHÔNG có trong enum v1 ⇒ ở local chỉ SUPER_ADMIN kích hoạt được chính
  // sách. TEACHER chưa có `view-self` tới PR12 (site GV riêng) — cấp bây giờ là cấp một trang GV không mở được.
  "sources:view": ["SUPER_ADMIN", "ACCOUNTANT", "MARKETING", "CENTER_MANAGER"],
  "sources:manage": ["SUPER_ADMIN", "MARKETING"],
  "sources:override-after-payment": ["SUPER_ADMIN"],
  "commission_policies:view": ["SUPER_ADMIN", "ACCOUNTANT", "HR", "MARKETING", "CENTER_MANAGER"],
  "commission_policies:manage": ["SUPER_ADMIN", "HR"],
  "commission_policies:activate": ["SUPER_ADMIN"],
  "commission:view-self": [
    "SUPER_ADMIN",
    "ACCOUNTANT",
    "HR",
    "MARKETING",
    "CENTER_MANAGER",
    "SALES_CSM",
    "TRAINING",
  ],
  "commission:view-center": ["SUPER_ADMIN", "ACCOUNTANT", "HR", "CENTER_MANAGER"],
  "commission_disputes:review": ["SUPER_ADMIN", "HR"],
  // 27/08 — CHỈ SUPER_ADMIN. Đây là quyết định "ai được nhận 3% doanh thu", chủ dự án
  // tự nhập. Vì chỉ SUPER_ADMIN, key này KHÔNG cần chạy `seed-prod-roles.yml`: v2
  // (`lib/auth/can.ts:52`) cho SUPER_ADMIN đi thẳng, không tra `RoleDef` trong DB.
  // ⚠️ Muốn mở cho vai khác thì PHẢI seed v2 — nếu không, người đó qua được gate v1 ở
  // local mà bị chặn câm trên prod (prod đang enforce v2).
  "commission-assignee:manage": ["SUPER_ADMIN"],
  // C4 — duyệt kế hoạch trả góp 2 đợt: chỉ quản lý cơ sở + admin (audit + reason bắt buộc khi từ chối).
  // #09 (09/07): v2 chuyển quyền này sang HO_ACCOUNTANT (de-xuat-scope §3.3 "tiền tập
  // trung"). `lib/orders/installments.ts` gate bằng matrix v1 (không theo cờ) làm lớp
  // phòng thủ, nên v1 PHẢI có ACCOUNTANT — nếu không, sau flip kế toán Hội sở qua được
  // gate v2 ở wrapper rồi bị chính lib chặn. CENTER_MANAGER giữ ở v1 cho tới khi flip:
  // gate thật nằm ở `checkPermission` trong _installment-approval-actions.ts.
  "installments:approve": ["SUPER_ADMIN", "CENTER_MANAGER", "ACCOUNTANT"],
  // BGĐ 31/07 — duyệt giảm giá: Quản lý cơ sở (người đệ trình là Sale/CSKH cơ sở).
  // ACCOUNTANT giữ như installments:approve để kế toán Hội sở không bị lib chặn sau flip v2.
  "discounts:approve": ["SUPER_ADMIN", "CENTER_MANAGER", "ACCOUNTANT"],
  "orders:view": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "ACCOUNTANT"],
  "orders:manage": ["SUPER_ADMIN", "CENTER_MANAGER", "ACCOUNTANT"],
  // G-A (biên bản chốt 4 cổng, 21/08/2026): mở đường chốt đơn cho Sale mà KHÔNG
  // cấp `orders:manage` (vốn cho mở/huỷ/hoàn toàn hệ thống). Ai có `orders:manage`
  // cũng phải có action này vì cổng tạo đơn nay kiểm `orders:create`.
  // Phạm vi "chỉ đơn gắn lead của mình" KHÔNG nằm ở scope RBAC mà ở guard tường
  // minh `checkOrderCreateOwnership()` — vì `can()` v2 với scope CENTER cần target,
  // còn cổng tạo đơn gọi trần. Xem lib/orders/create-guard.ts.
  "orders:create": ["SUPER_ADMIN", "CENTER_MANAGER", "ACCOUNTANT", "SALES_CSM"],
  // Xem đầy đủ liên hệ khách trên đơn (CRM + kế toán); vai khác thấy bản che.
  "orders:view-pii": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "ACCOUNTANT"],

  // --- Phase 5.7 — Vouchers ---

  // --- Phase 5.10 — Products ---
  "products:view": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "MARKETING", "ACCOUNTANT"],
  "products:manage": ["SUPER_ADMIN", "CENTER_MANAGER", "ACCOUNTANT"],

  // --- Phase 5.13 — Email System ---
  // R7 hygiene (BA #07 3.C): ACCOUNTANT bỏ Email Templates/Logs — không phải chức năng kế toán.
  "emails:view": ["SUPER_ADMIN", "MARKETING"],
  "emails:manage": ["SUPER_ADMIN", "CENTER_MANAGER", "MARKETING"],

  // --- Chat realtime (US-05 — nguồn sự thật: docs/chat-realtime/permissions.md) ---
  // Matrix v1 chỉ gate VAI được vào chat; quyền đọc/gửi thật là participant-based
  // enforce ở tầng action (delta 00-dieu-chinh mục E.3). SALES_CSM P0: 403 toàn bộ
  // (F5 đã dời) — cố ý KHÔNG xuất hiện ở bất kỳ action chat:* nào.
  // F5 (mở phạm vi 10/08/2026): SALES_CSM vào danh sách — nhưng CHỈ mở được kênh 1-1 với
  // phụ huynh mình phụ trách; chốt chặn thật là `Enrollment.saleId` kiểm trong handler
  // của `openDm`. Sale vẫn ❌ ở MỌI ô nhóm lớp (không có action nào cho phép, và scope
  // OWN của v2 không khớp target nhóm lớp).
  "chat:read": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER", "PARENT", "SALES_CSM"],
  // ⚠️ chat:send CỐ Ý KHÔNG có SUPER_ADMIN — ngoại lệ DUY NHẤT của luật "SUPER_ADMIN
  // phủ mọi action" (permissions.test.ts): US-15 AC4 — chế độ xem của Admin là CHỈ
  // ĐỌC, không gửi CHAT vào hội thoại mình không phải thành viên. can() v2 bypass
  // SUPER_ADMIN vẫn true ⇒ chốt chặn thật nằm ở participant-check trong Server
  // Action (US-06); v1 deny thêm một lớp + pin ý định ngay tại matrix.
  "chat:send": ["CENTER_MANAGER", "TEACHER", "PARENT", "SALES_CSM"],
  "chat:announce": ["SUPER_ADMIN", "CENTER_MANAGER", "TEACHER"],
  // Gỡ tin người khác: GV nhóm mình (+ lý do) hoặc Admin. QLCS ❌ (permissions.md).
  "chat:moderate": ["SUPER_ADMIN", "TEACHER"],
  // /admin/hoi-thoai + khoá hội thoại + tra cứu F-AUDIT — chỉ Admin HO (US-15 AC5).
  "chat:admin": ["SUPER_ADMIN"],

  // --- Hộp thư đa kênh ---
  // Sale là người trực hộp thư; Quản lý cơ sở theo dõi và gán việc.
  // MARKETING cố ý KHÔNG có: họ chạy chiến dịch, không trực khách. Cần thì cấp
  // riêng ở RBAC v2, đừng nới ở đây.
  "inbox:view": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"],
  "inbox:reply": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"],
  // Gán người phụ trách + nối hội thoại mồ côi vào phiếu khách. Gộp hai việc vào
  // một quyền vì cả hai đều là "phân loại việc", và tách ra thì màn hàng đợi mồ
  // côi có người mở được mà không xử lý được gì.
  "inbox:assign": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"],

  // --- Tích hợp ZaloCRM (S6) ---
  // Cùng bộ vai với hộp thư: Sale là người trực, Quản lý cơ sở theo dõi + trực thay.
  // Vai thứ tư là Giáo vụ (`CENTER_CLASS_MANAGER`) — KHÔNG BIỂU DIỄN ĐƯỢC ở đây vì
  // enum `Role` của Prisma chỉ có 9 giá trị và không có nó; Giáo vụ chỉ tồn tại ở
  // RoleDef v2 (`prisma/seed-roles.ts`). Hệ quả phải nhớ: ở local/dev/CI (chạy v1)
  // Giáo vụ KHÔNG vào được /zalo-crm dù prod (chạy v2) vào được — KHÔNG phải bug,
  // đừng "vá" bằng cách mượn một vai v1 khác.
  //
  // MARKETING và HO_SALE cố ý KHÔNG có: Marketing chạy chiến dịch chứ không trực
  // khách, còn Sale Hội sở bị loại theo chốt 9.7 (nick Zalo cá nhân thuộc về người
  // trực TẠI cơ sở, Hội sở không dùng).
  //
  // Khai ở đây KHÔNG phải vì bảng này là nguồn sự thật (nguồn là `RoleDef` +
  // `RolePermission` trong DB, v2 đang enforce trên prod) mà vì hai lý do kỹ thuật:
  // `ALL_ACTIONS = Object.keys(PERMISSIONS)` nên bỏ qua đây là local/dev/CI luôn
  // deny — không ai test được tính năng; và `buildActor()` LỌC grant theo đúng tập
  // đó nên mọi `UserPermissionGrant` mang key này bị vứt IM LẶNG, không lỗi.
  "zalocrm:use": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"],
  // GIAO nick cho người — CỐ Ý hẹp hơn `zalocrm:use`. Tư vấn viên dùng nick thì có,
  // nhưng tự giao nick cho mình thì không: đó là cổng phân quyền, không phải việc
  // hằng ngày của họ.
  "zalocrm:manage-nick": ["SUPER_ADMIN", "CENTER_MANAGER"],

  // Chính sách khuyến mãi — Sale tra cứu, QLCS + Kế toán đối chiếu giảm giá trên đơn,
  // Marketing biết chương trình nào đang chạy. Ban hành CHỈ BLĐ: ở v1 là SUPER_ADMIN, ở
  // v2 thêm `GIAM_DOC` (không có vai v1 tương ứng).
  "promotions:view": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "MARKETING", "ACCOUNTANT"],
  "promotions:manage": ["SUPER_ADMIN"],
  // Học bù — v1 không có vai "quản lý lớp"/"Giám đốc"; hai vai đó chỉ có ở v2 (seed-roles).
  "makeup:view": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"],
  "makeup:view-all": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "makeup:manage": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM"],
  "makeup:waive": ["SUPER_ADMIN", "CENTER_MANAGER"],
  // Điểm danh + nhận xét buổi bù: GV của case (site GV) và quản lý (admin). Sale KHÔNG — Sale chỉ
  // xem đã điểm danh/nhận xét chưa để nhắc GV (chốt 29/09).
  "makeup:attend": ["SUPER_ADMIN", "TEACHER", "CENTER_MANAGER"],

  // Bảo lưu học viên (08/10/2026). Ánh xạ vai theo chốt 07/10: QLTT và GĐ cơ sở cùng là CENTER_MANAGER,
  // BGĐ/TGĐ là SUPER_ADMIN, Sale/CSKH là SALES_CSM (CENTER_SALES_CSM ở v2), Kế toán là ACCOUNTANT.
  // approve ↔ extend cùng một vai ⇒ tách NGƯỜI bằng maker–checker ở server action.
  "bao-luu:view": ["SUPER_ADMIN", "CENTER_MANAGER", "SALES_CSM", "ACCOUNTANT"],
  "bao-luu:create": ["SUPER_ADMIN", "SALES_CSM"],
  "bao-luu:approve": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "bao-luu:extend": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "bao-luu:exception": ["SUPER_ADMIN"],
  "bao-luu:center-pause": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "bao-luu:settings": ["SUPER_ADMIN", "CENTER_MANAGER"],
  "bao-luu:refund-request": ["SUPER_ADMIN", "CENTER_MANAGER"],

  // --- Đào tạo nội bộ (EL-02) ---
  // ⚠️ BẢNG NÀY KHÔNG PHẢI nguồn sự thật của quyền e-learning. Nguồn là `RoleDef` +
  // `RolePermission` trong DB (v2 đang enforce trên prod), seed tại `prisma/seed-roles.ts`.
  // Khai ở đây vì một lý do kỹ thuật dễ quên: `ALL_ACTIONS = Object.keys(PERMISSIONS)`, và
  // `buildActor()` lọc grant theo đúng tập đó — không khai thì mọi `PermissionGrant` /
  // `UserPermissionGrant` mang key e-learning bị vứt IM LẶNG, không lỗi, không cảnh báo.
  //
  // Ánh xạ cột của ma trận EL-02 §3 sang 9 vai v1: SA→SUPER_ADMIN · HR→HR · TR→TRAINING ·
  // CM→CENTER_MANAGER · STAFF9→{SALES_CSM, TEACHER, MARKETING, ACCOUNTANT}. Cột **AUD
  // (Kiểm toán) và cột **HR KHÔNG BIỂU DIỄN ĐƯỢC Ở ĐÂY** — `AUDITOR` là `RoleDef` mới, không có vai v1
  // tương ứng; 5 quyền đọc của vai đó sống ở DB.
  //
  // Cột **HR của bảng §3 là `HO_HR`**, nhưng vai v1 tên `HR` ánh xạ sang **`CENTER_HR`**
  // (`LEGACY_TO_ROLEDEF` — `patch-rbac-staff.ts`, pin trong `rbac-parity.test.ts`). Hai
  // vai khác nhau: `CENTER_HR` là nhân sự MỘT cơ sở, chỉ là NGƯỜI HỌC. Nếu đổ 13 quyền
  // quản lý của cột HR vào dòng v1 `HR` thì parity v1↔v2 gãy ngay (đã đỏ khi viết
  // ticket này) — và tệ hơn là ở local/dev, nơi v1 vẫn chạy, nhân sự cơ sở bỗng được
  // cấp chứng nhận và xem tiến độ toàn hệ thống. Vì vậy các dòng dưới chỉ liệt kê
  // những vai v1 có ánh xạ 1-1 sang v2; phần còn lại của ma trận sống ở DB.
  // Đừng "sửa" bằng cách thêm vai vạ vào
  // các dòng dưới — làm vậy là nới quyền thật cho local/dev (nơi v1 vẫn chạy).
  // PARENT = 0 key, tuyệt đối không thêm.
  "elearning:portal:access": [
    "SUPER_ADMIN", "CENTER_MANAGER", "HR", "SALES_CSM", "TEACHER", "TRAINING", "MARKETING", "ACCOUNTANT",
  ],
  "elearning:lesson:learn": [
    "SUPER_ADMIN", "CENTER_MANAGER", "HR", "SALES_CSM", "TEACHER", "TRAINING", "MARKETING", "ACCOUNTANT",
  ],
  "elearning:program:manage": ["SUPER_ADMIN", "TRAINING"],
  "elearning:content:author": ["SUPER_ADMIN", "TRAINING"],
  "elearning:content:publish": ["SUPER_ADMIN", "TRAINING"],
  "elearning:assignment:create": ["SUPER_ADMIN", "TRAINING", "CENTER_MANAGER"],
  "elearning:assignment:extend": ["SUPER_ADMIN", "TRAINING", "CENTER_MANAGER"],
  "elearning:requirement:manage": ["SUPER_ADMIN", "TRAINING"],
  "elearning:progress:view-own": [
    "SUPER_ADMIN", "CENTER_MANAGER", "HR", "SALES_CSM", "TEACHER", "TRAINING", "MARKETING", "ACCOUNTANT",
  ],
  "elearning:progress:view-team": ["SUPER_ADMIN", "TRAINING", "CENTER_MANAGER"],
  "elearning:progress:view-all": ["SUPER_ADMIN", "TRAINING"],
  "elearning:video-analytics:view": ["SUPER_ADMIN", "TRAINING", "CENTER_MANAGER"],
  "elearning:exam:grade": ["SUPER_ADMIN", "TRAINING"],
  "elearning:exam:unlock": ["SUPER_ADMIN", "TRAINING"],
  "elearning:certificate:issue": ["SUPER_ADMIN"],
  "elearning:certificate:revoke": ["SUPER_ADMIN"],
  "elearning:report:export": ["SUPER_ADMIN", "TRAINING", "CENTER_MANAGER"],
};

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

// Per-user override grant — Phase 5.3.0
export type UserGrant = {
  action: string;
  grant: "ALLOW" | "DENY";
};

export type CanUser = {
  role: Role | string | null | undefined;
  roles?: (Role | string)[]; // Đợt 3B — đa vai trò (union quyền). Trống → dùng role.
  grants?: UserGrant[];
};

/** Đợt 3B — các vai trò HỮU HIỆU của 1 user (union). Trống roles → [role]. */
export function getEffectiveRoles(user: {
  role?: Role | string | null;
  roles?: (Role | string)[] | null;
}): Role[] {
  const arr =
    user.roles && user.roles.length > 0
      ? user.roles
      : user.role
        ? [user.role]
        : [];
  // Dedup (#13): User.roles trùng phần tử → không nhân đôi item ở RoleSwitcher
  // (trùng React key) / không hiện nút chuyển vai cho user thực chất 1 vai.
  return [...new Set(arr.filter(Boolean))] as Role[];
}

function roleListAllows(roles: Role[], action: Action): boolean {
  const allowed = PERMISSIONS[action];
  if (!allowed) return false;
  return roles.some((r) => allowed.includes(r));
}

/**
 * Check if a user (role / role[] / CanUser) can perform action.
 *
 * Đa vai trò: quyền = HỢP (union) — true nếu BẤT KỲ vai trò nào được phép.
 * Resolution (CanUser): SUPER_ADMIN bypass > grant DENY > grant ALLOW > union role.
 * Back-compat: truyền 1 Role string / null vẫn chạy như cũ.
 */
export function can(
  userOrRole: CanUser | Role | Role[] | string | null | undefined,
  action: Action,
): boolean {
  // Path 0: mảng vai trò → union.
  if (Array.isArray(userOrRole)) {
    return roleListAllows(userOrRole, action);
  }

  // Path 1: legacy signature — role string / null / undefined
  if (
    userOrRole === null ||
    userOrRole === undefined ||
    typeof userOrRole === "string"
  ) {
    const role = userOrRole;
    if (!role) return false;
    return PERMISSIONS[action]?.includes(role as Role) ?? false;
  }

  // Path 2: user object (role + roles + grants)
  const user = userOrRole;
  const effective = getEffectiveRoles(user);

  // 2a. SUPER_ADMIN bypass — không thể bị DENY override (chống tự khoá).
  if (effective.includes("SUPER_ADMIN")) {
    return PERMISSIONS[action]?.includes("SUPER_ADMIN") ?? false;
  }

  // 2b. Per-user grants — DENY > ALLOW > role fallback
  const grant = user.grants?.find((g) => g.action === action);
  if (grant?.grant === "DENY") return false;
  if (grant?.grant === "ALLOW") return true;

  // 2c. Union role matrix fallback
  return roleListAllows(effective, action);
}

// =============================================================================
// FULL ACTION LIST — single source of truth, sync với PERMISSIONS matrix
// =============================================================================

export const ALL_ACTIONS = Object.keys(PERMISSIONS) as Action[];

export function assertCan(
  roleOrRoles: CanUser | Role | Role[] | string | undefined | null,
  action: Action,
): void {
  if (!can(roleOrRoles, action)) {
    throw new Error(`Forbidden: không có quyền ${action}`);
  }
}

// =============================================================================
// FIELD-LEVEL VISIBILITY — Employee
// =============================================================================

export function getEmployeeFieldVisibility(
  roleOrRoles: Role | string | (Role | string)[] | null | undefined,
): {
  basic: boolean; // name, jobTitle, department, avatar, bio, joinedAt
  contact: boolean; // phone, email
  salary: boolean; // salaryRank, salaryLevel, bhxhBase
  personal: boolean; // dateOfBirth, gender, contractType, managerId, nationalId
} {
  const roles = (Array.isArray(roleOrRoles) ? roleOrRoles : [roleOrRoles]).filter(
    Boolean,
  ) as Role[];
  if (roles.length === 0) {
    return { basic: false, contact: false, salary: false, personal: false };
  }
  const any = (allowed: Role[]) => roles.some((r) => allowed.includes(r));
  return {
    basic: true,
    contact: any(["SUPER_ADMIN", "CENTER_MANAGER", "HR"]),
    salary: any(["SUPER_ADMIN", "HR", "ACCOUNTANT"]),
    personal: any(["SUPER_ADMIN", "HR"]),
  };
}

export type EmployeeFieldVisibility = ReturnType<typeof getEmployeeFieldVisibility>;

// SEC-H04 — nguồn DUY NHẤT map nhóm visibility → field Employee. Khớp CHÍNH XÁC với
// các input gate trong employee-form.tsx (visibility.contact/salary/personal). Dùng cho
// CẢ redact-khi-đọc (không serialize PII xuống client) LẪN strip-khi-ghi (client không
// set/xoá được field ngoài quyền). isCEO KHÔNG nằm đây: non-nullable + đã chặn ở M15.
export const EMPLOYEE_GATED_FIELDS = {
  contact: ["email", "phone"],
  salary: ["salaryRank", "salaryLevel", "bhxhBase"],
  personal: [
    "dateOfBirth",
    "gender",
    "contractType",
    "managerId",
    "endDate",
    "nationalId",
    "address",
    "emergencyContact",
    "notes",
  ],
} as const;

/**
 * Redact-khi-đọc (H04): set field thuộc nhóm bị ẩn → null TRƯỚC khi serialize xuống
 * bất kỳ client component. Giữ nguyên shape (field vẫn có, giá trị null) nên type ổn
 * định + UI (đã ẩn theo cùng visibility) không đổi. Trả về BẢN SAO, không mutate input.
 */
export function redactEmployeeFields<T extends Record<string, unknown>>(
  employee: T,
  visibility: EmployeeFieldVisibility,
): T {
  const out: Record<string, unknown> = { ...employee };
  for (const group of ["contact", "salary", "personal"] as const) {
    if (visibility[group]) continue;
    for (const field of EMPLOYEE_GATED_FIELDS[group]) {
      if (field in out) out[field] = null;
    }
  }
  return out as T;
}

/**
 * Strip-khi-ghi: XOÁ key thuộc nhóm bị ẩn khỏi payload create/update (mutate tại chỗ).
 * Prisma bỏ qua key vắng → DB giữ nguyên giá trị cũ (chống mất data khi client gửi null
 * do đã bị redact) + chặn client set field ngoài quyền (write-side hardening).
 */
export function stripHiddenEmployeeFields(
  data: Record<string, unknown>,
  visibility: EmployeeFieldVisibility,
): void {
  for (const group of ["contact", "salary", "personal"] as const) {
    if (visibility[group]) continue;
    for (const field of EMPLOYEE_GATED_FIELDS[group]) delete data[field];
  }
}

// =============================================================================
// HELPERS — convenience for common patterns
// =============================================================================

/** Quick role check — true if role is in the provided list. */
export function isRole(
  role: Role | string | null | undefined,
  ...allowed: Role[]
): boolean {
  if (!role) return false;
  return allowed.includes(role as Role);
}

/** True if SUPER_ADMIN — equivalent to legacy isSuperAdmin(). */
export function isSuperAdmin(role: Role | string | null | undefined): boolean {
  return role === "SUPER_ADMIN";
}

// =============================================================================
// MULTI-ROLE HELPERS — Đợt 3B
// =============================================================================

type RoleHolder = { role?: Role | string | null; roles?: (Role | string)[] | null };

/** User có giữ vai trò r không (xét union roles, fallback role). */
export function hasRole(user: RoleHolder, r: Role): boolean {
  return getEffectiveRoles(user).includes(r);
}

/** User có giữ BẤT KỲ vai trò nào trong danh sách không. */
export function hasAnyRole(user: RoleHolder, allowed: Role[]): boolean {
  const eff = getEffectiveRoles(user);
  return allowed.some((r) => eff.includes(r));
}

/** True nếu user có ≥1 vai trò NHÂN VIÊN (≠ PARENT). */
export function hasStaffRole(user: RoleHolder): boolean {
  return getEffectiveRoles(user).some((r) => r !== "PARENT");
}

/** True nếu user CHỈ là PARENT (không kèm vai trò nhân viên). */
export function isParentOnly(user: RoleHolder): boolean {
  const eff = getEffectiveRoles(user);
  return eff.length > 0 && eff.every((r) => r === "PARENT");
}

// Vai trò ĐƯỢC PHÉP xem thông tin liên hệ phụ huynh (SĐT/email) — dữ liệu PII.
// GIÁO VIÊN/trợ giảng/MARKETING/HR KHÔNG được xem (P0-3: chống lộ SĐT toàn lớp ở
// trang tiến độ lớp). CENTER_MANAGER/ACCOUNTANT vẫn cần center scope ở tầng query.
const PARENT_CONTACT_ROLES: Role[] = [
  "SUPER_ADMIN",
  "CENTER_MANAGER",
  "ACCOUNTANT",
  "SALES_CSM",
];

/** User có được xem SĐT/email phụ huynh không (PII). */
export function canViewParentContact(user: RoleHolder): boolean {
  return hasAnyRole(user, PARENT_CONTACT_ROLES);
}

// #11: canViewLeadPii đã chuyển sang lib/auth/check-permission.ts (async, qua checkPermission —
// sau flip #09). Không import check-permission vào file này: permission-eval import
// ngược permissions.ts, sẽ tạo vòng.
