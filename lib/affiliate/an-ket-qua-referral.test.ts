// @vitest-environment node
/**
 * [D1-*] (trước là [N1-*]) — KHÔNG ĐỂ MỘT ĐƯỜNG CÔNG KHAI / CỔNG ĐỐI TÁC NÀO LÀM LỘ «SĐT NÀY ĐÃ CÓ TRONG CRM CHƯA» (R9 · N1 → R10 · D1, docs/source-commission/12 §11.8).
 *
 * Chủ dự án chốt 18/10/2026: ĐÓNG HẲN, không chỉ che 7 ngày. Bản N1 che kết quả 7 ngày rồi hiện «Đã ghi nhận» / «Không được ghi nhận» + mã hồ sơ — kẻ kiên nhẫn đọc được. Nay cổng đối tác KHÔNG có trạng thái
 * của lượt gửi, KHÔNG có mã hồ sơ, KHÔNG đếm riêng lượt hợp lệ ở cột link; `/api/leads` không trả `duplicate`/`leadId`; mọi đường ẩn danh đi qua cùng lớp thời gian.
 *
 * Phần THUẦN + lưới ghim mã nguồn; ca chạm DB ở `tests/hoa-hong/affiliate-portal.spec.ts` ([AFR-PT-DB-03b]), `tests/lead-intake/affiliate-intake.spec.ts` ([AFI-14], [AFI-15]) và
 * `tests/lead-intake/leads-api-dong-deu.spec.ts` ([LDD-*]). Ngày TUYỆT ĐỐI (luật 19).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import * as cuaToi from "./cua-toi";
import { NHAN_LUOT_GUI_DOI_TAC } from "./cua-toi";

describe("[D1-01] cổng đối tác: MỘT nhãn duy nhất cho mọi lượt gửi; không còn hàm/hằng nào phân loại theo trạng thái", () => {
  it("nhãn là «Đã nhận» — không nói hợp lệ / trùng / từ chối / chờ xem", () => {
    expect(NHAN_LUOT_GUI_DOI_TAC).toBe("Đã nhận");
    expect(NHAN_LUOT_GUI_DOI_TAC).not.toMatch(/ghi nhận|từ chối|trùng|chờ|khiếu nại|hợp lệ/i);
  });
  it("ĐỐI CHỨNG ÂM: các xuất khẩu cũ (phân loại theo trạng thái, che 7 ngày, nhãn theo trạng thái) KHÔNG còn — quay lại là một bit «số này đã có chưa»", () => {
    const co = Object.keys(cuaToi);
    for (const ten of ["trangThaiHienChoDoiTac", "conDangAnKetQua", "NHAN_REFERRAL_DOI_TAC", "TRANG_THAI_DEM_CHO_DOI_TAC", "MS_AN_KET_QUA_REFERRAL", "NGAY_AN_KET_QUA_REFERRAL"]) {
      expect(co, ten).not.toContain(ten);
    }
  });
});

// ── lưới ghim mã nguồn ───────────────────────────────────────────────────────────────────────────
const boChuThich = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const doc = (p: string): string => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n"));
const dem = (s: string, mau: RegExp): number => (s.match(new RegExp(mau.source, mau.flags.includes("g") ? mau.flags : `${mau.flags}g`)) ?? []).length;

describe("[D1-W1] cổng đối tác KHÔNG ĐỌC trạng thái / lead của referral ở bất kỳ đâu (không đọc thì không thể lộ)", () => {
  const docCuaToi = doc("lib/affiliate/doc-cua-toi.ts");
  const cuaToiTs = doc("lib/affiliate/cua-toi.ts");

  it("mọi truy vấn `affiliateReferral` của cổng đối tác: đếm tổng + danh sách chỉ chọn `createdAt` và tên chương trình; `status: \"VALID\"` chỉ còn ở số «đã đăng ký học» (kết quả kinh doanh, cần khách ghi danh thật)", () => {
    expect(dem(docCuaToi, /affiliateReferral\./g)).toBe(3);
    expect(dem(docCuaToi, /affiliateReferral\.count\(\{ where: \{ partyId: \{ in: ids \} \} \}\)/g)).toBe(1);
    expect(dem(docCuaToi, /select: \{ createdAt: true, campaign: \{ select: \{ name: true \} \} \}/g)).toBe(1);
    expect(dem(docCuaToi, /status: "VALID", lead: \{ is: \{ convertedAt: \{ not: null \}/g)).toBe(1);
  });

  it("không còn dấu vết của cơ chế che 7 ngày / mã hồ sơ / gộp trạng thái", () => {
    for (const mau of [/trangThaiHienChoDoiTac/, /conDangAnKetQua/, /MS_AN_KET_QUA/, /maRutGonPhieu/, /mocAn/, /demRong/, /leadId/]) {
      expect(docCuaToi, String(mau)).not.toMatch(mau);
    }
  });

  it("kiểu trả về `DongReferralCuaToi` chỉ có `luc` + `campaign` (không `trangThai`, không `maPhieu`); `referral` không có `theoTrangThai`", () => {
    const dong = cuaToiTs.slice(cuaToiTs.indexOf("export type DongReferralCuaToi"), cuaToiTs.indexOf("export type DongHoaHongCuaToi"));
    expect(dong).toMatch(/luc: string;/);
    expect(dong).toMatch(/campaign: string;/);
    expect(dong).not.toMatch(/trangThai|maPhieu/);
    expect(cuaToiTs).toMatch(/referral: \{ tong: number; daDangKy: number; gan: DongReferralCuaToi\[\] \};/);
    expect(cuaToiTs).not.toMatch(/theoTrangThai: DemTheoTrangThaiReferral/);
  });

  it("cột «referral» ở danh sách link: góc nhìn ĐỐI TÁC đếm MỌI lượt (không lọc status); `gocNhinDoiTac` là tham số BẮT BUỘC (luật 7) và cổng đối tác truyền `true`, màn quản trị truyền `false`", () => {
    const link = doc("lib/affiliate/doc-link.ts");
    expect(dem(link, /gocNhinDoiTac: boolean;/g)).toBe(1);
    expect(dem(link, /\.\.\.\(loc\.gocNhinDoiTac \? \{\} : \{ status: "VALID" as const \}\)/g)).toBe(1);
    expect(link).not.toMatch(/chiDemLuotDaChot|MS_AN_KET_QUA/);
    expect(dem(docCuaToi, /gocNhinDoiTac: true/g)).toBe(1);
    expect(dem(doc("app/(admin)/admin/nguon-hoa-hong/link/page.tsx"), /gocNhinDoiTac: false/g)).toBe(1);
  });

  it("trang cổng đối tác vẽ MỘT nhãn cố định cho mọi dòng và không còn cột trạng thái / mã hồ sơ / ô đếm theo trạng thái", () => {
    const trang = doc("components/portal/gioi-thieu-page.tsx");
    expect(dem(trang, /NHAN_LUOT_GUI_DOI_TAC/g)).toBeGreaterThanOrEqual(2);
    for (const mau of [/NHAN_REFERRAL_DOI_TAC/, /TRANG_THAI_DEM_CHO_DOI_TAC/, /theoTrangThai\.VALID/, /maPhieu/, /Mã hồ sơ/, /NGAY_AN_KET_QUA/]) {
      expect(trang, String(mau)).not.toMatch(mau);
    }
  });
});

describe("[D1-W2] phản hồi công khai của intake Affiliate: lớp thời gian CHUNG, không thêm nhánh nào lộ thông tin", () => {
  const intake = doc("lib/affiliate/intake-cong-khai.ts");
  const chung = doc("lib/security/dong-deu-thoi-gian.ts");

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
    // 20/10/2026 — ingest chạy trong `chayIngest` (có thể gọi LẠI một lần bằng bản rút gọn, xem `[PE-B04]`): lỗi trần bị bắt NGAY TẠI ĐÓ và đổi thành `{ ok: false }` — đường nào cũng ra tới lớp thời gian chung.
    expect(dem(intake, /type KetQuaIngest = Awaited<ReturnType<typeof ingestIntakeLead>>;/g)).toBe(1);
    expect(dem(intake, /\} catch \(err\) \{\s*console\.error\("\[affiliate-intake\] ingest ném lỗi:", err\);\s*return \{ ok: false, error:/g)).toBe(1);
    expect(intake.indexOf('return { ok: false, error: "Lỗi không lường trước ở đường ingest."')).toBeLessThan(intake.indexOf("await denNguongThoiGian("));
  });

  it("lược đồ intake từ chối ký tự điều khiển ở MỌI trường chuỗi (token · clickId · phone · parentName · email · note · centerCode · children · utm · hp) — bộ dò «SĐT đã có chưa» bằng NUL", () => {
    const m = doc("lib/lead/intake/map-affiliate.ts");
    expect(dem(m, /const sach = \(max: number\) => z\.string\(\)\.max\(max\)\.regex\(SACH, KY_TU_LA\);/g)).toBe(1);
    const luocDo = m.slice(m.indexOf("export const affiliateIntakeSchema"), m.indexOf("export type DauVaoAffiliateIntake"));
    expect(dem(luocDo, /z\.string\(\)/g)).toBe(1);
    expect(luocDo).toMatch(/idempotencyKey: z\.string\(\)\.regex\(\/\^\[A-Za-z0-9_-\]\{8,64\}\$\//);
  });

  it("nhánh KHÔNG chạm khách (413 · 400 · bot · 429) trả TRƯỚC `batDau` — không chờ", () => {
    const batDau = intake.indexOf("const batDau = now.getTime();");
    for (const m of ["return tra(413,", 'return tra(400, false, "Dữ liệu không hợp lệ.")', "return tra(200, true, CAU_TRA_LOI_THANH_CONG);", "return tra(429,"]) {
      const v = intake.indexOf(m);
      expect(v, m).toBeGreaterThan(-1);
      expect(v, m).toBeLessThan(batDau);
    }
  });

  it("`cho` và `nhieuMs` là phụ thuộc BẮT BUỘC (luật 7) của lớp thời gian chung; bản thật chờ bằng `setTimeout`; intake dùng đúng bản chung (không tự chép lại)", () => {
    expect(dem(chung, /^\s+cho: \(ms: number\) => Promise<void>;/gm)).toBe(1);
    expect(dem(chung, /^\s+nhieuMs: \(\) => number;/gm)).toBe(1);
    expect(dem(chung, /cho: \(ms\) => new Promise\(\(xong\) => setTimeout\(xong, ms\)\)/g)).toBe(1);
    expect(dem(chung, /export const DO_TRE_TOI_THIEU_MS = 700;/g)).toBe(1);
    expect(dem(intake, /\.\.\.phuThuocThoiGianThat\(\)/g)).toBe(1);
    expect(intake).not.toMatch(/setTimeout|Math\.random|DO_TRE_TOI_THIEU_MS = /);
  });

  it("thân phản hồi chỉ có MỘT câu thành công (không câu riêng cho trùng / xem tay / từ chối)", () => {
    expect(dem(intake, /CAU_TRA_LOI_THANH_CONG/g)).toBeGreaterThanOrEqual(3);
    expect(intake).not.toMatch(/tra\(200, true, "(?!Đã nhận)/);
    expect(intake).not.toMatch(/duplicate|trùng|REJECTED_DUPLICATE/i);
  });
});

describe("[D1-W3] `/api/leads` (biểu mẫu website công khai): cùng thân, cùng lớp thời gian cho lead mới · lead trùng · lỗi", () => {
  const route = doc("app/api/leads/route.ts");

  it("KHÔNG còn trường `duplicate` / `leadId` trong bất kỳ phản hồi nào (lead trùng từng trả id lead CŨ + `duplicate: true` cho người ẩn danh)", () => {
    expect(route).not.toMatch(/duplicate: true/);
    expect(route).not.toMatch(/NextResponse\.json\(\{[^}]*leadId/); // `leadId:` còn ở lời gọi email nội bộ (không phải phản hồi)
    expect(dem(route, /NextResponse\.json\(PHAN_HOI_THANH_CONG\)/g)).toBe(6); // bot · timeOnPage · eventId đã xử lý · trùng · UNIQUE (gửi lặp đua nhau) · mới
    expect(dem(route, /const PHAN_HOI_THANH_CONG = \{ ok: true \} as const/g)).toBe(1);
  });

  it("lớp thời gian: `batDau` đặt TRƯỚC mọi phép tra theo khách; chờ ở MỌI nhánh chạm khách — eventId đã xử lý · trùng · UNIQUE · mới — và nhánh lỗi SAU khi đã chạm khách (5 lần gọi)", () => {
    expect(dem(route, /denNguongThoiGian\(pt, batDau, 'api\/leads'\)/g)).toBe(5);
    const batDau = route.indexOf("batDau = pt.now().getTime()");
    const kiemTrung = route.indexOf("await findRecentDuplicate(");
    expect(batDau).toBeGreaterThan(-1);
    expect(kiemTrung).toBeGreaterThan(batDau);
    expect(route.lastIndexOf("await denNguongThoiGian(pt, batDau, 'api/leads')")).toBeGreaterThan(kiemTrung);
    // MỖI câu trả thành công đứng SAU `batDau` phải có lời chờ NGAY TRƯỚC nó (không có nhánh chạm khách nào trả mà không chờ).
    const dong = route.split("\n");
    let dem2 = 0;
    dong.forEach((l, i) => {
      if (!l.includes("return NextResponse.json(PHAN_HOI_THANH_CONG)")) return;
      const viTri = dong.slice(0, i).join("\n").length;
      if (viTri < batDau) return; // bot · timeOnPage: chưa chạm khách
      dem2 += 1;
      expect(dong[i - 1], `dòng ${i + 1}`).toContain("await denNguongThoiGian(pt, batDau, 'api/leads')");
    });
    expect(dem2, "4 nhánh chạm khách: eventId đã xử lý · trùng · UNIQUE · mới").toBe(4);
    // nhánh KHÔNG chạm khách (bot · timeOnPage · 400 · 429) trả trước `batDau`
    for (const m of ["hp-", "'Dữ liệu không hợp lệ'", "suspicious timeOnPage", "status: 429"]) {
      const v = route.indexOf(m);
      if (v >= 0) expect(v, m).toBeLessThan(batDau);
    }
    expect(dem(route, /if \(batDau !== null\) await denNguongThoiGian\(pt, batDau, 'api\/leads'\)/g)).toBe(1);
  });
});

describe("[D1-W4] `sale-form` (cờ bắt buộc đăng nhập có thể tắt): cờ «trùng» / «thêm con» chỉ cho người ĐÃ đăng nhập; người ẩn danh đi qua lớp thời gian chung", () => {
  const route = doc("app/api/public/lead-intake/sale-form/route.ts");
  it("`dup` / `child` gài sau `nguoiDaDangNhap`; chờ chỉ khi KHÔNG có phiên", () => {
    expect(dem(route, /nguoiDaDangNhap && result\.duplicate \? \{ dup: "1" \}/g)).toBe(1);
    expect(dem(route, /nguoiDaDangNhap && result\.childAdded \? \{ child: "1" \}/g)).toBe(1);
    expect(dem(route, /if \(!session\?\.user\) await denNguongThoiGian\(phuThuocThoiGianThat\(\), batDauChamKhach, "sale-form"\);/g)).toBe(1);
    expect(route.indexOf("batDauChamKhach = Date.now()")).toBeLessThan(route.indexOf("await ingestIntakeLead("));
  });
});
