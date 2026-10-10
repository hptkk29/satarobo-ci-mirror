// lib/db-scope.ts — A0-04: scopedDb(actor) ép cách ly cơ sở ở TẦNG truy vấn (P3, Doc 15 §4.4).
// CỔNG AN TOÀN DỮ LIỆU. Tự inject `centerId IN visibleCenterIds` cho SCOPED_MODELS.
//
// ⚠️ GIỚI HẠN: Prisma client extension chỉ chạy cho query TOP-LEVEL. Nested `include`
// KHÔNG được auto-scope → khi include model scoped khác, PHẢI tự thêm `where` (xem AC7).
import { db } from "@/lib/db";
import { logRbacAudit } from "@/lib/audit/log";
import type { Actor } from "@/lib/auth/actor";

/** Model (PascalCase) có centerId VÀ phải cách ly theo cơ sở. */
export const SCOPED_MODELS = new Set<string>([
  "Lead", "Order", "Student", "Class", "ClassGroup", "TrialClass", "Room", "Holiday",
  "InventoryAudit", "StockBalance", "StockMovement", "Employee", "EmployeeCheckin",
  "CenterDayChecklist", "MakeupNeed", "Notification", "ShiftRegistration",
  // Học bù đời mới (29/09/2026) — case dạy bù + bé trong case, cách ly như MakeupNeed.
  "MakeupCase", "MakeupCaseStudent",
  // Bảo lưu Phiên 2 (08/10/2026) — hồ sơ bảo lưu + nhật ký sự kiện, cách ly như Student. centerId chép từ
  // học viên (migration 20261008150000 đã backfill); học viên không có cơ sở ⇒ NULL ⇒ chỉ cấp Hội sở thấy,
  // KHÔNG vào NULL_IS_GLOBAL_MODELS (dữ liệu cá nhân: coi "chưa biết cơ sở" là "ai cũng thấy" là rò rỉ).
  // ⚠️ scopedDb KHÔNG che WRITE: mọi create phải tự set centerId.
  "StudentReserve", "StudentReserveEvent",
  "SataCoinTransaction", "StudentCareTask", "StudentCenterHistory", "StudentRiskAlert",
  // Sinh nhật HV — cùng họ dữ liệu học viên, cách ly theo cơ sở như StudentCareTask.
  // Mọi create PHẢI tự set centerId (scopedDb không che write) — quên = dòng vô hình
  // với chính Sale/QLCS cơ sở đó, tức mất luôn việc chăm sóc.
  "StudentBirthdayGreeting",
  "Survey", "SurveyResponse", "TimesheetAdjustmentRequest",
  "MessengerConversation", // R1-01 — hội thoại CRM theo cơ sở
  "Payment", // R7-04 — khoản thanh toán theo cơ sở
  "TrialClassV2", // R7-02 — lớp trải nghiệm theo cơ sở
  "LeadTrialHistory", // FL-R2 — lịch sử học thử theo cơ sở
  "LeadStatusHistory", // GĐ1 — sổ đổi trạng thái lead theo cơ sở
  "TrialReschedule", // GĐ3 — nhật ký dời lịch ca trải nghiệm theo cơ sở
  // FL3-02 (W5f phase B) — centerId backfilled (denormalized từ class). Flip EXEMPT→SCOPED.
  // ⚠️ DEPLOY-GATE: chỉ an toàn sau khi backfill Enrollment/ClassSession.centerId = 100%
  // (centerId null sẽ bị inject `centerId IN [...]` → ẨN NHẦM record). Xem e2e cách ly.
  "Enrollment", // FL3-02 — đăng ký học theo cơ sở (trước scope tay qua class.centerId)
  "ClassSession", // FL3-02 — buổi học theo cơ sở; vẫn ∈ MAKEUP_EXCEPTION_MODELS (đọc chéo khi học bù)
  // #04 (08/07) — flip EXEMPT→SCOPED. Điều kiện đã đạt: centerId backfill prod = 0 null +
  // mọi đường tạo Attendance set centerId (attendance/_actions, parent-requests,
  // recordAttendance — commit 6a8ba7a). Cách ly: HO/SUPER thấy toàn bộ; center-actor chỉ
  // cơ sở mình. Reads bị scope = sdb.attendance (marking/báo cáo/sessions). Makeup đọc
  // Attendance qua raw db (KHÔNG qua scopedDb) → KHÔNG cần MAKEUP_EXCEPTION.
  "Attendance",
  // #03 Pha B (10/07) — flip sau khi PROD xác nhận 0 null (msg_null=rc_null=enr_null=0).
  // Pha A đã thêm cột + backfill + ép mọi đường tạo set centerId.
  "ReportCard", // học bạ theo cơ sở (centerId denormalize từ Enrollment)
  "ConversationMessage", // tin nhắn PH↔nhân viên theo cơ sở
  "EvaluationRound", // ⚠️ centerId null = vòng TOÀN HỆ THỐNG → xem NULL_IS_GLOBAL_MODELS
  // 03/08 — sổ thu theo đợt + phân bổ. Tiền ⇒ cách ly cơ sở là bắt buộc.
  "PaymentRequest",
  "PaymentAllocation",
  "QrSession",
  "CreditBalance",
  // 16/09 — phiếu gộp (1 QR cho cả gia đình). `PaymentBillLine` KHÔNG vào đây: nó không
  // có cột đơn vị (dòng chi tiết của phiếu, như OrderItem với Order), và khai một model
  // không có `centerId` vào SCOPED_MODELS là chèn `where` trên cột không tồn tại.
  "PaymentBill",
  // ⚠️ BankTransaction: centerId NULL = giao dịch CHƯA khớp được về cơ sở nào
  // (tiền vừa về, chưa biết của đơn nào) → xem NULL_IS_GLOBAL_MODELS. Ẩn nhóm này
  // khỏi người đối soát chính là làm mất đúng thứ họ cần xử lý.
  "BankTransaction",
  // 29/09/2026 — giao dịch thẻ SmartPOS (docs/pos-the-smartpos.md). `PosCardTransaction`
  // mang ĐÚNG ngữ nghĩa `BankTransaction`: centerId NULL = máy POS chưa khai cơ sở ⇒ dòng
  // "cần xử lý" mà kế toán phải thấy ⇒ khai kèm NULL_IS_GLOBAL_MODELS. `PosTerminal`
  // centerId BẮT BUỘC (máy luôn thuộc một cơ sở) ⇒ KHÔNG vào NULL_IS_GLOBAL.
  // `PosImportBatch` KHÔNG ở đây: không có cột đơn vị (một file chứa giao dịch mọi máy).
  // ⚠️ scopedDb KHÔNG che WRITE: mọi `create` phải tự set `centerId`.
  "PosCardTransaction",
  "PosTerminal",
  // 06/10/2026 — GĐ1 POS: phiếu thu thẻ (docs/pos-gd1-thiet-ke.md §1.3). `centerId` = cơ sở
  // của ĐƠN, NOT NULL ⇒ KHÔNG vào NULL_IS_GLOBAL. Lưới: `[POS1-SC-01]` + `[POS1-SC-02]`.
  "PosPaymentIntent",
  // 06/10/2026 — GĐ2 POS: nhật ký kiểm phiếu thu thẻ (docs/pos-gd2-thiet-ke.md §1.4). Mang mã
  // phiếu, mã giao dịch, người bấm của cơ sở đơn. `centerId` NOT NULL ⇒ KHÔNG vào NULL_IS_GLOBAL.
  // Lưới: `[POS2-SC-01]` + `[POS2-SC-02]`.
  "PosCheckLog",
  // 07/10/2026 — GĐ4 POS: đầu nhận POS Agent (docs/pos-gd4-thiet-ke.md §2.3). Máy đồng bộ + nhật ký
  // của nó + job "đồng bộ ngay" mang `centerId` NOT NULL ⇒ KHÔNG vào NULL_IS_GLOBAL. `PosTxnSource`
  // (nguồn đã thấy giao dịch — GĐ6 đối chiếu) có `centerId` NULL = CHƯA BIẾT cơ sở (máy chưa khai) — cố
  // ý KHÔNG vào NULL_IS_GLOBAL (T25, fail-closed: chỉ người cấp Hội sở thấy). `PosAgentNonce` không cột
  // đơn vị (sống 15′, chỉ tầng xác thực đọc). Lưới: `[POS4-SC-01]` + `[POS4-SC-02]`.
  "PosAgent",
  "PosAgentEvent",
  "PosCheckJob",
  "PosTxnSource",

  // EL-03 — đào tạo nội bộ. ĐÚnG 4 model mang cột đơn vị; 8 bảng còn lại của module là
  // bảng CON (scope theo bảng cha) hoặc ngoại lệ nhịp ghi cao (TrnVideoSession).
  // ⚠️ Ba trong bốn model này có NULL = TOÀN CÔNG TY ⇒ xem NULL_IS_GLOBAL_MODELS ngay dưới.
  // Quên khai ở đó thì chương trình/khoá dùng chung toàn hệ TÀNG HÌNH với người cấp cơ sở.
  // EL-08 — phiếu nhu cầu đào tạo. Cùng ngữ nghĩa với chương trình sinh ra từ nó:
  // NULL = nhu cầu TOÀN CÔNG TY, nên phải khai cả ở NULL_IS_GLOBAL_MODELS dưới.
  "TrnTrainingNeed",
  "TrnProgram",
  "TrnCourse",
  "TrnRequirement",
  "TrnEvaluationResult", // KHÁC 3 model trên: NULL = chưa backfill, KHÔNG phải toàn công ty
  // EL-05 — giao bài + ghi danh. Cả hai đều `BAT_BUOC`: một lượt giao / một lượt ghi danh
  // LUÔN thuộc một cơ sở. NULL = chưa backfill ⇒ KHÔNG vào NULL_IS_GLOBAL_MODELS.
  "TrnAssignment",
  "TrnEnrollment",
  // EL-09 — công nhận tương đương. Cùng nhóm `BAT_BUOC` với lượt ghi danh: một
  // lượt công nhận LUÔN thuộc cơ sở của người được công nhận. NULL ở đây là dữ
  // liệu chưa backfill, KHÔNG phải "toàn công ty" ⇒ KHÔNG vào NULL_IS_GLOBAL.
  "TrnEquivalence",
  // EL-04 — yêu cầu của chủ thể dữ liệu. `BAT_BUOC`: NULL = chưa backfill.
  // ⚠️ Đây là DỮ LIỆU CÁ NHÂN — đưa vào NULL_IS_GLOBAL_MODELS là biến "chưa biết cơ sở"
  // thành "ai cũng thấy", tức rò rỉ, không phải tiện lợi.
  "TrnDataSubjectRequest",
  // EL-13 — cờ nghi ngờ học đối phó. `BAT_BUOC`: một cờ luôn thuộc cơ sở của
  // người bị gắn cờ.
  // ⚠️ TUYỆT ĐỐI KHÔNG đưa vào NULL_IS_GLOBAL_MODELS. Đây là dữ liệu quan hệ lao
  // động của một cá nhân; coi "chưa backfill" là "ai cũng thấy" ở đây không phải
  // tiện lợi mà là rò rỉ — và rò đúng loại thông tin gây tổn hại nhất.
  "TrnWatchFlag",
  // EL-14 — khảo thí. Ba bảng mang cột đơn vị; bốn bảng con (`TrnChoice`,
  // `TrnExamQuestion`, `TrnExamAnswer`, `TrnExamUnlock`) KHÔNG mang, và cách ly
  // của chúng đến từ bảng cha — khai thừa ở đây là `[US-07-IT-08c]` đỏ.
  "TrnQuestion",
  "TrnExam",
  // ⚠️ `TrnExamAttempt` KHÔNG vào NULL_IS_GLOBAL_MODELS: một lượt thi luôn thuộc
  // cơ sở của người thi. NULL ở đây = chưa backfill, không phải "ai cũng thấy".
  "TrnExamAttempt",
  // EL-15 — bài tập chấm tay. HAI bảng mang cột đơn vị; hai bảng con
  // (`TrnRubricCriterion`, `TrnRubricScore`) KHÔNG mang, và cách ly của chúng đến
  // từ bảng cha — khai thừa ở đây là `[US-07-IT-08c]` đỏ.
  "TrnRubric",
  // ⚠️ `TrnSubmission` KHÔNG vào NULL_IS_GLOBAL_MODELS: một lượt nộp luôn thuộc cơ
  // sở của người nộp. Và nội dung của nó là bài làm của một con người — kèm video
  // lớp học và ghi âm hội thoại phụ huynh (§13.3) — nên coi "chưa biết cơ sở" là
  // "ai cũng thấy" ở đây là rò rỉ, không phải tiện lợi.
  "TrnSubmission",
  // MEDIA-REVIEW (26/08) — ảnh/video buổi học + kết luận duyệt của từng buổi.
  // Cả hai `BAT_BUOC` mang centerId: một tấm ảnh / một kết luận LUÔN thuộc đúng một cơ
  // sở. KHÔNG vào NULL_IS_GLOBAL_MODELS — coi "chưa biết cơ sở" là "ai cũng thấy" ở đây
  // là để ảnh học viên cơ sở này lọt sang QLCS cơ sở kia.
  // ⚠️ scopedDb KHÔNG che WRITE: mọi `create` phải tự set `centerId`, quên là dòng vô
  // hình với chính QLCS cơ sở đó (tức ảnh không bao giờ được duyệt).
  "MediaAsset",
  "SessionMediaReview",
  // 27/08 — sổ "ai phụ trách cơ sở nào" cho hoa hồng QC 1% + Quản lý TT 2%.
  // `centerId` NOT NULL: một phân công LUÔN thuộc đúng một cơ sở ⇒ KHÔNG vào
  // NULL_IS_GLOBAL_MODELS. Đây là dữ liệu ai-nhận-tiền, coi "chưa biết cơ sở" thành
  // "ai cũng thấy" là để người cơ sở này đọc bảng lương hoa hồng của cơ sở kia.
  // ⚠️ Engine chốt kỳ (`lib/crm/commission-run.ts`) đọc bảng này qua `db` TRẦN, cố ý:
  // chốt kỳ là việc TOÀN HỆ (`CommissionStatement.period` @unique, không có centerId),
  // lọc theo tầm nhìn của người bấm nút sẽ đẻ ra bảng kê thiếu dòng cho cơ sở khác.
  "CenterCommissionAssignee",
  // MEDIA-REVIEW (26/08) — anh/video buoi hoc + ket luan duyet cua tung buoi.
  // Ca hai `BAT_BUOC` mang centerId: mot tam anh / mot ket luan LUON thuoc dung mot co
  // so. KHONG vao NULL_IS_GLOBAL_MODELS — coi "chua biet co so" la "ai cung thay" o day
  // la de anh hoc vien co so nay lot sang QLCS co so kia.
  // scopedDb KHONG che WRITE: moi `create` phai tu set `centerId`, quen la dong vo
  // hinh voi chinh QLCS co so do (tuc anh khong bao gio duoc duyet).
  "MediaAsset",
  "SessionMediaReview",
  // 30/08/2026 — danh mục phương thức thanh toán nay thuộc cơ sở. `centerId = NULL`
  // = phương thức DÙNG CHUNG ⇒ PHẢI khai kèm ở NULL_IS_GLOBAL_MODELS ngay dưới, nếu
  // không tiền mặt/cổng online tàng hình với người cấp cơ sở và form tạo đơn hiện
  // danh sách rỗng. Prefix action khai ở `getModelPrefixes` (["payments:"]).
  "PaymentMethod",
  // 26/09/2026 — HOÁ ĐƠN ĐIỆN TỬ (docs/ke-toan-hoa-don/PLAN.md §2.2). `centerId` NOT NULL: một
  // hoá đơn luôn thuộc đúng một cơ sở ⇒ KHÔNG vào NULL_IS_GLOBAL_MODELS. Bảng chứa MST, địa
  // chỉ, email khách — lọt cơ sở là rò PII. Prefix `payments:` ở `getModelPrefixes`.
  // Hai bảng con (`HoaDonKhoan`, `HoaDonGuiEmail`) KHÔNG có centerId ⇒ không nằm ở đây: luôn
  // đọc qua `HoaDonDienTu` đã scope rồi `include`, không truy vấn thẳng ở tầng app.
  // ⚠️ scopedDb KHÔNG che WRITE: mọi `create` phải tự set `centerId` = cơ sở của ĐƠN.
  "HoaDonDienTu",
  // ── Module chấm công v3 (L1 · 06/09/2026) — kế hoạch §3.5 ─────────────────
  // `ShiftTemplate` NULL = mã ca dùng chung (khai kèm NULL_IS_GLOBAL). Các bảng còn lại
  // centerId BẮT BUỘC: NULL = lỗi đường ghi, không phải "ai cũng thấy". `AttendanceTicket`
  // cố ý KHÔNG có cột đơn vị (xem model). `WorkRequest` giữ SCOPE_EXEMPT (own-rows).
  // ⚠️ scopedDb KHÔNG che WRITE: mọi `create` phải tự set `centerId`.
  "ShiftTemplate",
  "ShiftWeeklyPattern",
  "ShiftAssignment",
  "WorkLocation",
  "StaffTimeLog",
  "StaffAttendanceDay",
  "AttendancePeriod",
  "ShiftBriefNote",
  // 09/10/2026 — HOA HỒNG THEO NGUỒN · PR4 (02 §11.1). Văn bản + chính sách + version + rule mang CẢ
  // HAI cột (luật Nền #3, đính chính 27/08): `centerId` là cột cơ chế cách ly đang đọc. `centerId = NULL`
  // = văn bản/chính sách của HỘI SỞ, dùng chung mọi cơ sở ⇒ PHẢI khai kèm ở NULL_IS_GLOBAL_MODELS ngay
  // dưới; quên là chính sách chung TÀNG HÌNH với người cấp cơ sở. Prefix ở `getModelPrefixes`
  // (`commission_policies:`) — thiếu thì tầm nhìn rơi về diện rộng (lỗi #04).
  // ⚠️ scopedDb KHÔNG che WRITE: mọi `create` phải tự set `centerId` + `orgUnitId` (version/rule CHÉP từ
  // policy — `lib/hoa-hong/chinh-sach-service.ts` là nơi GHI duy nhất).
  "RegulationDocument",
  "CommissionPolicy",
  "CommissionPolicyVersion",
  "CommissionRule",
  // SỔ HOA HỒNG · PR5a (02 §11.1). `centerId` của sổ/kỳ/ô/hàng chờ là cơ sở của GIAO DỊCH (không phải của
  // người hưởng). KHÔNG vào NULL_IS_GLOBAL_MODELS: `centerId` của sổ/kỳ/ô NOT NULL; `CommissionHold`/`StudentTransaction`
  // `centerId = NULL` = CHƯA quy được cơ sở (NO_ORG_UNIT) — không phải "dùng chung", nên chỉ tầm nhìn ALL (Hội sở) thấy.
  // Prefix ở `getModelPrefixes`: bỏ trống thì tầm nhìn rơi về diện rộng (lỗi #04). Đọc "của chính mình" (view-self) KHÔNG
  // đi qua scopedDb — xem lib/hoa-hong/doc-so.ts.
  "StudentTransaction",
  "CommissionPeriod",
  "CommissionCalcSlot",
  "CommissionTransaction",
  "CommissionHold",
  // KHIẾU NẠI hoa hồng (02 §9.5). `centerId` NOT NULL = cơ sở của GIAO DỊCH bị khiếu nại (không phải của người khiếu nại)
  // ⇒ KHÔNG vào NULL_IS_GLOBAL_MODELS. Người khiếu nại đọc khiếu nại CỦA MÌNH theo `raisedByUserId` KHÔNG qua scopedDb
  // (lib/hoa-hong/khieu-nai-doc.ts). ⚠️ scopedDb không che WRITE: mọi `create` phải tự set `centerId` + `orgUnitId`.
  "CommissionDispute",
  // Đợt 8 đơn từ (08/10/2026) — sổ quỹ nghỉ bù. centerId BẮT BUỘC (cơ sở chịu công của người đó
  // lúc phát sinh bút toán); NULL là lỗi đường ghi ⇒ KHÔNG vào NULL_IS_GLOBAL_MODELS.
  "CompTimeLedger",
]);

/**
 * Model mà `centerId = NULL` mang nghĩa "bản ghi TOÀN HỆ THỐNG", không phải "chưa gán".
 *
 * Với các model này, inject `centerId IN (...)` trần sẽ ẩn nhầm bản ghi chung — đó là lý
 * do `Survey` và `EvaluationRound` trước đây phải scope tay / nằm ngoài scopedDb. Nay
 * scopedDb hiểu semantics đó: `centerId IS NULL OR centerId IN (...)`.
 *
 * KHÔNG thêm model thường vào đây: với chúng, centerId null = dữ liệu chưa backfill và
 * PHẢI bị chặn, không được biến thành "ai cũng thấy".
 */
export const NULL_IS_GLOBAL_MODELS = new Set<string>([
  // 30/08/2026 — phương thức thanh toán KHÔNG gắn cơ sở = dùng chung mọi cơ sở
  // (tiền mặt, VNPAY…). Đây là 4 dòng seed gốc và mọi dòng có trước đợt này.
  "PaymentMethod",
  // Module chấm công v3 (L1 · 06/09/2026) — mã ca không gắn cơ sở = dùng chung (S, C, HC…).
  "ShiftTemplate",
  // 04/09/2026 — NGÀY NGHỈ TOÀN HỆ THỐNG. `Holiday.centerId = NULL` nghĩa là Tết /
  // lễ áp cho MỌI cơ sở, không phải "chưa gán".
  //
  // Thiếu dòng này thì `scopedDb` inject `centerId IN (...)` trần và người cấp cơ
  // sở KHÔNG BAO GIỜ thấy ngày nghỉ chung. Đo trên dữ liệu thật: 4/6 ngày nghỉ là
  // toàn hệ thống — tức đa số, và đúng những ngày sinh ra lịch buổi học. Màn
  // `/holidays` còn có bộ lọc "Toàn hệ thống" đặt `where.centerId = null`, giao
  // với `centerId IN [CS1]` thành điều kiện KHÔNG BAO GIỜ đúng ⇒ bảng trắng.
  "Holiday",
  "Survey", // khảo sát chung (không gắn cơ sở)
  "SurveyResponse", // phản hồi của khảo sát chung
  "EvaluationRound", // vòng đánh giá scope SYSTEM / TEACHER_EVAL
  // 03/08 — giao dịch tiền về chưa đối khớp: centerId null nghĩa là "chưa biết của
  // cơ sở nào", và đó CHÍNH LÀ nhóm cần mọi người đối soát nhìn thấy để xử lý.
  // Khớp xong thì centerId được điền, từ đó bị scope bình thường.
  "BankTransaction",
  // 29/09/2026 — giao dịch thẻ SmartPOS: NULL = máy chưa khai cơ sở, cùng lý do BankTransaction.
  "PosCardTransaction",

  // EL-03 — chương trình / khoá / yêu cầu đào tạo dùng chung toàn công ty thì KHÔNG gắn cơ sở nào.
  // Đây là nghiệp vụ bình thường của module chứ không phải dữ liệu thiếu: khoá "An toàn thông tin"
  // áp cho cả công ty, không thuộc CS1 hay CS2.
  // ⚠️ TrnEvaluationResult CỐ Ý KHÔNG nằm ở đây — với nó NULL là dữ liệu chưa backfill, và biến
  // "chưa biết cơ sở" thành "ai cũng thấy" là vỡ cách ly (QĐ-CDA-10 cấm đích danh).
  "TrnTrainingNeed",
  "TrnProgram",
  "TrnCourse",
  "TrnRequirement",
  "TrnEvalLinkConfig",
  // EL-14 — ngân hàng câu hỏi và đề thi DÙNG CHUNG toàn công ty là chuyện thường
  // (an toàn lao động, phòng cháy…). Quên hai dòng này thì kho câu hỏi chung TÀNG
  // HÌNH với mọi người dùng cấp cơ sở, và không gì báo lỗi — họ chỉ thấy kho rỗng.
  "TrnQuestion",
  "TrnExam",
  // EL-15 — khung chấm DÙNG CHUNG toàn công ty là chuyện thường (khung ngạch giáo
  // viên, khung quy trình tư vấn). Quên dòng này thì khung chung TÀNG HÌNH với mọi
  // người dùng cấp cơ sở, và không gì báo lỗi — họ chỉ thấy danh sách rỗng.
  "TrnRubric",
  // 09/10/2026 — văn bản / chính sách của Hội sở (centerId NULL) áp mọi cơ sở, không phải "chưa gán".
  "RegulationDocument",
  "CommissionPolicy",
  "CommissionPolicyVersion",
  "CommissionRule",
]);

// FIX-C3 (B1) — soft-delete đã chuyển lên TẦNG base `db` (lib/soft-delete.ts + lib/db.ts)
// để bắt cả read `db` trần. Re-export để call-site/test import từ đây vẫn chạy.
export { SOFT_DELETE_MODELS, injectSoftDelete } from "@/lib/soft-delete";

/** Có centerId nhưng KHÔNG scope (lý do rõ) — để introspection không báo "miss model". */
export const SCOPE_EXEMPT = new Set<string>([
  "OrgUnit", // centerId = link Center cũ (hạ tầng tổ chức)
  "User", // identity/auth — đọc toàn cục
  "LeadAssignmentConfig", // config, centerId null = quy tắc toàn hệ thống
  "SataCoinRule", // config, centerId null = áp mọi cơ sở
  "FacebookPageMapping", // mapping Page→center (cấu hình hạ tầng, không phải dữ liệu nghiệp vụ)
  // ZaloCRM (09/2026) — HAI BẢNG ÁNH XẠ HẠ TẦNG, cùng loại FacebookPageMapping ở
  // trên: chúng trả lời "nick này của ai, ở cơ sở nào" và "hội thoại
  // này thuộc phiếu nào", chứ không chứa hội thoại hay tin nào (nội dung sống ở Inbox*).
  //
  // Vì sao MIỄN scope: đây là bảng TRA CỨU. Người trực đối
  // soát ở CS1 vẫn phải tra nổi chủ của một nick CS2 thì mới gán được hội thoại cho
  // đúng người; cách ly nằm ở DỮ LIỆU (Inbox*, Lead), không ở bảng tra cứu. Thêm nữa
  // `centerId` ở đây NULL được (orgCode chưa ánh xạ cơ sở) nên inject `centerId IN (…)`
  // trần sẽ ẩn đúng nhóm cần người xử lý khỏi chính người phải xử lý nó.
  //
  // 🔴 ĐỔI LẠI: `scopedDb` KHÔNG che gì cho hai bảng này — `injectScope` thoát ngay ở
  // dòng đầu. AI GÁC THAY: `lib/integrations/zalocrm/nick-admin.ts` lọc TAY theo
  // `actor.visibleCenterIds`, cho CẢ đường đọc lẫn đường ghi (SCOPE_EXEMPT nghĩa là
  // cả `passesScope` cũng trả true, không có lưới nào ở tầng query).
  // Đọc "đã khai vào db-scope" thành "đã được cách ly" là đúng cái bẫy dòng này chặn.
  "ZaloCrmNick",
  "ZaloCrmThread",
  "WorkShiftConfig", // R6-B2 — cấu hình ca per-center, centerId null = mặc định toàn hệ thống
  // LMS-16 — RevenueTarget là config mục tiêu KPI; centerId null = mục tiêu toàn hệ
  // thống; scope tay qua getRevenueTargets. (Trước đây khai báo lặp 2 lần — đã dọn.)
  "RevenueTarget",
  // C-01 — LeadTarget: song sinh của RevenueTarget, đo SỐ HỌC SINH thay vì tiền. Cùng
  // lý do miễn scope: centerId null = chỉ tiêu TOÀN HỆ THỐNG, mà `injectScope` chèn
  // `centerId IN (...)` trần (:277-279) nên dòng đó sẽ tàng hình với chính người vừa
  // đặt nó. Đổi lại `scopedDb` KHÔNG chặn giúp ⇒ tầm nhìn ép TAY bằng
  // `leadTargetListWhere` và quyền ghi bằng `checkRevenueTargetScope` (đều có test).
  "LeadTarget",
  // D-02 — AdsBudgetTarget: bảng chỉ tiêu thứ ba, đo TIỀN CHI cho quảng cáo. Cùng lý do
  // miễn scope với hai bảng trên: centerId null = chỉ tiêu TOÀN HỆ THỐNG, mà `injectScope`
  // chèn `centerId IN (...)` trần (:277-279) nên dòng đó sẽ tàng hình với chính người vừa
  // đặt nó. Đổi lại `scopedDb` KHÔNG chặn giúp ⇒ tầm nhìn ép TAY bằng
  // `adsBudgetTargetListWhere` và quyền ghi bằng `checkRevenueTargetScope` (đều có test).
  "AdsBudgetTarget",
  // (#03 Pha B, 10/07 — ReportCard / EvaluationRound / ConversationMessage đã rời khỏi đây
  //  sang SCOPED_MODELS sau khi PROD xác nhận 0 dòng centerId NULL.)
  // W3-1 — RefundRequest scope qua quan hệ enrollment→class (Class là SCOPED_MODEL);
  // centerId chỉ là snapshot nullable (HO/centerId null), inject `centerId IN` sẽ ẩn nhầm.
  "RefundRequest",
  // L6 — Đơn từ GV: đọc theo requesterId = chính mình (không list chéo); duyệt gate
  // CENTER_MANAGER + so centerId THỦ CÔNG trong reviewWorkRequest. centerId = snapshot
  // session.user.centerId (có thể null) → inject `centerId IN` sẽ ẩn nhầm đơn của chính GV.
  "WorkRequest",
  // Hoàn thành khoá — đề xuất đọc theo enrollmentId ∈ lớp mình phụ trách (Enrollment/Class
  // đã SCOPED) hoặc theo id + so centerId THỦ CÔNG trong reviewCourseCompletion. centerId
  // là snapshot nullable từ class → scope qua quan hệ, không inject trực tiếp.
  "CourseCompletionRequest",
  // RBAC-DECISION #5 (06/07) — Center LÀ ranh giới tenant, không tự scope theo chính
  // nó (self-referential, sẽ vỡ mọi thao tác cross-center hợp lệ: HO xem toàn bộ
  // center, branch switcher, super-admin list center). Lớp bảo vệ PHẢI là permission
  // tường minh ở call-site (assertCan/can theo actor.visibleCenterIds), KHÔNG phải
  // auto-filter tầng query. TODO: audit các nơi `db.center.findMany` để đảm bảo
  // non-HO/non-SUPER_ADMIN actor không list được center ngoài visibleCenterIds.
  "Center",
  // BGĐ 31/07 — Affiliate là DANH MỤC nguồn giới thiệu dùng chung: centerId chỉ là
  // "cơ sở theo dõi" và thường NULL (người giới thiệu toàn hệ thống). Inject
  // `centerId IN [...]` sẽ ẩn mất mã toàn hệ thống khỏi nhân sự cơ sở ⇒ link ?ref=
  // hợp lệ lại không tra được. Cách ly nằm ở gate quyền (leads:view-all/assign);
  // dữ liệu nghiệp vụ gắn theo nó (Lead) vẫn scoped bình thường.
  "Affiliate",
  // US-04 chat — log KỸ THUẬT của job đối soát thành viên đêm (drift REMOVE/ADD).
  // Chỉ SUPER_ADMIN đọc qua /admin/hoi-thoai/doi-soat (gate chat:admin — mà
  // SUPER_ADMIN vốn bypass scope). centerId/orgUnitId trên dòng log là ghi kép
  // ngữ cảnh (luật Nền Hệ thống #3), không phải ranh giới tenant của dữ liệu
  // nghiệp vụ → không auto-scope.
  "ConversationMembershipDrift",
  // US-05 chat (delta 00-dieu-chinh mục E.3) — quyền đọc/gửi chat là PARTICIPANT-BASED
  // (ConversationParticipant tại thời điểm request), KHÔNG center-based. Conversation
  // có centerId CHỈ phục vụ truy vấn quản trị; DM (DM_TEACHER_PARENT) có centerId=null
  // ⇒ nếu đưa vào SCOPED_MODELS thì inject `centerId IN [...]` sẽ ẩn nhầm toàn bộ DM
  // khỏi chính người trong cuộc. Cách ly cho màn admin: filter TAY theo
  // getVisibleCenterIds(actor) (US-15).
  "Conversation",
  // EL-03 — cấu hình mức gắn đánh giá: bảng CON của TrnProgram (programId @unique).
  // Mang cột đơn vị để đối soát đêm đếm được, nhưng tầm nhìn đi theo CHƯƠNG TRÌNH chứ không
  // tự lọc: một dòng cấu hình không có nghĩa độc lập với chương trình nó gắn vào, và inject
  // `centerId IN [...]` sẽ ẩn mất cấu hình của chương trình dùng chung toàn công ty (centerId NULL)
  // khỏi chính người đang xem chương trình đó ⇒ màn cấu hình hiện rỗng và bị đọc thành
  // "chưa cấu hình" (fail-closed REPORT_ONLY) trong khi thực tế đã cấu hình.
  "TrnEvalLinkConfig",
]);

function bypassesScope(actor: Actor): boolean {
  return actor.isSuperAdmin;
}

/** Trả về danh sách tiền tố action (prefix) liên quan đến model. */
export function getModelPrefixes(model: string): string[] {
  switch (model) {
    case "Lead":
    case "MessengerConversation":
      return ["leads:"];
    case "Order":
      return ["orders:"];
    // 03/08 — sổ thu theo đợt + phân bổ + giao dịch tiền về + tiền thừa: cùng
    // họ "tiền", nên tầm nhìn cơ sở đi theo quyền payments:* như Payment.
    //
    // 30/08 — `PaymentMethod` (danh mục phương thức) nhập cụm này.
    // ⚠️ ĐO TRƯỚC KHI GỠ NÓ RA. Có một hiểu nhầm rất dễ mắc: `payments:*` được seed
    // `scopeType: "GLOBAL"` cho cả vai CẤP CƠ SỞ (CENTER_MANAGER, CENTER_ACCOUNTANT,
    // CENTER_SALES_CSM trong prisma/seed-roles.ts), nên trông như khai prefix ở đây sẽ
    // cho họ `centerScope: "ALL"` và phá cách ly theo cơ sở. KHÔNG PHẢI: `centerScope`
    // suy từ NƠI NEO VAI (HO/ROOT → "ALL"), không phải từ `scopeType` — lib/auth/actor.ts:50-56.
    // Đo thật với vai neo tại CS1: cả ba vai đều ra `centerScope: [CS1]`, đúng cách ly.
    //
    // Và khai prefix TỐT HƠN bỏ trống: bỏ trống thì model rơi về nhánh
    // `isHoLevel ? "ALL" : visibleCenterIds`, nghĩa là ai có MỘT vai neo tại Hội sở —
    // kể cả vai chẳng liên quan tiền nong — đọc được danh mục MỌI cơ sở. Đúng lỗi #04
    // đã mắc với `Attendance`. Bất biến này khoá ở `[PTTT-09]`
    // (tests/e2e/r7/payment-method-per-center.spec.ts) và ở test "mọi SCOPED_MODEL phải
    // có prefix" trong lib/db-scope-function.test.ts.
    case "Payment":
    case "PaymentRequest":
    case "PaymentAllocation":
    case "PaymentBill":
    case "QrSession":
    case "BankTransaction":
    case "CreditBalance":
    case "PaymentMethod":
    case "PosCardTransaction": // 29/09 — giao dịch thẻ SmartPOS, cùng họ BankTransaction
    case "PosTerminal":
    case "PosPaymentIntent": // 06/10 — GĐ1 POS: phiếu thu thẻ, cùng họ PaymentBill
    case "PosCheckLog": // 06/10 — GĐ2 POS: nhật ký kiểm phiếu thu thẻ, cùng họ PosPaymentIntent
    case "PosAgent": // 07/10 — GĐ4 POS: máy đồng bộ + nhật ký + job + nguồn đã thấy giao dịch
    case "PosAgentEvent":
    case "PosCheckJob":
    case "PosTxnSource":
    case "HoaDonDienTu": // 26/09 — cùng họ tiền; bỏ trống ⇒ vai neo HO bất kỳ đọc hoá đơn mọi cơ sở
      return ["payments:"];
    // Bảo lưu: tầm nhìn theo quyền bao-luu:* HOẶC students:* (nút Bảo lưu cũ gác students:edit và còn
    // sống tới Phiên 3). Thiếu map ⇒ rơi về `isHoLevel ? ALL` — vai Hội sở bất kỳ đọc được bảo lưu mọi cơ sở.
    case "StudentReserve":
    case "StudentReserveEvent":
      return ["bao-luu:", "students:"];
    case "Student":
    case "StudentCareTask":
    case "StudentCenterHistory":
    case "StudentRiskAlert":
    case "StudentBirthdayGreeting":
      return ["students:"];
    case "Class":
    case "ClassGroup":
      return ["classes:", "class_group:"];
    case "ReportCard":
      // Học bạ gắn ghi danh. TRAINING@HO (report-cards:* GLOBAL, centerScope ALL) → cả 2
      // cơ sở, đúng câu 55 (Toại duyệt học bạ liên cơ sở). CM@CS1 → chỉ CS1.
      return ["report-cards:", "enrollments:"];
    case "ConversationMessage":
      // Tin nhắn PH↔nhân viên gắn ghi danh/lớp. GV (classes:view-own @center) chỉ thấy cơ
      // sở mình; Đào tạo/HO thấy cross-center giống lớp & học viên.
      return ["classes:", "enrollments:"];
    case "EvaluationRound":
      return ["evaluations:"];
    case "Enrollment":
      // 24/07 (user chốt): TÁCH report-cards: khỏi đây → /ghi danh khoá đúng theo
      // enrollments: (Toại = CS1). Duyệt học bạ CS2 KHÔNG cần Enrollment cross-center:
      // trang chi tiết/action học bạ dùng checkEnrollmentScope (isHoLevel → ok) + db trần;
      // trang list học bạ lọc theo lớp đã-trong-scope. ReportCard vẫn giữ report-cards:
      // (cross-center cho Đào tạo). Đào tạo THUẦN (chỉ report-cards:review, không
      // enrollments:) rơi về fallback isHoLevel → ALL — vẫn đọc được để duyệt.
      return ["enrollments:"];
    case "Attendance":
      // #04 flip EXEMPT→SCOPED nhưng QUÊN map prefix → rơi vào fallback `isHoLevel ? ALL`,
      // tức bất kỳ ai có 1 role HO đều thấy điểm danh toàn hệ thống bất kể chức năng.
      // Điểm danh là dữ liệu đào tạo: bám attendance:/classes: giống ClassSession.
      return ["attendance:", "classes:"];
    case "LeadTrialHistory":
      // Dữ liệu LEAD (lịch sử học thử của lead) — KHÔNG phải dữ liệu đào tạo. Thiếu map
      // → fallback ALL → Đào tạo/HO nhìn thấy lead cơ sở khác. Bám đúng `leads:`.
      return ["leads:"];
    case "LeadStatusHistory":
      // Cùng lý do: sổ đổi trạng thái là dữ liệu lead. Thiếu map thì báo cáo tỷ lệ
      // chuyển đổi rò số liệu lead cơ sở khác cho bất kỳ ai có một vai Hội sở.
      return ["leads:"];
    case "TrialReschedule":
      // Nhật ký dời lịch ca trải nghiệm — dữ liệu học thử, bám `trials:` (và `leads:`
      // vì nó gắn với khách của Sale). Thiếu map là rơi về fallback ALL.
      return ["trials:", "leads:"];
    case "ClassSession":
      // Buổi học gắn lớp → map cả action sessions: lẫn classes: (ai quản lý lớp ở cơ sở
      // nào thì thấy buổi cơ sở đó). GV có classes:view-own/sessions:view → scope cơ sở mình.
      return ["sessions:", "classes:"];
    case "TrialClass":
    case "TrialClassV2":
    case "MakeupNeed":
      return ["trials:", "completions:", "classes:", "makeup:"];
    // Học bù đời mới (29/09/2026): tầm nhìn theo quyền makeup:* (Sale, QLCS, quản lý lớp).
    case "MakeupCase":
    case "MakeupCaseStudent":
      return ["makeup:", "classes:"];
    case "Room":
      return ["rooms:", "centers:"];
    case "Holiday":
      return ["holidays:", "centers:"];
    case "InventoryAudit":
    case "StockBalance":
    case "StockMovement":
      return ["inventory:"];
    case "Employee":
      return ["employees:"];
    case "EmployeeCheckin":
    case "ShiftRegistration":
    case "TimesheetAdjustmentRequest":
      return ["hr_attendance:"];
    case "CenterDayChecklist":
      return ["centers:", "hr_attendance:"];
    // Module chấm công v3 (L1 · 06/09/2026) — kế hoạch §3.5. Prefix là FULL KEY (so bằng
    // `startsWith`, nên "hr_attendance:" trần sẽ kéo cả `checkin` — key mà MỌI vai nhân sự
    // có GLOBAL — vào và biến ai cũng thành HO-level với bảng công). Cố ý KHÔNG có `checkin`.
    case "ShiftTemplate":
      return ["hr_attendance:config", "hr_attendance:assign", "hr_attendance:view"];
    case "WorkLocation":
      return ["hr_attendance:config", "hr_attendance:view", "centers:"];
    case "ShiftWeeklyPattern":
    case "ShiftAssignment":
    case "StaffTimeLog":
    case "StaffAttendanceDay":
    case "AttendancePeriod":
    case "ShiftBriefNote":
    case "CompTimeLedger":
      return [
        "hr_attendance:view",
        "hr_attendance:assign",
        "hr_attendance:approve",
        "hr_attendance:close-period",
        "hr_attendance:export",
      ];
    // 09/10/2026 — hoa hồng theo nguồn · PR4. Một nhóm prefix cho cả bốn bảng chính sách (02 §11.1).
    case "RegulationDocument":
    case "CommissionPolicy":
    case "CommissionPolicyVersion":
    case "CommissionRule":
      return ["commission_policies:"];
    // sổ hoa hồng · PR5a (02 §11.1).
    case "StudentTransaction":
    case "CommissionCalcSlot":
    case "CommissionTransaction":
    case "CommissionHold":
      return ["commission:", "commission_periods:"];
    case "CommissionPeriod":
      return ["commission_periods:", "commission:"];
    // khiếu nại (02 §11.1): người duyệt có `commission_disputes:review` mà có thể không có `commission:*`.
    case "CommissionDispute":
      return ["commission_disputes:", "commission:"];
    case "Notification":
      return ["notifications:"];
    case "SataCoinTransaction":
      return ["satacoin:"];
    case "Survey":
    case "SurveyResponse":
      return ["parent-feedback:", "khao-sat:"];
    // EL-03 — đào tạo nội bộ. Thiếu nhánh này thì `getModelPrefixes` trả mảng rỗng
    // và tầm nhìn rơi về `isHoLevel` DIỆN RỘNG: bất kỳ ai có MỘT vai neo tại Hội sở —
    // kể cả vai chẳng liên quan đào tạo — sẽ đọc được chương trình và kết quả đánh giá của
    // MỌI cơ sở. Đúng lỗi #04 đã mắc với `Attendance` và đã có test riêng chặn.
    case "TrnTrainingNeed":
    case "TrnProgram":
    case "TrnCourse":
    case "TrnRequirement":
    case "TrnEvaluationResult":
    case "TrnEquivalence":
    case "TrnAssignment":
    case "TrnEnrollment":
    case "TrnDataSubjectRequest":
    case "TrnWatchFlag":
    case "TrnQuestion":
    case "TrnExam":
    case "TrnExamAttempt":
    case "TrnRubric":
    case "TrnSubmission":
      return ["elearning:"];
    // MEDIA-REVIEW (26/08) — ảnh buổi học + kết luận duyệt. Thiếu nhánh này thì
    // `getModelPrefixes` trả rỗng và tầm nhìn rơi về `isHoLevel` DIỆN RỘNG: bất kỳ ai
    // có MỘT vai neo tại Hội sở — kể cả vai chẳng liên quan — đọc được ảnh học viên của
    // MỌI cơ sở. Đây là ảnh trẻ em, không phải số liệu.
    case "MediaAsset":
    case "SessionMediaReview":
      return ["media:"];
    // 27/08 — phân công người hưởng hoa hồng theo cơ sở. Thiếu nhánh này thì
    // `getModelPrefixes` trả rỗng và tầm nhìn rơi về `isHoLevel` DIỆN RỘNG: bất kỳ ai
    // có MỘT vai neo tại Hội sở — kể cả vai chẳng liên quan tiền — đọc được ai đang ăn
    // hoa hồng ở MỌI cơ sở. Đúng lỗi đã mắc với `Attendance` (#04) và đã có test chặn.
    // Bám `payments:` (đây là dữ liệu tiền) + `centers:` (đơn vị đo là cơ sở).
    case "CenterCommissionAssignee":
      return ["payments:", "centers:"];
    default:
      return [];
  }
}

// =============================================================================
// 28/09/2026 — GÓC NHÌN GIẢNG DẠY (chỉ site giáo viên).
//
// Sự cố prod: giáo viên Hội sở được "gán cơ sở" (vai neo tại CS1) nhưng dạy một lớp ở
// CS2. Đường LƯU điểm danh đi db trần nên lưu được, còn mọi màn ĐỌC của site GV đi
// scopedDb ⇒ lớp CS2 biến khỏi trang chủ/lịch, màn điểm danh mãi báo "chưa điểm danh".
//
// Luật: trên site GV, cơ sở của lớp mình ĐƯỢC PHÂN DẠY (Class.teacherId/assistantId)
// tính là cơ sở mình — nhưng CHỈ cho dữ liệu đào tạo dưới đây. Lead/Order/tiền… KHÔNG nới.
// Màn admin dùng scopedDb(actor) thường nên KHÔNG đổi: người vừa quản lý CS1 vừa dạy CS2
// không vì thế mà thấy danh sách học viên CS2 ở admin.
// =============================================================================
export const GIANG_DAY_MODELS = new Set<string>([
  "Class",
  "ClassSession",
  "Attendance",
  "Enrollment",
  "ReportCard",
  "Student",
]);

/** Bản sao actor bật góc nhìn giảng dạy — CHỈ dùng trong app/(teacher)/** (lưới [GD-CS-W]). */
export function actorGiangDay(actor: Actor): Actor {
  return { ...actor, phamViGiangDay: true };
}

/** Trả về danh sách centerId được phép hoặc "ALL" cho model cụ thể của actor. */
export function getModelVisibleCenterIds(model: string, actor: Actor): "ALL" | string[] {
  const base = getModelVisibleCenterIdsGoc(model, actor);
  if (base === "ALL" || !actor.phamViGiangDay || !GIANG_DAY_MODELS.has(model)) return base;
  const them = actor.teachingCenterIds ?? [];
  return them.length === 0 ? base : [...new Set([...base, ...them])];
}

function getModelVisibleCenterIdsGoc(model: string, actor: Actor): "ALL" | string[] {
  if (actor.isSuperAdmin) return "ALL";

  const prefixes = getModelPrefixes(model);
  if (prefixes.length === 0) {
    // Nếu model không được map prefix, fallback về cách xử lý cũ: HO-level xem tất cả, center-level theo visibleCenterIds.
    return actor.isHoLevel ? "ALL" : actor.visibleCenterIds;
  }

  const allowedCenters = new Set<string>();
  let hasAll = false;
  let hasAnyPermissionForModel = false;

  for (const p of actor.permissions) {
    if (prefixes.some((prefix) => p.action.startsWith(prefix))) {
      hasAnyPermissionForModel = true;
      if (p.centerScope === "ALL") {
        hasAll = true;
        break;
      } else if (Array.isArray(p.centerScope)) {
        p.centerScope.forEach((c) => allowedCenters.add(c));
      }
    }
  }

  // Check grantsAllow (per-user overrides)
  for (const action of actor.grantsAllow) {
    if (prefixes.some((prefix) => action.startsWith(prefix))) {
      hasAnyPermissionForModel = true;
      hasAll = true; // per-user grants are global exceptions
      break;
    }
  }

  if (hasAll) return "ALL";
  if (!hasAnyPermissionForModel) {
    // scopedDb là cổng CÁCH LY CƠ SỞ (data isolation), KHÔNG phải cổng phân quyền
    // action — việc cho/cấm action do can() lo. Thiếu action model-specific KHÔNG đồng
    // nghĩa "không thấy gì"; vẫn lọc theo tầm nhìn cơ sở từ cây OrgUnit:
    // HO/ROOT → cross-center (ALL); center-level → visibleCenterIds.
    return actor.isHoLevel ? "ALL" : actor.visibleCenterIds;
  }
  return Array.from(allowedCenters);
}

/** Inject filter centerId vào args (THUẦN — test được). Không scope → trả nguyên args. */
export function injectScope<A>(model: string, args: A, actor: Actor): A {
  if (!SCOPED_MODELS.has(model) || bypassesScope(actor)) return args;

  const visibleCenters = getModelVisibleCenterIds(model, actor);
  if (visibleCenters === "ALL") return args;

  const a = (args ?? {}) as { where?: unknown };
  // #03 Pha B — với NULL_IS_GLOBAL_MODELS, `centerId = NULL` nghĩa là "toàn hệ thống",
  // KHÔNG phải "chưa gán". Inject `centerId IN (...)` trần sẽ ẩn nhầm bản ghi chung
  // (khảo sát chung, vòng đánh giá SYSTEM/TEACHER_EVAL) → dùng OR-null.
  const scopeWhere = NULL_IS_GLOBAL_MODELS.has(model)
    ? { OR: [{ centerId: null }, { centerId: { in: visibleCenters } }] }
    : { centerId: { in: visibleCenters } };
  return { ...a, where: a.where ? { AND: [a.where, scopeWhere] } : scopeWhere } as A;
}

/** Record đọc được (findUnique) có nằm trong scope của actor không (chống IDOR). */
export function passesScope(
  model: string,
  record: { centerId?: string | null } | null | undefined,
  actor: Actor,
): boolean {
  if (!record) return false;
  if (!SCOPED_MODELS.has(model) || bypassesScope(actor)) return true;

  const visibleCenters = getModelVisibleCenterIds(model, actor);
  if (visibleCenters === "ALL") return true;

  // Bản ghi "toàn hệ thống" (centerId null hợp lệ) → ai cũng đọc được. Với model thường,
  // centerId null = dữ liệu hỏng/chưa backfill → CHẶN (an toàn), giữ nguyên hành vi cũ.
  if (record.centerId == null) return NULL_IS_GLOBAL_MODELS.has(model);

  return visibleCenters.includes(record.centerId);
}

type FindUniqueArgs = { select?: Record<string, unknown> | null } | undefined;
type FindUniqueQuery = (args: unknown) => Promise<unknown>;

/**
 * findUnique + lọc hậu kỳ passesScope, CHỊU ĐƯỢC select hẹp.
 *
 * Bug gốc (có từ A0-04, quét 10/07 ra 28 call-site dính): passesScope đọc
 * `record.centerId`, nhưng nếu caller `select` không xin centerId thì field là
 * undefined → actor cấp cơ sở bị trả null OAN trên chính record của cơ sở mình
 * (chuyển lớp, hoàn thành khoá, in phiếu thu, tin nhắn...). SUPER_ADMIN/HO không
 * dính (bypass/ALL) nên bug ẩn tới khi có user cấp cơ sở thật.
 *
 * Fix: model SCOPED + có select thiếu centerId → merge `centerId: true` vào query,
 * check scope xong STRIP để trả đúng shape caller xin. `include` không cần merge
 * (mọi scalar top-level đã trả về).
 */
async function findUniqueScoped(
  model: string,
  args: unknown,
  query: FindUniqueQuery,
  actor: Actor,
): Promise<unknown> {
  const a = args as FindUniqueArgs;
  const needsMerge =
    SCOPED_MODELS.has(model) && !!a?.select && !("centerId" in a.select);
  const r = await query(
    needsMerge ? { ...a, select: { ...a!.select, centerId: true } } : args,
  );
  if (!passesScope(model, r as { centerId?: string | null } | null, actor)) return null;
  if (needsMerge && r && typeof r === "object") {
    const { centerId: _stripped, ...rest } = r as Record<string, unknown>;
    return rest;
  }
  return r;
}

/**
 * Prisma Client mở rộng đã cách ly theo `actor`. Đọc + count/aggregate/groupBy bị scope;
 * findUnique lọc hậu kỳ (IDOR → null). bypass=true (job hạ tầng) → db trần + ghi audit.
 */
export function scopedDb(actor: Actor, opts?: { bypass?: boolean }) {
  const bypass = opts?.bypass ?? false;
  // Chỉ lo SCOPE (cách ly cơ sở). Soft-delete đã được base `db` xử lý cho mọi model
  // SOFT_DELETE_MODELS (kể cả qua $extends này), nên KHÔNG lặp lại ở đây.
  return db.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          return query(bypass ? args : injectScope(model, args, actor));
        },
        async findFirst({ model, args, query }) {
          return query(bypass ? args : injectScope(model, args, actor));
        },
        async count({ model, args, query }) {
          return query(bypass ? args : injectScope(model, args, actor));
        },
        async aggregate({ model, args, query }) {
          return query(bypass ? args : injectScope(model, args, actor));
        },
        async groupBy({ model, args, query }) {
          return query(bypass ? args : injectScope(model, args, actor));
        },
        async findUnique({ model, args, query }) {
          // Soft-delete null-filter do base `db` lo; ở đây chỉ chống IDOR theo scope.
          if (bypass) return query(args);
          return findUniqueScoped(model, args, query as FindUniqueQuery, actor);
        },
        async findFirstOrThrow({ model, args, query }) {
          return query(bypass ? args : injectScope(model, args, actor));
        },
      },
    },
  });
}

// =============================================================================
// R7-08 — Makeup cross-center EXCEPTION (QĐ-O2).
// Luồng học bù LIÊN CƠ SỞ cần đọc CHÉO cơ sở (lớp/buổi/nhu cầu bù ở CS khác) để
// gợi ý + xếp bù. Exception này HẸP: chỉ nới scope cho whitelist model dưới đây,
// MỌI model khác (Lead/Order/Student/Payment...) VẪN bị cách ly nguyên vẹn (AC6).
// CHỈ dùng bên trong lib/makeup/service.ts + roster "Học bù" của trang điểm danh.
// =============================================================================

/** Model được ĐỌC CHÉO cơ sở trong luồng makeup. KHÔNG gồm Lead/Order/Student. */
export const MAKEUP_EXCEPTION_MODELS = new Set<string>([
  "Class", // lớp đích ở cơ sở khác (scoped → cần nới để xếp bù chéo)
  "ClassSession", // buổi ứng viên — FL3-02 đã SCOPED, exception nới để xếp bù chéo cơ sở
  "Lesson", // bài giảng (không scoped)
  "MakeupNeed", // nhu cầu bù: GV cơ sở đích đọc HS bù theo makeupSessionId
]);

/** Model `model` có được miễn cách ly trong luồng makeup không? (THUẦN — test). */
export function isMakeupExceptionModel(model: string): boolean {
  return MAKEUP_EXCEPTION_MODELS.has(model);
}

/**
 * scopedDb biến thể cho luồng học bù liên cơ sở: model ∈ MAKEUP_EXCEPTION_MODELS
 * → đọc chéo cơ sở; model khác → scope y như scopedDb(actor) (cách ly nguyên vẹn).
 * Exception là FUNCTION-SCOPED: chỉ client trả về ở đây mới nới — không rò sang
 * scopedDb thường hay query khác (AC6).
 */
export function withMakeupException(actor: Actor) {
  const bypass = bypassesScope(actor); // SUPER_ADMIN/HO vốn cross-center
  const inject = <A>(model: string, args: A): A =>
    bypass || MAKEUP_EXCEPTION_MODELS.has(model) ? args : injectScope(model, args, actor);
  return db.$extends({
    query: {
      $allModels: {
        async findMany({ model, args, query }) {
          return query(inject(model, args));
        },
        async findFirst({ model, args, query }) {
          return query(inject(model, args));
        },
        async count({ model, args, query }) {
          return query(inject(model, args));
        },
        async aggregate({ model, args, query }) {
          return query(inject(model, args));
        },
        async groupBy({ model, args, query }) {
          return query(inject(model, args));
        },
        async findUnique({ model, args, query }) {
          if (bypass || MAKEUP_EXCEPTION_MODELS.has(model)) return query(args);
          return findUniqueScoped(model, args, query as FindUniqueQuery, actor);
        },
        async findFirstOrThrow({ model, args, query }) {
          return query(inject(model, args));
        },
      },
    },
  });
}

/** Ghi AuditLog mỗi lần bypass scope (AC10). Gọi khi dùng scopedDb(actor,{bypass:true}). */
export async function logScopeBypass(actor: Actor, reason: string): Promise<void> {
  await logRbacAudit({
    entity: "ROLE", // tái dùng bảng RbacAuditLog; entityId = userId, action = mô tả bypass
    entityId: actor.userId,
    action: "UPDATE",
    actorId: actor.userId,
    actorName: "scopedDb-bypass",
    reason: `SCOPE_BYPASS: ${reason}`,
  });
}
