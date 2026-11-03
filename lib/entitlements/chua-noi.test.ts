// lib/entitlements/chua-noi.test.ts — NỀN QUYỀN HỌC CHƯA ĐƯỢC NỐI VÀO LUỒNG NÀO. Lưới ghim lời hứa của PR nền.
//
// Lời hứa: "chưa có caller production". Lời hứa mà không ai canh thì sống tới lần import tiện tay đầu tiên
// — và khi đó cờ TẮT là thứ duy nhất che đường cũ, trong khi mã mới đã nằm trên đường chạy thật.
//
// ⚠️ Lưới này CỐ Ý đỏ khi ai đó nối đường đầu tiên. Đó là chủ đích: nối là một hành động có ý thức,
// kèm bộ R7 và quyết định về migration — người nối sửa DANH SÁCH CHO PHÉP dưới đây trong cùng PR và nói
// rõ trong mô tả PR vì sao đường đó an toàn khi cờ TẮT.
//
// ── DANH SÁCH CHO PHÉP CHIA THEO KHU VỰC (PR khung X0) ─────────────────────────────────────────────────
// Trước đây là MỘT dòng `DUOC_PHEP = []`. PR nối đầu tiên sửa đúng dòng đó, mọi PR nối sau xung đột chắc chắn
// (sáu khu vực cùng nối song song). Nay mỗi khu vực có KHỐI RIÊNG, các khối cách nhau ≥ 3 dòng chú thích:
// git gộp được hai PR sửa hai khối khác nhau mà không xung đột.
//
// Mỗi tệp được phép KÈM BA THỨ BẮT BUỘC ([CHN-04]/[CHN-05]):
//   · `lyDo`     — vì sao tệp này PHẢI import nền;
//   · `khiCoTat` — điều gì xảy ra khi `billing.scopePurchaseEnabled` TẮT (đường cũ chạy nguyên ở chỗ nào);
//   · `congCo`   — nơi hỏi cờ: "GOI" (chính tệp gọi `chanNeuPhamViTat`/`laThuHocPhiTheoPhamViBat`/
//                  `apDungMoHinhPhamVi`) hoặc `{ nhanTu }` (tệp giao diện không gọi được hàm `server-only`
//                  nên NHẬN quyết định từ một tệp "GOI" đã nêu tên).
// Khu vực nào, tệp nào thuộc ai: docs/thu-hoc-phi-pham-vi/BANG-DIEU-PHOI.md.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Mô-đun của nền. Import chúng từ NGOÀI hai thư mục này (và test) là đã nối. */
const MODULE_NEN = /@\/lib\/(entitlements|pricing)\/|\.\.?\/(entitlements|pricing)\//;

/** Sáu khu vực nối (BANG-DIEU-PHOI.md). Thêm khu vực mới = thêm vào đây VÀ thêm một khối bên dưới. */
const KHU_VUC = ["tao-don", "tien-vao", "xep-lop", "portal-gv", "vong-doi", "hoan-tien"] as const;
type KhuVuc = (typeof KHU_VUC)[number];

type CongCo = "GOI" | { readonly nhanTu: string };

interface TepDuocPhep {
  /** Đường dẫn từ gốc repo, dấu `/`. */
  readonly tep: string;
  readonly lyDo: string;
  readonly khiCoTat: string;
  readonly congCo: CongCo;
}

type KhoiDuocPhep = Readonly<Record<KhuVuc, readonly TepDuocPhep[]>>;

/**
 * Các tệp NGOÀI lib/entitlements, lib/pricing được phép import mô-đun nền, theo khu vực. Rỗng = chưa nối.
 *
 * ⚠️ Thêm tệp vào ĐÚNG khối của khu vực mình, mỗi tệp một đối tượng đủ ba trường. Đừng gom khối lại cho
 * "gọn": khoảng trống giữa các khối là thứ giữ cho hai PR song song không xung đột ([CHN-06] canh).
 */
const DUOC_PHEP_THEO_KHU: KhoiDuocPhep = {
  // ═══ KHU VỰC 1 — TẠO ĐƠN / GIÁ ═══════════════════════════════════════════════════════════════════
  "tao-don": [
    {
      tep: "app/(admin)/admin/orders/_actions.ts",
      lyDo:
        "createOrderManualAction mở cổng SCOPE sớm: một lời gọi apDungMoHinhPhamVi trước khi tính tiền; logic ở lib/orders/pham-vi. " +
        "Cùng tệp có bốn action gắn/bỏ gắn/tách/chuyển tiền theo con, mỗi action thêm MỘT lời gọi hichCapQuyenHocChoDon sau commit (khu vực tien-vao, NOI-DUONG-TIEN.md).",
      khiCoTat:
        "Cờ tắt: apDungMoHinhPhamVi trả LEGACY sau đúng một lần hỏi cờ, mọi dòng đi đường cũ nguyên văn (payload tx.order.create không đổi). " +
        "Bốn lời hích: xetCapQuyenHocChoDon dừng trước mọi phép ghi (cờ tắt / đơn không dấu SCOPE), vỏ không bao giờ ném — action trả đúng kết quả cũ.",
      congCo: "GOI",
    },
    {
      tep: "lib/orders/pham-vi/ap-dung.ts",
      lyDo: "Nơi DUY NHẤT đọc cờ phạm vi cho đường tạo đơn, rồi giao cho planner thuần; import feature + pricing của nền.",
      khiCoTat: "Cờ tắt (hoặc đơn không gắn cơ sở): trả LEGACY ngay sau lần hỏi cờ, không đọc mốc ngày hay cài đặt giá nào.",
      congCo: "GOI",
    },
    {
      tep: "lib/orders/pham-vi/ke-hoach-don.ts",
      lyDo: "Planner thuần ghép planner một dòng của lib/pricing thành kế hoạch cả đơn (thứ hạng con, chặn đơn trộn).",
      khiCoTat: "Không tự đọc cờ: chỉ được gọi từ ap-dung.ts SAU khi cờ bật; tham số phamViBat=false trả LEGACY ngay.",
      congCo: { nhanTu: "lib/orders/pham-vi/ap-dung.ts" },
    },
    {
      tep: "lib/orders/pham-vi/doc-dong.ts",
      lyDo: "Ghi và đọc dấu phạm vi trên OrderItem.metadata (type PricingSnapshotDong của lib/pricing).",
      khiCoTat: "Cờ tắt: chỉ boPhamViCuaClient chạy (gỡ khoá dự trữ khỏi metadata client); không ghi dấu SCOPE nào.",
      congCo: { nhanTu: "lib/orders/pham-vi/ap-dung.ts" },
    },
  ],



  // ═══ KHU VỰC 2 — TIỀN VỀ / CẤP QUYỀN HỌC ═════════════════════════════════════════════════════════
  "tien-vao": [
    {
      tep: "lib/events/register.ts",
      lyDo: "Đăng ký handler thứ hai cho phieu-gop.da-chia và payment.confirmed: xét cấp quyền học khi tiền về (lib/entitlements/su-kien.ts).",
      khiCoTat:
        "Cờ tắt (hoặc đơn không có dấu SCOPE): xetCapQuyenHocChoDon dừng trước mọi phép ghi, handler không tạo quyền học/AuditLog/DomainEvent và không bao giờ ném.",
      congCo: { nhanTu: "lib/entitlements/cap-tu-don.ts" },
    },
    {
      tep: "lib/payments/payos-ingest.ts",
      lyDo: "allocateToOrder (webhook đời cũ + đối soát tay /bien-dong-so-du) không phát sự kiện nào: tiền vừa rót vào sổ ⇒ một lời gọi hichCapQuyenHocChoDon sau commit, ngoài `if (settled)`.",
      khiCoTat:
        "Cờ tắt hoặc đơn không dấu SCOPE: xetCapQuyenHocChoDon dừng sau 1–3 câu ĐỌC, không ghi gì; vỏ nuốt mọi lỗi nên webhook không bao giờ 500 vì quyền học. Phần rót tiền/chốt đơn/biên nhận không đổi một chữ.",
      congCo: { nhanTu: "lib/entitlements/cap-tu-don.ts" },
    },
    {
      tep: "app/(admin)/admin/bien-dong-so-du/_gan-theo-con.ts",
      lyDo: "Hai action gắn / gỡ giao dịch theo con thay đổi tiền theo dòng đơn mà không phát sự kiện: mỗi action một lời gọi hichCapQuyenHocChoDon SAU commit, ở tầng action (không trong ghiTienChoDon đang giữ khoá đơn).",
      khiCoTat: "Cờ tắt hoặc đơn không dấu SCOPE: không ghi gì, vỏ không ném — kết quả trả về cho người dùng y nguyên.",
      congCo: { nhanTu: "lib/entitlements/cap-tu-don.ts" },
    },
    {
      tep: "lib/crm/convert-lead-v2.ts",
      lyDo:
        "Chốt lead tạo học viên + ghi danh nhưng KHÔNG ghi OrderItem.studentId: sau commit, một lời gọi hichCapQuyenHocChoLead để dòng CHỜ CHUYỂN ĐỔI của khách mới được cấp quyền học (cầu nối con lead) rồi chốt phạm vi bài. " +
        "GATE D (xếp lớp): dòng SCOPE khi cờ BẬT không bị ghi Enrollment.buoiBatDau theo luật cũ 'học các buổi cuối' — phamViDangBatChoCoSo + laDongPhamViChoGhiDanh. " +
        "PR5 (quyết định 3 — quyền học TRƯỚC, ghi danh active SAU): cùng phép khớp (mảng dongTheoQuyenHoc) khiến ghi danh của dòng SCOPE ra đời ở PENDING 'Chờ xếp lớp'; xep-lop-tu-don.ts kích hoạt (PENDING → STUDYING/CONFIRMED) sau khi quyền học chốt phạm vi.",
      khiCoTat:
        "Cờ tắt: hichCapQuyenHocChoLead đọc đơn của lead, không đơn nào có dấu SCOPE ⇒ dừng, không ghi gì; vỏ nuốt lỗi nên chốt lead không bao giờ hỏng vì quyền học. " +
        "GATE D: không dòng nào có dấu SCOPE ⇒ phamViDangBatChoCoSo KHÔNG được gọi (không đọc cờ), buoiBatDau tính nguyên văn như cũ; có dấu mà cờ tắt ⇒ phamViBat=false ⇒ cũng nguyên văn. " +
        "PR5: cùng điều kiện ⇒ dongTheoQuyenHoc toàn false ⇒ KHÔNG truyền status ⇒ ghi danh mặc định ACTIVE nguyên chữ.",
      congCo: { nhanTu: "lib/entitlements/cap-tu-don.ts" },
    },
    {
      tep: "app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts",
      lyDo:
        "chuyenDoiDonAction ghi OrderItem.studentId/enrollmentId cho dòng đơn: sau commit, một lời gọi hichCapQuyenHocChoDon để dòng CHỜ CHUYỂN ĐỔI được cấp quyền học rồi chốt phạm vi bài. " +
        "GATE D: dòng SCOPE nhận phán quyết trung tính từ docDuLieuChuyenDoi (lib/orders/chuyen-doi-don.ts) nên buoiBatDau/soBuoiHocVuot tự về null/0. " +
        "PR5 (quyết định 3 — quyền học TRƯỚC, ghi danh active SAU): cùng cờ DongChuyenDoi.phamVi khiến ghi danh của dòng SCOPE ra đời ở PENDING thay vì STUDYING; xep-lop-tu-don.ts kích hoạt sau khi quyền học chốt phạm vi.",
      khiCoTat:
        "Cờ tắt hoặc đơn thường: không ghi gì, vỏ không ném — kết quả chuyển đổi trả về y nguyên; docDuLieuChuyenDoi trả phán quyết xetXepVaoLop cũ nguyên văn. " +
        "PR5: phamVi=false ⇒ status vẫn STUDYING nguyên chữ, không EnrollmentAuditLog.",
      congCo: { nhanTu: "lib/entitlements/cap-tu-don.ts" },
    },
    {
      tep: "lib/finance/payment.ts",
      lyDo: "Cổng xác nhận tiền TRƯỚC khi có ghi danh (deadlock CHUA_GHI_DANH, chủ dự án 11/10/2026): confirmPayment hỏi choPhepXacNhanTruocGhiDanh NGOÀI tx rồi truyền boolean vào lõi xacNhanKhoanTrongTx.",
      khiCoTat:
        "Cờ tắt / đơn không dấu SCOPE: choPhepXacNhanTruocGhiDanh trả false ⇒ thieuGhiDanhTruocXacNhan = thieuGhiDanh, cổng giữ nguyên chữ (CHUA_GHI_DANH vẫn chặn khoản COURSE chưa gắn ghi danh). Chỉ hỏi cờ khi khoản thật sự thiếu ghi danh.",
      congCo: { nhanTu: "lib/entitlements/xac-nhan-truoc.ts" },
    },
    {
      tep: "app/(admin)/admin/payments/_actions.ts",
      lyDo:
        "Nút ✓ ở màn Thanh toán phải nói đúng như lõi xác nhận (luật 12): donChoXacNhanTruocGhiDanh tính theo lô; thêm một lời hích sau xác nhận và sau điều chỉnh để quyền học được xét ngay.",
      khiCoTat:
        "Cờ tắt / đơn thường: donChoXacNhanTruocGhiDanh trả tập rỗng ⇒ cờ thieuGhiDanh y nguyên bản cũ; hai lời hích dừng trước mọi phép ghi, vỏ không bao giờ ném.",
      congCo: { nhanTu: "lib/entitlements/xac-nhan-truoc.ts" },
    },
    {
      tep: "app/(admin)/admin/quyen-hoc-hang-doi/page.tsx",
      lyDo:
        "Hàng đợi quyền học (PR hàng đợi + cron đối soát): màn cho người có entitlements:manage xử lý các dòng StudyEntitlementXuLy. Đọc qua lib/entitlements/hang-doi/doc-hang-doi.ts (scopedDb); nút vẽ bằng xetHanhDong — cùng hàm mà action dùng (luật 12).",
      khiCoTat:
        "Cờ phạm vi học là cờ THEO CƠ SỞ: cơ sở TẮT cờ vẫn XEM được dòng (lịch sử) nhưng mọi dòng của cơ sở đó có hanhDong = [] (xetHanhDong từ chối khi coBat=false) nên không có nút ghi; không đường nào của màn này đổi hành vi của đường tiền.",
      congCo: { nhanTu: "lib/entitlements/hang-doi/doc-hang-doi.ts" },
    },
    {
      tep: "app/(admin)/admin/quyen-hoc-hang-doi/_actions.ts",
      lyDo:
        "Server Action của hàng đợi quyền học: thử cấp lại · đóng · giữ quyền · duyệt thu hồi · cần duyệt tay. Mỏng — đăng nhập + checkPermission(entitlements:manage) rồi giao lib/entitlements/hang-doi/hanh-dong.ts (khoá đơn, cổng, audit, idempotent).",
      khiCoTat:
        "Cờ TẮT cho cơ sở của dòng: chuanBi đọc cờ NGOÀI transaction rồi xetHanhDong từ chối trước phép ghi đầu tiên — không ghi gì, không gọi xetCapQuyenHocChoDon (thuCapLai dừng ở cổng); đọc hàng đợi không bị ảnh hưởng.",
      congCo: { nhanTu: "lib/entitlements/hang-doi/hanh-dong.ts" },
    },
    {
      tep: "app/(admin)/admin/quyen-hoc-hang-doi/_components/xu-ly-dong.tsx",
      lyDo: "Giao diện chi tiết + nút xử lý một dòng hàng đợi (client component): chỉ vẽ nút theo dong.hanhDong do server tính, không tự suy quyền.",
      khiCoTat: "Không tự đọc cờ: nhận hanhDong từ page.tsx; cờ TẮT ⇒ hanhDong = [] ⇒ không vẽ nút ghi nào.",
      congCo: { nhanTu: "lib/entitlements/hang-doi/doc-hang-doi.ts" },
    },
    {
      tep: "app/api/cron/quyen-hoc-doi-soat/route.ts",
      lyDo:
        "Cron đối soát quyền học (withCron + CRON_SECRET): chạy xetCapQuyenHocChoDon ở chế độ CHI_GHI_NHAN (không bao giờ cấp) cho từng đơn SCOPE của cơ sở BẬT cờ, rồi đối soát lệch. Chỉ tạo/cập nhật dòng hàng đợi và đếm.",
      khiCoTat:
        "Cơ sở TẮT cờ (hoặc chưa ánh xạ OrgUnit) bị BỎ QUA trước khi đọc đơn nào — không đọc, không ghi, chỉ vào báo cáo (boQua = CO_TAT); tất cả cơ sở tắt ⇒ lượt chạy là no-op.",
      congCo: { nhanTu: "lib/entitlements/hang-doi/doi-soat.ts" },
    },
  ],



  // ═══ KHU VỰC 3 — XẾP LỚP / CHUYỂN ĐỔI ĐƠN ════════════════════════════════════════════════════════
  "xep-lop": [
    {
      tep: "lib/orders/chuyen-doi-don.ts",
      lyDo:
        "Nạp dữ liệu màn Chuyển đổi: dòng đơn SCOPE (cờ BẬT) không được in/áp luật cũ 'học các buổi cuối' (xetXepVaoLop) — thay bằng phán quyết trung tính, bài bắt đầu do quyền học chốt sau khi xếp (GATE D, XEP-LOP.md). " +
        "Hai tệp khác của khu vực này đã khai ở khối 'tien-vao' (convert-lead-v2.ts, chuyen-doi/_actions.ts) — [CHN-04e] cấm khai hai lần nên lý do GATE D của chúng nằm trong lyDo/khiCoTat ở đó.",
      khiCoTat:
        "Cờ tắt (hoặc đơn thường không dấu SCOPE): dongPhamViDangBat trả tập rỗng — đơn không dấu thì KHÔNG đọc cờ — nên mọi lớp đi xetXepVaoLop nguyên văn, buoiBatDau và soBuoiHocVuot y hệt bản cũ.",
      congCo: { nhanTu: "lib/entitlements/gate-xep-lop.ts" },
    },
    {
      tep: "lib/enrollments/gan-quyen-hoc-ghi-danh-tay.ts",
      lyDo:
        "Ghi danh TAY (enrollStudent) có gắn quyền học [chủ dự án 21/10/2026]: học viên đang có quyền học AWAITING_PLACEMENT cùng khoá ⇒ nối OrderItem.enrollmentId vào ghi danh vừa tạo (cùng cách bước Chuyển đổi nối), rồi một lời gọi hichCapQuyenHocChoDon sau commit để chốt bài bắt đầu. " +
        "Không dựng đường xếp lớp thứ hai: chốt phạm vi vẫn chỉ do xetXepLopChoDon quyết.",
      khiCoTat:
        "Cờ tắt hoặc học viên không có quyền học chờ xếp: truy vấn quyền học trả rỗng ⇒ KHONG_CO, không ghi gì, ghi danh tay chạy y như cũ; hích là vỏ KHÔNG NÉM và tự dừng khi đơn không có dấu SCOPE / cờ tắt.",
      congCo: { nhanTu: "lib/entitlements/cap-tu-don.ts" },
    },
  ],



  // ═══ KHU VỰC 4 — ĐIỂM DANH / CỔNG PHỤ HUYNH / SITE GIÁO VIÊN ═════════════════════════════════════════
  "portal-gv": [
    {
      tep: "lib/hoc-bu/dong-diem-danh.ts",
      lyDo:
        "Điểm danh lớp tiêu thụ quyền học: dongBoDongSauDiemDanh — MỘT chỗ chung của ba đường lưu điểm danh (admin/attendance, teacher/lop, admin/parent-requests) — gọi dongBoSoCaiNeuBat CUỐI giao dịch, " +
        "và xoaDiemDanhVaDongBoSoCai gom phép xoá điểm danh với việc huỷ dòng sổ cái. Tệp này cũng phát hành docSoCaiDiemDanh cho ba đường ấy đọc cờ NGOÀI giao dịch (ba tệp action không import lib/entitlements).",
      khiCoTat:
        "Cờ tắt (hoặc cơ sở không có OrgUnit — fail-closed): docSoCaiDiemDanh trả null sau đúng MỘT lần tra OrgUnit + một lần đọc cài đặt (có cache); soCai = null ⇒ dongBoSoCaiNeuBat trả ngay, KHÔNG câu truy vấn nào trong giao dịch. " +
        "Nơi xoá điểm danh giữ nguyên sdb.attendance.delete khi soCai = null.",
      congCo: { nhanTu: "lib/entitlements/dong-bo-bai-db.ts" },
    },
    {
      tep: "lib/hoc-bu/case-diem-danh-db.ts",
      lyDo:
        "Điểm danh buổi dạy bù (diemDanhBe / suaDiemDanhBe → ganDiemDanhBeTrongTx): khi một mục học bù chuyển VÀO hoặc RA khỏi COMPLETED thì bằng chứng MAKEUP/CATCH_UP của bài đổi, " +
        "nên cuối giao dịch gọi dongBoSoCaiNeuBat theo buổi LỠ của dòng cần bù; cờ đọc ngoài giao dịch bằng docSoCaiDiemDanh theo cơ sở của dòng cần bù (lớp của bé), không phải nơi dạy case.",
      khiCoTat:
        "Cờ tắt: docSoCaiDiemDanh trả null ⇒ ganDiemDanhBeTrongTx nhận soCai = null ⇒ dongBoSoCaiNeuBat trả ngay, không truy vấn nào; mọi phép ghi case/lượt/dòng cần bù/điểm danh gốc chạy nguyên văn.",
      congCo: { nhanTu: "lib/entitlements/dong-bo-bai-db.ts" },
    },
    {
      tep: "lib/portal/tien-do-pham-vi-db.ts",
      lyDo:
        "Cổng phụ huynh đọc tiến độ THEO PHẠM VI ĐÃ ĐĂNG KÝ (QĐ-16/QĐ-54): đọc cờ theo cơ sở của TỪNG lớp (OrgUnit của cơ sở; không có OrgUnit ⇒ tắt), quyền học của (học viên, khoá) lọc theo cơ sở, " +
        "buổi đã diễn ra + điểm danh + dòng học vượt; learning.ts (getStudentProgressSummaries / getStudentAttendanceSummaries / getStudentSessions) và trang Kết quả gọi qua getStudentPhamVi.",
      khiCoTat:
        "Cờ tắt (hoặc lớp không có cơ sở / cơ sở không có OrgUnit — fail-closed): docPhamViChoCon trả Map RỖNG sau một câu tra lớp + các lần đọc cờ, KHÔNG đọc quyền học / buổi / điểm danh; " +
        "mọi hàm ở tien-do-pham-vi.ts nhận undefined và trả CHÍNH đối tượng cũ, hàng buổi không thêm trường nào. Học viên không có quyền học ACTIVE, hai lớp cùng khoá, buổi chưa ghim giáo trình ⇒ cũng đường cũ.",
      congCo: "GOI",
    },
    {
      tep: "lib/portal/tien-do-pham-vi.ts",
      lyDo:
        "Adapter THUẦN giữa cổng phụ huynh và tienDoTheoPhamVi: quyết 'thay con số cũ hay không' (cổng = có quyền học ACTIVE + mọi buổi xác định được số bài), dựng nhãn buổi từ nhanLyDo — MỘT nguồn chữ 'ngoài phạm vi đăng ký'.",
      khiCoTat: "Không tự đọc cờ: nhận PhamViLop từ tien-do-pham-vi-db.ts. Không có PhamViLop (cờ tắt) ⇒ mọi hàm trả chính đối tượng cũ ([PVP-01]).",
      congCo: { nhanTu: "lib/portal/tien-do-pham-vi-db.ts" },
    },
  ],



  // ═══ KHU VỰC 5a — VÒNG ĐỜI QUYỀN HỌC: HẾT QUYỀN, ÂN HẠN, BẢO LƯU, CHỨNG CHỈ ════════════════════════
  "vong-doi": [
  ],



  // ═══ KHU VỰC 5b — HOÀN TIỀN / DỪNG HỌC / HOÁ ĐƠN ════════════════════════════════════════════════
  "hoan-tien": [
  ],
};

/** Danh sách phẳng cho [CHN-01]. Suy ra từ các khối — không có nguồn thứ hai. */
const lamPhang = (khoi: KhoiDuocPhep): string[] => Object.values(khoi).flatMap((ds) => ds.map((t) => t.tep));
const DUOC_PHEP: readonly string[] = lamPhang(DUOC_PHEP_THEO_KHU);

const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Lời GỌI (không phải dòng import, không phải chú thích) tới một trong ba cổng cờ. */
const LOI_GOI_CONG_CO = /\b(chanNeuPhamViTat|laThuHocPhiTheoPhamViBat|apDungMoHinhPhamVi)\s*\(/;

const DO_DAI_LY_DO_TOI_THIEU = 25;

// ── Hai hàm kiểm THUẦN: nhận dữ liệu qua tham số để ca synthetic ép được chúng đỏ (không tautology) ──────

const laTepNen = (tep: string): boolean => tep.startsWith("lib/entitlements/") || tep.startsWith("lib/pricing/");

/** Mọi vi phạm của cấu trúc danh sách. Rỗng = hợp lệ. */
function kiemKhoi(khoi: KhoiDuocPhep): string[] {
  const loi: string[] = [];
  const tenKhoi = Object.keys(khoi).sort();
  const mongDoi = [...KHU_VUC].sort();
  if (tenKhoi.join("|") !== mongDoi.join("|")) {
    loi.push(`khối khu vực lệch: có [${tenKhoi.join(", ")}], cần [${mongDoi.join(", ")}]`);
  }

  const daThay = new Map<string, string>();
  const tatCa = new Map<string, TepDuocPhep>();
  for (const [kv, ds] of Object.entries(khoi) as [string, readonly TepDuocPhep[]][]) {
    for (const t of ds) {
      const ten = t.tep;
      if (!ten || ten !== ten.trim() || ten.includes("\\") || ten.startsWith("./") || ten.startsWith("/")) {
        loi.push(`[${kv}] đường dẫn không chuẩn hoá: "${ten}"`);
        continue;
      }
      if (ten.startsWith("lib/entitlements/") || ten.startsWith("lib/pricing/") || /\.test\.tsx?$/.test(ten)) {
        loi.push(`[${kv}] ${ten}: tệp trong hai thư mục nền hoặc tệp test không cần được phép`);
      }
      const truoc = daThay.get(ten);
      if (truoc) loi.push(`${ten}: khai hai lần (khối ${truoc} và ${kv})`);
      daThay.set(ten, kv);
      tatCa.set(ten, t);
      if ((t.lyDo ?? "").trim().length < DO_DAI_LY_DO_TOI_THIEU) loi.push(`[${kv}] ${ten}: thiếu lý do (cần ≥ ${DO_DAI_LY_DO_TOI_THIEU} ký tự)`);
      if ((t.khiCoTat ?? "").trim().length < DO_DAI_LY_DO_TOI_THIEU) {
        loi.push(`[${kv}] ${ten}: chưa nói rõ khi cờ TẮT thì đường cũ chạy thế nào (cần ≥ ${DO_DAI_LY_DO_TOI_THIEU} ký tự)`);
      }
    }
  }
  for (const [ten, t] of tatCa) {
    if (t.congCo === "GOI") continue;
    const dich = t.congCo?.nhanTu;
    if (!dich) loi.push(`${ten}: congCo phải là "GOI" hoặc { nhanTu: <tệp> }`);
    else if (dich === ten) loi.push(`${ten}: nhận quyết định cờ từ chính nó`);
    else if (laTepNen(dich)) {
      // Tệp nền KHÔNG nằm trong danh sách (không cần được phép) nên không thể là "GOI" ở đây; hợp lệ khi nó THẬT SỰ gọi cổng cờ —
      // `kiemCong` đọc nội dung và canh điều đó. Tệp test thì không bao giờ là nơi hỏi cờ.
      if (/\.test\.tsx?$/.test(dich)) loi.push(`${ten}: nhanTu "${dich}" là tệp test`);
    } else if (tatCa.get(dich)?.congCo !== "GOI") loi.push(`${ten}: nhanTu "${dich}" không phải một tệp "GOI" đã được phép`);
  }
  return loi;
}

/** Tệp "GOI" phải THẬT SỰ có lời gọi cổng cờ — chứng minh "cờ TẮT ⇒ đường cũ". `null` = tệp không đọc được. */
function kiemCong(khoi: KhoiDuocPhep, docNoiDung: (tep: string) => string | null): string[] {
  const loi: string[] = [];
  for (const ds of Object.values(khoi)) {
    for (const t of ds) {
      if (t.congCo !== "GOI") {
        // `nhanTu` trỏ vào TỆP NỀN (chính nơi gọi cổng): tệp nền đó phải thật sự gọi cổng — nếu không, "nhận quyết định từ nó"
        // là một lời hứa suông.
        const dich = t.congCo.nhanTu;
        if (!dich || !laTepNen(dich)) continue;
        const ndNen = docNoiDung(dich);
        if (ndNen === null) loi.push(`${t.tep}: nhanTu "${dich}" không đọc được tệp`);
        else if (!LOI_GOI_CONG_CO.test(boChuThich(ndNen))) {
          loi.push(`${t.tep}: nhanTu "${dich}" không có lời gọi chanNeuPhamViTat / laThuHocPhiTheoPhamViBat / apDungMoHinhPhamVi`);
        }
        continue;
      }
      const nd = docNoiDung(t.tep);
      if (nd === null) loi.push(`${t.tep}: không đọc được tệp (gõ sai đường dẫn?)`);
      else if (!LOI_GOI_CONG_CO.test(boChuThich(nd))) {
        loi.push(`${t.tep}: khai "GOI" nhưng không có lời gọi chanNeuPhamViTat / laThuHocPhiTheoPhamViBat / apDungMoHinhPhamVi`);
      }
    }
  }
  return loi;
}

const docThat = (tep: string): string | null => {
  try {
    return readFileSync(resolve(process.cwd(), tep), "utf8");
  } catch {
    return null;
  }
};

function tepNguon(): string[] {
  const ra = execFileSync(
    "git",
    ["grep", "--untracked", "-l", "-E", "lib/(entitlements|pricing)|\\./(entitlements|pricing)/", "--", "lib", "app", "components", "scripts"],
    { encoding: "utf8" },
  );
  return ra
    .split("\n")
    .filter(Boolean)
    .map((t) => t.replace(/\\/g, "/"))
    .filter((t) => !t.startsWith("lib/entitlements/") && !t.startsWith("lib/pricing/"))
    .filter((t) => !/\.test\.tsx?$/.test(t));
}

describe("[CHN] nền quyền học chưa nối vào đường chạy thật", () => {
  it("[CHN-01] không tệp mã nào ngoài lib/entitlements, lib/pricing (và test) import chúng", () => {
    const nhap = tepNguon().filter((t) => MODULE_NEN.test(boChuThich(readFileSync(resolve(process.cwd(), t), "utf8"))));
    expect(nhap.filter((t) => !DUOC_PHEP.includes(t))).toEqual([]);
  });

  it("[CHN-02] đối chứng: bộ lọc nhìn thấy đúng loại dòng cần bắt (không rỗng vì regex hỏng)", () => {
    expect(MODULE_NEN.test('import { x } from "@/lib/entitlements/dich-vu";')).toBe(true);
    expect(MODULE_NEN.test('import { x } from "@/lib/pricing/tinh-gia-theo-moc";')).toBe(true);
    expect(MODULE_NEN.test('import { x } from "@/lib/finance/pricing/bang-gia-buoi";')).toBe(false);
  });

  it("[CHN-03] tên khoá công tắc chỉ xuất hiện ở registry, nhãn và feature.ts (đã canh ở [FTR-PIN-01]); ở đây: không có đường chạy thật nào còn tự đọc nó", () => {
    let ra: string;
    try {
      ra = execFileSync("git", ["grep", "--untracked", "-l", "-F", "scopePurchaseEnabled", "--", "app", "components"], {
        encoding: "utf8",
      }).trim();
    } catch {
      ra = ""; // git grep thoát 1 khi không có kết quả — đúng điều ta muốn
    }
    expect(ra).toBe("");
  });
});

describe("[CHN-04] mỗi tệp được phép nối có lý do và có lời nói rõ khi cờ TẮT", () => {
  const hopLe: TepDuocPhep = {
    tep: "app/(admin)/admin/vi-du/_actions.ts",
    lyDo: "Action tạo đơn cần báo giá theo phạm vi học.",
    khiCoTat: "Cờ tắt: action thoát sớm ở dòng đầu, kế hoạch đợt chạy nguyên văn.",
    congCo: "GOI",
  };
  const rong: Record<KhuVuc, readonly TepDuocPhep[]> = {
    "tao-don": [],
    "tien-vao": [],
    "xep-lop": [],
    "portal-gv": [],
    "vong-doi": [],
    "hoan-tien": [],
  };
  const voi = (kv: KhuVuc, ...ds: TepDuocPhep[]): KhoiDuocPhep => ({ ...rong, [kv]: ds });

  it("[CHN-04a] danh sách THẬT hợp lệ (đủ lý do / khi-cờ-tắt / cổng cờ cho mọi tệp đã khai)", () => {
    expect(kiemKhoi(DUOC_PHEP_THEO_KHU)).toEqual([]);
  });

  it("[CHN-01b] danh sách phẳng gom ĐỦ tệp của MỌI khối khu vực (danh sách thật đang rỗng nên CHN-01 một mình không chứng minh được điều này)", () => {
    const khoi: KhoiDuocPhep = {
      "tao-don": [{ ...hopLe, tep: "a/1.ts" }],
      "tien-vao": [{ ...hopLe, tep: "a/2.ts" }],
      "xep-lop": [{ ...hopLe, tep: "a/3.ts" }],
      "portal-gv": [{ ...hopLe, tep: "a/4.ts" }],
      "vong-doi": [{ ...hopLe, tep: "a/5.ts" }],
      "hoan-tien": [{ ...hopLe, tep: "a/6.ts" }, { ...hopLe, tep: "a/7.ts" }],
    };
    expect(lamPhang(khoi).sort()).toEqual(["a/1.ts", "a/2.ts", "a/3.ts", "a/4.ts", "a/5.ts", "a/6.ts", "a/7.ts"]);
  });

  it("[CHN-04b] đối chứng dương: một mục đủ ba trường thì KHÔNG có vi phạm (hàm kiểm không đỏ vô điều kiện)", () => {
    expect(kiemKhoi(voi("tao-don", hopLe))).toEqual([]);
  });

  it("[CHN-04c] thiếu lý do ⇒ đỏ đúng tệp đó", () => {
    expect(kiemKhoi(voi("tao-don", { ...hopLe, lyDo: "" }))).toEqual([expect.stringContaining(`${hopLe.tep}: thiếu lý do`)]);
    expect(kiemKhoi(voi("tao-don", { ...hopLe, lyDo: "   ngắn   " }))).toHaveLength(1);
  });

  it("[CHN-04d] không nói rõ khi cờ TẮT ⇒ đỏ", () => {
    expect(kiemKhoi(voi("tien-vao", { ...hopLe, khiCoTat: "" }))).toEqual([expect.stringContaining("khi cờ TẮT")]);
  });

  it("[CHN-04e] khai trùng một tệp ở hai khối ⇒ đỏ (hai khu vực cùng nhận một tệp là tranh nhau)", () => {
    const khoi: KhoiDuocPhep = { ...rong, "tao-don": [hopLe], "xep-lop": [hopLe] };
    expect(kiemKhoi(khoi)).toEqual([expect.stringContaining("khai hai lần")]);
  });

  it("[CHN-04f] thiếu hoặc thừa khối khu vực ⇒ đỏ", () => {
    const thieu: Record<string, unknown> = { ...rong };
    delete thieu["hoan-tien"];
    expect(kiemKhoi(thieu as unknown as KhoiDuocPhep)).toEqual([expect.stringContaining("khối khu vực lệch")]);
    expect(kiemKhoi({ ...rong, "khu-la": [] } as unknown as KhoiDuocPhep)).toEqual([expect.stringContaining("khối khu vực lệch")]);
  });

  it("[CHN-04g] đường dẫn kiểu Windows, tương đối, hoặc nằm trong hai thư mục nền ⇒ đỏ", () => {
    expect(kiemKhoi(voi("tao-don", { ...hopLe, tep: "app\\x\\_actions.ts" }))).toHaveLength(1);
    expect(kiemKhoi(voi("tao-don", { ...hopLe, tep: "./app/x/_actions.ts" }))).toHaveLength(1);
    expect(kiemKhoi(voi("tao-don", { ...hopLe, tep: "lib/entitlements/dich-vu.ts" }))).toHaveLength(1);
    expect(kiemKhoi(voi("tao-don", { ...hopLe, tep: "lib/pricing/bao-gia-dong.test.ts" }))).toHaveLength(1);
  });

  it("[CHN-04h] 'nhanTu' phải trỏ tới MỘT TỆP 'GOI' đã được phép — không trỏ vào chính nó, không trỏ vào tệp lạ, không nối chuỗi", () => {
    const form: TepDuocPhep = { ...hopLe, tep: "app/(admin)/admin/vi-du/_form.tsx", congCo: { nhanTu: hopLe.tep } };
    expect(kiemKhoi(voi("tao-don", hopLe, form))).toEqual([]);
    expect(kiemKhoi(voi("tao-don", { ...form, congCo: { nhanTu: form.tep } }))).toEqual([expect.stringContaining("chính nó")]);
    expect(kiemKhoi(voi("tao-don", form))).toEqual([expect.stringContaining("không phải một tệp \"GOI\"")]);
    const form2: TepDuocPhep = { ...form, tep: "app/(admin)/admin/vi-du/_form2.tsx", congCo: { nhanTu: form.tep } };
    expect(kiemKhoi(voi("tao-don", hopLe, form, form2))).toEqual([expect.stringContaining("không phải một tệp \"GOI\"")]);
  });
});

describe("[CHN-05] tệp được phép 'GOI' phải thật sự gọi cổng cờ", () => {
  const tep = "app/(admin)/admin/vi-du/_actions.ts";
  const mot = (congCo: CongCo = "GOI"): KhoiDuocPhep => ({
    "tao-don": [{ tep, lyDo: "Action tạo đơn cần báo giá theo phạm vi.", khiCoTat: "Cờ tắt: thoát sớm, kế hoạch đợt chạy nguyên văn.", congCo }],
    "tien-vao": [],
    "xep-lop": [],
    "portal-gv": [],
    "vong-doi": [],
    "hoan-tien": [],
  });

  it("[CHN-05a] danh sách THẬT đạt (tệp GOI thật sự gọi cổng; nhanTu trỏ tệp nền thì tệp nền ấy gọi cổng)", () => {
    expect(kiemCong(DUOC_PHEP_THEO_KHU, docThat)).toEqual([]);
  });

  it("[CHN-05b] đối chứng dương: có lời gọi thật ⇒ không vi phạm, với cả ba tên cổng", () => {
    for (const goi of ["await chanNeuPhamViTat(orgUnitId)", "if (await laThuHocPhiTheoPhamViBat(ou)) {", "const pv = await apDungMoHinhPhamVi(ctx)"]) {
      expect(kiemCong(mot(), () => `export async function a() { ${goi}; }`), goi).toEqual([]);
    }
  });

  it("[CHN-05c] chỉ IMPORT mà không GỌI ⇒ đỏ (import không chứng minh gì về đường cũ)", () => {
    const nd = 'import { chanNeuPhamViTat } from "@/lib/entitlements/feature";\nexport async function a() { return 1; }';
    expect(kiemCong(mot(), () => nd)).toEqual([expect.stringContaining("không có lời gọi")]);
  });

  it("[CHN-05d] lời gọi nằm trong CHÚ THÍCH ⇒ đỏ (chú thích giải thích bản vá hay nhắc đúng tên hàm)", () => {
    const nd = "// phải gọi chanNeuPhamViTat(ou) trước\n/* laThuHocPhiTheoPhamViBat(ou) */\nexport const x = 1;";
    expect(kiemCong(mot(), () => nd)).toHaveLength(1);
  });

  it("[CHN-05e] tên gần giống nhưng KHÔNG phải cổng ⇒ đỏ", () => {
    expect(kiemCong(mot(), () => "export const a = () => chanNeuPhamViTatCa(ou) && xchanNeuPhamViTat(ou);")).toHaveLength(1);
  });

  it("[CHN-05f] tệp không đọc được (gõ sai đường dẫn) ⇒ đỏ chứ không bỏ qua im lặng", () => {
    expect(kiemCong(mot(), () => null)).toEqual([expect.stringContaining("không đọc được tệp")]);
  });

  it("[CHN-05g] tệp 'nhanTu' KHÔNG bị đòi tự gọi cổng (giao diện không gọi được hàm server-only)", () => {
    expect(kiemCong(mot({ nhanTu: "app/x.ts" }), () => "export const Form = () => null;")).toEqual([]);
  });
});

describe("[CHN-07] 'nhanTu' có thể trỏ vào TỆP NỀN, miễn tệp đó thật sự gọi cổng cờ", () => {
  const nen = "lib/entitlements/cap-tu-don.ts";
  const form: TepDuocPhep = {
    tep: "lib/events/vi-du.ts",
    lyDo: "Đăng ký handler sự kiện tiền về để xét cấp quyền học.",
    khiCoTat: "Cờ tắt: hàm xét dừng trước mọi phép ghi, handler không ghi gì và không ném.",
    congCo: { nhanTu: nen },
  };
  const rong: Record<KhuVuc, readonly TepDuocPhep[]> = { "tao-don": [], "tien-vao": [], "xep-lop": [], "portal-gv": [], "vong-doi": [], "hoan-tien": [] };
  const khoi: KhoiDuocPhep = { ...rong, "tien-vao": [form] };

  it("[CHN-07a] cấu trúc hợp lệ: nhanTu → tệp nền không cần nằm trong danh sách", () => {
    expect(kiemKhoi(khoi)).toEqual([]);
  });

  it("[CHN-07b] nhanTu → tệp test nền ⇒ đỏ", () => {
    const t = { ...form, congCo: { nhanTu: "lib/entitlements/cap-tu-don.test.ts" } };
    expect(kiemKhoi({ ...rong, "tien-vao": [t] })).toEqual([expect.stringContaining("là tệp test")]);
  });

  it("[CHN-07c] tệp nền THẬT SỰ gọi cổng ⇒ không vi phạm (đối chứng dương)", () => {
    expect(kiemCong(khoi, () => "export async function x() { return await laThuHocPhiTheoPhamViBat(ou); }")).toEqual([]);
  });

  it("[CHN-07d] tệp nền chỉ IMPORT / nhắc trong chú thích mà không GỌI cổng ⇒ đỏ", () => {
    const nd = ["// laThuHocPhiTheoPhamViBat(ou)", 'import { laThuHocPhiTheoPhamViBat } from "./feature";', "export const x = 1;"].join("\n");
    expect(kiemCong(khoi, () => nd)).toEqual([expect.stringContaining("không có lời gọi")]);
  });

  it("[CHN-07e] tệp nền không đọc được ⇒ đỏ chứ không bỏ qua im lặng", () => {
    expect(kiemCong(khoi, () => null)).toEqual([expect.stringContaining("không đọc được tệp")]);
  });
});

describe("[CHN-06] bố cục chống xung đột gộp: các khối khu vực cách nhau ≥ 3 dòng", () => {
  it("[CHN-06a] mỗi khối mở và đóng bằng dòng riêng; giữa dòng đóng của khối trước và dòng mở của khối sau có ≥ 3 dòng", () => {
    const dong = readFileSync(resolve(process.cwd(), "lib/entitlements/chua-noi.test.ts"), "utf8").split(/\r?\n/);
    const bat = dong.findIndex((d) => d.startsWith("const DUOC_PHEP_THEO_KHU"));
    const ket = dong.findIndex((d, i) => i > bat && d === "};");
    expect(bat, "không thấy khai báo DUOC_PHEP_THEO_KHU — đã đổi tên?").toBeGreaterThan(-1);
    expect(ket).toBeGreaterThan(bat);
    const viTri = KHU_VUC.map((kv) => dong.findIndex((d, i) => i > bat && i < ket && d.trim() === `"${kv}": [`));
    expect(viTri.every((v) => v > -1), `mỗi khối phải mở bằng đúng dòng "<khu>": [ — thấy ${JSON.stringify(viTri)}`).toBe(true);
    const dongDong = viTri.map((v) => dong.findIndex((d, i) => i > v && d.trim() === "],"));
    expect(dongDong.every((v, i) => v > viTri[i]), "mỗi khối phải đóng bằng một dòng `],` riêng").toBe(true);
    for (let i = 1; i < viTri.length; i++) {
      const giua = viTri[i] - dongDong[i - 1] - 1;
      expect(giua, `khối ${KHU_VUC[i]} dính khối ${KHU_VUC[i - 1]}`).toBeGreaterThanOrEqual(3);
    }
  });
});
