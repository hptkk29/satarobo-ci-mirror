/**
 * Ca [MNA-*] — ô «Mã NV giới thiệu» là CHỮ TỰ DO: SĐT phụ huynh / tên người dán nhầm KHÔNG ĐƯỢC hiện cho người KHÔNG có quyền PII (`ma` = phần hiện cho mọi người; `raw` chỉ qua cổng quyền). THUẦN.
 *
 * ⚠️ ĐỌC LÝ LẼ trước khi sửa: bản 11/10 ghim «chuỗi không phải dạng mã KHÔNG được LƯU». Lý lẽ thật là «không để lộ PII cho người không có quyền». Vòng UAT cuối (§22) chủ dự án đòi người duyệt thấy
 * chuỗi gốc ⇒ `raw` ĐƯỢC LƯU, và chỗ chặn chuyển sang cổng ĐỌC có tham số quyền bắt buộc (`docMaNvSai(…, canViewPii)`; ca mới ở `ma-nv-goc.test.ts` [MNG-*]). Các ca dưới đây giữ nguyên lý lẽ chống rò,
 * chỉ đổi CHỖ đo: từ «JSON được lưu» sang «dữ liệu server trả cho người không có quyền».
 *
 *   [MNA-01]  `laDangMaNv`: mã nhân viên thật được giữ; SĐT (mọi dạng viết) · tên (có dấu / không dấu / có khoảng trắng) · email · chữ trơn · dãy số dài bị che
 *   [MNA-02]  `maNvSaiTuKetQua` / `maNvSaiKhacMa`: JSON của kết quả KHÔNG chứa dãy ≥ 8 chữ số hay chữ người nhập khi nó không phải dạng mã; mã dạng NV (kể cả KHÔNG tồn tại) vẫn hiện để người duyệt sửa
 *   [MNA-03]  `maNvSaiKhacMa` kiểm TỪNG mã trước khi nối (kiểm sau khi nối thì mọi giá trị bị che vì có khoảng trắng)
 *   [MNA-04]  `maNvSaiCuaDong` che LẠI lúc đọc: dòng ghi trước bản vá mang nguyên SĐT/tên ⇒ không bao giờ hiện; hình lạ ⇒ null; dấu «có một mã sai» KHÔNG biến mất khi `ma` bị che
 *   [MNA-08]  VÒNG ghi → JSON → đọc của `KHAC_MA`: các mã xung đột (đã nối « | ») ra tới người duyệt NGUYÊN VẸN; chỉ cần MỘT phần không có dạng mã (SĐT/tên) là che TOÀN BỘ
 *   [MNA-05]  chữ hiển thị `nhanMaNvDaGo`: mã ⇒ chính nó; bị che ⇒ nói THẬT «đã ẩn» + độ dài, không để trống
 *   [MNA-W1]  lưới dây nối: mọi chỗ dựng `MaNvSai` / ghi `signals.maNvSai|maNvKhongGiai` / đọc `maNvSaiCuaDong` đi qua cổng chung
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { docMaNvSai, laDangMaNv, maNvLuuDuoc, MA_NV_TOI_DA } from "./ma-nv-an-toan";
import { maNvSaiKhacMa, maNvSaiTuKetQua, type KetQuaMaNv } from "./ma-nv-gioi-thieu";
import { maNvSaiCuaDong } from "./ly-do-hang-cho";
import { chuanHoaMaNhanVien } from "./ma-nhan-vien";
import { nhanMaNvDaGo } from "./nhan-hien-thi";

const CON = ["INVALID_EMPLOYEE_REFERRER_CODE"];
/** Có dãy ≥ 8 chữ số (kể cả bị ngăn bằng dấu chấm / gạch / cách) ở bất kỳ đâu trong JSON? */
const coNghiSdt = (v: unknown): boolean => JSON.stringify(v).replace(/[^0-9]/g, "").length >= 8;
const hoi = (raw: string): KetQuaMaNv => ({ kieu: "BO_QUA", lyDo: "x", phanLoai: "KHONG_TON_TAI", ma: chuanHoaMaNhanVien(raw), raw });
/** Đúng cái người KHÔNG có quyền PII nhận được từ server cho một `MaNvSai` vừa lưu (vòng ghi → JSON → đọc). */
const choNguoiKhongQuyen = (luu: unknown) => docMaNvSai(JSON.parse(JSON.stringify(luu)), false);

const MA_THAT = ["SR.NV.999", "NV.SR.002", "EMNV.NV.001", "SR.NV.002", "sr.nv.011"];
const SDT = ["0905123456", "0905.123.456", "090-512-3456", "090 512 3456", "+84905123456", "84905123456", "905123456", "0905123456789", "12345678"];
const TEN = ["Nguyễn Văn A", "NGUYEN VAN A", "nguyen.van.a", "EMNV Nguyễn Văn Sale", "Trần Thị B", "NGUYENVANA"];
const KHAC = ["a@b.com", "SR NV 002", "SR/NV/002", "SR.NV.002 (cũ)", "AB", "", "SR.NV.", "..", "X".repeat(MA_NV_TOI_DA + 1) + "1"];

describe("[MNA-01] laDangMaNv — chỉ dạng mã nhân viên mới được lưu nguyên", () => {
  it("mã nhân viên thật (đã chuẩn hoá) ⇒ true", () => {
    for (const m of MA_THAT) expect(laDangMaNv(chuanHoaMaNhanVien(m)), m).toBe(true);
  });
  it("SĐT ở mọi dạng viết ⇒ false (kể cả bị ngăn bằng dấu chấm — đếm TỔNG chữ số, không đếm dãy liền)", () => {
    for (const s of SDT) expect(laDangMaNv(chuanHoaMaNhanVien(s)), s).toBe(false);
  });
  it("tên người (có dấu, không dấu, có khoảng trắng, chữ trơn) ⇒ false", () => {
    for (const t of TEN) expect(laDangMaNv(chuanHoaMaNhanVien(t)), t).toBe(false);
  });
  it("email · ký tự lạ · quá ngắn/dài · không có chữ số ⇒ false", () => {
    for (const k of KHAC) expect(laDangMaNv(chuanHoaMaNhanVien(k)), k).toBe(false);
  });
  it("biên: 7 chữ số tổng vẫn là mã, 8 chữ số thì không; đúng MA_NV_TOI_DA ký tự vẫn nhận, hơn 1 thì không", () => {
    expect(laDangMaNv("SR.1234567")).toBe(true);
    expect(laDangMaNv("SR.12345678")).toBe(false);
    expect(laDangMaNv(`${"A".repeat(MA_NV_TOI_DA - 1)}1`)).toBe(true);
    expect(laDangMaNv(`${"A".repeat(MA_NV_TOI_DA)}1`)).toBe(false);
  });
  it("maNvLuuDuoc: có dạng ⇒ chính nó; không ⇒ null", () => {
    expect(maNvLuuDuoc("SR.NV.999")).toBe("SR.NV.999");
    expect(maNvLuuDuoc("0905123456")).toBeNull();
  });
});

describe("[MNA-02] maNvSaiTuKetQua — không SĐT/tên nào lọt vào kết quả", () => {
  it("SĐT dán vào ô mã ⇒ ma = null, doDai giữ độ dài; phần NGƯỜI KHÔNG QUYỀN nhận được không có dãy số nghi SĐT (raw vẫn lưu để người có quyền thấy)", () => {
    for (const s of SDT) {
      const kq = maNvSaiTuKetQua(hoi(s));
      expect(kq, s).toMatchObject({ ma: null, loai: "KHONG_TON_TAI" });
      expect(kq!.doDai, s).toBe(chuanHoaMaNhanVien(s).length);
      expect(coNghiSdt(kq!.ma), s).toBe(false);
      expect(coNghiSdt(choNguoiKhongQuyen(kq)), s).toBe(false);
    }
  });
  it("tên người ⇒ ma = null; phần người KHÔNG QUYỀN nhận được không chứa họ tên", () => {
    for (const t of TEN) {
      const kq = maNvSaiTuKetQua(hoi(t));
      expect(kq!.ma, t).toBeNull();
      expect(JSON.stringify(choNguoiKhongQuyen(kq)), t).not.toMatch(/NGUY|TR[ẦA]N|SALE/i);
    }
  });
  it("ĐỐI CHỨNG DƯƠNG: mã dạng NV nhưng không tồn tại vẫn hiện nguyên để người duyệt sửa; BO_QUA mới là mã sai, DUNG/KHONG_CO ⇒ null", () => {
    expect(maNvSaiTuKetQua(hoi("SR.NV.999"))).toEqual({ ma: "SR.NV.999", loai: "KHONG_TON_TAI", doDai: 9, raw: "SR.NV.999" });
    expect(maNvSaiTuKetQua({ kieu: "DUNG", employeeId: "E" })).toBeNull();
    expect(maNvSaiTuKetQua({ kieu: "KHONG_CO" })).toBeNull();
  });
});

describe("[MNA-03] maNvSaiKhacMa — kiểm TỪNG mã trước khi nối", () => {
  it("các mã đúng dạng ⇒ nối « | » và sắp, không phụ thuộc thứ tự", () => {
    expect(maNvSaiKhacMa(["SR.NV.003", "SR.NV.001"])).toEqual({ ma: "SR.NV.001 | SR.NV.003", loai: "KHAC_MA", doDai: 18, raw: "SR.NV.001 | SR.NV.003" });
  });
  it("lẫn mã thật với SĐT ⇒ giữ mã thật, bỏ SĐT; không còn mã nào có dạng ⇒ ma = null", () => {
    const lan = maNvSaiKhacMa(["SR.NV.001", "0905123456"]);
    expect(lan.ma).toBe("SR.NV.001");
    expect(coNghiSdt(lan.ma)).toBe(false);
    expect(coNghiSdt(choNguoiKhongQuyen(lan))).toBe(false);
    const toanSdt = maNvSaiKhacMa(["0905123456", "0912345678"]);
    expect(toanSdt).toEqual({ ma: null, loai: "KHAC_MA", doDai: 20, raw: "0905123456 | 0912345678" });
    expect(coNghiSdt(toanSdt.ma)).toBe(false);
    expect(coNghiSdt(choNguoiKhongQuyen(toanSdt))).toBe(false);
  });
});

describe("[MNA-04] maNvSaiCuaDong che LẠI lúc đọc (lớp thứ hai)", () => {
  it("dòng GHI TRƯỚC bản vá lưu nguyên SĐT/tên ⇒ không bao giờ ra khỏi hàm đọc; dấu «có mã sai» còn", () => {
    for (const s of [...SDT, ...TEN]) {
      const r = maNvSaiCuaDong({ xemTay: CON, maNvSai: { ma: chuanHoaMaNhanVien(s), loai: "KHONG_TON_TAI" } }, false);
      expect(r, s).not.toBeNull();
      expect(r!.ma, s).toBeNull();
      expect(r!.doDai, s).toBe(chuanHoaMaNhanVien(s).length);
      expect(coNghiSdt(r), s).toBe(false);
    }
  });
  it("dòng cũ lưu mã dạng NV ⇒ vẫn hiện; thiếu doDai ⇒ suy từ độ dài", () => {
    expect(maNvSaiCuaDong({ xemTay: CON, maNvSai: { ma: "SR.NV.999", loai: "KHONG_TON_TAI" } }, false)).toEqual({ ma: "SR.NV.999", loai: "KHONG_TON_TAI", doDai: 9, raw: null, coQuyenXem: false });
  });
  it("dòng MỚI đã che (ma = null) ⇒ vẫn ra marker, không bị coi là «không có mã sai»", () => {
    expect(maNvSaiCuaDong({ xemTay: CON, maNvSai: { ma: null, loai: "KHONG_TON_TAI", doDai: 10 } }, false)).toEqual({ ma: null, loai: "KHONG_TON_TAI", doDai: 10, raw: null, coQuyenXem: false });
  });
  it("hình lạ ⇒ null (không đoán): ma rỗng · ma không phải chuỗi · loai thiếu · không phải đối tượng", () => {
    for (const hong of [{ ma: "", loai: "X" }, { ma: 1, loai: "X" }, { ma: "SR.NV.1" }, "SR.NV.999", null, [], { loai: 3 }]) {
      expect(docMaNvSai(hong, false), JSON.stringify(hong)).toBeNull();
    }
  });
  it("vẫn đòi dấu xem tay còn sống (người duyệt đã chọn người ⇒ vết gốc không hiện như đang chờ)", () => {
    expect(maNvSaiCuaDong({ xemTay: [], maNvSai: { ma: "SR.NV.999", loai: "KHONG_TON_TAI" } }, false)).toBeNull();
  });
});

describe("[MNA-08] KHAC_MA qua vòng ghi → JSON → đọc (lớp thứ hai KHÔNG che nhầm chuỗi đã nối)", () => {
  // Cổng đọc từng chạy `maNvLuuDuoc` trên CẢ chuỗi «SR.NV.001 | SR.NV.003»: khuôn mã không cho khoảng trắng ⇒ luôn null ⇒ người duyệt không bao giờ thấy các mã xung đột
  // dù phía ghi đã dựng để họ thấy. [MNA-03] chỉ đo phía GHI, [MNA-04] chỉ đo mã đơn — không ca nào đi hết vòng.
  const vong = (ma: string[]) => JSON.parse(JSON.stringify(maNvSaiKhacMa(ma))) as unknown;
  const dongCua = (v: unknown) => maNvSaiCuaDong({ xemTay: CON, maNvSai: v }, false);

  it("[MNA-08a] hai mã thật xung đột ⇒ đọc lại ra ĐÚNG chuỗi đã nối, cả ở docMaNvSai lẫn maNvSaiCuaDong; doDai giữ nguyên", () => {
    const v = vong(["SR.NV.003", "SR.NV.001"]);
    expect(docMaNvSai(v, false)).toEqual({ ma: "SR.NV.001 | SR.NV.003", loai: "KHAC_MA", doDai: 18, raw: null, coQuyenXem: false });
    expect(dongCua(v)).toEqual({ ma: "SR.NV.001 | SR.NV.003", loai: "KHAC_MA", doDai: 18, raw: null, coQuyenXem: false });
  });
  it("[MNA-08b] ba mã (tổng 9 chữ số, ≥ ngưỡng SĐT nếu đếm cả chuỗi) vẫn hiện — ngưỡng áp cho TỪNG phần", () => {
    const v = vong(["SR.NV.001", "SR.NV.002", "SR.NV.003"]);
    expect(docMaNvSai(v, false)?.ma).toBe("SR.NV.001 | SR.NV.002 | SR.NV.003");
  });
  it("[MNA-08c] một phần là SĐT/tên ⇒ che TOÀN BỘ chuỗi (ma = null) nhưng dấu «có mã sai» và doDai còn", () => {
    for (const hong of ["0905123456", "Nguyễn Văn A", "090-512-3456", "a@b.com", ""]) {
      const raw = { ma: `SR.NV.001 | ${hong}`, loai: "KHAC_MA", doDai: 20 };
      expect(docMaNvSai(raw, false), hong).toEqual({ ma: null, loai: "KHAC_MA", doDai: 20, raw: null, coQuyenXem: false });
      expect(dongCua(raw), hong).toEqual({ ma: null, loai: "KHAC_MA", doDai: 20, raw: null, coQuyenXem: false });
      expect(coNghiSdt(docMaNvSai(raw, false)), hong).toBe(false);
    }
  });
  it("[MNA-08d] ĐỐI CHỨNG: loại KHÁC không được hưởng cách tách này — «SR.NV.001 | SR.NV.003» ghi dưới loại KHONG_TON_TAI vẫn bị che (chỉ KHAC_MA nối bằng « | »)", () => {
    expect(docMaNvSai({ ma: "SR.NV.001 | SR.NV.003", loai: "KHONG_TON_TAI", doDai: 21 }, false)).toEqual({ ma: null, loai: "KHONG_TON_TAI", doDai: 21, raw: null, coQuyenXem: false });
  });
});

describe("[MNA-09] SĐT bị CẮT ĐÔI qua hai dòng Excel không được hiện lại (reviewer vòng 3)", () => {
  // Mỗi nửa chỉ 6-7 chữ số ⇒ qua ngưỡng tổng-chữ-số; lớp đọc tách KHAC_MA theo từng phần nên «0905123 | 456789» từng hiện NGUYÊN, ghép lại được thành SĐT.
  // Mã nhân viên thật luôn có ít nhất một chữ cái (SR.NV.001); dãy toàn số không phải mã ⇒ che.
  it("[MNA-09a] dãy toàn chữ số (không chữ cái) ⇒ không phải dạng mã, kể cả khi ngắn hơn ngưỡng SĐT", () => {
    for (const s of ["0905123", "456789", "123", "1234567", "12-34-56", "090.512.3"]) expect(laDangMaNv(s), s).toBe(false);
    expect(laDangMaNv("SR.1234567")).toBe(true); // đối chứng dương: có chữ cái thì vẫn là mã
    expect(laDangMaNv("A1")).toBe(false); // quá ngắn (đã có từ trước)
    expect(laDangMaNv("NV001")).toBe(true);
  });
  it("[MNA-09b] hai nửa SĐT nối bằng « | » dưới KHAC_MA ⇒ che TOÀN BỘ ở cả ghi lẫn đọc", () => {
    const ghi = JSON.parse(JSON.stringify(maNvSaiKhacMa(["0905123", "456789"]))) as { ma: unknown };
    expect(ghi.ma).toBeNull(); // phần hiện cho mọi người
    expect(JSON.stringify(choNguoiKhongQuyen(ghi))).not.toMatch(/0905123|456789/); // …và phần server trả cho người KHÔNG có quyền
    const doc = docMaNvSai({ ma: "0905123 | 456789", loai: "KHAC_MA", doDai: 16 }, false);
    expect(doc).toEqual({ ma: null, loai: "KHAC_MA", doDai: 16, raw: null, coQuyenXem: false });
  });
});

describe("[MNA-05] nhanMaNvDaGo — chữ hiển thị", () => {
  it("mã ⇒ chính mã; bị che ⇒ nói thật «đã ẩn» kèm độ dài, không để trống, không lộ nội dung", () => {
    expect(nhanMaNvDaGo({ ma: "SR.NV.999", doDai: 9 })).toBe("SR.NV.999");
    const che = nhanMaNvDaGo({ ma: null, doDai: 10 });
    expect(che).toMatch(/đã ẩn/);
    expect(che).toContain("10");
    expect(nhanMaNvDaGo({ ma: null, doDai: 0 })).toMatch(/đã ẩn/);
  });
});

// ── [MNA-W1] lưới dây nối — soi MÃ (bỏ chú thích), neo hẹp, đếm số lần khớp, không cờ /s (luật 11) ───────────────────────────────────────
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const docMa = (p: string): string =>
  doc(p)
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

describe("[MNA-W1] mọi đường tới `signals` / giao diện đi qua cổng chung", () => {
  it("hai hàm dựng MaNvSai đi qua cổng: `maNvSaiTuKetQua` gọi dungMaNvSai, `maNvSaiKhacMa` gọi maNvLuuDuoc TỪNG mã (map), cả hai không tự cắt chuỗi", () => {
    const m = docMa("lib/nguon/ma-nv-gioi-thieu.ts");
    expect(dem(m, /\bdungMaNvSai\(kq\.ma, kq\.phanLoai, kq\.raw\)/g)).toBe(1);
    expect(m).toMatch(/\.map\(\(n\) => maNvLuuDuoc\(n\.chuan\)\)/);
    // `ma` không bị cắt chuỗi (chỉ DANH SÁCH ứng viên của `raw` bị cắt ở `UNG_VIEN_TOI_DA`).
    expect(m).not.toMatch(/\bma\.slice\(|catMa/);
  });
  it("`signals.maNvSai` và `signals.maNvKhongGiai` chỉ ghi giá trị ĐÃ qua cổng", () => {
    const q = docMa("lib/nguon/quy-nguon.ts");
    expect(dem(q, /signals\.maNvSai = \{ ma: tin\.maNvSai\.ma, loai: tin\.maNvSai\.loai, doDai: tin\.maNvSai\.doDai, raw: tin\.maNvSai\.raw \}/g)).toBe(1);
    expect(dem(q, /signals\.maNvKhongGiai\s*=/g)).toBe(1);
    expect(q).toMatch(/const maAnToan = maNvLuuDuoc\(tin\.maNvKhongGiai\);/);
    expect(q).toMatch(/if \(maAnToan !== null\) signals\.maNvKhongGiai = maAnToan;/);
    expect(q).not.toMatch(/signals\.maNvKhongGiai\s*=\s*tin\./);
  });
  it("hàm đọc `maNvSaiCuaDong` che lại bằng docMaNvSai (không tự trả `signals.maNvSai.ma`)", () => {
    const d = docMa("lib/nguon/ly-do-hang-cho.ts");
    expect(dem(d, /return docMaNvSai\(signals\.maNvSai, canViewPii\);/g)).toBe(1);
    expect(d).not.toMatch(/signals\.maNvSai;\s*\n\s*return typeof ma/);
  });
  it("hai chỗ HIỂN THỊ cùng đi qua nhanMaNvDaGo; không còn in thẳng `maNvSai.ma`", () => {
    for (const t of ["components/admin/nguon-hoa-hong/nguon-status-pill.tsx", "components/admin/nguon-hoa-hong/thong-tin-nguon.tsx"]) {
      const s = docMa(t);
      expect(dem(s, /nhanMaNvDaGo\(/g), t).toBe(1);
      expect(s, t).not.toMatch(/\bmaNvSai\.ma\b/);
    }
  });
});
