// lib/notifications/catalog.ts — NGUỒN SỰ THẬT DUY NHẤT phân loại thông báo nhân sự.
//
// PRD (§7.4) đòi mỗi loại thông báo khai đủ 6 trường: mã · nhóm · mức · người nhận · deep-link ·
// dedupeKey. Repo đã có ~17 nơi sinh `StaffNotification`, mỗi nơi tự nối chuỗi `dedupeKey` và tự
// chọn `href`, không nơi nào khai nhóm/mức. File này là chỗ khai bù, và từ nay là chỗ DUY NHẤT
// được quyết nhóm + mức của một thông báo.
//
// VÌ SAO KHOÁ THEO TIỀN TỐ `dedupeKey` chứ không theo một mã loại mới:
// `dedupeKey` là thứ ĐANG có thật trong DB prod và có `@@unique([userId, dedupeKey])`. Đặt một hệ
// mã song song rồi ánh xạ hai chiều là thêm một nguồn lệch. Đổi FORMAT dedupeKey của loại đang chạy
// còn tệ hơn: mọi bản ghi cũ thành mồ côi (không bao giờ được `update` nữa) và người dùng ăn một
// đợt thông báo trùng. Nên: giữ nguyên khoá, khai nghĩa cho khoá.
//
// THUẦN — không import DB, không import React. Test bằng Vitest không cần dựng gì.

import { isPendingSyncKey, PENDING_SYNC_TYPES } from "./pending-sync";

// ─── 5 nhóm của PRD §7.4 ────────────────────────────────────────────────────────

/**
 * Màu nhận diện nhóm ghi bằng HEX chứ không dùng token Tailwind — CÓ CHỦ ĐÍCH.
 * Site admin (tím #610B8A) và site giáo viên (cam #C2410C) có hệ token riêng, nên cùng một token
 * ra hai màu khác nhau ở hai nơi. Nhóm thông báo là DANH TÍNH: "vạch đỏ = đến hạn" phải giống hệt
 * nhau ở mọi site, nếu không người dùng phải học lại bảng màu mỗi lần đổi màn.
 * Màu chỉ là kênh phụ — mỗi nhóm luôn kèm NHÃN CHỮ (yêu cầu tiếp cận của PRD §7.15).
 */
export const NOTI_GROUPS = [
  {
    key: "action_required",
    color: "#4B5BD7",
    label: "Cần thực hiện",
    // "Tôi đang chặn người khác / hệ thống đang chờ tôi."
    hint: "Việc đang chờ chính tôi xử lý",
  },
  {
    key: "parent_message",
    color: "#E08A00",
    label: "Tin nhắn PH",
    hint: "Có phụ huynh đang chờ trả lời",
  },
  {
    key: "new_task",
    color: "#0E9B8E",
    label: "Việc mới",
    hint: "Vừa được giao thêm việc",
  },
  {
    key: "due_date",
    color: "#D93A2B",
    label: "Đến hạn",
    hint: "Sắp trễ hoặc đã trễ",
  },
  {
    key: "system",
    color: "#5B6472",
    label: "Hệ thống",
    hint: "Nên biết, không cần làm gì ngay",
  },
] as const;

export type NotiGroupKey = (typeof NOTI_GROUPS)[number]["key"];

const GROUP_KEY_SET: ReadonlySet<string> = new Set(NOTI_GROUPS.map((g) => g.key));

export function isNotiGroupKey(value: string): value is NotiGroupKey {
  return GROUP_KEY_SET.has(value);
}

export function notiGroupLabel(key: string): string {
  return NOTI_GROUPS.find((g) => g.key === key)?.label ?? "Khác";
}

// ─── Mức ưu tiên ────────────────────────────────────────────────────────────────

/** 1 = khẩn · 2 = thường · 3 = tham khảo. Trùng thang P1/P2/P3 của PRD. */
export type NotiPriority = 1 | 2 | 3;

/**
 * Loại đối tượng đích. Dùng để (a) thu hồi thông báo khi đối tượng bị xoá, (b) sau này dựng
 * deep-link theo host mà không phải đoán từ chuỗi href.
 */
export type NotiEntityType =
  | "class"
  | "session"
  | "lead"
  | "student"
  | "enrollment"
  | "conversation"
  | "parent_request"
  | "work_request"
  | "timesheet"
  | "media"
  | "report_card"
  | "payment"
  // 25/09/2026 — ĐƠN HÀNG. Cố ý KHÁC `payment`: `payment` là một khoản tiền đã ghi
  // nhận, còn `order` là cái đơn. Deep-link của hai thứ đi hai chỗ khác nhau
  // (`/payments/<id>` vs `/orders/<id>`), nên gộp một giá trị là dựng link về sai màn.
  | "order"
  | "trial"
  // T13 — case dạy bù (`MakeupCase`). Deep-link: `/hoc-bu` (admin) · `/teacher/hoc-bu` (site giáo viên).
  | "makeup_case"
  | "center"
  | "marketing"
  | "integration"
  // EL-06 — lượt ghi danh ĐÀO TẠO NỘI BỘ. Cố ý KHÁC `enrollment` (ghi danh học
  // viên): hai thứ nằm trên hai host khác nhau, nên gộp một giá trị là dựng
  // deep-link về sai site.
  | "trn_enrollment";

// ─── Bảng khai ─────────────────────────────────────────────────────────────────

interface NotiDef {
  /** Nhãn người đọc được — dùng ở màn cấu hình thông báo đẩy. Bắt buộc: một dòng
   *  thiếu nhãn thì màn cấu hình hiện khoá thô `lead.moi:` và người vận hành phải đoán. */
  label: string;
  /** Nhóm hiển thị trong panel. */
  group: NotiGroupKey;
  /** Mức mặc định. Khoá `:overdue` của vòng việc tồn luôn được nâng lên 1 — xem `classifyNotification`. */
  priority: NotiPriority;
  /** Đối tượng đích. */
  entity: NotiEntityType;
  /** Ai nhận — chỉ để đọc hiểu, không dùng lúc chạy. Đây là trường "người nhận" mà PRD đòi. */
  recipients: string;
  /** Đích đến mong đợi — chỉ để đọc hiểu; href thật do nơi sinh dựng. */
  target: string;
}

/**
 * Khai theo TIỀN TỐ `dedupeKey`. Khớp theo tiền tố DÀI NHẤT (xem `classifyNotification`), nên
 * `payment-reconcile:unmatched:` thắng `payment-reconcile:` nếu sau này có mục chung.
 *
 * Thêm nguồn sinh thông báo mới BẮT BUỘC thêm một dòng ở đây, nếu không nó rơi về nhóm "Hệ thống"
 * mức P3 — tức nằm chót panel và không bao giờ được ai chú ý. Test `catalog.test.ts` khoá danh sách
 * tiền tố đang chạy thật để việc quên không đi lọt.
 */
const BY_PREFIX: Readonly<Record<string, NotiDef>> = {
  // ── Vòng đồng bộ việc tồn (lib/pending-tasks.ts → lib/staff-notifications.ts) ──
  "class_approval:": {
    label: "Lớp chờ duyệt",
    group: "action_required", priority: 2, entity: "class",
    recipients: "Người có quyền duyệt lớp", target: "/classes?status=PENDING_APPROVAL",
  },
  "timesheet_adjust:": {
    label: "Đơn chỉnh công chờ duyệt",
    group: "action_required", priority: 2, entity: "timesheet",
    recipients: "Quản lý chấm công", target: "/don-tu", // L5: màn chỉnh công cũ đã gỡ, đơn chỉnh công nay ở Duyệt đơn từ
  },
  "parent_request:": {
    label: "Yêu cầu phụ huynh còn tồn",
    group: "action_required", priority: 1, entity: "parent_request",
    recipients: "CSKH / Quản lý cơ sở", target: "/parent-requests",
  },
  "media_approval:": {
    label: "Ảnh lớp chờ duyệt",
    group: "action_required", priority: 2, entity: "media",
    recipients: "Người duyệt ảnh lớp", target: "/media",
  },
  "session_incomplete:": {
    label: "Buổi học chưa chốt",
    group: "action_required", priority: 1, entity: "session",
    recipients: "Giáo viên phụ trách buổi", target: "/sessions",
  },
  // 25/09/2026 — ĐƠN VƯỢT MỨC ĐANG CHỜ DUYỆT. Chủ dự án: *"khi có đơn cần được duyệt thì
  // phải gửi thông báo về ngay cho quản lý để duyệt gấp cho KH được thanh toán"*.
  //
  // `priority: 1` (khẩn) — và đây là con số có lý do, không phải để cho oai: đơn chưa
  // duyệt thì **không xuất được mã QR** (`_qr-core.ts` chặn), tức khách đang đứng chờ trả
  // tiền mà hệ thống không đưa mã ra được. Đó là việc chặn dòng tiền, không phải việc
  // "khi nào rảnh thì xem" — cùng hạng với `parent_request:` và `lead_followup:`.
  "don.cho_duyet:": {
    label: "Đơn vượt mức đang chờ duyệt",
    group: "action_required", priority: 1, entity: "order",
    recipients: "Người có quyền duyệt giảm giá / trả góp tại cơ sở của đơn",
    // 🔁 ĐÍNH CHÍNH 28/09/2026 — dòng này ghi `/orders?duyet=1` trong khi `href` THẬT đã
    // đổi sang trang của TỪNG ĐƠN từ 25/09 (`lib/orders/tin-cho-duyet.ts`). Trường
    // `target` ở đây **không ai đọc lúc chạy** (đo: `git grep "\.target\b"` ra 0 chỗ đọc
    // catalog) — nó là tài liệu, nên nó sai mà không có triệu chứng nào.
    //
    // Đó chính là kiểu sai nguy hiểm nhất của tài liệu: người sau đọc nó, tin là hệ thống
    // chỉ trỏ tới hàng chờ, rồi "vá" một thứ đã xong (luật 12).
    target: "/orders/<orderId>/duyet",
  },
  "center_checklist:": {
    label: "Checklist cơ sở chưa xong",
    group: "action_required", priority: 1, entity: "center",
    recipients: "Quản lý cơ sở", target: "/cham-cong/checklist-co-so",
  },
  // 30/08 — LEAD MỚI VỀ TAY BẠN. `priority: 1` như `lead_followup`: lead mới là thứ
  // phải gọi trong ngày, để chung nhóm "chờ xử lý" với việc follow-up.
  "lead.moi:": {
    label: "Lead mới vừa chia cho tôi",
    group: "action_required", priority: 1, entity: "lead",
    recipients: "Tư vấn viên vừa được chia lead", target: "/leads",
  },
  // 15/09 — bản GỘP cho đường nhập hàng loạt. Chủ dự án chốt: "nhập nhiều thì báo là có bao
  // nhiêu lead mới chứ không gửi nhiều thông báo". Chỉ bắn khi một người nhận từ HAI lead trở
  // lên; đúng một lead thì `lead.moi:` tốt hơn vì nó trỏ thẳng trang chi tiết.
  "lead.moi_nhieu:": {
    label: "Nhận nhiều lead mới cùng lúc",
    group: "action_required", priority: 1, entity: "lead",
    recipients: "Tư vấn viên được chia lead trong một lượt nhập danh sách", target: "/leads",
  },
  // 06/10/2026 — hai khoá đang phát thật (lib/lead/assign-lead.ts) mà chưa từng được khai:
  // rơi về "Hệ thống / P3" trong chuông và KHÔNG hiện ở màn cấu hình đẩy — nên không ai bật
  // được, dù `lead.nhap_lai:` vốn đứng trong danh sách mặc định của lib/push/allowlist.ts.
  "lead.nhap_lai:": {
    label: "Khách của tôi vừa để lại thông tin lần nữa",
    group: "action_required", priority: 1, entity: "lead",
    recipients: "Tư vấn viên đang phụ trách lead", target: "/leads/<leadId>",
  },
  "lead.pool_rong:": {
    label: "Lead về mà không còn ai nhận (pool rỗng)",
    group: "action_required", priority: 1, entity: "lead",
    recipients: "Quản lý cơ sở của lead + Quản trị tối cao", target: "/quan-ly-chia-lead",
  },
  // Cron nhac-no-theo-con — một nhà một tin một ngày.
  "no-qua-han:": {
    label: "Học phí của khách quá hạn",
    group: "due_date", priority: 1, entity: "order",
    recipients: "Sale phụ trách đơn", target: "/orders/<orderId>",
  },
  "lead_followup:": {
    label: "Lead đến hạn chăm sóc",
    group: "action_required", priority: 1, entity: "lead",
    recipients: "Tư vấn viên phụ trách lead", target: "/leads",
  },
  "renewal:": {
    label: "Học viên sắp hết khoá",
    group: "due_date", priority: 2, entity: "enrollment",
    recipients: "Tư vấn viên / CSKH", target: "/enrollments?tab=sap-het-khoa",
  },
  "student_risk:": {
    label: "Cảnh báo học viên rủi ro",
    group: "action_required", priority: 2, entity: "student",
    recipients: "CSKH phụ trách học viên", target: "/canh-bao-rui-ro",
  },
  "student_care:": {
    label: "Việc chăm sóc học viên được giao",
    group: "new_task", priority: 2, entity: "student",
    recipients: "Người được giao việc chăm sóc", target: "/cham-soc-hv",
  },
  "student_birthday:": {
    label: "Sinh nhật học viên — nhắc CSKH/giáo viên",
    group: "system", priority: 3, entity: "student",
    recipients: "CSKH + giáo viên lớp", target: "/sinh-nhat",
  },
  "class_no_teacher:": {
    label: "Lớp chưa có giáo viên",
    group: "action_required", priority: 1, entity: "class",
    recipients: "Quản lý cơ sở / Đào tạo", target: "/sessions",
  },
  // ⚠️ `status=` phải là giá trị LeadStatus CÒN SỐNG: màn /leads bỏ qua giá trị lạ
  // KHÔNG báo lỗi, nên link cũ (?status=REGISTERED) mở ra TOÀN BỘ danh sách lead —
  // trông như bộ lọc chạy đúng mà thật ra không lọc gì.
  "registered_stale:": {
    label: "Lead đã đăng ký nhưng đứng im",
    group: "action_required", priority: 2, entity: "lead",
    recipients: "Tư vấn viên phụ trách lead", target: "/leads?status=DA_DANG_KY",
  },
  "report_card_milestone:": {
    label: "Đến mốc phải làm học bạ",
    group: "due_date", priority: 2, entity: "report_card",
    recipients: "Giáo viên phụ trách lớp", target: "/report-cards",
  },
  "elearning_due:": {
    label: "Khoá đào tạo nội bộ đến hạn",
    group: "due_date", priority: 1, entity: "trn_enrollment",
    recipients: "Chính người được giao khoá", target: "host đào tạo nội bộ",
  },
  // 06/10/2026 — ba khoá sự kiện của Đào tạo nội bộ (lib/elearning/_handlers/notify.ts) phát
  // thật qua `notifyStaff` mà chưa từng được khai ⇒ không bật đẩy được ở màn cấu hình.
  "el.enr:": {
    label: "Được giao khoá đào tạo nội bộ",
    group: "new_task", priority: 2, entity: "trn_enrollment",
    recipients: "Nhân sự được giao khoá", target: "/elearning/hoc/<id>",
  },
  "el.over:": {
    label: "Khoá đào tạo nội bộ đã quá hạn",
    group: "due_date", priority: 1, entity: "trn_enrollment",
    recipients: "Người học + quản lý trực tiếp + bộ phận Đào tạo", target: "/elearning",
  },
  "el.done:": {
    label: "Hoàn thành khoá đào tạo nội bộ",
    group: "system", priority: 3, entity: "trn_enrollment",
    recipients: "Chính người vừa học xong", target: "/elearning",
  },

  // ── Sinh từ sự kiện: lớp & buổi học ──
  "class.session_changed:": {
    label: "Lịch lớp vừa thay đổi",
    group: "system", priority: 2, entity: "class",
    recipients: "Giáo viên phụ trách lớp", target: "/classes/<classId>/edit",
  },
  "class.cancelled:": {
    label: "Lớp bị huỷ",
    group: "system", priority: 2, entity: "class",
    recipients: "Giáo viên phụ trách lớp", target: "/classes/<classId>/edit",
  },
  "session.taught:": {
    label: "Buổi học đã dạy xong",
    group: "system", priority: 3, entity: "session",
    recipients: "Giáo viên dạy buổi đó", target: "/sessions/<sessionId>",
  },
  // Điểm danh bị người khác sửa hồi tố — giáo viên phải kiểm lại, đây là việc chứ không phải tin.
  "attendance.edited:": {
    label: "Điểm danh bị sửa hồi tố",
    group: "action_required", priority: 2, entity: "session",
    recipients: "Giáo viên chính của lớp", target: "/attendance?sessionId=<id>",
  },
  // Lịch dạy thay ngày mai — đổi ca của chính mình.
  "session.substitute:": {
    label: "Được xếp dạy thay",
    group: "system", priority: 2, entity: "session",
    recipients: "Giáo viên dạy thay", target: "/lich",
  },
  // Buổi đã kết thúc mà chưa chốt — đây là hạn chót thật.
  "session.close-reminder:": {
    label: "Nhắc chốt buổi đã kết thúc",
    group: "due_date", priority: 1, entity: "session",
    recipients: "Giáo viên phụ trách buổi", target: "/lich",
  },

  // ── Sinh từ sự kiện: lead & trải nghiệm ──
  // 06/10/2026 — nhãn đổi "học thử" → "trải nghiệm" cho cùng tên với màn Lớp Trial (chủ dự án:
  // "loạn quá không biết cái nào lại cái nào"). CHỈ đổi chữ hiển thị — khoá giữ nguyên byte vì
  // cấu hình `push.tienToDuocDay` trên prod lưu theo khoá.
  "lead.trialAttended:": {
    label: "Lead đã đi trải nghiệm",
    group: "new_task", priority: 2, entity: "lead",
    recipients: "Tư vấn viên phụ trách lead", target: "/leads/<leadId>",
  },
  "trial.assigned:": {
    label: "Lead của tôi được xếp ca trải nghiệm",
    group: "new_task", priority: 2, entity: "trial",
    // Người nhận là SALE, KHÔNG phải giáo viên: producer lấy `lead.assignedToId` (rơi về admin
    // lead nếu trống) — lib/_handlers/trial-notif.ts. Khai nhầm ở đây làm người rà deep-link kết
    // luận loại này gãy trên site giáo viên rồi đi sửa nhầm chỗ.
    recipients: "Tư vấn viên phụ trách lead (không có thì admin lead)", target: "/leads/<leadId>",
  },
  // 03/09 — giáo viên chấm xong phiếu rubric ⇒ Sale có căn cứ chốt với phụ huynh.
  // Việc MỚI rơi xuống chứ không phải tin để biết, nên xếp "new_task" như trial.assigned.
  "trial.evaluated:": {
    label: "Giáo viên đã chấm phiếu trải nghiệm",
    group: "new_task", priority: 2, entity: "trial",
    // Là SALE, không phải giáo viên: người chấm chính là giáo viên nên báo lại là vô nghĩa.
    recipients: "Tư vấn viên phụ trách lead (không có thì admin lead)", target: "/lop-trial/<trialClassId>",
  },
  "trial.schedule_changed:": {
    label: "Lịch trải nghiệm của lead thay đổi",
    group: "system", priority: 2, entity: "trial",
    // Cũng là SALE (lib/_handlers/trial-schedule-notif.ts), không phải giáo viên.
    recipients: "Tư vấn viên phụ trách lead (không có thì admin lead)", target: "/leads/<leadId>",
  },
  // 03/09 — có EM vừa được xếp vào ca của GV (enrollLeadChild). Khác ba loại "assigned"
  // còn lại: chúng báo việc được giao LỚP/BUỔI/CA, loại này báo SIĨ SỐ của ca đổi.
  // Lớp trải nghiệm là slot tái sử dụng nên hai việc cách nhau hàng tuần.
  "trial-enroll.assigned:": {
    label: "Có em mới xếp vào ca trải nghiệm",
    group: "new_task", priority: 2, entity: "trial",
    recipients: "Giáo viên dạy buổi (không có thì GV chính của lớp)", target: "/lop-trial",
  },
  // 07/10/2026 — CA DẠY BÙ (lib/hoc-bu/bao-gv.ts). Trước đợt này module học bù không báo giáo
  // viên một tin nào: được xếp ca bù chỉ biết khi tự mở /teacher/hoc-bu.
  "hoc-bu.ca-moi:": {
    label: "Tôi được xếp một ca dạy bù",
    group: "new_task", priority: 2, entity: "session",
    recipients: "Giáo viên của ca dạy bù (không báo chính người bấm)", target: "/hoc-bu/case/<id>",
  },
  "hoc-bu.them-hv:": {
    label: "Ca dạy bù của tôi có thêm học viên",
    group: "new_task", priority: 3, entity: "session",
    recipients: "Giáo viên của ca dạy bù (không báo chính người bấm)", target: "/hoc-bu/case/<id>",
  },
  // Huỷ ⇒ giáo viên KHÔNG phải lên lớp nữa; biết muộn là tới lớp không có ai. Mức khẩn.
  "hoc-bu.huy:": {
    label: "Ca dạy bù của tôi bị huỷ",
    group: "new_task", priority: 1, entity: "session",
    recipients: "Giáo viên của ca dạy bù vừa huỷ (không báo chính người bấm)", target: "/hoc-bu",
  },
  // Buổi ad-hoc thêm tay vào lớp trải nghiệm (addTrialSession) — GV được gán buổi đó.
  // Cùng mức với hai loại trên: là ca dạy vừa rơi vào lịch của mình, không phải tin để biết.
  "trial-session.assigned:": {
    label: "Được phân buổi trải nghiệm thêm",
    group: "new_task", priority: 2, entity: "trial",
    recipients: "Giáo viên được phân buổi trải nghiệm", target: "/lop-trial",
  },
  // 14/09 — BA loại dưới đây sinh thật từ `app/(admin)/admin/lop-trial/_actions.ts` nhưng
  // TRƯỚC ĐỢT NÀY không có trong bảng: hệ quả là chúng rơi về "Hệ thống / P3" trong chuông,
  // và màn cấu hình đẩy KHÔNG BÀY RA nên không ai bật được. Chủ dự án thử đúng ba thao tác
  // này rồi kết luận kênh hỏng — sổ `WebPushOutbox` trên prod ghi rõ ba dòng SKIPPED lúc
  // 17:38–17:40 ngày 13/09.
  "trial-session.updated:": {
    label: "Buổi trải nghiệm vừa bị sửa",
    group: "new_task", priority: 2, entity: "trial",
    recipients: "Giáo viên đang được phân buổi sau khi sửa", target: "/lop-trial",
  },
  // GV CŨ bị thay khỏi buổi. Mức 2 như "được phân": biết muộn là tới lớp thừa.
  "trial-session.moved-out:": {
    label: "Bị gỡ khỏi buổi trải nghiệm",
    group: "new_task", priority: 2, entity: "trial",
    recipients: "Giáo viên vừa bị thay khỏi buổi", target: "/lop-trial",
  },
  // Buổi bị huỷ hẳn. Đây là tin PHẢI tới trước giờ dạy, nên xếp mức 1.
  "trial-session.cancelled:": {
    label: "Buổi trải nghiệm bị huỷ",
    group: "new_task", priority: 1, entity: "trial",
    recipients: "Giáo viên được phân buổi bị huỷ", target: "/lop-trial",
  },
  // 29/09/2026 — đơn nghỉ / đổi ca vừa duyệt làm giáo viên vắng ở một case trial đã xếp
  // (`lib/trial/bao-gv-vang.ts`). Mức 1: case có bé thật, không đổi GV là lớp không người dạy.
  "trial.gv-vang:": {
    label: "Case trải nghiệm cần đổi giáo viên (GV nghỉ / đổi ca)",
    group: "new_task", priority: 1, entity: "trial",
    recipients: "Sale tạo case + bộ phận Đào tạo", target: "/lop-trial/<id>",
  },
  "trial.cho-phan-cong:": {
    label: "Ca trải nghiệm chưa có giáo viên",
    group: "new_task", priority: 2, entity: "trial",
    recipients: "Bộ phận Đào tạo (ca trải nghiệm chưa có giáo viên)", target: "/lop-trial",
  },
  // GĐ6 — nhắc Sale trước buổi để Sale tự nhắn phụ huynh qua Zalo cá nhân. Hệ thống
  // KHÔNG gửi tin tự động cho phụ huynh; đây là chốt nghiệp vụ, không phải giới hạn
  // kỹ thuật. Xếp nhóm "due_date" vì đây là việc CÓ HẠN, không phải việc mới rơi xuống.
  "trial.reminder:": {
    label: "Nhắc trước buổi trải nghiệm",
    group: "due_date", priority: 2, entity: "trial",
    recipients: "Sale phụ trách lead (không có thì admin lead)", target: "/leads/<leadId>",
  },
  // V2-d (17/09) — nhắc GIÁO VIÊN ~1 tiếng trước giờ dạy trải nghiệm. Nhóm "due_date" chứ
  // không phải "new_task": việc đã được giao từ lúc xếp buổi (`trial-session.assigned:`),
  // đây là chuông HẠN của chính việc đó. Mức 1 vì quá mốc là lớp không có người đứng.
  //
  // ⚠️ Khai ở đây KHÔNG phải thủ tục giấy tờ: `catalogEntries()` là nguồn DUY NHẤT dựng màn
  // cấu hình đẩy, nên thiếu dòng này thì công tắc không bày ra và KHÔNG AI BẬT ĐƯỢC push —
  // đúng sự cố 13/09 (ba khoá `trial-session.*` sinh thật nhưng chưa khai, sổ `WebPushOutbox`
  // prod ghi SKIPPED). Thông báo trong ứng dụng vẫn chạy, nên hỏng này HOÀN TOÀN CÂM.
  "trial.reminder-gv:": {
    label: "Sắp tới giờ dạy buổi trải nghiệm",
    group: "due_date", priority: 1, entity: "trial",
    recipients: "Giáo viên được phân buổi trải nghiệm", target: "/lop-trial",
  },
  // V2-d (17/09) — tới mốc nhắc mà buổi VẪN chưa có giáo viên ⇒ leo thang cho Đào tạo.
  // Tiền tố RIÊNG, không dùng lại `trial.cho-phan-cong:` của lúc tạo buổi: `dedupeKey` có
  // `@@unique([userId, dedupeKey])` nên trùng khoá là ĐÈ mất tin gốc — người nhận không còn
  // thấy việc này đã treo từ lúc nào. Khớp tiền tố DÀI NHẤT nên hai khoá không nuốt nhau
  // (`trial.cho-phan-cong-gap:` không bắt đầu bằng `trial.cho-phan-cong:` — sau chữ "cong"
  // là "-" chứ không phải ":").
  "trial.cho-phan-cong-gap:": {
    label: "GẤP: buổi trải nghiệm sắp bắt đầu mà chưa có giáo viên",
    group: "due_date", priority: 1, entity: "trial",
    recipients: "Bộ phận Đào tạo (buổi còn ~1 tiếng, chưa phân công)", target: "/lop-trial",
  },
  // Vi phạm SLA chăm lead — theo PRD đây là "đã trễ", không phải "việc mới".
  "sla:": {
    label: "Vi phạm SLA chăm lead",
    group: "due_date", priority: 1, entity: "lead",
    recipients: "Tư vấn viên phụ trách + Quản lý", target: "/leads/<leadId>",
  },

  // ── Sinh từ sự kiện: phụ huynh ──
  "conversation.message_posted:": {
    label: "Phụ huynh nhắn tin",
    group: "parent_message", priority: 2, entity: "conversation",
    recipients: "Giáo viên chính + trợ giảng của lớp", target: "/tin-nhan?c=<conversationId>",
  },
  "parent_request.created:": {
    label: "Phụ huynh vừa gửi yêu cầu",
    group: "action_required", priority: 1, entity: "parent_request",
    recipients: "CSKH / Quản lý cơ sở", target: "/parent-requests",
  },
  "parent_request.reminder:": {
    label: "Nhắc yêu cầu phụ huynh chưa xử",
    group: "action_required", priority: 1, entity: "parent_request",
    recipients: "CSKH / Quản lý cơ sở", target: "/parent-requests",
  },

  // ── Sinh từ sự kiện: học viên & tiền ──
  "reserve.expired:": {
    label: "Bảo lưu đã hết hạn",
    group: "action_required", priority: 2, entity: "student",
    recipients: "CSKH phụ trách học viên", target: "/students/<studentId>/edit",
  },
  "reserve-expiry:": {
    label: "Bảo lưu sắp hết hạn (luồng cũ)",
    group: "action_required", priority: 2, entity: "student",
    recipients: "CSKH phụ trách học viên", target: "/students/<studentId>/edit",
  },
  "payment-reconcile:unmatched:": {
    label: "Tiền về chưa khớp đơn nào",
    group: "action_required", priority: 1, entity: "payment",
    recipients: "Kế toán", target: "/bien-dong-so-du?status=unmatched",
  },
  "payment-reconcile:overdue-partial:": {
    label: "Công nợ quá hạn / đóng thiếu",
    group: "action_required", priority: 1, entity: "payment",
    recipients: "Kế toán", target: "/cong-no",
  },
  // Hoá đơn điện tử (docs/ke-toan-hoa-don/PLAN.md §7): kế toán đã chốt hoá đơn mà khách không có
  // email ⇒ sale tải tệp trên trang đơn gửi qua Zalo. Sinh ở `lib/finance/hoa-don/gui-email.ts`.
  "hoa-don.khong-email:": {
    label: "Hoá đơn điện tử chưa gửi được cho khách (không có email)",
    group: "action_required", priority: 2, entity: "payment",
    recipients: "Sale phụ trách lead → người lập đơn → Quản lý cơ sở", target: "/orders/<orderId>",
  },
  // GĐ 8 — email hoá đơn hỏng HẲN (hết lượt thử / thiếu nội dung). Hai khoá: `…:<guiId>` cho phía
  // sale, `…:<guiId>:ke-toan` cho kế toán đã bấm gửi. Sinh ở `lib/finance/hoa-don/gui-email.ts`.
  "hoa-don.gui-loi:": {
    label: "Email hoá đơn điện tử không tới được khách",
    group: "action_required", priority: 2, entity: "payment",
    recipients: "Sale phụ trách lead → người lập đơn → Quản lý cơ sở; kế toán đã bấm gửi",
    target: "/orders/<orderId> · /payments/hoa-don?hoaDon=<id>",
  },
  // PLAN Q-mở 7 — chuông hằng ngày (cron `payment-reconcile`, chỉ khi cờ màn hoá đơn BẬT): số lần thu
  // đang chờ xuất hoá đơn. Khoá `…:<centerId>:<ngày>` cho kế toán cơ sở, `…:tong:<ngày>` cho kế toán
  // Hội sở. Dựng ở `lib/finance/hoa-don/nhac-ke-toan.ts`.
  "hoa-don.cho-xuat:": {
    label: "Lần thu chờ xuất hoá đơn điện tử (nhắc hằng ngày)",
    group: "action_required", priority: 2, entity: "payment",
    recipients: "Kế toán của cơ sở (payments:confirm); kế toán Hội sở nhận bản tổng",
    target: "/payments/hoa-don?ngan=cho",
  },

  // 06/10/2026 — GĐ1 POS (docs/pos-gd1-thiet-ke.md §5–6). Tiền phiếu gộp (QR mã mới + thẻ POS) chia
  // xong ⇒ báo sale phụ trách mở đơn Chuyển đổi. Sinh ở `lib/payments/sau-da-chia.ts`. Khoá
  // `…:<bankTransactionId>:<billId>`. KHÔNG in số tiền (PRD T5).
  "phieu-gop.da-chia:": {
    label: "Tiền phiếu thu đã về (QR / thẻ POS) — mở đơn để Chuyển đổi",
    group: "new_task", priority: 2, entity: "order",
    recipients: "Sale phụ trách lead → người lập đơn → Quản lý cơ sở", target: "/orders/<orderId>",
  },
  // Sale bấm "Báo admin": đã ≥ 10 phút mà vẫn chưa thấy giao dịch thẻ. Sinh ở
  // `lib/payments/pos/phieu-pos.ts`. Khoá `…:<intentId>`.
  "pos.bao-admin:": {
    label: "Sale báo: chưa thấy giao dịch thẻ POS",
    group: "action_required", priority: 2, entity: "order",
    recipients: "Kế toán HO + Quản trị tối cao", target: "/bien-dong-so-du",
  },
  // 09/10/2026 — Việc 3 POS: sale xin xác nhận giao dịch thẻ NHẬP SAI MÃ (khách đã quẹt thành công, ghi chú sai). Sinh ở
  // `lib/payments/pos/sai-ma-ghi.ts`. Khoá `…:<yeuCauId>`. Nội dung KHÔNG mang ghi chú gốc / số thẻ / tên phụ huynh.
  "pos.sai-ma:": {
    label: "Sale xin xác nhận giao dịch thẻ nhập sai mã",
    group: "action_required", priority: 2, entity: "order",
    recipients: "Kế toán HO + Quản trị tối cao", target: "/bien-dong-so-du#the-pos-sai-ma",
  },
  // Kế toán duyệt / từ chối ⇒ báo NGƯỜI GỬI. Khoá `…:<yeuCauId>`. Từ chối mang lệnh ĐỪNG cho khách quẹt lại.
  "pos.sai-ma-kq:": {
    label: "Kết quả xác nhận giao dịch thẻ nhập sai mã",
    group: "action_required", priority: 2, entity: "order",
    recipients: "Sale đã gửi yêu cầu", target: "/orders/<orderId>",
  },
  // 10/10/2026 — Việc 6 POS (chốt): "Dừng học" / "Đổi khoá" HUỶ KÈM phiếu thu thẻ POS đang chờ quẹt cùng phiếu gộp ⇒ báo NGƯỜI TẠO phiếu thẻ (sale ở quầy, khách có thể đang đứng cạnh máy).
  // Sinh ở `lib/payments/pos/bao-the-huy-cung.ts`. Khoá `…:<intentId>`. Nội dung chỉ có mã phiếu; mang lệnh ĐỪNG cho khách quẹt theo mã cũ.
  "pos.the-huy-cung:": {
    label: "Phiếu thu thẻ POS của bạn bị huỷ kèm (dừng học / đổi khoá)",
    group: "action_required", priority: 1, entity: "order",
    recipients: "Người tạo phiếu thẻ (không báo người bấm)", target: "/orders/<orderId>",
  },
  // Provider phiếu thu thẻ lỗi kết nối (đọc dữ liệu / API). Sinh ở `lib/payments/pos/xu-ly-ket-qua.ts`.
  // Khoá `…:<intentId>:<YYYY-MM-DDTHH giờ VN>` khi SALE bấm — dedupe theo GIỜ. GĐ2 (U13): khi MÁY tự
  // kiểm (poller / đồng bộ import / quét sạch) khoá TOÀN HỆ THỐNG `…:he-thong:<YYYY-MM-DDTHH>` — một sự
  // cố một chuông, trỏ Nhật ký kiểm thẻ POS lọc lỗi kết nối.
  "pos.loi-ket-noi:": {
    label: "Lỗi kết nối hệ thống thanh toán thẻ",
    group: "action_required", priority: 2, entity: "order",
    recipients: "Kế toán HO + Quản trị tối cao",
    target: "/orders/<orderId> · /bien-dong-so-du/nhat-ky-pos?ketQua=PROVIDER_ERROR (khoá he-thong:)",
  },
  // GĐ2 — quét sạch cuối ngày 23:30 giờ VN ghi nhận phiếu thu thẻ mà poller/nút/đồng bộ bỏ sót. Sinh ở
  // `lib/payments/pos/quet-sach.ts`. Khoá `…:<YYYY-MM-DD giờ VN>` — một chuông/ngày; không in số tiền.
  "pos.quet-sach:": {
    label: "Đối soát thẻ cuối ngày: có phiếu vừa được ghi nhận muộn",
    group: "action_required", priority: 2, entity: "payment",
    recipients: "Kế toán HO + Quản trị tối cao", target: "/bien-dong-so-du/nhat-ky-pos",
  },
  // Pha ghi tiền của phiếu thu thẻ NÉM — tiền có thể đã trừ thẻ khách. KHẨN. Sinh ở
  // `lib/payments/pos/xu-ly-ket-qua.ts`. Khoá `…:<intentId>:<YYYY-MM-DDTHH>` khi SALE bấm; khi MÁY tự kiểm
  // (poller / đồng bộ import / quét sạch) `…:<intentId>:<YYYY-MM-DD>` — một chuông/phiếu/NGÀY VN.
  "pos.chua-xac-dinh:": {
    label: "Chưa xác định được kết quả thu thẻ — cần kiểm tay",
    group: "action_required", priority: 1, entity: "order",
    recipients: "Kế toán HO + Quản trị tối cao", target: "/orders/<orderId>",
  },
  // 07/10/2026 — GĐ4 POS: chuông MÁY ĐỒNG BỘ (Chrome extension đọc portal Techcombank). Sinh ở
  // `lib/payments/pos/agent/canh-bao.ts` — `/status`, cron giám sát / 07:30 và lượt sale bị D9 dùng CÙNG khoá
  // `…:<centerId>:<YYYY-MM-DD giờ VN>` (một chuông / cơ sở / ngày; sự việc MỚI trong ngày ⇒ mở lại). Không in số
  // tiền / mã phiếu / tên khách. Hết phiên là KHẨN: sale đang đứng quầy không kiểm được thẻ cho tới khi đăng nhập lại.
  "pos.agent-het-phien:": {
    label: "Portal Techcombank hết phiên — đăng nhập lại trên máy POS Agent",
    group: "action_required", priority: 1, entity: "payment",
    recipients: "Kế toán HO + Quản trị tối cao", target: "/bien-dong-so-du/pos-agent",
  },
  "pos.agent-mat-ket-noi:": {
    label: "Máy POS Agent mất kết nối / không trả lời",
    group: "action_required", priority: 2, entity: "payment",
    recipients: "Kế toán HO + Quản trị tối cao", target: "/bien-dong-so-du/pos-agent",
  },
  "pos.agent-sap-het-phien:": {
    label: "Phiên portal Techcombank sắp hết hạn trong ngày (07:30)",
    group: "action_required", priority: 2, entity: "payment",
    recipients: "Kế toán HO + Quản trị tối cao", target: "/bien-dong-so-du/pos-agent",
  },
  "pos.agent-loi:": {
    label: "Máy POS Agent báo lỗi",
    group: "action_required", priority: 2, entity: "payment",
    recipients: "Kế toán HO + Quản trị tối cao", target: "/bien-dong-so-du/pos-agent",
  },

  // ── Sinh từ sự kiện: marketing & tích hợp ──
  "cost-unconfirmed:": {
    label: "Chi phí quảng cáo chưa xác nhận",
    group: "action_required", priority: 2, entity: "marketing",
    recipients: "Marketing", target: "/marketing/funnel",
  },
  // Đến hạn chốt sổ mà chưa nộp báo cáo — PRD xếp ACTION.REPORT_MISSING là P1.
  "report-missing:": {
    label: "Đến hạn chốt sổ mà chưa nộp báo cáo",
    group: "action_required", priority: 1, entity: "marketing",
    recipients: "Marketing", target: "/marketing/funnel",
  },
  // Nguồn lead hỏng/im lặng = tiền quảng cáo đang chảy vào hư không ⇒ khẩn.
  "intake-failing:": {
    label: "Nguồn lead đang lỗi",
    group: "system", priority: 1, entity: "integration",
    recipients: "SUPER_ADMIN", target: "/crm/webhook-replay",
  },
  "intake-silent:": {
    label: "Nguồn lead im lặng bất thường",
    group: "system", priority: 1, entity: "integration",
    recipients: "SUPER_ADMIN", target: "/crm/webhook-replay",
  },
  "birthday:": {
    label: "Sinh nhật học viên (luồng cũ)",
    group: "system", priority: 3, entity: "student",
    recipients: "CSKH + giáo viên lớp", target: "/sinh-nhat",
  },
  // ── Module chấm công v3 (L3, 06/09/2026) ────────────────────────────────────
  // Ca của tôi bị đổi (sửa tay trên lưới / đơn được duyệt) — T-07: "duyệt ⇒ đổi lịch ⇒ báo".
  "shift.changed:": {
    label: "Ca làm việc của tôi bị đổi",
    group: "new_task", priority: 2, entity: "timesheet",
    recipients: "Chính người có ca", target: "/cham-cong/lich-ca",
  },
  // Tin nhắc lịch NGÀY MAI (thay tin Zalo 19:00 của Sheet). dedupeKey = shift.brief:<userId>:<ymd>
  // ⇒ cron bơm dày (test 5′/lần) không kêu chuông lần hai.
  "shift.brief:": {
    label: "Nhắc lịch ca ngày mai",
    group: "due_date", priority: 3, entity: "timesheet",
    recipients: "Mọi nhân sự có trong lưới phân ca", target: "/cham-cong/lich-ca",
  },
  // L5 — đơn từ (ca/nghỉ/chỉnh công/lớp) dùng chung mọi nhân sự.
  // Đơn mới tới cơ sở nhận đơn: báo người có quyền duyệt ở cơ sở đó. dedupeKey = request.submitted:<requestId>
  "request.submitted:": {
    label: "Đơn từ mới chờ duyệt",
    group: "new_task", priority: 2, entity: "timesheet",
    recipients: "Người giữ quyền duyệt đơn (hr_attendance:approve) tại cơ sở nhận đơn", target: "/don-tu",
  },
  // Đơn của tôi được duyệt / từ chối. dedupeKey = request.decided:<requestId>:<userId>
  "request.decided:": {
    label: "Đơn của tôi đã được quyết",
    group: "new_task", priority: 2, entity: "timesheet",
    recipients: "Người nộp đơn (và người nhận ca/làm thay nếu có)", target: "/don-tu/cua-toi",
  },
  // ── Khoá CHỈ CÓ trên nhánh `test`, bổ sung khi hợp nhất 16/09/2026 ──
  //    `label` viết thêm ở đây: kiểu `NotiDef` bên `main` đòi trường này.
  // F-21 — CẢNH BÁO ĐẨY, khác hẳn `media_approval:` ở trên (đó là nhóm việc tồn, chỉ sinh
  // ra khi chính người đó mở chuông). Khoá dạng `media_review.overdue:<folder>:<ngày VN>`
  // nên KHÔNG rơi vào phạm vi vòng đồng bộ việc tồn — cố ý, xem `pending-sync.ts`.
  "media_review.overdue:": {
    label: "Ảnh buổi học quá hạn duyệt",
    group: "due_date", priority: 1, entity: "media",
    recipients: "Quản lý cơ sở CÓ ảnh đang treo", target: "/media",
  },
  // ── Luồng ca trải nghiệm ở màn Lớp Trial ────────────────────────────────────
  // 06/10/2026 — GỠ bốn mục chết `trial-case.assigned:`, `trial-case.rescheduled:`,
  // `trial-v1.assigned:`, `trial-class.assigned:`: đo trên `origin/test`, KHÔNG còn đường mã
  // nào phát ra (kể cả khoá ghép động). Mục thứ tư đã được hẹn gỡ từ 14/09 (chú thích mục 7
  // của lop-trial/_actions.ts) nhưng quay lại qua một lượt gộp nhánh. Chúng bày ra màn cấu hình thành công tắc không nối vào đâu — trên prod
  // `trial-case.assigned` còn đang BẬT, người vận hành tưởng mình đã nhận tin phân ca.
  // Lưới chặn tái phát: `[CAT-SONG]` trong catalog.test.ts.
  //
  // Đồng thời KHAI ba khoá đang phát thật mà chưa từng có mặt ở đây (log prod 03/10 báo
  // `trial-case.go … chưa khai trong catalog`): chuyển/gỡ học viên giữa các case.
  "trial-case.moved-in:": {
    label: "Có học viên chuyển vào ca trải nghiệm của tôi",
    group: "new_task", priority: 2, entity: "trial",
    recipients: "Giáo viên của case nhận học viên (không báo chính người bấm)", target: "/lop-trial",
  },
  "trial-case.moved-out:": {
    label: "Học viên chuyển khỏi ca trải nghiệm của tôi",
    group: "new_task", priority: 3, entity: "trial",
    recipients: "Giáo viên của case cũ (case còn sống, không báo chính người bấm)", target: "/lop-trial",
  },
  "trial-case.go:": {
    label: "Học viên bị gỡ khỏi ca trải nghiệm của tôi",
    group: "new_task", priority: 3, entity: "trial",
    recipients: "Giáo viên của case vừa bị gỡ học viên (không báo chính người bấm)", target: "/lop-trial",
  },
  // ── Chính sách khuyến mãi (26/09/2026) ─────────────────────────────────────────────
  // BLĐ ban hành ⇒ báo ngay người tra cứu trong phạm vi áp dụng ("up lên là nhận luôn và gửi
  // về cho Sale tra cứu"). P2: nên đọc trước ca tư vấn kế, chưa phải việc chặn ai.
  "khuyen-mai.ban-hanh:": {
    label: "Chính sách khuyến mãi mới ban hành",
    group: "system", priority: 2, entity: "marketing",
    recipients: "Người giữ quyền xem khuyến mãi (Sale, QLCS, kế toán, marketing) trong phạm vi áp dụng",
    target: "/khuyen-mai/[id]",
  },
  // Thu hồi sớm — P1: Sale đang có thể hứa với khách một ưu đãi vừa bị rút.
  // ── T13 (08/10/2026) — học bù theo case. Phụ huynh nhận ở CỔNG (bảng `Notification`, không qua catalog này); các khoá dưới là CHUÔNG NHÂN SỰ. ──
  "makeup.case.scheduled:": {
    label: "Được xếp dạy bù",
    group: "new_task", priority: 2, entity: "makeup_case",
    recipients: "Giáo viên của case dạy bù", target: "/hoc-bu",
  },
  "makeup.case.changed:": {
    label: "Buổi dạy bù đổi lịch / đổi giáo viên",
    group: "system", priority: 2, entity: "makeup_case",
    recipients: "Giáo viên của case (cả giáo viên cũ nếu đổi người)", target: "/hoc-bu",
  },
  "makeup.case.cancelled:": {
    label: "Buổi dạy bù bị huỷ",
    group: "system", priority: 2, entity: "makeup_case",
    recipients: "Giáo viên của case", target: "/hoc-bu",
  },
  "makeup.case.reminder:": {
    label: "Nhắc buổi dạy bù ngày mai",
    group: "due_date", priority: 2, entity: "makeup_case",
    recipients: "Giáo viên của case", target: "/hoc-bu",
  },
  "makeup.absent:": {
    label: "Học viên vắng buổi học bù",
    group: "action_required", priority: 2, entity: "makeup_case",
    recipients: "Sale phụ trách học viên (không có thì quản lý cơ sở)", target: "/hoc-bu",
  },
  "makeup.payment-required:": {
    label: "Học viên hết lượt — cần thu phí học bù",
    group: "action_required", priority: 2, entity: "makeup_case",
    recipients: "Sale phụ trách học viên (không có thì quản lý cơ sở)", target: "/hoc-bu",
  },
  "makeup.teacher-unavailable:": {
    label: "Giáo viên không còn ca cho buổi dạy bù",
    group: "action_required", priority: 1, entity: "makeup_case",
    recipients: "Quản lý cơ sở", target: "/hoc-bu",
  },
  "makeup.overdue:": {
    label: "Buổi dạy bù quá giờ chưa điểm danh",
    group: "due_date", priority: 1, entity: "makeup_case",
    recipients: "Quản lý cơ sở + giáo viên của case", target: "/hoc-bu",
  },
  "khuyen-mai.thu-hoi:": {
    label: "Chính sách khuyến mãi bị thu hồi",
    group: "action_required", priority: 1, entity: "marketing",
    recipients: "Người giữ quyền xem khuyến mãi trong phạm vi áp dụng",
    target: "/khuyen-mai/[id]",
  },
  // ── Bảo lưu học viên (SR.QD.236 · 08/10/2026) ──────────────────────────────────────
  // Hồ sơ vừa lập ⇒ Quản lý cơ sở phải duyệt (maker–checker: người lập không tự duyệt). P2: việc
  // phải làm trong ngày, chưa phải sự cố.
  "pause.cho-duyet:": {
    label: "Hồ sơ bảo lưu chờ duyệt",
    group: "action_required", priority: 2, entity: "enrollment",
    recipients: "Quản lý cơ sở của học viên (trừ người vừa lập hồ sơ)", target: "/bao-luu/[id]",
  },
  // Kết quả duyệt/từ chối ⇒ báo NGƯỜI LẬP hồ sơ để họ báo lại phụ huynh.
  "pause.da-duyet:": {
    label: "Hồ sơ bảo lưu đã được duyệt",
    group: "new_task", priority: 2, entity: "enrollment",
    recipients: "Người lập hồ sơ bảo lưu", target: "/bao-luu/[id]",
  },
  "pause.tu-choi:": {
    label: "Hồ sơ bảo lưu bị từ chối",
    group: "action_required", priority: 2, entity: "enrollment",
    recipients: "Người lập hồ sơ bảo lưu", target: "/bao-luu/[id]",
  },
  // Phiên 5 — cron `/api/cron/bao-luu` + vòng đời. Mỗi mốc ĐÚNG MỘT thông báo (dedupeKey theo hồ sơ + mốc).
  "pause.nhac-truoc-han:": {
    label: "Bảo lưu sắp hết hạn",
    group: "due_date", priority: 2, entity: "enrollment",
    recipients: "Người lập hồ sơ bảo lưu (Sale)", target: "/bao-luu/[id]",
  },
  "pause.nhac-het-han:": {
    label: "Hôm nay hết hạn bảo lưu",
    group: "due_date", priority: 1, entity: "enrollment",
    recipients: "Người lập hồ sơ bảo lưu (Sale)", target: "/bao-luu/[id]",
  },
  "pause.qua-han:": {
    label: "Bảo lưu đã quá hạn",
    group: "action_required", priority: 2, entity: "enrollment",
    recipients: "Người lập hồ sơ bảo lưu (Sale)", target: "/bao-luu/[id]",
  },
  "pause.leo-thang:": {
    label: "Bảo lưu quá hạn chưa liên hệ phụ huynh",
    group: "action_required", priority: 1, entity: "enrollment",
    recipients: "Quản lý cơ sở của học viên", target: "/bao-luu/[id]",
  },
  "pause.cham-dut:": {
    label: "Đã chấm dứt bảo lưu",
    group: "action_required", priority: 1, entity: "enrollment",
    recipients: "Quản lý cơ sở của học viên", target: "/bao-luu/[id]",
  },
  "pause.thu-hoi-kit:": {
    label: "Việc: thu hồi kit sau chấm dứt bảo lưu",
    group: "new_task", priority: 2, entity: "enrollment",
    recipients: "Quản lý cơ sở của học viên", target: "/bao-luu/[id]",
  },
  "pause.center-qua-ngay:": {
    label: "Tạm dừng lớp quá ngày dự kiến mở lại",
    group: "action_required", priority: 2, entity: "enrollment",
    recipients: "Quản lý cơ sở của học viên", target: "/bao-luu/[id]",
  },
  "pause.gia-han-cho-duyet:": {
    label: "Đề nghị gia hạn bảo lưu chờ duyệt",
    group: "action_required", priority: 2, entity: "enrollment",
    recipients: "Quản lý cơ sở (trừ người đề nghị)", target: "/bao-luu/[id]",
  },
  "pause.gia-han-da-duyet:": {
    label: "Đề nghị gia hạn bảo lưu đã duyệt",
    group: "new_task", priority: 2, entity: "enrollment",
    recipients: "Người đề nghị gia hạn", target: "/bao-luu/[id]",
  },
  "pause.gia-han-tu-choi:": {
    label: "Đề nghị gia hạn bảo lưu bị từ chối",
    group: "action_required", priority: 2, entity: "enrollment",
    recipients: "Người đề nghị gia hạn", target: "/bao-luu/[id]",
  },
};

/** Danh sách tiền tố đã sắp DÀI TRƯỚC — khớp tiền tố dài nhất, tính sẵn một lần. */
const PREFIXES_LONGEST_FIRST: readonly string[] = Object.keys(BY_PREFIX).sort(
  (a, b) => b.length - a.length,
);

/** Khai báo dùng khi không khớp tiền tố nào: rơi xuống đáy panel, không gây ồn. */
const FALLBACK: NotiDef = {
  label: "(chưa khai trong catalog)",
  group: "system",
  priority: 3,
  entity: "integration",
  recipients: "(chưa khai trong catalog)",
  target: "(chưa khai trong catalog)",
};

export interface NotiClassification {
  groupKey: NotiGroupKey;
  priority: NotiPriority;
  entityType: NotiEntityType;
  /** false = không khớp tiền tố nào ⇒ đang dùng giá trị rơi tự do. Dùng cho test + cảnh báo. */
  known: boolean;
}

/**
 * Phân loại một thông báo từ `dedupeKey` của nó.
 *
 * Quy tắc nâng mức: khoá của vòng đồng bộ việc tồn kết thúc bằng `:overdue` LUÔN được nâng lên P1,
 * bất kể mức khai trong bảng. Lý do: cùng một loại việc, "còn tồn" và "đã quá hạn" là hai mức độ
 * khẩn khác nhau, và người dùng cần thấy cái quá hạn nằm trên cùng panel (PRD §7.5).
 */
export function classifyNotification(dedupeKey: string): NotiClassification {
  const prefix = PREFIXES_LONGEST_FIRST.find((p) => dedupeKey.startsWith(p));
  const def = prefix ? BY_PREFIX[prefix] : FALLBACK;

  const overdue = isPendingSyncKey(dedupeKey) && dedupeKey.endsWith(":overdue");

  return {
    groupKey: def.group,
    priority: overdue ? 1 : def.priority,
    entityType: def.entity,
    known: prefix !== undefined,
  };
}

/** Chỉ dùng cho test/kiểm kê — đừng đọc trực tiếp ở đường chạy. */
export function catalogPrefixes(): readonly string[] {
  return PREFIXES_LONGEST_FIRST;
}

/**
 * Tiền tố mà vòng ĐỒNG BỘ VIỆC TỒN sở hữu — những loại KHÔNG BAO GIỜ đẩy được Web Push.
 *
 * ── VÌ SAO PHẢI TÁCH RA (14/09/2026) ───────────────────────────────────────────────────
 * Chúng do `lib/staff-notifications.ts` ghi thẳng bằng `db.staffNotification.upsert`, KHÔNG đi
 * qua `notifyStaff` — mà `notifyStaff` là điểm móc DUY NHẤT của Web Push. Ranh giới đó là cố ý
 * và khối chú thích ở `lib/notifications/notify.ts` nói rõ lý do: hàm dưới dành cho cron quét
 * hàng loạt (`lib/crm/sla.ts`, ~1.800 vi phạm mỗi lượt) và nó đi cửa đó CHÍNH VÌ không muốn
 * rung điện thoại. Push đi theo sự kiện, không đi theo lượt quét.
 *
 * Hệ quả: bày những loại này ra màn cấu hình đẩy là mời người ta bật một công tắc không nối
 * vào đâu. Chủ dự án đã bật thật 2 trong số đó (`class_no_teacher:`, `timesheet_adjust:`) rồi
 * ngồi chờ — đúng định nghĩa affordance nói dối.
 *
 * SUY RA từ `PENDING_SYNC_TYPES` chứ không đánh dấu tay từng dòng: đánh dấu tay thì thêm một
 * loại việc tồn mới mà quên đánh dấu là lại có thêm một công tắc chết.
 */
const TIEN_TO_VONG_QUET: ReadonlySet<string> = new Set(
  PENDING_SYNC_TYPES.map((t) => `${t}:`),
);

/** Loại này có khả năng đẩy Web Push không (false = sinh từ vòng quét, không bao giờ đẩy). */
export function dayDuocPush(prefix: string): boolean {
  return !TIEN_TO_VONG_QUET.has(prefix);
}

/**
 * Tiền tố ĐƯỢC PHÉP nằm trong `push.tienToDuocDay`.
 *
 * Hẹp hơn `catalogPrefixes()` đúng ở chỗ bỏ các loại của vòng quét. Đường ghi cấu hình phải
 * kiểm theo danh sách NÀY, không theo danh sách đầy đủ — nếu không thì một khoá không đẩy được
 * vẫn lưu được vào DB qua đường khác và nằm đó vô nghĩa.
 */
export function catalogPrefixesDayDuoc(): readonly string[] {
  return PREFIXES_LONGEST_FIRST.filter(dayDuocPush);
}

/** Một dòng để BÀY RA cho người vận hành chọn — không phải để quyết định lúc chạy. */
export interface NotiCatalogEntry {
  /** Tiền tố `dedupeKey` — cũng là giá trị lưu trong cấu hình allowlist. */
  prefix: string;
  label: string;
  groupKey: NotiGroupKey;
  groupLabel: string;
  priority: NotiPriority;
  recipients: string;
}

/**
 * Toàn bộ loại thông báo đã khai, để màn cấu hình bày ra.
 *
 * ⚠️ Màn cấu hình PHẢI dựng danh sách từ đây chứ không chép tay: chép tay thì thêm một loại
 * thông báo mới ở `BY_PREFIX` mà quên cập nhật màn ⇒ loại đó vĩnh viễn không ai bật/tắt được,
 * và không có gì báo — đúng lớp lỗi "màn hình nói dối" mà luật 12 của repo nói tới.
 *
 * Sắp theo NHÓM (đúng thứ tự `NOTI_GROUPS`) rồi theo MỨC rồi theo nhãn — không theo thứ tự
 * khai, vì thứ tự khai là lịch sử phát triển, vô nghĩa với người vận hành.
 */
export function catalogEntries(): readonly NotiCatalogEntry[] {
  const thuTuNhom = new Map(NOTI_GROUPS.map((g, i) => [g.key, i] as const));
  return Object.entries(BY_PREFIX)
    // Bỏ loại của vòng quét: chúng không bao giờ đẩy được, bày ra là hứa suông.
    .filter(([prefix]) => dayDuocPush(prefix))
    .map(([prefix, def]) => ({
      prefix,
      label: def.label,
      groupKey: def.group,
      groupLabel: notiGroupLabel(def.group),
      priority: def.priority,
      recipients: def.recipients,
    }))
    .sort(
      (a, b) =>
        (thuTuNhom.get(a.groupKey) ?? 99) - (thuTuNhom.get(b.groupKey) ?? 99) ||
        a.priority - b.priority ||
        a.label.localeCompare(b.label, "vi"),
    );
}
