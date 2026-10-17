// @vitest-environment node
/**
 * [N1-*] — KHÔNG ĐỂ CỔNG ĐỐI TÁC / PHẢN HỒI CÔNG KHAI LÀM LỘ «SĐT NÀY ĐÃ CÓ TRONG CRM CHƯA» (R9, docs/source-commission/12 §11.8).
 * Phần THUẦN + lưới ghim mã nguồn; ca chạm DB ở `tests/hoa-hong/affiliate-portal.spec.ts` ([AFR-PT-DB-03b]) và `tests/lead-intake/affiliate-intake.spec.ts` ([AFI-14], [AFI-15]).
 * Ngày TUYỆT ĐỐI (luật 19).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { MS_AN_KET_QUA_REFERRAL, NGAY_AN_KET_QUA_REFERRAL, conDangAnKetQua, trangThaiHienChoDoiTac } from "./cua-toi";
import { TRANG_THAI_REFERRAL, type TrangThaiReferral } from "./ghi-referral-dau-vao";

const T0 = new Date("2026-10-10T03:00:00.000Z");
const NGAY = 24 * 60 * 60 * 1000;

describe("[N1-01] trangThaiHienChoDoiTac — lượt MỚI che mọi kết quả; lượt CŨ gộp «trùng» vào «bị từ chối»", () => {
  it("dangAn = true: mọi kết quả KẾT THÚC (hợp lệ · trùng · từ chối · xem tay) hiện «Đang chờ xem xét» — người ngoài không phân biệt được", () => {
    for (const t of ["VALID", "REJECTED", "REJECTED_DUPLICATE", "MANUAL_REVIEW"] as const) expect(trangThaiHienChoDoiTac(t, true), t).toBe("MANUAL_REVIEW");
  });
  it("dangAn = false: giữ nguyên, trừ «trùng» gộp vào «bị từ chối» (không bao giờ lộ lý do trùng)", () => {
    expect(trangThaiHienChoDoiTac("VALID", false)).toBe("VALID");
    expect(trangThaiHienChoDoiTac("REJECTED", false)).toBe("REJECTED");
    expect(trangThaiHienChoDoiTac("REJECTED_DUPLICATE", false)).toBe("REJECTED");
    expect(trangThaiHienChoDoiTac("MANUAL_REVIEW", false)).toBe("MANUAL_REVIEW");
  });
  it("«khiếu nại» do CHÍNH đối tác khởi tạo ⇒ không che ở cả hai chế độ", () => {
    expect(trangThaiHienChoDoiTac("DISPUTED", true)).toBe("DISPUTED");
    expect(trangThaiHienChoDoiTac("DISPUTED", false)).toBe("DISPUTED");
  });
  it("ĐỐI CHỨNG: khi che, tập kết quả hiện ra chỉ còn MỘT giá trị cho mọi trạng thái nội bộ (ngoài khiếu nại) — không còn bit nào để đọc", () => {
    const hien = new Set(TRANG_THAI_REFERRAL.filter((t: TrangThaiReferral) => t !== "DISPUTED").map((t: TrangThaiReferral) => trangThaiHienChoDoiTac(t, true)));
    expect([...hien]).toEqual(["MANUAL_REVIEW"]);
  });
});

describe("[N1-02] conDangAnKetQua — biên chính xác", () => {
  it("dưới 7 ngày ⇒ còn che; ĐÚNG 7 ngày ⇒ hiện; hằng số khớp", () => {
    expect(NGAY_AN_KET_QUA_REFERRAL).toBe(7);
    expect(MS_AN_KET_QUA_REFERRAL).toBe(7 * NGAY);
    expect(conDangAnKetQua(T0, new Date(T0.getTime()))).toBe(true);
    expect(conDangAnKetQua(T0, new Date(T0.getTime() + 7 * NGAY - 1))).toBe(true);
    expect(conDangAnKetQua(T0, new Date(T0.getTime() + 7 * NGAY))).toBe(false);
    expect(conDangAnKetQua(T0, new Date(T0.getTime() + 30 * NGAY))).toBe(false);
  });
  it("mốc tạo ở TƯƠNG LAI (đồng hồ lệch) ⇒ vẫn che (an toàn hơn là hiện sớm)", () => {
    expect(conDangAnKetQua(new Date(T0.getTime() + NGAY), T0)).toBe(true);
  });
});

// ── lưới ghim mã nguồn ───────────────────────────────────────────────────────────────────────────
const boChuThich = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const doc = (p: string): string => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n"));
const dem = (s: string, mau: RegExp): number => (s.match(new RegExp(mau.source, mau.flags.includes("g") ? mau.flags : `${mau.flags}g`)) ?? []).length;

describe("[N1-W1] cổng đối tác: MỘT hàm quyết trạng thái hiển thị, mọi nơi dùng nó với cờ `dangAn` tường minh", () => {
  const docCuaToi = doc("lib/affiliate/doc-cua-toi.ts");

  it("đúng BA lời gọi `trangThaiHienChoDoiTac(` ở chỗ đọc (đếm cũ · đếm mới · danh sách) — không nơi nào tự gộp trạng thái", () => {
    expect(dem(docCuaToi, /trangThaiHienChoDoiTac\(/g)).toBe(3);
    expect(dem(docCuaToi, /trangThaiHienChoDoiTac\(x\.status, false\)/g)).toBe(1);
    expect(dem(docCuaToi, /trangThaiHienChoDoiTac\(x\.status, true\)/g)).toBe(1);
    expect(dem(docCuaToi, /trangThaiHienChoDoiTac\(r\.status, dangAn\)/g)).toBe(1);
  });

  it("biên của hai nửa đếm KHỚP `conDangAnKetQua` (cũ = `<= mốc`, mới = `> mốc`): lệch một biên là đếm ra khác danh sách (đã từng đỏ ở [AFR-PT-DB-03b])", () => {
    expect(dem(docCuaToi, /createdAt: \{ lte: mocAn \}/g)).toBe(1);
    expect(dem(docCuaToi, /createdAt: \{ gt: mocAn \}/g)).toBe(1);
    expect(dem(docCuaToi, /const mocAn = new Date\(now\.getTime\(\) - MS_AN_KET_QUA_REFERRAL\)/g)).toBe(1);
  });

  it("mã hồ sơ CHỈ khi hết thời gian che VÀ hợp lệ: `!dangAn && r.status === \"VALID\"`", () => {
    expect(dem(docCuaToi, /maPhieu: !dangAn && r\.status === "VALID" && r\.leadId \? maRutGonPhieu\(r\.leadId\) : null/g)).toBe(1);
  });

  it("`dangAn` là tham số BẮT BUỘC của hàm gộp (luật 7): không `?`, không mặc định", () => {
    const cuaToi = doc("lib/affiliate/cua-toi.ts");
    expect(dem(cuaToi, /export function trangThaiHienChoDoiTac\(t: TrangThaiReferral, dangAn: boolean\)/g)).toBe(1);
  });
});

describe("[N1-W2] phản hồi công khai: lớp thời gian CHUNG, không thêm nhánh nào lộ thông tin", () => {
  const intake = doc("lib/affiliate/intake-cong-khai.ts");

  it("`denNguongThoiGian` gọi đúng MỘT lần, SAU `ingestIntakeLead` và TRƯỚC cả hai `return` cuối (thành công · lỗi lưu)", () => {
    expect(dem(intake, /await denNguongThoiGian\(/g)).toBe(1);
    const ingest = intake.indexOf("await ingestIntakeLead(");
    const cho = intake.indexOf("await denNguongThoiGian(");
    const loi = intake.indexOf('return tra(500, false, "Chưa lưu được thông tin');
    const ok = intake.indexOf("return tra(200, true, CAU_TRA_LOI_THANH_CONG, acao);");
    expect(ingest).toBeGreaterThan(-1);
    expect(cho).toBeGreaterThan(ingest);
    expect(loi).toBeGreaterThan(cho);
    expect(ok).toBeGreaterThan(cho);
  });

  it("ingest ném lỗi trần ⇒ vẫn đi hết lớp thời gian chung và ra CÙNG câu 500 (không để Next trả 500 mặc định khác thân, không chờ)", () => {
    expect(dem(intake, /let ketQua: Awaited<ReturnType<typeof ingestIntakeLead>>;/g)).toBe(1);
    expect(dem(intake, /\} catch \(err\) \{\s*console\.error\("\[affiliate-intake\] ingest ném lỗi:", err\);\s*ketQua = \{ ok: false, error:/g)).toBe(1);
    expect(intake.indexOf("ketQua = { ok: false, error:")).toBeLessThan(intake.indexOf("await denNguongThoiGian("));
  });

  it("lược đồ intake từ chối ký tự điều khiển ở MỌI trường chuỗi (token · clickId · phone · parentName · email · note · centerCode · children · utm · hp) — bộ dò «SĐT đã có chưa» bằng NUL", () => {
    const m = doc("lib/lead/intake/map-affiliate.ts");
    expect(dem(m, /const sach = \(max: number\) => z\.string\(\)\.max\(max\)\.regex\(SACH, KY_TU_LA\);/g)).toBe(1);
    // không còn `z.string()` trần trong lược đồ (mọi chuỗi đi qua `sach`/`chuoi`), ngoại lệ DUY NHẤT là regex khoá chống gửi lặp (đã giới hạn bảng ký tự)
    const luocDo = m.slice(m.indexOf("export const affiliateIntakeSchema"), m.indexOf("export type DauVaoAffiliateIntake"));
    expect(dem(luocDo, /z\.string\(\)/g)).toBe(1);
    expect(luocDo).toMatch(/idempotencyKey: z\.string\(\)\.regex\(\/\^\[A-Za-z0-9_-\]\{8,64\}\$\//);
  });

  it("nhánh KHÔNG chạm khách (413 · 400 · bot · 429) trả TRƯỚC `batDau` — không chờ", () => {
    const batDau = intake.indexOf("const batDau = now.getTime();");
    for (const m of ["return tra(413,", "return tra(400, false, \"Dữ liệu không hợp lệ.\")", "return tra(200, true, CAU_TRA_LOI_THANH_CONG);", "return tra(429,"]) {
      const v = intake.indexOf(m);
      expect(v, m).toBeGreaterThan(-1);
      expect(v, m).toBeLessThan(batDau);
    }
  });

  it("`cho` và `nhieuMs` là phụ thuộc BẮT BUỘC của `PhuThuocIntake` (luật 7) và bản thật chờ bằng `setTimeout`; ngưỡng đủ lớn hơn đường «lead mới» thường gặp", () => {
    expect(dem(intake, /^\s+cho: \(ms: number\) => Promise<void>;/gm)).toBe(1);
    expect(dem(intake, /^\s+nhieuMs: \(\) => number;/gm)).toBe(1);
    expect(dem(intake, /cho: \(ms\) => new Promise\(\(xong\) => setTimeout\(xong, ms\)\)/g)).toBe(1);
    expect(dem(intake, /export const DO_TRE_TOI_THIEU_MS = 700;/g)).toBe(1);
  });

  it("thân phản hồi chỉ có MỘT câu thành công (không câu riêng cho trùng / xem tay / từ chối)", () => {
    expect(dem(intake, /CAU_TRA_LOI_THANH_CONG/g)).toBeGreaterThanOrEqual(3);
    expect(intake).not.toMatch(/tra\(200, true, "(?!Đã nhận)/); // mọi 200 thành công đều dùng hằng chung
    expect(intake).not.toMatch(/duplicate|trùng|REJECTED_DUPLICATE/i);
  });
});
