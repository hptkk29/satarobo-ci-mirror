// AUTO-GENERATED (R6-F1) — whitelist file app/(admin|portal) con import @/lib/db tran.
// Muc tieu: whitelist -> chi con exception HOP LE. Moi file migrate sang scopedDb(actor)
// thi XOA entry o day. KHONG them file MOI vao day — code moi phai dung scopedDb (ESLint chan).
// Brackets dung glob char-class de match literal [id], [slug]...
//
// #03 (08/07): dọn 28 entry STALE (file đã migrate) + migrate 5 file jobs/settings
// (JobPosting/Center/User non-scoped → scopedDb pass-through). 58 → 25 entry.
// 25 entry còn lại đều là EXCEPTION HỢP LỆ (không migrate máy móc được):
//   - Loại B cross-center: leads/actions.ts (dedup SĐT toàn hệ thống cố ý).
//   - 2 file học bạ: carve-out câu 20 + $transaction (xem ghi chú tại chỗ).
// 10/07 — #03 Pha B hạ 26 → 18 (center-scope 3 model + NULL_IS_GLOBAL cho Survey),
// rồi 18 → 3 (portal ownership-scope: 15 file sang portalDb — lib/portal/db.ts).
export const DB_IMPORT_ALLOWLIST = [
  // ── Loại B — scope tay + read cross-center CỐ Ý (scopedDb không diễn tả được) ──
  // leads/actions.ts: mọi read Lead đã guard passesScope('Lead',...); NHƯNG createLeadManual
  // + updateLeadFields check trùng SĐT TOÀN HỆ THỐNG (kể cả cơ sở khác) → swap scopedDb sẽ
  // VỠ dedup cross-center. Giữ db trần có chủ đích.
  "app/(admin)/admin/leads/actions.ts",
  // (khao-sat/page.tsx đã rời allowlist 10/07: NULL_IS_GLOBAL_MODELS dạy scopedDb hiểu
  //  "centerId null = khảo sát chung", nên không cần scope tay nữa.)

  // ── PORTAL — 10/07: 15 file đã migrate sang `portalDb` (lib/portal/db.ts, ownership-
  // scope theo Student.parentUserId + childIds, belt-and-suspenders trên guard tay
  // requireActiveStudent/assertOwnsStudent). Không còn file portal nào trong allowlist —
  // code portal MỚI bắt buộc đi portalDb hoặc helper lib/portal/*. ──

  // ── #03 Pha B (10/07) — ReportCard/EvaluationRound/ConversationMessage đã vào
  // SCOPED_MODELS, Survey đã có semantics "null = toàn hệ thống" (NULL_IS_GLOBAL_MODELS).
  // 7 file dưới ĐÃ migrate sang sdb và RỜI khỏi allowlist:
  //   evaluations/page.tsx · evaluations/results/[roundId]/page.tsx · report-cards/page.tsx
  //   report-cards/criteria/page.tsx · tin-nhan/page.tsx · tin-nhan/_actions.ts
  //   khao-sat/page.tsx (bỏ luôn scope tay "null OR visible")
  // Còn 2 file GIỮ db trần, có lý do: ──

  // ⚠️ Carve-out câu 20 (#04): HV chuyển cơ sở → QL cơ sở TIẾP NHẬN được XEM học bạ cũ.
  // ReportCard.centerId = cơ sở CŨ, nên sdb.reportCard.findUnique sẽ trả null và giết
  // carve-out TRONG IM LẶNG. Cách ly ở đây do checkEnrollmentScope(receivingCenterId) lo.
  // Cùng lý do với db.classSession.count (lớp thuộc cơ sở cũ).
  "app/(admin)/admin/report-cards/[[]enrollmentId[]]/page.tsx",

  // Đường GHI học bạ: mọi mutation nằm trong db.$transaction, và tx của client mở rộng
  // không khớp kiểu Prisma.TransactionClient mà các helper lib/lms/* nhận. Cách ly đã ép
  // TAY bằng checkEnrollmentScope (KHÔNG truyền receivingCenterId ⇒ EDIT vẫn cách ly).
  // Migrate khi helper lib/lms nhận được tx của extended client.
  "app/(admin)/admin/report-cards/_actions.ts",
];
