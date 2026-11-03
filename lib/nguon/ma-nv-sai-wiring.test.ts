// @vitest-environment node
/**
 * Ca [MNR-W*] — LƯỚI DÂY NỐI của hướng F (mã NV giới thiệu SAI trong Excel). Test GREP MÃ NGUỒN: neo hẹp, bỏ chú thích, đếm SỐ LẦN khớp, không cờ `/s` (luật 11).
 *
 * Vì sao cần lưới mà không chỉ test hành vi: HAI route nhập Excel chạm DB (Postgres + auth + R2…) nên test hành vi nằm ở bộ DB (`nguon-excel-ma-nv.spec.ts`, bộ `[MNR-D*]`), và
 * một route QUÊN truyền `maNvSai` vào tín hiệu quy nguồn không làm ca THUẦN nào đỏ — lead chỉ lặng lẽ rơi lại UNKNOWN và mất mã (đúng lỗi hướng F sinh ra để sửa).
 *
 *   [MNR-W1]  CẢ HAI route: mã sai từ `giaiMaNvGioiThieuTheoLo` → `maNvSaiTuKetQua`, nhóm SĐT ghi mã khác nhau → `maNvSaiKhacMa(cacMaGocKhacNhau(…))`, và `maNvSai:` ĐI VÀO tín hiệu quy nguồn
 *  [MNR-W2]  CẢ HAI route nói THẬT về kết quả nguồn: `phanLoaiDongNhap` + `lyDoHangChoCuaKetQua`; route D trả `successWithReview` · `skipped` · `review`, route E trả `choDuyetNguon` · `nguonGiuNguyen`
 *  [MNR-W3]  `thuThapTinHieuTheoLo` chuyển `maNvSai` (không nuốt) và bộ luật đánh dấu xem tay MỌI lúc có mã sai (trừ kế thừa SĐT)
 *  [MNR-W4]  `NV_GIOI_THIEU_SAI` nằm đúng chỗ trong bảng luật: sau `NV_GIOI_THIEU`, trước `KHAI_TAY`, cờ con `referral`
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();
const ROUTE_D = "app/api/admin/import/leads/route.ts";
const ROUTE_E = "app/api/admin/import/leads/registered/route.ts";

/** Mã đã bỏ chú thích (dòng trước, khối sau) — lưới soi MÃ, không soi lời kể về mã. */
function docMa(p: string): string {
  return readFileSync(resolve(GOC, p), "utf8")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

describe.each([
  ["D · file sự kiện", ROUTE_D],
  ["E · file đăng ký", ROUTE_E],
])("[MNR-W1] %s — mã sai đi vào quy nguồn", (_ten, p) => {
  const ma = docMa(p);

  it("kết quả BO_QUA của hàm giải mã được dựng thành MaNvSai đúng MỘT lần (`maNvSaiTuKetQua(kq)`)", () => {
    expect(dem(ma, /maNvSaiTuKetQua\(kq\)/g)).toBe(1);
  });

  it("nhóm SĐT ghi mã KHÁC NHAU được dựng bằng `maNvSaiKhacMa(cacMaGocKhacNhau(…))` đúng MỘT lần, truyền ô GỐC (hàm giải mã không bao giờ thấy ca này)", () => {
    expect(dem(ma, /maNvSaiKhacMa\(cacMaGocKhacNhau\(/g)).toBe(1);
  });

  it("`maNvSai:` ĐI VÀO tín hiệu quy nguồn đúng MỘT lần — lấy từ mảng theo dòng, `?? null` (đối chứng: quên là lead rơi UNKNOWN mất mã)", () => {
    expect(dem(ma, /\bmaNvSai: maNvSaiCuaDong\[i\] \?\? null,/g)).toBe(1);
  });

  it("mảng theo dòng được KHAI và RESET mỗi vòng (`maNvSaiCuaDong[i] = null`) trước khi nhánh nào đó gán — không rò mã dòng trước sang dòng sau", () => {
    expect(dem(ma, /const maNvSaiCuaDong: \(MaNvSai \| null\)\[\] = \[\];/g)).toBe(1);
    expect(dem(ma, /maNvSaiCuaDong\[i\] = null;/g)).toBe(1);
  });
});

describe.each([
  ["D · file sự kiện", ROUTE_D, [/successWithReview: tk\.SUCCESS_WITH_REVIEW/g, /\bskipped: tk\.SKIPPED/g, /\breview\b\s*\}\)/g]],
  ["E · file đăng ký", ROUTE_E, [/choDuyetNguon: choDuyetSdt\.size/g, /nguonGiuNguyen: scopedMerges\.length/g]],
] as const)("[MNR-W2] %s — kết quả NGUỒN nói thật", (_ten, p, phanTra) => {
  const ma = docMa(p);

  it("phân loại bằng `phanLoaiDongNhap` với lý do hàng chờ LẤY TỪ KẾT QUẢ QUY NGUỒN (`lyDoHangChoCuaKetQua(cb.ketQua)`), không tự nghĩ điều kiện thứ hai", () => {
    expect(dem(ma, /lyDoHangChoCuaKetQua\(cb\.ketQua\)/g)).toBe(1);
    expect(dem(ma, /phanLoaiDongNhap\(\{/g)).toBeGreaterThanOrEqual(1);
  });

  it("phản hồi mang đủ trường kết quả nguồn", () => {
    for (const re of phanTra) expect(dem(ma, re), String(re)).toBe(1);
  });

  it("đối chứng dương: `phanLoaiDongNhap` được nhập từ `ket-qua-nhap` (không chép tay một bản thứ hai ở route)", () => {
    expect(dem(ma, /from "@\/lib\/nguon\/ket-qua-nhap"/g)).toBe(1);
    expect(dem(ma, /function phanLoaiDongNhap/g)).toBe(0);
  });
});

describe("[MNR-W3] tín hiệu quy nguồn không nuốt mã sai", () => {
  it("`thuThapTinHieuTheoLo` chuyển `maNvSai: r.maNvSai ?? null` đúng MỘT lần", () => {
    expect(dem(docMa("lib/nguon/thu-thap-tin-hieu.ts"), /\bmaNvSai: r\.maNvSai \?\? null,/g)).toBe(1);
  });

  it("`hoanTat` gắn dấu xem tay mã sai khi có `tin.maNvSai` — TRỪ KE_THUA_SDT (first-claim) — đúng MỘT lần; `signals.maNvSai` được ghi đúng MỘT lần", () => {
    const q = docMa("lib/nguon/quy-nguon.ts");
    expect(dem(q, /if \(tin\.maNvSai && luat !== "KE_THUA_SDT"\) xemTay\.push\("INVALID_EMPLOYEE_REFERRER_CODE"\);/g)).toBe(1);
    expect(dem(q, /if \(tin\.maNvSai\) signals\.maNvSai = \{ ma: tin\.maNvSai\.ma, loai: tin\.maNvSai\.loai, doDai: tin\.maNvSai\.doDai, raw: tin\.maNvSai\.raw \};/g)).toBe(1);
  });

  it("luật `NV_GIOI_THIEU_SAI` loại ca NHAN_MAU_THUAN (nhãn người nhập khai có chủ đích vẫn thắng) đúng MỘT lần", () => {
    expect(dem(docMa("lib/nguon/quy-nguon.ts"), /if \(!s \|\| s\.loai === "NHAN_MAU_THUAN"\) return null;/g)).toBe(1);
  });
});

describe("[MNR-W4] bảng luật", () => {
  const q = docMa("lib/nguon/quy-nguon.ts");

  it("THU_TU_LUAT_MAC_DINH: NV_GIOI_THIEU_SAI đứng NGAY SAU NV_GIOI_THIEU và TRƯỚC PH_GIOI_THIEU · KHAI_TAY", () => {
    const lay = (ma: string) => q.indexOf(`{ ma: "${ma}", bat: true }`);
    expect(lay("NV_GIOI_THIEU")).toBeGreaterThan(0);
    expect(lay("NV_GIOI_THIEU_SAI")).toBeGreaterThan(lay("NV_GIOI_THIEU"));
    expect(lay("PH_GIOI_THIEU")).toBeGreaterThan(lay("NV_GIOI_THIEU_SAI"));
    expect(lay("KHAI_TAY")).toBeGreaterThan(lay("NV_GIOI_THIEU_SAI"));
  });

  it("CO_CUA_LUAT: cùng cờ con `referral` với NV_GIOI_THIEU (tắt giới thiệu là tắt cả hai)", () => {
    expect(dem(q, /NV_GIOI_THIEU_SAI: "referral",/g)).toBe(1);
    expect(dem(q, /\bNV_GIOI_THIEU: "referral",/g)).toBe(1);
  });
});
