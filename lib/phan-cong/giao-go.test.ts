// [PCG2-*] Luật thuần giao / gỡ GĐ2. Mốc tuyệt đối, không đồng hồ thật (luật 19); mỗi ca xanh khi chạy một mình.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hetThang, hetThangSau, lyDoKhongGiaoDuoc, lyDoKhongGoTrucQua, ngayTheoPhamVi } from "./giao-go";

describe("ngayTheoPhamVi", () => {
  it("[PCG2-01] CHI_BUOI_NAY ⇒ đúng một ngày", () => {
    expect(ngayTheoPhamVi({ ngay: "2026-11-04", phamVi: "CHI_BUOI_NAY" })).toEqual(["2026-11-04"]);
  });
  it("[PCG2-02] CAC_TUAN_SAU ⇒ cùng thứ mỗi tuần tới hết THÁNG CỦA NGÀY ĐÓ (chủ dự án 26/10), không sang tháng sau", () => {
    const r = ngayTheoPhamVi({ ngay: "2026-11-04", phamVi: "CAC_TUAN_SAU" });
    expect(r).toEqual(["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"]);
    for (const d of r) expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(3);
    // Tuần cuối tháng: hai phạm vi trùng nhau (không có tuần nào sau trong tháng).
    expect(ngayTheoPhamVi({ ngay: "2026-10-29", phamVi: "CAC_TUAN_SAU" })).toEqual(["2026-10-29"]);
  });
  it("[PCG2-02b] hết tháng: tháng 2, tháng 31 ngày, qua năm", () => {
    expect(hetThang("2027-02-03")).toBe("2027-02-28");
    expect(hetThang("2026-10-01")).toBe("2026-10-31");
    expect(hetThang("2026-12-31")).toBe("2026-12-31");
  });
  it("[PCG2-03] hết tháng sau (mặc định Áp khung): qua năm và tháng 2", () => {
    expect(hetThangSau("2026-12-10")).toBe("2027-01-31");
    expect(hetThangSau("2027-01-31")).toBe("2027-02-28");
    expect(hetThangSau("2027-12-01")).toBe("2028-01-31");
  });
});

describe("lyDoKhongGiaoDuoc", () => {
  it("[PCG2-04] ngày đã qua ⇒ chặn; hôm nay và ngày tới ⇒ được (đối chứng)", () => {
    expect(lyDoKhongGiaoDuoc({ ngay: "2026-11-03", homNay: "2026-11-04", trangThaiKy: null, boQuaNgayQua: false })).toMatch(/đã qua/);
    expect(lyDoKhongGiaoDuoc({ ngay: "2026-11-04", homNay: "2026-11-04", trangThaiKy: null, boQuaNgayQua: false })).toBeNull();
    expect(lyDoKhongGiaoDuoc({ ngay: "2026-11-05", homNay: "2026-11-04", trangThaiKy: "OPEN", boQuaNgayQua: false })).toBeNull();
  });
  it("[PCG2-05] kỳ đã chốt ⇒ chặn", () => {
    expect(lyDoKhongGiaoDuoc({ ngay: "2026-11-05", homNay: "2026-11-04", trangThaiKy: "LOCKED", boQuaNgayQua: false })).toMatch(/đã chốt/);
  });
  it("[GTQ-01] đường gỡ trực của Quản trị tối cao: ngày đã qua KHÔNG chặn, nhưng kỳ đã chốt VẪN chặn", () => {
    expect(lyDoKhongGiaoDuoc({ ngay: "2026-11-03", homNay: "2026-11-05", trangThaiKy: null, boQuaNgayQua: true })).toBeNull();
    expect(lyDoKhongGiaoDuoc({ ngay: "2026-11-03", homNay: "2026-11-05", trangThaiKy: "OPEN", boQuaNgayQua: true })).toBeNull();
    expect(lyDoKhongGiaoDuoc({ ngay: "2026-10-30", homNay: "2026-11-05", trangThaiKy: "LOCKED", boQuaNgayQua: true })).toMatch(/đã chốt/);
  });
});

describe("lyDoKhongGoTrucQua (chốt 05/11/2026)", () => {
  const du = { laQuanTriToiCao: true, giao: false, phamVi: "CHI_BUOI_NAY" as const, lyDo: "GV không trực thật" };
  it("[GTQ-02] Quản trị tối cao + gỡ + một buổi + đủ lý do ⇒ được", () => {
    expect(lyDoKhongGoTrucQua(du)).toBeNull();
  });
  it("[GTQ-03] không phải Quản trị tối cao ⇒ chặn (đối chứng âm của vai)", () => {
    expect(lyDoKhongGoTrucQua({ ...du, laQuanTriToiCao: false })).toMatch(/Quản trị tối cao/);
  });
  it("[GTQ-04] giao vào ngày đã qua ⇒ chặn, kể cả Quản trị tối cao", () => {
    expect(lyDoKhongGoTrucQua({ ...du, giao: true })).toMatch(/không giao/);
  });
  it("[GTQ-05] các tuần sau ⇒ chặn; thiếu / ngắn lý do ⇒ chặn", () => {
    expect(lyDoKhongGoTrucQua({ ...du, phamVi: "CAC_TUAN_SAU" })).toMatch(/Chỉ buổi này/);
    expect(lyDoKhongGoTrucQua({ ...du, lyDo: "  ab  " })).toMatch(/lý do/);
    expect(lyDoKhongGoTrucQua({ ...du, lyDo: undefined })).toMatch(/lý do/);
  });
  it("[GTQ-W1] dây nối: action hỏi vai THẬT ở máy chủ, chặn TRƯỚC khi ghi, và chỉ ngày đã qua mới mở cổng cho `datTruc`", () => {
    const src = readFileSync(resolve(process.cwd(), "app/(admin)/admin/cham-cong/phan-cong/_actions-gop.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect((src.match(/lyDoKhongGoTrucQua\(\{ laQuanTriToiCao: \(await resolveActor\(g\.actor\.id\)\)\.isSuperAdmin,/g) ?? []).length).toBe(1);
    expect((src.match(/if \(chan\) return \{ ok: false, error: chan \};/g) ?? []).length).toBe(1);
    expect(src).toMatch(/const goNgayQua = laNgayDaQua\(p\.data\.ngay, homNay\);/);
    expect(src.indexOf("lyDoKhongGoTrucQua(")).toBeLessThan(src.indexOf("datTruc(tx"));
  });
});
