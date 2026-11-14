/**
 * [CTQ-*] màn quản trị «Chia theo phường» — phần THUẦN (`apDungCapNhat`, `demPhuongDaDat`, `coSoCuaCacPhuong`) và danh mục địa chỉ (`phuong-xa.ts`).
 *   [CTQ-01] áp lượt chỉnh hợp lệ: đặt, ghi đè, gỡ (null); bảng cũ không bị sửa
 *   [CTQ-02] NGUYÊN KHỐI: một dòng sai ⇒ lỗi và KHÔNG trả bảng mới (cơ sở không hợp lệ · phường rỗng · trùng phường · thiếu thành phố · quá trần)
 *   [CTQ-03] đếm phường đã đặt chỉ trong thành phố đang xem; đọc lại cơ sở theo từng phường
 *   [CTQ-04] danh mục: «Tp Đà Nẵng» có trong gói, 94 phường/xã, sắp theo tiếng Việt; mã lạ ⇒ rỗng
 */
import { describe, expect, it } from "vitest";
import { apDungCapNhat, BANG_RONG, coSoCuaCacPhuong, demPhuongDaDat, TOI_DA_DONG_MOT_LAN } from "./chia-theo-phuong";
import { danhSachPhuongCuaTinh, danhSachTinh, idTinhTheoTen, TP_MAC_DINH } from "./phuong-xa";

const HOP_LE = new Set(["cs1", "cs2"]);
const DN = "Tp Đà Nẵng";

describe("[CTQ-01] áp lượt chỉnh hợp lệ", () => {
  it("đặt nhiều phường một lần", () => {
    const r = apDungCapNhat(BANG_RONG, DN, [{ phuong: "Phường Hải Châu", coSoId: "cs2" }, { phuong: "Phường Hòa Khánh", coSoId: "cs1" }], HOP_LE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bang.map).toEqual({ "da nang|hai chau": "cs2", "da nang|hoa khanh": "cs1" });
    expect(BANG_RONG.map).toEqual({});
  });
  it("ghi đè và gỡ (coSoId null)", () => {
    const co = { phienBan: 1 as const, map: { "da nang|hai chau": "cs2", "da nang|thanh khe": "cs1" } };
    const r = apDungCapNhat(co, DN, [{ phuong: "Phường Hải Châu", coSoId: "cs1" }, { phuong: "Phường Thanh Khê", coSoId: null }], HOP_LE);
    expect(r.ok && r.bang.map).toEqual({ "da nang|hai chau": "cs1" });
  });
  it("không đụng phường của thành phố khác", () => {
    const co = { phienBan: 1 as const, map: { "ha noi|ba dinh": "cs1" } };
    const r = apDungCapNhat(co, DN, [{ phuong: "Phường Hải Châu", coSoId: "cs2" }], HOP_LE);
    expect(r.ok && r.bang.map).toEqual({ "ha noi|ba dinh": "cs1", "da nang|hai chau": "cs2" });
  });
});

describe("[CTQ-02] nguyên khối: một dòng sai thì không lưu gì", () => {
  it("cơ sở không hợp lệ", () => {
    const r = apDungCapNhat(BANG_RONG, DN, [{ phuong: "Phường Hải Châu", coSoId: "cs2" }, { phuong: "Phường Hòa Khánh", coSoId: "cs_dong_cua" }], HOP_LE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.loi.join(" ")).toMatch(/Hòa Khánh/);
  });
  it("phường rỗng; phường trùng (kể cả viết khác)", () => {
    expect(apDungCapNhat(BANG_RONG, DN, [{ phuong: "  ", coSoId: "cs1" }], HOP_LE).ok).toBe(false);
    const trung = apDungCapNhat(BANG_RONG, DN, [{ phuong: "Phường Hải Châu", coSoId: "cs1" }, { phuong: "hải châu", coSoId: "cs2" }], HOP_LE);
    expect(trung.ok).toBe(false);
    if (!trung.ok) expect(trung.loi.join(" ")).toMatch(/hai lần/);
  });
  it("thiếu thành phố; quá trần số dòng", () => {
    expect(apDungCapNhat(BANG_RONG, "", [{ phuong: "Hải Châu", coSoId: "cs1" }], HOP_LE).ok).toBe(false);
    const nhieu = Array.from({ length: TOI_DA_DONG_MOT_LAN + 1 }, (_, i) => ({ phuong: `P${i}`, coSoId: "cs1" }));
    expect(apDungCapNhat(BANG_RONG, DN, nhieu, HOP_LE).ok).toBe(false);
  });
  it("gỡ phường (null) luôn hợp lệ dù không còn cơ sở nào hợp lệ", () => {
    expect(apDungCapNhat({ phienBan: 1, map: { "da nang|hai chau": "cs_dong_cua" } }, DN, [{ phuong: "Phường Hải Châu", coSoId: null }], new Set()).ok).toBe(true);
  });
});

describe("[CTQ-03] đếm và đọc lại", () => {
  const bang = { phienBan: 1 as const, map: { "da nang|hai chau": "cs2", "da nang|thanh khe": "cs1", "ha noi|ba dinh": "cs1" } };
  it("chỉ đếm trong thành phố đang xem", () => {
    expect(demPhuongDaDat(bang, DN)).toBe(2);
    expect(demPhuongDaDat(bang, "Hà Nội")).toBe(1);
    expect(demPhuongDaDat(bang, "Huế")).toBe(0);
  });
  it("đọc lại theo từng phường (tên viết lệch vẫn khớp), chưa đặt ⇒ null", () => {
    expect(coSoCuaCacPhuong(bang, "Đà Nẵng", ["Phường Hải Châu", "Phường Thanh Khê", "Phường An Hải"])).toEqual({
      "Phường Hải Châu": "cs2",
      "Phường Thanh Khê": "cs1",
      "Phường An Hải": null,
    });
  });
});

describe("[CTQ-04] danh mục địa chỉ", () => {
  it("«Tp Đà Nẵng» có trong gói, có mã, và là thành phố mặc định", () => {
    expect(danhSachTinh().map((t) => t.name)).toContain(TP_MAC_DINH);
    expect(idTinhTheoTen(TP_MAC_DINH)).not.toBeNull();
    expect(idTinhTheoTen("Không có thật")).toBeNull();
  });
  it("94 phường/xã, không trùng, sắp theo tiếng Việt", () => {
    const ds = danhSachPhuongCuaTinh(idTinhTheoTen(TP_MAC_DINH)!);
    expect(ds).toHaveLength(94);
    expect(new Set(ds).size).toBe(ds.length);
    expect(ds).toEqual([...ds].sort((a, b) => a.localeCompare(b, "vi")));
    expect(ds).toContain("Phường Hải Châu");
  });
  it("mã lạ ⇒ rỗng", () => {
    expect(danhSachPhuongCuaTinh("khong-co")).toEqual([]);
  });
  it("mọi phường trong gói tạo được khoá hợp lệ với tên thành phố mặc định (khớp với dữ liệu lead lưu theo TÊN gói)", () => {
    for (const p of danhSachPhuongCuaTinh(idTinhTheoTen(TP_MAC_DINH)!)) {
      const r = apDungCapNhat(BANG_RONG, TP_MAC_DINH, [{ phuong: p, coSoId: "cs1" }], HOP_LE);
      expect(r.ok, p).toBe(true);
    }
  });
});
