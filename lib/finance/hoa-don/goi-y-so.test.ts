// Ca [GYS-*] — gợi ý số hoá đơn + kiểm trùng theo DÃY (PR3).
import { describe, expect, it } from "vitest";
import { goiYSo, khoaDay, mstCuaDay, soDaCoTrongDay, soDaDungCuaDay, type HoaDonCoSo } from "./goi-y-so";

const MST_SATA = "0402301783";
const MST_NV = "0402341070";
const mstTheoMa = (ma: string) => ({ SATA_ROBO: MST_SATA, NEW_VISION: MST_NV })[ma];
const h = (o: Partial<HoaDonCoSo> & Pick<HoaDonCoSo, "soHoaDon">): HoaDonCoSo => ({ phapNhanMst: MST_SATA, kyHieu: "1C26MAI", maCoSo: "CS1", ...o });

// Dữ liệu ĐÚNG HÌNH DẠNG prod 23/10/2026: CS1 số 2,4,5,6,7,8 (thiếu 1,3) — CS2 số 13…36 có lỗ, MST lưu là Sata.
const CS1 = [2, 4, 5, 6, 7, 8].map((n) => h({ soHoaDon: String(n) }));
const CS2_CU = [13, 14, 15, 27, 28, 29, 30, 31, 33, 34, 35, 36].map((n) => h({ soHoaDon: String(n), kyHieu: "1C26MNV", maCoSo: "CS2", phapNhanMst: MST_SATA }));

describe("[GYS-01] đề xuất = số lớn nhất + 1, KHÔNG lấp số thiếu", () => {
  it("CS1: có lỗ 1 và 3 ⇒ vẫn đề xuất 9, không đề xuất 1 hay 3", () => {
    const so = soDaDungCuaDay(CS1, { mst: MST_SATA, kyHieu: "1C26MAI" }, mstTheoMa);
    expect(so).toEqual([2, 4, 5, 6, 7, 8]);
    expect(goiYSo(so)).toEqual({ loai: "CO", so: 9, max: 8, soLuong: 6 });
  });
  it("dãy rỗng ⇒ CHUA_CO — không giả định bắt đầu từ 1", () => {
    expect(goiYSo([])).toEqual({ loai: "CHUA_CO" });
    expect(soDaDungCuaDay([], { mst: MST_SATA, kyHieu: "1C27MAI" }, mstTheoMa)).toEqual([]);
  });
  it("số được chuẩn hoá: '0000127' và '127' là MỘT số; chữ / rỗng bị bỏ", () => {
    const ds = [h({ soHoaDon: "0000127" }), h({ soHoaDon: "127" }), h({ soHoaDon: "abc" }), h({ soHoaDon: "" }), h({ soHoaDon: "0" })];
    expect(soDaDungCuaDay(ds, { mst: MST_SATA, kyHieu: "1C26MAI" }, mstTheoMa)).toEqual([127]);
  });
});

describe("[GYS-02] dãy = (MST, ký hiệu), KHÔNG phải cơ sở", () => {
  it("ký hiệu khác ⇒ dãy khác (CS1 không dính số của CS2)", () => {
    const tat = [...CS1, ...CS2_CU];
    expect(soDaDungCuaDay(tat, { mst: MST_SATA, kyHieu: "1C26MAI" }, mstTheoMa)).toEqual([2, 4, 5, 6, 7, 8]);
  });
  it("hai cơ sở CÙNG (MST, ký hiệu) ⇒ MỘT dãy chung: cơ sở này thấy số cơ sở kia đã dùng", () => {
    const chung = [h({ soHoaDon: "10", maCoSo: "CS1" }), h({ soHoaDon: "11", maCoSo: "CS2" })];
    expect(soDaDungCuaDay(chung, { mst: MST_SATA, kyHieu: "1C26MAI" }, mstTheoMa)).toEqual([10, 11]);
  });
  it("cùng ký hiệu nhưng MST KHÁC (pháp nhân khác) ⇒ dãy khác", () => {
    const ds = [h({ soHoaDon: "5", phapNhanMst: MST_NV, kyHieu: "1C26ZZZ" }), h({ soHoaDon: "9", phapNhanMst: MST_SATA, kyHieu: "1C26ZZZ" })];
    expect(soDaDungCuaDay(ds, { mst: MST_NV, kyHieu: "1C26ZZZ" }, mstTheoMa)).toEqual([5]);
    expect(soDaDungCuaDay(ds, { mst: MST_SATA, kyHieu: "1C26ZZZ" }, mstTheoMa)).toEqual([9]);
  });
  it("ký hiệu so không phân biệt hoa/thường và khoảng trắng; MST bỏ dấu cách / gạch", () => {
    expect(soDaDungCuaDay([h({ soHoaDon: "3", kyHieu: " 1c26mai " })], { mst: "0402-301 783", kyHieu: "1C26MAI" }, mstTheoMa)).toEqual([3]);
  });
});

describe("[GYS-03] hoá đơn CŨ lưu sai pháp nhân vẫn nằm đúng dãy (không sửa dòng DB)", () => {
  it("CS2 + 1C26MNV lưu MST Sata ⇒ thuộc dãy New Vision: đề xuất 37, không phải số 1", () => {
    const so = soDaDungCuaDay(CS2_CU, { mst: MST_NV, kyHieu: "1C26MNV" }, mstTheoMa);
    expect(so).toEqual([13, 14, 15, 27, 28, 29, 30, 31, 33, 34, 35, 36]);
    expect(goiYSo(so)).toMatchObject({ loai: "CO", so: 37, max: 36 });
  });
  it("dãy Sata (1C26MNV) KHÔNG còn thấy chúng — tránh đề xuất số trong dãy sai", () => {
    expect(soDaDungCuaDay(CS2_CU, { mst: MST_SATA, kyHieu: "1C26MNV" }, mstTheoMa)).toEqual([]);
  });
  it("bản MỚI đã lưu đúng MST New Vision cùng nằm trong dãy với bản cũ", () => {
    const moi = h({ soHoaDon: "37", kyHieu: "1C26MNV", maCoSo: "CS2", phapNhanMst: MST_NV });
    const so = soDaDungCuaDay([...CS2_CU, moi], { mst: MST_NV, kyHieu: "1C26MNV" }, mstTheoMa);
    expect(so.at(-1)).toBe(37);
    expect(soDaCoTrongDay(so, "30")).toBe(true);
  });
  it("hoá đơn KHÔNG khớp quy tắc giữ MST đã lưu", () => {
    expect(mstCuaDay(h({ soHoaDon: "1" }), mstTheoMa)).toBe(MST_SATA);
    expect(mstCuaDay(h({ soHoaDon: "1", maCoSo: "CS1", kyHieu: "1C26MNV" }), mstTheoMa)).toBe(MST_SATA);
  });
});

describe("[GYS-04] kiểm trùng + khoá", () => {
  it("số đã dùng (kể cả số chuẩn hoá) ⇒ true; số chưa dùng / không phải số ⇒ false", () => {
    const so = [2, 4, 8];
    expect(soDaCoTrongDay(so, "4")).toBe(true);
    expect(soDaCoTrongDay(so, "0004")).toBe(true);
    expect(soDaCoTrongDay(so, "3")).toBe(false);
    expect(soDaCoTrongDay(so, "x")).toBe(false);
  });
  it("khoá dãy ổn định, không phụ thuộc cách viết hoa/MST", () => {
    expect(khoaDay({ mst: "0402-301 783", kyHieu: " 1c26mai " })).toBe(khoaDay({ mst: MST_SATA, kyHieu: "1C26MAI" }));
    expect(khoaDay({ mst: MST_SATA, kyHieu: "1C26MAI" })).not.toBe(khoaDay({ mst: MST_NV, kyHieu: "1C26MAI" }));
  });
});
