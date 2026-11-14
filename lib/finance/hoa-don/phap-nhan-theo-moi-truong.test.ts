// @vitest-environment node
//
// Ca [PNT-*] — pháp nhân UAT CHỈ có ở môi trường TEST (chủ dự án chốt 25/10/2026, phương án 2). Thuần: truyền `env` vào, không đụng process.env.
// Luật cần khoá: (1) PRODUCTION nhận lại CHÍNH đối tượng cũ — ba pháp nhân thật, không gì thêm, kể cả khi mã này lên `main`; (2) TEST thấy thêm
// MỘT pháp nhân dữ liệu-thử ở CUỐI, không bao giờ là mặc định; (3) `kiemCauHinhCoSo` KHÔNG bị nới — chỉ danh sách đưa vào đổi; (4) dữ liệu thử tự
// khai mình là giả ở ba lớp độc lập.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CAU_HINH_HOA_DON_MAC_DINH, kiemCauHinhHoaDon, laPhapNhanMisa, PHAP_NHAN_UAT, phapNhanChoDon } from "./phap-nhan";
import { cauHinhHoaDonChoMoiTruong, choPhepPhapNhanThu } from "./phap-nhan-theo-moi-truong";
import { kiemCauHinhCoSo } from "./cau-hinh-co-so";

// Hai env THẬT đo trên VPS 25/10/2026 (chỉ các khoá liên quan): prod và test.
const PROD_VPS = { VERCEL_ENV: "production", NODE_ENV: "production" };
const TEST_VPS = { VERCEL_ENV: "preview", NODE_ENV: "production", NEXTAUTH_URL: "https://test.satarobo.vn", NEXT_PUBLIC_APP_URL: "https://test.satarobo.vn" };
const MA_THAT = CAU_HINH_HOA_DON_MAC_DINH.phapNhan.map((p) => p.ma);

describe("[PNT-01] ai được thấy pháp nhân UAT — cả HAI khoá (host test.* VÀ không-production) phải cùng đúng", () => {
  it("env test VPS thật ⇒ được thấy", () => {
    expect(choPhepPhapNhanThu(TEST_VPS)).toBe(true);
  });
  it.each(["NEXTAUTH_URL", "AUTH_URL", "NEXT_PUBLIC_APP_URL"])("%s một mình mang host test.* (VERCEL_ENV=preview) ⇒ được thấy", (khoa) => {
    expect(choPhepPhapNhanThu({ VERCEL_ENV: "preview", [khoa]: "https://test.satarobo.vn" })).toBe(true);
  });
  it.each([
    ["env prod VPS", PROD_VPS],
    ["prod + URL thật", { ...PROD_VPS, NEXTAUTH_URL: "https://admin.satarobo.vn", NEXT_PUBLIC_APP_URL: "https://satarobo.vn" }],
    ["VERCEL_ENV=production dù host mang test.* (khoá không-production nói KHÔNG)", { ...PROD_VPS, NEXTAUTH_URL: "https://test.satarobo.vn" }],
    ["thiếu VERCEL_ENV + `next start` thật + host test.* (laProductionThat=true ⇒ từ chối, an toàn hơn đoán)", { NODE_ENV: "production", NEXTAUTH_URL: "https://test.satarobo.vn" }],
    ["preview nhưng KHÔNG có host test.* (preview lạ)", { VERCEL_ENV: "preview", NODE_ENV: "production", NEXTAUTH_URL: "https://pr-123.example.com" }],
    ["máy dev / vitest", { NODE_ENV: "test" }],
    ["máy dev có NEXTAUTH_URL localhost", { NODE_ENV: "development", NEXTAUTH_URL: "http://localhost:3000" }],
    ["job CI", { NODE_ENV: "production", CI: "true", NEXTAUTH_URL: "http://localhost:3100" }],
    ["env rỗng", {}],
    ["host testing.* / contest.* không phải test.*", { VERCEL_ENV: "preview", NEXTAUTH_URL: "https://testing.satarobo.vn", AUTH_URL: "https://contest.satarobo.vn" }],
  ])("%s ⇒ KHÔNG được thấy", (_t, env) => {
    expect(choPhepPhapNhanThu(env)).toBe(false);
  });
  it("không có công tắc env nào bật nó ở PROD", () => {
    const env = { ...PROD_VPS, UAT_PHAP_NHAN: "1", HOA_DON_PHAP_NHAN_THU: "true", ALLOW_UAT: "1", NODE_ENV: "production" };
    expect(choPhepPhapNhanThu(env)).toBe(false);
  });
});

describe("[PNT-02] PRODUCTION: danh sách KHÔNG ĐỔI MỘT BYTE", () => {
  it.each([["env prod VPS", PROD_VPS], ["env rỗng", {}], ["máy dev", { NODE_ENV: "test" }]])("%s ⇒ đúng CHÍNH đối tượng CAU_HINH_HOA_DON_MAC_DINH", (_t, env) => {
    const c = cauHinhHoaDonChoMoiTruong(env);
    expect(c).toBe(CAU_HINH_HOA_DON_MAC_DINH); // cùng tham chiếu — không bản sao, không phần tử thêm
    // GHIM CỨNG theo tên, không so với chính hằng (một dòng lạ nhét vào hằng sẽ làm hai bên cùng đổi và phép so tự khớp). Thêm pháp nhân THẬT mới
    // vào danh sách PROD là quyết định có người chịu trách nhiệm ⇒ sửa dòng này CÙNG PR, kèm xác nhận của kế toán/owner.
    expect(c.phapNhan.map((p) => p.ma)).toEqual(["SATA_ROBO", "NEW_VISION", "STEM_ROBOTICS_AI"]);
    expect(c.phapNhan.some((p) => p.laDuLieuThu)).toBe(false);
  });
  it("mã UAT_THU bị `kiemCauHinhCoSo` TỪ CHỐI như mọi mã lạ — không thể lưu cấu hình hay hoá đơn mang pháp nhân UAT trên PROD", () => {
    const danh = cauHinhHoaDonChoMoiTruong(PROD_VPS).phapNhan;
    const loi = kiemCauHinhCoSo({ centerId: "c1", phapNhanMa: "UAT_THU", kyHieu: "1C26UAT", hieuLucTu: "2026-01-01", hieuLucDen: "2026-12-31", dangBat: true }, [], danh);
    expect(loi.join(" | ")).toMatch(/chưa được khai trong hệ thống/);
  });
  it("`phapNhanChoDon` trên PROD không bao giờ trả pháp nhân UAT, với mọi cơ sở kể cả mã lạ / rỗng", () => {
    for (const cs of ["CS1", "CS2", "HO", "CS999", "", null, undefined]) {
      const p = phapNhanChoDon(cs, cauHinhHoaDonChoMoiTruong(PROD_VPS));
      expect(p?.ma).not.toBe("UAT_THU");
      expect(MA_THAT).toContain(p?.ma);
    }
  });
});

describe("[PNT-03] TEST: thấy thêm ĐÚNG MỘT pháp nhân thử, ở CUỐI, không bao giờ là mặc định", () => {
  const c = cauHinhHoaDonChoMoiTruong(TEST_VPS);
  it("ba pháp nhân thật giữ nguyên (cùng tham chiếu) + UAT ở cuối", () => {
    expect(c.phapNhan).toHaveLength(MA_THAT.length + 1);
    c.phapNhan.slice(0, MA_THAT.length).forEach((p, i) => expect(p).toBe(CAU_HINH_HOA_DON_MAC_DINH.phapNhan[i]));
    expect(c.phapNhan.at(-1)).toBe(PHAP_NHAN_UAT);
  });
  it("mọi thứ còn lại của cấu hình KHÔNG đổi: ánh xạ cơ sở · mặc định · thuế", () => {
    expect(c.macDinhTheoCoSo).toBe(CAU_HINH_HOA_DON_MAC_DINH.macDinhTheoCoSo);
    expect(c.phapNhanMacDinh).toBe(CAU_HINH_HOA_DON_MAC_DINH.phapNhanMacDinh);
    expect(c.thue).toBe(CAU_HINH_HOA_DON_MAC_DINH.thue);
    expect(c.macDinhTheoCoSo.some((m) => m.maPhapNhan === "UAT_THU")).toBe(false);
    expect(c.phapNhanMacDinh).not.toBe("UAT_THU");
  });
  it("không cơ sở nào (kể cả mã lạ / rỗng) bị gán UAT làm mặc định, kể cả khi pháp nhân thật TẮT một phần", () => {
    for (const cs of ["CS1", "CS2", "HO", "CS999", "", null, undefined]) expect(phapNhanChoDon(cs, c)?.ma).not.toBe("UAT_THU");
    const tatHaiPhanBa = { ...c, phapNhan: c.phapNhan.map((p, i) => (i < 2 ? { ...p, bat: false } : p)) };
    expect(phapNhanChoDon("CS2", tatHaiPhanBa)?.ma).not.toBe("UAT_THU"); // còn pháp nhân thật thứ ba bật ⇒ vẫn là nó, không phải UAT
  });
  it("danh sách TEST vẫn hợp lệ với luật cấu hình hoá đơn chung (mã không trùng · MST 10 số · có địa chỉ · ánh xạ trỏ đúng)", () => {
    expect(kiemCauHinhHoaDon(c)).toEqual([]);
  });
});

describe("[PNT-04] TEST: kiểm cấu hình KHÔNG bị nới", () => {
  const danh = cauHinhHoaDonChoMoiTruong(TEST_VPS).phapNhan;
  const dau = { centerId: "c1", phapNhanMa: "UAT_THU", kyHieu: "1C26UAT", hieuLucTu: "2026-01-01", hieuLucDen: "2026-12-31", dangBat: true };
  it("UAT_THU + 1C26UAT hiệu lực 2026 ⇒ hợp lệ", () => {
    expect(kiemCauHinhCoSo(dau, [], danh)).toEqual([]);
  });
  it.each([
    ["mã pháp nhân lạ vẫn bị từ chối", { phapNhanMa: "KHAC" }, /chưa được khai trong hệ thống/],
    ["ký hiệu sai dạng vẫn bị từ chối", { kyHieu: "UAT" }, /không đúng dạng/],
    ["ký hiệu sai năm vẫn bị từ chối", { kyHieu: "1C25UAT" }, /mang năm/],
    ["ngày vượt một năm vẫn bị từ chối", { hieuLucDen: "2027-06-30" }, /MỘT năm/],
  ])("%s", (_t, ghiDe, mong) => {
    expect(kiemCauHinhCoSo({ ...dau, ...ghiDe }, [], danh).join(" | ")).toMatch(mong);
  });
  it("chồng ngày với dòng đang bật của CÙNG cơ sở vẫn bị từ chối", () => {
    const daCo = [{ id: "x", centerId: "c1", phapNhanMa: "NEW_VISION", kyHieu: "1C26MNV", hieuLucTu: "2026-06-01", hieuLucDen: "2026-12-31", dangBat: true }];
    expect(kiemCauHinhCoSo(dau, daCo as never, danh).join(" | ")).toMatch(/Trùng khoảng ngày/);
  });
});

describe("[PNT-05] dữ liệu THỬ tự khai mình là giả — ba lớp độc lập", () => {
  // Chữ số kiểm tra MST Việt Nam (10 số): Σ d_i·w_i với w = 31,29,23,19,17,13,7,5,3 cho 9 số đầu; c = 10 − (Σ mod 11); hợp lệ khi c ≤ 9 và bằng số thứ 10.
  const hopLeCheck = (mst: string) => {
    const w = [31, 29, 23, 19, 17, 13, 7, 5, 3];
    const s = w.reduce((t, x, i) => t + x * Number(mst[i]), 0);
    const c = 10 - (s % 11);
    return c <= 9 && c === Number(mst[9]);
  };
  it("bộ kiểm chữ số đúng với ba MST thật đã khai (đối chứng dương — nếu sai bộ kiểm thì lớp dưới vô nghĩa)", () => {
    for (const p of CAU_HINH_HOA_DON_MAC_DINH.phapNhan) expect(hopLeCheck(p.maSoThue), p.maSoThue).toBe(true);
  });
  it("lớp 1 — MST thử mang chữ số kiểm tra SAI ⇒ không thể là MST đã cấp cho doanh nghiệp nào; khác mọi MST thật", () => {
    expect(PHAP_NHAN_UAT.maSoThue).toBe("9900000091");
    expect(hopLeCheck(PHAP_NHAN_UAT.maSoThue)).toBe(false);
    expect(MA_THAT).not.toContain(PHAP_NHAN_UAT.ma);
    expect(CAU_HINH_HOA_DON_MAC_DINH.phapNhan.map((p) => p.maSoThue)).not.toContain(PHAP_NHAN_UAT.maSoThue);
  });
  it("lớp 2 — tên mở đầu dấu hiệu UAT (tự đi vào snapshot hoá đơn); cờ laDuLieuThu chỉ có ở pháp nhân thử", () => {
    expect(PHAP_NHAN_UAT.ten.startsWith("[UAT — DỮ LIỆU THỬ")).toBe(true);
    expect(PHAP_NHAN_UAT.laDuLieuThu).toBe(true);
    for (const p of CAU_HINH_HOA_DON_MAC_DINH.phapNhan) expect(p.laDuLieuThu).toBeUndefined();
  });
  it("lớp 3 — không có đường phát hành thật: không phần mềm phát hành ⇒ không nút MISA; không ký hiệu mặc định; email không thể gửi tới", () => {
    expect(PHAP_NHAN_UAT.phanMem).toBeUndefined();
    expect(laPhapNhanMisa(PHAP_NHAN_UAT)).toBe(false);
    expect(PHAP_NHAN_UAT.kyHieu).toBeUndefined();
    expect(PHAP_NHAN_UAT.email).toMatch(/@example\.invalid$/);
  });
});

// ── LƯỚI GHIM MÃ NGUỒN ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Hành vi đã có ở trên; lưới này canh thứ chúng KHÔNG thấy: một nơi MỚI đi vòng qua cửa. Đọc mã đã BỎ CHÚ THÍCH (luật 11), neo vào tên, không vào chỗ đặt dòng.
const goc = process.cwd();
const doc = (p: string) => readFileSync(resolve(goc, p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
function tepNguon(thuMuc: string): string[] {
  const kq: string[] = [];
  for (const ten of readdirSync(resolve(goc, thuMuc))) {
    if (ten === "node_modules" || ten === ".next" || ten.startsWith(".")) continue;
    const p = join(thuMuc, ten);
    if (statSync(resolve(goc, p)).isDirectory()) kq.push(...tepNguon(p));
    else if (/\.tsx?$/.test(ten) && !/\.test\.tsx?$/.test(ten)) kq.push(p.replace(/\\/g, "/"));
  }
  return kq;
}

describe("[PNT-W1] mọi nơi dùng danh sách pháp nhân đi qua MỘT cửa", () => {
  const tep = [...tepNguon("lib"), ...tepNguon("app")];
  it("không tệp mã nào ngoài phap-nhan.ts dùng CAU_HINH_HOA_DON_MAC_DINH trực tiếp (script báo cáo PROD ở scripts/ cố ý dùng danh sách thật)", () => {
    expect(tep.length).toBeGreaterThan(500); // đừng để lưới rỗng vì sai đường dẫn
    const dungThang = tep.filter((p) => p !== "lib/finance/hoa-don/phap-nhan.ts" && p !== "lib/finance/hoa-don/phap-nhan-theo-moi-truong.ts" && /CAU_HINH_HOA_DON_MAC_DINH/.test(boChuThich(doc(p))));
    expect(dungThang).toEqual([]);
  });
  it("PHAP_NHAN_UAT chỉ được nhắc ở phap-nhan.ts (định nghĩa) và phap-nhan-theo-moi-truong.ts (cửa duy nhất)", () => {
    const nhac = tep.filter((p) => /PHAP_NHAN_UAT/.test(boChuThich(doc(p))));
    expect(nhac.sort()).toEqual(["lib/finance/hoa-don/phap-nhan-theo-moi-truong.ts", "lib/finance/hoa-don/phap-nhan.ts"]);
  });
  it("trong phap-nhan.ts, hằng CAU_HINH_HOA_DON_MAC_DINH KHÔNG chứa UAT / MST 9900… / laDuLieuThu", () => {
    const src = boChuThich(doc("lib/finance/hoa-don/phap-nhan.ts"));
    const i = src.indexOf("export const CAU_HINH_HOA_DON_MAC_DINH");
    const j = src.indexOf("export const PHAP_NHAN_UAT"); // hằng UAT đứng NGAY SAU hằng thật, tách riêng
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    const khoi = src.slice(i, j);
    expect(khoi).not.toMatch(/UAT|9900|laDuLieuThu/);
  });
});

describe("[PNT-W2] cửa duy nhất: điều kiện là HAI khoá nối bằng && — không có nhánh hoặc", () => {
  const src = boChuThich(doc("lib/finance/hoa-don/phap-nhan-theo-moi-truong.ts"));
  it("choPhepPhapNhanThu = hostUngDungLaTest(env) && !laProductionThat(env)", () => {
    expect(src).toMatch(/return\s+hostUngDungLaTest\(env\)\s*&&\s*!laProductionThat\(env\);/);
    expect(src.match(/hostUngDungLaTest\(/g)).toHaveLength(1);
    expect(src.match(/laProductionThat\(/g)).toHaveLength(1);
  });
  it("không đọc biến env nào khác, không có công tắc", () => {
    expect(src).not.toMatch(/process\.env\.[A-Z_]+/);
    expect(src).not.toMatch(/\benv\.[A-Z_]+/);
    expect(src).not.toMatch(/env\[/);
  });
  it("PROD trả CHÍNH hằng (không spread) — nhánh không-được-phép trả CAU_HINH_HOA_DON_MAC_DINH nguyên", () => {
    expect(src).toMatch(/if\s*\(!choPhepPhapNhanThu\(env\)\)\s*return\s+CAU_HINH_HOA_DON_MAC_DINH;/);
  });
});
