// [SBQ-*] "Sửa buổi đã qua" (chủ dự án 20/10/2026) — luật thuần + dây nối. DB thật: tests/cham-cong/parttime-sua-buoi-da-qua.spec.ts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { laBuoiDaQua, loiSuaBuoiDaQua, nguoiLienQuan } from "./sua-buoi-da-qua";

const v = (p: Partial<Parameters<typeof loiSuaBuoiDaQua>[0]> = {}) =>
  loiSuaBuoiDaQua({ ngay: "2026-11-16", homNay: "2026-11-20", tinhTrang: "MO", apDung: true, kyDaChot: false, lyDo: "Cô A dạy thay thầy B ốm", ...p });

describe("[SBQ] luật", () => {
  it("[SBQ-01] đã qua = đã chốt, hoặc còn mở mà ngày trước hôm nay; hôm nay còn mở thì CHƯA qua", () => {
    expect(laBuoiDaQua({ ngay: "2026-11-25", tinhTrang: "DA_CHOT" }, "2026-11-20")).toBe(true);
    expect(laBuoiDaQua({ ngay: "2026-11-19", tinhTrang: "MO" }, "2026-11-20")).toBe(true);
    expect(laBuoiDaQua({ ngay: "2026-11-20", tinhTrang: "MO" }, "2026-11-20")).toBe(false);
    expect(laBuoiDaQua({ ngay: "2026-11-19", tinhTrang: "DA_DONG" }, "2026-11-20")).toBe(false);
  });
  it("[SBQ-02] cổng: hợp lệ ⇒ null; chính sách cũ · buổi đóng · chưa qua · kỳ đã chốt · lý do ngắn ⇒ lý do riêng", () => {
    expect(v()).toBeNull();
    expect(v({ apDung: false })).toMatch(/chính sách cũ/);
    expect(v({ tinhTrang: "DA_DONG" })).toMatch(/huỷ/);
    expect(v({ ngay: "2026-11-20" })).toMatch(/chưa qua/);
    expect(v({ kyDaChot: true })).toBe("Kỳ công tháng 11/2026 của cơ sở đã chốt — mở lại kỳ trước khi sửa buổi.");
    expect(v({ lyDo: "ngắn" })).toMatch(/tối thiểu 10/);
    // Màn hỏi TRƯỚC khi có lý do (lyDo null) ⇒ không khoá vì lý do.
    expect(v({ lyDo: null })).toBeNull();
  });
  it("[SBQ-03] người liên quan: cũ + mới, bỏ trống, không trùng", () => {
    expect(nguoiLienQuan("a", "b")).toEqual(["a", "b"]);
    expect(nguoiLienQuan(null, "b")).toEqual(["b"]);
    expect(nguoiLienQuan("a", "a")).toEqual(["a"]);
  });
});

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("[SBQ-W] dây nối", () => {
  it("[SBQ-W1] ba thao tác phân công thường từ chối buổi đã qua (đi đường có lý do + nhật ký)", () => {
    const s = doc("app/(admin)/admin/cham-cong/phan-cong/_actions.ts");
    expect(s.match(/if \(await laBuoiDaQuaCua\([^)]*\)\) return \{ ok: false, error: DA_QUA \};/g)?.length ?? 0).toBe(3);
  });
  it("[SBQ-W2] action sửa buổi đã qua đi qua cổng chung + kiểm người được phân + suaBuoiDaQua", () => {
    const s = doc("app/(admin)/admin/cham-cong/phan-cong/_actions.ts");
    const than = s.slice(s.indexOf("export async function suaBuoiDaQuaAction"));
    expect(than).toMatch(/const g = await cong\(centerId, "STAFFING"\);\s*if \(!g\.ok\) return g;/);
    expect(than).toMatch(/kiemNguoiDuocPhan\(u, centerId!, g\.actor\.id\)/);
    expect(than).toMatch(/suaBuoiDaQua\(tx, \{/);
  });
  it("[SBQ-W3] màn tính lý do khoá bằng CÙNG hàm action dùng (loiSuaBuoiDaQua) và CÙNG nguồn kỳ đã chốt", () => {
    const s = doc("app/(admin)/admin/cham-cong/phan-cong/page.tsx");
    expect(s).toMatch(/suaQua: laBuoiDaQua\(b, homNay\)/);
    expect(s).toMatch(/loiSuaBuoiDaQua\(\{[^}]*kyDaChot: kyDaChot\.has\(b\.ngay\.slice\(0, 7\)\)/);
  });
});
