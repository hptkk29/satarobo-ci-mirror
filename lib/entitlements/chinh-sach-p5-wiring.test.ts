// lib/entitlements/chinh-sach-p5-wiring.test.ts — LƯỚI GHIM DÂY NỐI của PR5. `[P5-W*]`.
//
// Luật cần khoá có dạng "lời gọi này phải có / không được có" — test hành vi (tests/finance/chinh-sach-p5*.test.ts) bắt phần lớn, nhưng cổng chạm DB thì ca hành vi
// không đỏ khi ai đó GỠ lời gọi (đã xảy ra ở các PR trước). Đếm trên mã ĐÃ BỎ CHÚ THÍCH, neo vào LỜI GỌI / biểu thức điều kiện, không neo vào chỗ đặt `await` (luật 11).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const docTho = (tep: string): string => readFileSync(resolve(process.cwd(), tep), "utf8");
const boChuThich = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const doc = (tep: string): string => boChuThich(docTho(tep));
const dem = (s: string, re: RegExp): number => (s.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)) ?? []).length;

const CONVERT = doc("lib/crm/convert-lead-v2.ts");
const CHUYEN_DOI = doc("app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts");
const CHUYEN_DOI_GHI = doc("lib/orders/chuyen-doi-ghi.ts"); // 27/10/2026: phần GHI dời sang đây
const XEP = doc("lib/entitlements/xep-lop-tu-don.ts");
const DICH_VU = doc("lib/entitlements/dich-vu.ts");
const TIEU_THU = doc("lib/entitlements/tieu-thu.ts");
const SCHEMA = docTho("prisma/schema.prisma"); // KHÔNG bỏ chú thích: schema chứa chuỗi `/*` làm bộ bỏ chú thích cắt nhầm cả khối

describe("[P5-W] quyết định 3 — ghi danh của dòng SCOPE ra đời PENDING, chỉ `xetXepLopChoDon` kích hoạt", () => {
  it("[P5-W1] convertLeadV2: PENDING chỉ qua MỘT biểu thức `dongTheoQuyenHoc` (cùng phép khớp với buoiBatDau = null); không chỗ nào khác ghi status ghi danh", () => {
    expect(dem(CONVERT, /\bstatus: "PENDING"/)).toBe(1);
    expect(CONVERT).toMatch(/\.\.\.\(dongTheoQuyenHoc\[i\] \? \{ status: "PENDING" as const \} : \{\}\)/);
    expect(dem(CONVERT, /\bdongTheoQuyenHoc\b/)).toBeGreaterThanOrEqual(3); // khai báo + buoiBatDau + status
    // Cờ chỉ được hỏi một lần cho cả lượt, và CHỈ khi có dòng mang dấu (đơn thường không tốn câu truy vấn nào).
    expect(dem(CONVERT, /\bphamViDangBatChoCoSo\(/)).toBe(1);
    // Đơn thường / cờ tắt: KHÔNG truyền `status` ⇒ mặc định ACTIVE của schema — tức là không có `status:` nào khác trong lời tạo ghi danh.
    const taoGhiDanh = CONVERT.slice(CONVERT.indexOf("tx.enrollment.create("), CONVERT.indexOf("tx.enrollment.create(") + 1200);
    expect(dem(taoGhiDanh, /\bstatus:/)).toBe(1);
  });

  it("[P5-W2] chuyenDoiDonAction: trạng thái ghi danh quyết bởi `DongChuyenDoi.phamVi` (cùng nguồn với buoiBatDau / phán quyết trung tính); đơn thường vẫn STUDYING", () => {
    expect(CHUYEN_DOI_GHI).toMatch(/status: k\.phamVi \? "PENDING" : "STUDYING"/);
    expect(CHUYEN_DOI).toMatch(/phamVi: goc\.phamVi,/);
    expect(dem(CHUYEN_DOI_GHI, /: "STUDYING"/)).toBe(1); // nhánh đơn thường / cờ tắt của biểu thức trên — không còn chỗ thứ hai
  });

  it("[P5-W3] kích hoạt: chỉ khi ghi danh đang PENDING, SAU `xepLopTrongTx` và SAU cập nhật buoiBatDau, qua `trangThaiGhiDanhMoi`, có nhật ký + audit + đồng bộ nhóm chat CÙNG transaction", () => {
    expect(dem(XEP, /gdMoi\.status === "PENDING"/)).toBe(1);
    const iXep = XEP.indexOf("xepLopTrongTx(");
    const iBuoi = XEP.indexOf("buoiBatDau: phamVi.startLesson > 1");
    const iKichHoat = XEP.indexOf('gdMoi.status === "PENDING"');
    expect(iXep).toBeGreaterThan(-1);
    expect(iXep).toBeLessThan(iBuoi);
    expect(iBuoi).toBeLessThan(iKichHoat);
    const khoi = XEP.slice(iKichHoat, XEP.indexOf("daXep.push({"));
    expect(khoi).toMatch(/trangThaiGhiDanhMoi\(gdMoi\.class\.status, "CONFIRMED"\)/);
    expect(khoi).toMatch(/tx\.enrollmentAuditLog\.create\(/);
    expect(khoi).toMatch(/fromStatus: "PENDING"/);
    expect(khoi).toMatch(/writeAudit\(\{[\s\S]*?\btx,/);
    expect(khoi).toMatch(/syncConversationMembership\(tx, gd\.classId\)/);
    expect(khoi).not.toMatch(/\bdb\./); // [DVU-PIN-07]: không kết nối thứ hai trong transaction
    expect(dem(XEP, /\bsyncConversationMembership\(/)).toBe(1);
    expect(dem(XEP, /\benrollmentAuditLog\.create\(/)).toBe(1);
  });

  it("[P5-W4] đường ghi danh cũ (thủ công / nhóm / chuyển lớp) KHÔNG bị nối: không file nào ngoài hai đường convert / chuyển đổi ghi PENDING theo cờ phạm vi", () => {
    for (const tep of ["app/(admin)/admin/enrollments/_actions.ts", "app/(admin)/admin/class-groups/_actions.ts", "lib/enrollments/chuyen-lop.ts", "lib/transfer/service.ts"]) {
      expect(doc(tep), tep).not.toMatch(/phamViDangBatChoCoSo|dongPhamViDangBat|laThuHocPhiTheoPhamViBat/);
    }
  });
});

describe("[P5-W] quyết định 1 — FREE_MAKEUP không đụng sổ cái của quyền chính", () => {
  it("[P5-W5] `ghiNhanBaiTrongTx`: nhánh BO_SUNG trả TRƯỚC mọi phép ghi sổ cái (upsert / ganLaiTieuThu), chỉ ghi audit BONUS_LEARN", () => {
    const ham = DICH_VU.slice(DICH_VU.indexOf("export async function ghiNhanBaiTrongTx("), DICH_VU.indexOf("export async function ghiNhanBai("));
    const iNhanh = ham.indexOf('qd.loai === "BO_SUNG"');
    const iUpsert = ham.indexOf("studyEntitlementUsage.upsert(");
    expect(iNhanh).toBeGreaterThan(-1);
    expect(iNhanh).toBeLessThan(iUpsert);
    const nhanh = ham.slice(iNhanh, iUpsert);
    expect(nhanh).toMatch(/action: "BONUS_LEARN"/);
    expect(nhanh).toMatch(/\btx,/);
    expect(nhanh).toMatch(/return \{ ghi: false as const, lyDo: "HOC_BO_SUNG" as const \}/);
    expect(nhanh).not.toMatch(/studyEntitlementUsage|ganLaiTieuThu|studyEntitlement\.update/);
  });

  it("[P5-W6] `xepLopTrongTx` ghi `freeMakeupSessions` từ kết quả của MỘT công thức xếp lớp; `tinhConLai` trừ nó; `tomTat` đọc nó (trường BẮT BUỘC — luật 7)", () => {
    expect(dem(DICH_VU, /freeMakeupSessions: phamVi\.freeMakeupLessons\.length/)).toBe(2); // cột + audit
    expect(DICH_VU).toMatch(/freeMakeupSessions: e\.freeMakeupSessions/);
    expect(TIEU_THU).toMatch(/q\.purchaseSessions - daTieuThu - q\.baiBoQua\.length - q\.freeMakeupSessions/);
    expect(TIEU_THU).toMatch(/readonly freeMakeupSessions: number;/);
    expect(TIEU_THU).not.toMatch(/freeMakeupSessions\??:\s*number\s*=/);
    // Bài bổ sung được hỏi TRƯỚC `phanLoaiBai` trong `quyetDinhGhiNhan` (nếu không nó bị coi là TRONG_PHAM_VI và trừ quyền chính).
    expect(TIEU_THU.indexOf("laBaiBoSung(q, lessonOrder)")).toBeGreaterThan(-1);
    expect(TIEU_THU.indexOf("laBaiBoSung(q, lessonOrder)")).toBeLessThan(TIEU_THU.indexOf("const phanLoai = phanLoaiBai(q, lessonOrder)"));
  });

  it("[P5-W7] migration: CHỈ THÊM (cột + CHECK trong khối DO, một giá trị enum), dấu thời gian duy nhất và sau mọi migration của PR trước; schema khớp", () => {
    const ten = readdirSync(resolve(process.cwd(), "prisma/migrations")).filter((t) => /^\d{14}_/.test(t));
    const A = "20261025100000_quyen_hoc_hoc_bu_mien_phi";
    const B = "20261025110000_quyen_hoc_xu_ly_cho_duyet_hoc_vuot";
    expect(ten.filter((t) => t.startsWith("20261025100000_"))).toEqual([A]);
    expect(ten.filter((t) => t.startsWith("20261025110000_"))).toEqual([B]);
    expect(A > "20261022100000_quyen_hoc_xu_ly_doi_soat").toBe(true);
    const sqlA = docTho(`prisma/migrations/${A}/migration.sql`).replace(/--[^\n]*/g, "");
    expect(sqlA).toMatch(/ADD COLUMN IF NOT EXISTS "freeMakeupSessions" INTEGER NOT NULL DEFAULT 0/);
    expect(sqlA).toMatch(/StudyEntitlement_free_makeup_chk/);
    expect(sqlA).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i);
    const sqlB = docTho(`prisma/migrations/${B}/migration.sql`).replace(/--[^\n]*/g, "").trim();
    expect(sqlB).toBe(`ALTER TYPE "EntitlementXuLyLoai" ADD VALUE IF NOT EXISTS 'CHO_DUYET_HOC_VUOT';`);
    expect(SCHEMA).toMatch(/freeMakeupSessions\s+Int\s+@default\(0\)/);
    expect(SCHEMA).toMatch(/\n\s*CHO_DUYET_HOC_VUOT\r?\n/);
  });
});

describe("[P5-W] quyết định 5 — dòng xin duyệt chỉ mở khi vượt trần, qua đường vòng đời có sẵn", () => {
  it("[P5-W8] xep-lop-tu-don KHÔNG còn tạo dòng CHO_DUYET_HOC_VUOT (chốt 21/10/2026: vượt n ⇒ vào từ buổi kế tiếp, không xin duyệt) và đánh dấu dòng bù học vượt MIỄN PHÍ bằng `nguonBaoLuu: NGUON_BU_HOC_VUOT`", () => {
    expect(XEP).not.toContain("deXuatHocVuot(");
    expect(XEP).not.toContain("CHO_DUYET_HOC_VUOT");
    expect(XEP).not.toContain("thiHanhHanhDongCho");
    expect(XEP).not.toContain("choDuyetHocVuot");
    // Dòng bù tạo ở đây phải mang nhãn miễn phí — thiếu nhãn là dòng học vượt trừ lượt / đòi phí mà không test hành vi nào đỏ.
    expect(XEP.split('nguon: "ORDER_CONVERSION", nguonBaoLuu: NGUON_BU_HOC_VUOT,').length - 1).toBe(1);
  });

  it("[P5-W9] duyệt học vượt: KHÔNG ghi sổ cái Usage, KHÔNG ghi OrderItem / ghi danh; chỉ MỘT hàm ghi quyền học (`skippedSessions` + `configSnapshot`) và `taoDongHocBu` ORDER_CONVERSION", () => {
    const hd = doc("lib/entitlements/hang-doi/hanh-dong.ts");
    const duyet = hd.slice(hd.indexOf("export async function duyetHocVuot("));
    expect(duyet).not.toMatch(/studyEntitlementUsage\.|orderItem\.|enrollment\.(create|update)|ghiNhanBai|\.student\.|payment\./);
    expect(dem(duyet, /\btx\.studyEntitlement\.update\(/)).toBe(1);
    expect(dem(duyet, /\btaoDongHocBu\(tx,/)).toBe(1);
    expect(duyet).toMatch(/nguon: "ORDER_CONVERSION"/);
    expect(duyet).toMatch(/skippedSessions: ap\.skippedMoi/);
  });
});
