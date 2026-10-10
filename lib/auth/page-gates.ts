// lib/auth/page-gates.ts — NGUỒN DUY NHẤT cho "ai được vào trang nào".
//
// Vì sao tồn tại: smoke prod 10/07 lòi ra hai lớp lỗi ngược nhau, cùng một gốc là
// sidebar và page.tsx mỗi bên tự khai một danh sách action:
//   1. DEAD LINK — menu hiện (perm A), trang gác bằng action B mà vai đó không có
//      ⇒ bấm vào là văng /dashboard. (Marketing × /site-content; GV × /students.)
//   2. HỞ QUYỀN THEO URL — menu giấu, nhưng trang gác bằng action rộng hơn
//      ⇒ gõ URL là vào. (Kế toán/HR/Marketing đọc được tin nhắn phụ huynh, học bạ.)
//
// scopedDb KHÔNG cứu được lớp (2): nó cách ly *cơ sở*, không cách ly *chức năng* —
// và vai HO thì nhìn xuyên cơ sở.
//
// Quy tắc: mỗi route ở đây khai đúng MỘT danh sách action. Vào được ⟺ có ≥1 action
// trong danh sách (OR). Sidebar dùng chính mảng này làm `perm`, page.tsx dùng chính
// nó làm gate ⇒ menu và cổng không thể lệch nhau nữa. `page-gates.test.ts` khoá lại.
//
// Muốn đổi ai-thấy-gì thì sửa Ở ĐÂY, không sửa rải rác trong page.tsx.
import type { Action } from "@/lib/auth/permissions";

export const PAGE_GATES = {
  /** Danh sách HV toàn cơ sở. GV KHÔNG vào (trang không lọc theo lớp) — GV xem lớp
   *  mình ở site giáo viên. Trước 10/07 sidebar mời GV vào rồi trang đá ra. */
  "/students": ["students:view-all"],

  /** Học bạ + xuất PDF. Chốt 10/07 (BGĐ): chỉ Đào tạo + QL cơ sở + GV. HR/Kế toán/
   *  Marketing/Sale/Giáo vụ KHÔNG xem — trước đó vào được bằng URL nhờ students:view-all. */
  "/hoc-ba": ["curriculum:view", "students:view-own-class"],

  /** Hội thoại phụ huynh ↔ giáo viên (PII). GV vào được vì trang CÓ lọc theo lớp
   *  phân công. Đào tạo/HR/Kế toán/Marketing bị cắt.
   *
   *  ⚠️ 09/08/2026 — GỠ `parent-requests:manage` khỏi ô này. Action đó do
   *  SUPER_ADMIN + CENTER_MANAGER + **SALES_CSM** giữ (nó là chìa khoá CSKH cho
   *  /cham-soc-hv và /canh-bao-rui-ro, không gỡ khỏi Sale được), nên Sale mở được
   *  /tin-nhan — trong khi `docs/chat-realtime/permissions.md` ghi Sale ❌ ở MỌI ô
   *  chat và TS-01.6 đòi "sale1 gọi mọi endpoint chat → 403 toàn bộ". Danh sách hiện
   *  rỗng (phạm vi đọc là participant-based) nhưng cửa vẫn mở — hợp đồng nói là đóng.
   *
   *  Vì sao là `students:view-own-class` chứ KHÔNG phải `chat:read`: gate cấp trang gọi
   *  `checkAnyPermission` KHÔNG có target, mà dưới RBAC v2 (đang bật prod) `chat:read`
   *  seed scope CENTER cho QLCS và ASSIGNED cho GV — `scopeMatches` đòi target
   *  (lib/auth/can.ts:18,29) nên gọi trần trả FALSE ⇒ khoá cửa chính của cả QLCS lẫn GV
   *  trên prod, trong khi máy dev (v1 tĩnh) vẫn xanh. Đúng dạng "chạy máy tôi thì được".
   *  `students:view-own-class` giữ được cả hai tính chất cần: v1 = SUPER_ADMIN +
   *  CENTER_MANAGER + TEACHER (không có Sale), v2 = GLOBAL ở CẢ CENTER_MANAGER lẫn
   *  TEACHER nên gọi trần vẫn đúng. Quyền theo TỪNG hội thoại (đọc/gửi/thông báo/gỡ)
   *  vẫn kiểm CÓ target trong `chat-workspace` + từng Server Action — gate này chỉ là
   *  cửa vào màn hình. Bất biến "action trong PAGE_GATES phải GLOBAL ở mọi RoleDef giữ
   *  nó" được `page-gates.test.ts` khoá lại.
   *
   *  ⚠️ 09/08/2026 — ĐẢO phần Giáo vụ. Bản trước ghi "Giáo vụ (`CENTER_CLASS_MANAGER`)
   *  cũng ra khỏi cửa này vì sync chỉ dẫn xuất participant cho `CENTER_MANAGER`". Chủ dự
   *  án chốt Giáo vụ được đối xử Y HỆT Quản lý cơ sở trong chat, nên
   *  `lib/chat/sync-membership.ts` (CHAT_CENTER_MANAGER_ROLE_CODES) nay dẫn xuất cả vai
   *  này → họ LÀ thành viên nhóm lớp cơ sở mình. Gate không đổi; Giáo vụ vào bằng
   *  `classes:view-own` GLOBAL vừa thêm ở `prisma/seed-roles.ts` (KHÔNG mượn
   *  `students:view-own-class` — action đó kéo theo /hoc-ba mà BGĐ 10/07 đã cấm Giáo vụ).
   *  Sale vẫn ❌: vai đó không giữ action nào trong danh sách này. */
  /**
   * F5 (mở phạm vi 10/08/2026) — THÊM `parent-requests:manage` để Sale vào được.
   *
   * Vì sao action này chứ không phải `chat:read`: hai bất biến do chính file test bên
   * cạnh khoá lại — (a) mọi action trong bảng phải seed **GLOBAL** ở MỌI RoleDef giữ nó,
   * vì `checkAnyPermission` gọi KHÔNG target; (b) gate **cấm** mọi `chat:*`. Sale giữ
   * `chat:read` scope OWN, GV giữ ASSIGNED, QLCS giữ CENTER ⇒ nhét `chat:read` vào gate
   * là khoá luôn cửa chính của GV lẫn QLCS. `parent-requests:manage` thoả cả hai: GLOBAL
   * ở cả 3 RoleDef giữ nó (seed-roles.ts:347/456/520) và không phải chat:*.
   *
   * Nó cũng KHÔNG mở cửa cho ai mới ngoài Sale: v1 giữ nó ở đúng
   * [SUPER_ADMIN, CENTER_MANAGER, SALES_CSM] — hai vai đầu vốn đã qua cổng này.
   */
  "/tin-nhan": ["students:view-own-class", "classes:view-own", "parent-requests:manage"],

  /**
   * Cây tổ chức (P1 · US-05 AC4) — MÀN QUẢN TRỊ, không phải màn tra cứu.
   *
   * Trước 11/08/2026 gác bằng `centers:view`, mà action đó 7 RoleDef giữ (kể cả TEACHER,
   * Sale, HR, Kế toán) vì nó là chìa khoá cho dropdown/bộ lọc cơ sở ở khắp nơi. Hệ quả:
   * gần như MỌI vai đều thấy nhóm "Hệ thống & Cấu hình" hiện lên chỉ vì mục này — trong
   * khi chủ dự án chốt (11/08/2026) nhóm đó CHỈ dành cho SUPER_ADMIN.
   *
   * `centers:edit` giữ đúng ngữ nghĩa (đây là màn sửa cây) và chỉ SUPER_ADMIN có
   * (v1: permissions.ts:544; v2: không RoleDef nào khai ⇒ chỉ qua bypass). KHÔNG gỡ
   * `centers:view` khỏi các vai — làm thế là gãy bộ lọc cơ sở ở hàng chục màn khác.
   */
  "/to-chuc": ["centers:edit"],

  /** 26/09/2026 — Chính sách khuyến mãi (BLĐ ban hành, Sale tra cứu). Ban hành/sửa/thu hồi
   *  gác `promotions:manage` ở trang con + từng Server Action, không ở cổng này. */
  "/khuyen-mai": ["promotions:view"],

  /** 29/09/2026 — Học bù đời mới (docs/hoc-bu/DAC-TA.md). Thay `parent-requests:manage` của
   *  màn cũ. Huỷ / miễn phí ngoại lệ gác `makeup:waive` ở từng Server Action. */
  "/hoc-bu": ["makeup:view"],

  /** P2 · US-08 — vị trí công việc mang bộ vai trò ⇒ cùng hạng nguy hiểm với sửa
   *  RoleDef, cùng một cổng `roles:manage` (chỉ SUPER_ADMIN). */
  "/nhan-su/vi-tri": ["roles:manage"],

  /** Cảnh báo rủi ro HV. GV KHÔNG vào: trang không có lọc theo lớp, cho GV vào là
   *  mở toàn cơ sở — đúng thứ câu 19 cấm. */
  /** Quản lý chia lead (29/08) — Quản trị + Quản lý cơ sở; QLCS chỉ thấy cơ sở mình. */
  // `leads:rotation-view` thêm 16/09/2026 khi hợp nhất `main`: màn "Sổ lượt chia lead"
  // (S-5, quyền CHỈ ĐỌC cho tổ Sale) đã nhập vào màn này từ 30/08, nên quyền đọc phải
  // theo sang — không thì người giữ nó mất chỗ xem mà không có lỗi nào báo.
  // An toàn vì mọi việc GHI ở đây tự gác riêng (`_actions.ts` gọi `checkPermission(perm)`),
  // cổng trang chỉ quyết "mở được màn hay không".
  "/quan-ly-chia-lead": ["lead_pool:manage", "leads:rotation-view"],

  "/canh-bao-rui-ro": ["parent-requests:manage"],

  /** Ghi chú chăm sóc HV. Cùng lý do /canh-bao-rui-ro. Sale vào bằng chính
   *  parent-requests:manage (thay hack `hasRole(SALES_CSM)` cũ trong page.tsx). */
  "/cham-soc-hv": ["parent-requests:manage"],

  /** Sinh nhật học viên (06/08/2026) — Sale/CSKH + QL cơ sở là người đi chúc.
   *  Gác bằng `students:view-all`: trang liệt kê học viên toàn cơ sở, đúng bộ vai
   *  đang giữ quyền đó. GV không vào (không lọc theo lớp phân công) — GV nhận
   *  thông báo riêng cho buổi mình đứng lớp. */
  "/sinh-nhat": ["students:view-all"],

  /** Nội dung website. Trước 10/07 gác nhầm bằng `honors:settings` ⇒ Marketing thấy
   *  menu mà không vào được. Sau flip nó tự hết đau do HO_MARKETING tình cờ giữ cả hai
   *  — tức đúng do may, không do thiết kế. */
  "/site-content": ["site-content:view"],

  /** Tracking lead. Gác bằng leads:view-all từ đầu; sidebar khai nhầm site-content:view. */
  "/marketing": ["leads:view-all"],

  /**
   * S-5 — SỔ LƯỢT CHIA LEAD (chỉ đọc). Màn kiểm chứng dựng ra để dập tin đồn thiên
   * vị khi chia lead; đặc tả gốc đòi "màn hình cho **cả tổ sale** nhìn thấy"
   * (plan/15 §5). Nhưng nó gác bằng `leads:view-all` — quyền QUẢN LÝ mà Sale cố ý
   * không có — nên người duy nhất không mở được là người mà bằng chứng viết cho.
   *
   * Vá bằng key ĐỌC riêng `leads:rotation-view` ĐỨNG CẠNH `leads:view-all`, không
   * thay thế:
   *  • không nới `leads:view-all` cho Sale — quyền đó gác ~8 màn quản lý khác;
   *  • giữ `leads:view-all` trong ô này để Quản lý cơ sở/Marketing KHÔNG mất màn
   *    trong khoảng giữa "merge vào main" và "bấm chạy seed-prod-roles.yml" (RBAC v2
   *    enforce trên prod đọc quyền từ DB) — trắng màn không kèm lỗi, không tái hiện
   *    được ở local vì local chạy v1 tĩnh.
   *
   * ⚠️ Key MỚI ⇒ sau khi merge `test` → `main` PHẢI chạy `seed-prod-roles.yml`, nếu
   * không Sale trên prod vẫn bị đá ra đúng như trước khi vá.
   * ⚠️ Vào được TRANG ≠ xem được mọi cơ sở: phạm vi do `rotationBoardScope`
   * (lib/lead/rotation.ts) chặn — Sale chỉ thấy sổ cơ sở mình.
   */
  // "/leads/so-luot" — GỠ 16/09/2026 khi hợp nhất `main`. Màn "Sổ lượt chia lead" đã
  // nhập vào `/quan-ly-chia-lead` (chốt 30/08), đường cũ nay chỉ còn một dòng
  // `redirect`. Giữ mục ở đây là bảng đòi một trang có cổng mà trang đó không còn gác
  // gì — và `page-gates.test.ts` bắt đúng chỗ đó.

  /** G-D (21/08/2026) — nhập nhanh khách hàng, bản CÓ ĐĂNG NHẬP thay cho biểu mẫu
   *  công khai `sale.satarobo.vn`. Ai nhập được lead thì vào được: marketing,
   *  sale-admin, Sale cơ sở. `leads:create` là GLOBAL ở cả 3 RoleDef giữ nó nên
   *  dùng làm gate cấp trang được (gate gọi trần, không target). */
  "/nhap-khach-hang": ["leads:create"],

  /** Chuyển lớp/cơ sở. Sale TẠO yêu cầu, QL cơ sở DUYỆT (enrollments:transfer chỉ điều
   *  khiển nút duyệt trong trang). Menu cũ khai `enrollments:transfer` ⇒ Sale không thấy
   *  đường vào chính việc của mình. Đây là lỗi giấu-tính-năng, không phải hở quyền. */
  "/chuyen-lop": ["enrollments:create"],

  /** Thư viện media buổi học. Menu cũ khai thiếu `media:upload` (cùng người giữ ở v1
   *  nên chưa ai đau) — khai đủ để menu ≡ gate. */
  "/media": ["media:view", "media:upload"],

  /** Cổng duyệt ảnh/video buổi học (MEDIA-REVIEW, 26/08). CHỈ `media:approve` — đây là
   *  màn RA QUYẾT ĐỊNH, không phải thư viện: người chỉ có `media:view` vào được thì sẽ
   *  thấy nút "Duyệt tất cả" mà bấm vào là bị Server Action từ chối. */
  "/duyet-media": ["media:approve"],

  // ── Việc của tư vấn viên (site Sale ĐÃ GỠ 22/09/2026) ───────────────────
  // Sáu route `/sale/*` gỡ cùng site. Phần việc còn cần thì đã nằm trong admin:
  // "Việc hôm nay" gộp vào `/dashboard`, "Tra cứu" thành `/tra-cuu`, hộp thư còn
  // ĐỘNG CƠ (`lib/inbox/*`, webhook ZaloCRM) nhưng không còn màn.
  //
  // ⚠️ Action dưới đây phải GLOBAL ở mọi RoleDef giữ nó (có test riêng khoá bất
  // biến đó): gate cấp trang gọi `checkAnyPermission` KHÔNG có target, nên action
  // seed scope CENTER/OWN sẽ trả FALSE trên prod trong khi máy dev vẫn xanh.
  // Cách ly cơ sở do `scopedDb` lo, không do gate.

  /** Tra cứu — bảng giá khoá/học cụ + lớp còn chỗ. CHỈ ĐỌC. Vào được bằng MỘT
   *  trong hai quyền; trang tự quyết khối nào hiện, không đá ai ra vì thiếu một
   *  quyền. Đừng khai quyền mới cho màn chỉ-đọc này. */
  "/tra-cuu": ["products:view", "classes:view-all", "promotions:view"],


  /** Ba báo cáo đào tạo. BGĐ chốt 10/07: "báo cáo của chức năng nào thì role chức năng
   *  đó xem". Trước đây gác `classes:view-all` ∨ `training:manage` ⇒ HR/Kế toán/Marketing
   *  mở được bằng URL (menu thì khai `courses:create`, nên giấu). Nay: Đào tạo + QL cơ sở. */
  /**
   * B-01 — Doanh thu vs mục tiêu. Trước đây cả menu lẫn trang gác bằng `payments:manage`
   * ⇒ Quản lý cơ sở, đúng người mà màn này viết cho, KHÔNG mở được: quyền đó là thao tác
   * TIỀN (mở/huỷ/hoàn, phương thức thanh toán, hoa hồng) và cố ý không nằm ở vai đó.
   *
   * Thêm `revenue_targets:manage` (key riêng) thay vì nới `payments:manage`. Giữ luôn
   * `payments:manage` trong ô này để kế toán không mất đường vào. Cả hai đều GLOBAL ở
   * mọi RoleDef giữ chúng — bắt buộc, vì gate gọi `checkAnyPermission` KHÔNG có target.
   */
  "/bao-cao/doanh-thu": ["payments:manage", "revenue_targets:manage"],

  /**
   * C-01 — Chỉ tiêu lead theo tháng × cơ sở. Màn này CHỈ để đặt/sửa con số, nên gác
   * bằng đúng quyền ghi: ai không đặt được thì vào cũng không có việc gì làm ở đây
   * (số liệu thực-vs-chỉ-tiêu nằm ở tab Kinh doanh của dashboard, gác riêng).
   *
   * KHÔNG kèm `leads:view-all`: action đó seed GLOBAL nên gate sẽ nhận, nhưng như vậy
   * là mở màn ĐẶT chỉ tiêu cho cả Sale/Marketing — người bị đo, không phải người đặt.
   * `lead_targets:manage` GLOBAL ở mọi RoleDef giữ nó (bắt buộc: gate gọi
   * `checkAnyPermission` KHÔNG có target).
   */
  "/bao-cao/muc-tieu-lead": ["lead_targets:manage"],

  /**
   * D-02 — Chỉ tiêu ngân sách quảng cáo theo tháng × cơ sở. Cùng luật với màn C-01 ở
   * trên: màn CHỈ để đặt/sửa con số nên gác bằng đúng quyền ghi.
   *
   * KHÔNG kèm `leads:view-all`: action đó seed GLOBAL nên gate sẽ nhận, nhưng nó đang
   * gác `/admin/marketing/funnel` cho cả QLCS lẫn Marketing ⇒ mượn là mở màn ĐẶT chỉ
   * tiêu cho người mà chỉ tiêu đó dùng để đo. `ads_budget_targets:manage` GLOBAL ở mọi
   * RoleDef giữ nó (bắt buộc: gate gọi `checkAnyPermission` KHÔNG có target).
   */
  "/bao-cao/ngan-sach-quang-cao": ["ads_budget_targets:manage"],

  "/bao-cao/dao-tao": ["reports:training"],
  "/bao-cao/hieu-suat-gv": ["reports:training"],
  "/bao-cao/cohort": ["reports:training"],

  /**
   * A-02 — Dashboard QLCS 4 tab (Tài chính · Kinh doanh · Chi phí Marketing · Tương tác
   * KH). Gác bằng MỘT key riêng `dashboard:view` (chốt kỹ thuật 24/08/2026, E/OQ-4).
   *
   * Vì sao không mượn key sẵn có:
   *  • `chat:read` — ứng viên đầu tiên cho tab E — seed scope CENTER (QLCS) / ASSIGNED
   *    (GV). Gate cấp trang gọi `checkAnyPermission` KHÔNG có target, mà `scopeMatches`
   *    đòi target với các scope đó ⇒ luôn false trên prod (v2), xanh ở local (v1). Đây
   *    đúng cái bẫy đã suýt dính ở `/tin-nhan`.
   *  • `payments:*` / `leads:view-all` gác được đúng MỘT tab. Đặt vào ô này là hoặc
   *    khoá cửa của người chỉ cần tab kia, hoặc mở kèm năng lực không ai định trao.
   *
   * ⚠️ Vào được TRANG ≠ xem được mọi tab. Gate từng tab (B → `payments:view` ·
   * C → `leads:view-all` · D/E → `dashboard:view`) đi kèm nội dung của tab đó; khung
   * này chưa có số liệu nên chưa có gì để lọc.
   * ⚠️ Key MỚI ⇒ sau khi merge `test` → `main` phải chạy `seed-prod-roles.yml`, nếu
   * không prod hiện MÀN TRẮNG không kèm lỗi và không tái hiện được ở local (local v1).
   */
  "/dashboard-qlcs": ["dashboard:view"],

  /**
   * S1 (tích hợp ZaloCRM 06/09/2026) — màn Zalo CRM nhúng: giao diện chat của fork
   * ZaloCRM chạy trong iframe, đăng nhập một lần bằng vé SSO 60 giây do Sata ký.
   *
   * Gác bằng MỘT key riêng `zalocrm:use` chứ không mượn key sẵn có:
   *  • `inbox:view` — ứng viên gần nhất — là quyền đọc HỘP THƯ CỦA SATA. Hai thứ khác
   *    nhau về bản chất trách nhiệm: mở màn này là mở một ỨNG DỤNG NGOÀI dưới danh nghĩa
   *    tài khoản của mình, và ai được làm thế là câu hỏi BGĐ phải trả lời riêng.
   *  • `chat:*` seed scope CENTER/ASSIGNED ⇒ gate cấp trang (gọi `checkAnyPermission`
   *    KHÔNG target) luôn FALSE trên prod, xanh ở local — đúng bẫy đã suýt khoá /tin-nhan.
   *
   * `zalocrm:use` seed **GLOBAL** ở mọi RoleDef giữ nó (bắt buộc, ca "mọi action trong
   * bảng phải là GLOBAL" ngay trên canh). Cách ly cơ sở KHÔNG đến từ `scopeType` mà từ
   * chỗ khác: vé SSO chỉ ký cho org của cơ sở người dùng nhìn thấy được
   * (`app/(admin)/admin/zalo-crm/_lib/co-so.ts`, giao với `actor.visibleCenterIds`).
   *
   * ⚠️ Key MỚI ⇒ sau khi merge `test` → `main` phải chạy `seed-prod-roles.yml`, nếu không
   * người mở màn trên prod bị đá về /dashboard KHÔNG kèm lỗi và không tái hiện được ở
   * local (local chạy RBAC v1 tĩnh).
   */
  "/zalo-crm": ["zalocrm:use"],

  /**
   * Hoá đơn điện tử — màn của KẾ TOÁN (docs/ke-toan-hoa-don/PLAN.md §9). Không tạo quyền mới:
   * `payments:confirm` là đúng quyền "xác nhận khoản thu" mà bước chốt hoá đơn sẽ dùng, seed
   * GLOBAL ở HO_ACCOUNTANT + CENTER_ACCOUNTANT ⇒ không phải chạy seed-prod-roles.
   *
   * ⚠️ Vào được TRANG ≠ thao tác được trên MỌI dòng: cổng trang hỏi trần; từng dòng hỏi thêm
   * "là kế toán của ĐÚNG cơ sở giữ đơn" (`coQuyenKeToanTaiCoSo` — người kiêm kế toán CS2 + sale
   * CS1 thấy dòng CS1 nhưng nút tắt kèm lý do). Cờ `billing.hoaDonEnabled` TẮT ⇒ trang 404.
   */
  "/payments/hoa-don": ["payments:confirm"],
} as const satisfies Record<string, readonly Action[]>;

export type GatedHref = keyof typeof PAGE_GATES;

/**
 * CHƯA đưa vào bảng — gate và menu vẫn lệch, có chủ đích.
 *
 * RỖNG từ 22/09/2026: mục cuối cùng là `/sale/ghi-danh`, gỡ cùng site Sale.
 * (Màn chốt lead của admin đi đường khác — `submitConvertV2` tự kiểm phép VÀ của
 * `students:create` + `enrollments:create`, chứ không qua bảng HOẶC này.)
 *
 * Thêm route mới vào đây phải kèm lý do, không được im lặng.
 */
export const GATE_MISMATCH_ALLOWLIST: readonly string[] = [];
