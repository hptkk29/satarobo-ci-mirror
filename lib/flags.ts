// lib/flags.ts — feature flags (env-driven).

/**
 * RBAC v2 (can() đọc quyền động từ DB). Mặc định OFF → fallback matrix tĩnh
 * (permissions.ts). Bật dần: dev → staging → 1 tuần shadow → production.
 */
export function isRbacV2Enabled(): boolean {
  return process.env.RBAC_V2_ENABLED === "true";
}

/**
 * Nền Hệ thống P3 · US-12 — chạy SHADOW cho resolver dataScope đo bằng `orgUnitId`.
 *
 * Bật KHÔNG đổi hành vi quyền một chút nào: shadow chỉ so và ghi log (`ScopeShadowDiff`).
 * Cái nó đổi là TẢI — thêm vài lượt ghi DB thưa. Mặc định OFF để môi trường nào chưa áp
 * migration P3 cũng không sinh lỗi.
 *
 * Đây KHÔNG phải cờ cutover. Cờ cutover là `ORG_SCOPE_CUTOVER_ENABLED` (US-13) và chỉ
 * được bật sau khi `congCutoverDat()` báo ĐẠT.
 */
export function isScopeShadowEnabled(): boolean {
  return process.env.SCOPE_SHADOW_ENABLED === "true";
}

/**
 * AUTH-SĐT P4 — cờ break-glass khi ZBS/ZNS sự cố hàng loạt: OTP tới SĐT BỎ QUA
 * kênh Zalo, đi thẳng email dự phòng (chỉ user có email đã verify). Bật bằng env
 * `AUTH_ZNS_DEGRADED="true"` + redeploy; mặc định OFF. Phụ huynh không có email
 * sẽ KHÔNG nhận được mã khi cờ bật — cân nhắc trước khi kéo.
 */
export function isZnsDegraded(): boolean {
  return process.env.AUTH_ZNS_DEGRADED === "true";
}

/** A0-05 — login chung satarobo.vn/login + redirect theo role. OFF → giữ login theo host. */
export function isCommonLoginEnabled(): boolean {
  return process.env.COMMON_LOGIN_ENABLED !== "false"; // mặc định ON (hành vi đã triển khai)
}

/**
 * F4 (Q41) — WIRE THẬT của cổng login chung: public host `satarobo.vn/login` SERVE
 * form login (thay vì 308 permanent sang admin/login như hiện tại). Mặc định OFF →
 * giữ nguyên hành vi hiện tại (308) → an toàn merge trong tuần flip / UAT.
 *
 * ⚠️ CHỈ bật env `COMMON_LOGIN_AT_ROOT="true"` SAU khi F2 (`AUTH_COOKIE_DOMAIN`) đã
 * bật — không có SSO cookie xuyên subdomain thì login ở public host xong redirect
 * sang admin/teacher/portal = mất session (cookie host-only). Xem Q41/F4.
 */
export function isCommonLoginAtRootEnabled(): boolean {
  return process.env.COMMON_LOGIN_AT_ROOT === "true";
}

/** A0-07 — dispatcher DomainEvent (cron). OFF → không xử lý (event vẫn tích PENDING). */
export function isDispatcherEnabled(): boolean {
  return process.env.DISPATCHER_ENABLED !== "false"; // mặc định ON
}

/**
 * R7-05/R7-06 — Convert v2 (per-child, guard payment CONFIRMED, multi-student, dedupe).
 * Quyết định R7: v2 là entry point DUY NHẤT → mặc định ON. Đặt
 * `CONVERT_V2_ENABLED=false` chỉ để tắt khẩn cấp (không còn flow gộp lead cũ trên UI).
 */
export function isConvertV2Enabled(): boolean {
  return process.env.CONVERT_V2_ENABLED !== "false"; // mặc định ON
}

/**
 * R7-07 — Session lifecycle v2 ("Hoàn tất buổi": state machine SCHEDULED→COMPLETED +
 * dữ liệu thực tế GV/giờ/phòng + event session.taught). OFF → giữ checklist 9 mục cũ
 * (2-phase, song song). Bật dần như các flag khác.
 */
export function isSessionLifecycleV2Enabled(): boolean {
  return process.env.SESSION_LIFECYCLE_V2 === "true"; // mặc định OFF
}

/**
 * R7-09 — Signed URL R2 cho ảnh lớp (portal + admin render qua presigned GET, TTL ngắn).
 * OFF → dùng fileUrl công khai như cũ. Bật dần để siết quyền truy cập ảnh.
 */
export function isMediaSignedUrlEnabled(): boolean {
  return process.env.MEDIA_SIGNED_URL === "true"; // mặc định OFF
}

/**
 * R7-16 — Đánh giá GV (học viên) + Khảo sát trung tâm (PH) qua form builder Eval*.
 * Gate menu portal/admin + luồng nộp. OFF → ẩn menu, không đụng Survey NPS cũ.
 */
export function isEvalV2Enabled(): boolean {
  return process.env.EVAL_V2_ENABLED === "true"; // mặc định OFF
}

/**
 * R7-11/R7-12 — SCORM (upload/giải nén/publish + player blur/watermark). Gate
 * menu + route admin/scorm + api asset. OFF → ẩn hoàn toàn, không ảnh hưởng hệ khác.
 */
export function isScormEnabled(): boolean {
  return process.env.SCORM_ENABLED === "true"; // mặc định OFF
}

/**
 * Portal v2 — giao diện Cổng phụ huynh mới (merge SataUI). Bật dần, chạy SONG SONG
 * portal hiện tại; OFF → giữ portal cũ. Gỡ portal cũ sau khi v2 ổn (2-phase).
 */
export function isPortalV2Enabled(): boolean {
  return process.env.PORTAL_V2_ENABLED === "true"; // mặc định OFF
}

/**
 * L5 — Site giáo viên riêng `giaovien.satarobo.vn` (ĐẢO Doc 15 §0 theo phiếu BGĐ
 * câu 7, ký 04/07/2026). 2-phase:
 *  - OFF (mặc định): hành vi hiện tại Y NGUYÊN — GV vẫn làm việc trên admin,
 *    layout `app/(teacher)` đá về /dashboard, host giaovien (khi đã wiring
 *    proxy) bounce về admin. KHÔNG đá GV khỏi admin khi site chưa đủ tính năng.
 *  - ON: GV trên host giaovien vào site GV (decideRoute rewrite /teacher/*);
 *    role khác vào giaovien bị đá về khu của họ. Bật sau khi L6 đủ tính năng.
 */
export function isTeacherSiteEnabled(): boolean {
  // 🚀 FLIP 10/07/2026 (Kiệt duyệt sau merge batch 1-4 — site GV 13 route data thật):
  // mặc định ON. Hệ quả: giaovien.satarobo.vn phục vụ site GV; GV THUẦN đăng nhập
  // admin.satarobo.vn bị chuyển sang site GV (GV kiêm nhiệm vẫn ở admin) — xem
  // decideRoute (lib/auth/route-policy.ts). ROLLBACK NHANH: đặt env
  // TEACHER_SITE_ENABLED="false" trên Vercel + redeploy (không cần revert code).
  return process.env.TEACHER_SITE_ENABLED !== "false";
}

/**
 * AUTH-SĐT P5 — công tắc ngắt **đường TỰ ĐỘNG cấp tài khoản phụ huynh theo SĐT**
 * (`ensureParentAccountForOrder`): xác nhận đơn sang CONFIRMED và webhook SePay.
 * Mặc định ON; ngắt bằng env `AUTH_PHONE_PROVISIONING="false"` + redeploy.
 *
 * ⚠️ CỜ NÀY CHỈ CHẮN ĐƯỜNG TỰ ĐỘNG, KHÔNG chắn các form nhân viên tự bấm
 * (`/admin/students` cấp tài khoản, convert lead). Cố ý: sau P5 thì SĐT LÀ khoá
 * đăng nhập của phụ huynh — bắt các form đó "quay về email" là dựng lại đúng cái
 * bế tắc P5 sinh ra để phá, và tạo nhánh code không ai chạy nên không ai test.
 * Doc phase từng hứa "3 luồng quay lại nhánh email cũ"; hứa vậy là sai hướng, đã
 * sửa lại doc theo đúng cái cờ này làm.
 *
 * VÌ SAO CẦN: đường tự động chạy KHÔNG có người duyệt và `.catch()` nuốt lỗi, nên
 * hỏng thì hỏng im lặng và mỗi đơn đẻ một tài khoản. Đúng kịch bản đã xảy ra trên
 * prod từ 31/07: `provision.ts` (batch E4) lên trước P5, tạo tài khoản khoá SĐT
 * trong khi `/kich-hoat` còn đòi email ⇒ tài khoản không kích hoạt được, mà SĐT
 * thì đã bị chiếm chỗ (`User.phone @unique`).
 */
export function isAuthPhoneProvisioningEnabled(): boolean {
  return process.env.AUTH_PHONE_PROVISIONING !== "false";
}

/**
 * 03/08 — CỜ CUTOVER SỔ THU MỚI (`PaymentRequest` ← `PaymentAllocation` ←
 * `BankTransaction`). Mặc định **TẮT**.
 *
 * Sổ mới đang chạy SONG SONG với sổ cũ (`Payment` Ledger-A + `OrderInstallment`
 * Ledger-B): tiền về qua payOS ghi CẢ HAI bên — sổ mới (`PaymentAllocation`) và một
 * dòng `Payment` marker `[auto:payos:<txn>]` cho sổ cũ — vì **công nợ hiển thị vẫn
 * lấy từ sổ cũ** cho tới khi lật cờ này.
 * Cờ này là chỗ lật nguồn đọc sang sổ mới — và chỉ được lật khi
 * `scripts/shadow-compare-debt.ts` báo **0 đơn lệch**. Quy trình:
 *   1. `pnpm payments:backfill --apply`      → dựng phiếu thu cho đơn cũ
 *   2. `pnpm payments:shadow-compare`        → còn lệch thì xử lý theo cột lý do
 *   3. sạch → set env `PAYMENT_LEDGER_V2="true"` + redeploy
 * Rollback = xoá env (hoặc set khác `"true"`) + redeploy; sổ cũ chưa bị gỡ nên
 * không mất dữ liệu.
 *
 * ⚠️ Cờ mới khai — CHƯA nối vào màn nào. Bật lúc này KHÔNG đổi hành vi. Đây là chủ ý
 * (khai cờ trước, nối sau) để đường lùi tồn tại trong code từ đầu, không phải chỉ
 * trên giấy — đúng bài học của `AUTH_PHONE_PROVISIONING`.
 */
export function isPaymentLedgerV2Enabled(): boolean {
  return process.env.PAYMENT_LEDGER_V2 === "true"; // mặc định OFF
}

/**
 * ⛔ CÔNG TẮC thu học phí linh hoạt KHÔNG ở đây — nó ở DB.
 *
 * Sáng 16/09/2026 tôi khai `PAYMENT_PER_CHILD_ENABLED` ở file này. Chiều cùng ngày chủ dự án
 * chốt: *"nên để bật cho toàn hệ thống đồng loạt, nhưng sẽ có công tắc riêng cho từng cs"* — và
 * `SystemSetting` + `CenterSetting` làm đúng được việc đó, còn env thì không (env không có
 * chiều cơ sở, và bật nó phải qua dev + redeploy).
 *
 * Nên cờ env đã GỠ, và chỗ duy nhất đọc công tắc là `laThuTienLinhHoatBat()` ở
 * `lib/finance/feature.ts` (khoá `billing.flexV1Enabled`). Có lưới `[FEAT-03]` đếm số chỗ đọc
 * khoá đó ngoài file ấy = 0.
 *
 * ⚠️ ĐỪNG khai lại cờ ở đây "cho nhanh". Hai công tắc là hai nơi quyết định nghĩa của "bật", và
 * tắt một cái sẽ tắt được 9 chỗ trong 10 — đúng hình dạng sự cố `PAYMENT_LEDGER_V2`.
 */

/**
 * 20/08/2026 — TẮT tính năng NHÓM LỚP theo yêu cầu chủ dự án ("ẩn nhóm lớp,
 * disable tính năng nhóm lớp ở sidebar luôn").
 *
 * Mặc định **OFF** — ngược chiều mọi cờ khác trong file này, vì đây là cờ GỠ chứ
 * không phải cờ mở: hành vi mong muốn là ẩn, còn env chỉ để bật lại nếu cần.
 *
 * Cờ này che: mục sidebar "Nhóm lớp", ô "Nhóm lớp cố định" trong form lớp, và
 * mọi route `/admin/class-groups/*` (layout tự đá về /admin/classes).
 *
 * KHÔNG đụng schema: `Class.classGroupId` và bảng `ClassGroup` giữ nguyên dữ liệu.
 * Lớp nào đang gắn nhóm vẫn gắn — chỉ là không ai sửa được qua giao diện nữa.
 * Bật lại: đặt env `CLASS_GROUP_ENABLED="true"` + redeploy, không cần revert code.
 */
export function isClassGroupEnabled(): boolean {
  return process.env.CLASS_GROUP_ENABLED === "true"; // mặc định OFF (đã gỡ)
}

/**
 * 20/08/2026 — TẮT tính năng CHECKLIST CƠ SỞ (mở/đóng cơ sở hằng ngày) theo yêu
 * cầu chủ dự án ("ẩn checklist cơ sở, disable chức năng này, xoá luôn ở dashboard").
 *
 * Mặc định **OFF** (cờ GỠ — xem `isClassGroupEnabled`). Che: route
 * `/admin/cham-cong/checklist-co-so/*`, lối vào từ trang Chấm công, và nhóm việc
 * "Checklist cơ sở hôm qua" trên dashboard quản lý (`lib/pending-tasks.ts`).
 *
 * KHÔNG đụng schema: bảng `CenterDayChecklist` và dữ liệu đã ghi giữ nguyên.
 * Bật lại: env `CENTER_CHECKLIST_ENABLED="true"` + redeploy.
 */
export function isCenterChecklistEnabled(): boolean {
  return process.env.CENTER_CHECKLIST_ENABLED === "true"; // mặc định OFF (đã gỡ)
}

/**
 * G-D (21/08/2026) — KHOÁ endpoint nhận phiếu nhập khách (`/api/public/lead-intake/sale-form`).
 *
 * VÌ SAO CẦN: `isInfraPath` cho `/api/*` đi thẳng ở MỌI host, nên bất kỳ ai trên
 * Internet cũng `curl` được vào endpoint này và **tạo Lead thật**. Phòng thủ hiện
 * có (honeypot, giới hạn theo IP, trần dung lượng) chỉ chống **spam**, không chống
 * **truy cập trái phép** — trái CLAUDE.md #5 ("API route VẪN phải auth() + assertCan").
 *
 * ⚠️ **22/08/2026 ĐẢO CHIỀU MẶC ĐỊNH: OFF → ON.** Trước đây phải OFF vì biểu mẫu
 * tĩnh `sale.satarobo.vn/nhap-lieu.html` gửi bài **ẩn danh** hằng ngày — bật là
 * cắt đường nhập liệu của marketing. Nay biểu mẫu đó đã NGHỈ (xoá khỏi
 * `public/sale/`, host cũ đá 307 sang `satarobo.vn/nhap-khach-hang` có đăng
 * nhập), nên không còn ai gửi ẩn danh nữa: để OFF chỉ còn là giữ một cửa mở cho
 * người ngoài `curl` vào tạo Lead thật.
 *
 * Khuôn `!== "false"` (mặc định BẬT) — cố ý ngược khuôn `=== "true"` của các cờ
 * mở tính năng: cờ này là CỔNG KHOÁ, quên đặt env phải là khoá chứ không phải mở.
 *
 * Rollback (mở lại cửa ẩn danh): đặt env `LEAD_INTAKE_REQUIRE_AUTH="false"` +
 * redeploy — KHÔNG revert code. Chỉ làm khi phải dựng lại biểu mẫu công khai.
 */
export function isLeadIntakeAuthRequired(): boolean {
  return process.env.LEAD_INTAKE_REQUIRE_AUTH !== "false"; // mặc định ON
}

/**
 * Đợt E (22/08/2026) — chính sách CHIA SẺ LEAD trong cơ sở (`Lead.isSharedWithTeam`).
 *
 * Chủ dự án chốt Q8 (21/08): **lead độc quyền tuyệt đối**, bỏ tính năng dùng chung.
 *
 * ⚠️ Đây là ĐẢO quyết định BGĐ câu 10 ký 10/07/2026, và tính năng ĐANG CHẠY PROD.
 * Mặc định **OFF** = chính sách mới có hiệu lực. Gỡ theo 2 pha: ngừng tôn trọng cờ
 * ở tầng đọc + ẩn nút; **GIỮ cột `Lead.isSharedWithTeam` và toàn bộ dữ liệu**.
 *
 * Bật lại = env `LEAD_SHARING_ENABLED="true"` + redeploy. Không revert code, không
 * mất dữ liệu — đây là quyết định CHÍNH SÁCH, mà chính sách thì đổi được.
 */
export function isLeadSharingEnabled(): boolean {
  return process.env.LEAD_SHARING_ENABLED === "true"; // mặc định OFF (đã gỡ)
}

/**
 * EL-07 — khu đào tạo nội bộ `e-learning.satarobo.vn` (route group thứ 6
 * `app/(elearning)/`). Cờ sinh ra ở trạng thái OFF; PR nền là no-op với người dùng.
 *
 * ⚠️ **Cố ý NGƯỢC khuôn `isTeacherSiteEnabled()`** (`lib/flags.ts` phía trên: dùng
 * `!== "false"`, tức mặc định ON). Khuôn đó đúng cho site giáo viên vì nó **đã qua
 * kỳ flip 10/07/2026** và nay là hành vi mặc định của hệ thống. E-learning thì chưa
 * có một dòng giao diện nào — chép nguyên khuôn đó sang sẽ cho cờ **bật sẵn ngay khi
 * merge**, ngược hẳn ý định 2 pha. Vì vậy ở đây dùng `=== "true"`:
 *   - unset · `"1"` · `"TRUE"` · `"yes"`  → false
 *   - đúng chuỗi `"true"`                 → true
 *
 * OFF: host e-learning bounce về khu của người dùng (staff → admin, PARENT → portal),
 * 0 byte HTML e-learning được phục vụ. Rollback = đổi env + redeploy, không revert code.
 */
export function isElearningEnabled(): boolean {
  return process.env.ELEARNING_ENABLED === "true"; // mặc định OFF
}

/**
 * ZALOCRM (đợt tích hợp 06/09/2026) — trục ZaloCRM nhúng: màn `/admin/zalo-crm`
 * (iframe SSO sang `zalo.satarobo.vn`), webhook `/api/webhooks/zalocrm/<org>`, và
 * nút "Nhắn Zalo" trên phiếu lead.
 *
 * **OFF nghĩa là gì, cụ thể** — không phải "chạy nhưng rỗng":
 *  - mục sidebar "Zalo CRM" KHÔNG hiện (layout admin không truyền cờ ⇒ mục bị lọc);
 *  - `/admin/zalo-crm` trả 404 như thể route không tồn tại (`notFound()`);
 *  - `/api/webhooks/zalocrm/<org>` trả 404 — ZaloCRM đẩy tin về thì rơi vào outbox
 *    retry của nó, KHÔNG mất tin, KHÔNG ghi gì vào hộp thư Sata;
 *  - 0 byte iframe được phục vụ, nên không có SSO token nào được ký.
 *
 * **Vì sao `=== "true"` chứ không `!== "false"`** — hai khuôn tồn tại song song
 * trong file này và chúng KHÔNG thay thế nhau được. `!== "false"` (mặc định BẬT)
 * chỉ đúng cho cờ đã qua kỳ flip, tức hành vi mặc định của hệ thống hôm nay đã là
 * BẬT (`isTeacherSiteEnabled` — flip 10/07/2026). ZaloCRM thì ngược lại: máy chủ
 * fork còn chưa dựng xong, secret webhook/SSO còn chưa phát, ánh xạ cơ sở ↔
 * `orgCode` còn rỗng. Chép khuôn `!== "false"` sang đây là cờ **tự bật ngay lúc
 * merge** trên mọi môi trường chưa khai env — ngược hẳn ý định 2 pha. Hệ quả của
 * so-khớp-đúng-bằng: `"1"` · `"TRUE"` · `"True"` · `"yes"` · `" true "` đều là
 * **TẮT**. Đây là cố ý (nhất quán toàn file, khoá bằng `lib/flags.test.ts`):
 * người bật cờ phải gõ chính xác, chứ không phải "gõ gần đúng rồi tưởng đã bật".
 *
 * **Rollback** = đặt env `ZALOCRM_ENABLED="false"` (hoặc xoá biến) + redeploy.
 * KHÔNG revert code, KHÔNG rollback migration: chữ đã nhận nằm ở bảng `Inbox*`
 * nên tắt trục ZaloCRM không mất lịch sử hội thoại.
 *
 * ⚠️ Cờ này là công tắc 2-phase của CẢ tính năng, không phải công tắc VẬN HÀNH.
 * Thứ cần tắt GẤP mà không kịp deploy là `SystemSetting inbox.zaloCaNhanLive`
 * (gửi thật hay mô phỏng): công tắc trong DB tắt được ngay, env thì phải deploy lại.
 */
export function isZalocrmEnabled(): boolean {
  return process.env.ZALOCRM_ENABLED === "true"; // mặc định OFF
}

/**
 * INBOX (S9-B4) — hộp thư đa kênh (`lib/inbox/*`).
 *
 * ⚠️ Màn hộp thư (`app/(sale)/sale/hop-thu`) đã GỠ cùng site Sale 22/09/2026.
 * ĐỘNG CƠ thì còn và đang chạy thật: webhook ZaloCRM nạp tin qua
 * `lib/integrations/zalocrm/nap-su-kien.ts` → `lib/inbox/*`, và báo cáo phản hồi
 * ở `/admin/bao-cao/phan-hoi-hop-thu` đọc từ đó. Cờ này vẫn là đường lùi cho
 * phần động cơ ấy.
 *
 * ⚠️ **Cờ này đã được NHẮC TỚI trước khi tồn tại.** `lib/settings/registry.ts`
 * ghi "cờ 2-phase bật/tắt cả tính năng (`INBOX_ENABLED` trong lib/flags.ts)" từ
 * đợt hộp thư, trong khi `grep INBOX_ENABLED` toàn repo chỉ ra đúng dòng chú
 * thích đó — không một dòng code nào đọc biến này. Đúng vết đã dính với
 * `AUTH_PHONE_PROVISIONING`: đường lùi chỉ tồn tại trên giấy, tới lúc sự cố mới
 * biết là kéo cờ không có tác dụng gì. Hàm này đóng khoảng cách đó.
 *
 * **Trạng thái hôm nay: cờ MỚI KHAI, CHƯA NỐI vào màn nào** — bật hay tắt lúc
 * này đều KHÔNG đổi hành vi. Cố ý (khuôn `isPaymentLedgerV2Enabled`): khai cờ
 * trước, nối sau, để đường lùi nằm trong code từ đầu.
 *
 * OFF (mặc định) sẽ nghĩa là: adapter kênh không được nạp, webhook kênh ngoài
 * không ghi vào `Inbox*`. Dữ liệu đã có giữ nguyên.
 *
 * Dùng `=== "true"` cùng lý do như `isZalocrmEnabled` ngay trên.
 *
 * 🔴 **Lưu ý cho người NỐI cờ này về sau**: trước 22/09/2026 hộp thư còn nấp sau
 * `SALE_SITE_ENABLED` nên cờ này chỉ là tầng khoá thứ hai. Cờ kia đã GỠ cùng site
 * Sale ⇒ từ nay `INBOX_ENABLED` là khoá DUY NHẤT. Nối nó vào đường nạp webhook mà
 * quên khai `INBOX_ENABLED="true"` cho prod là **đóng luôn đường ghi tin đang chạy
 * thật**, không còn tầng nào đỡ.
 */
export function isInboxEnabled(): boolean {
  return process.env.INBOX_ENABLED === "true"; // mặc định OFF
}
