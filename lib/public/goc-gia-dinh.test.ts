/**
 * [GOC-*] Nhóm «Góc gia đình» (DISC · Tủ sách · Sức khỏe): nguồn duy nhất, theo từng cờ, chèn trước «Liên hệ».
 * Thay các ca `chenMucDisc` / `chenMucCongThongTin` cũ (hai hàm đó đã gỡ — mỗi hàm chèn một mục riêng là cách để thanh trên tràn).
 */
import { describe, expect, it } from "vitest";
import { DISC_NAV } from "@/lib/disc/nav";
import { SUC_KHOE_NAV, TU_SACH_NAV } from "@/lib/cong-thong-tin/nav";
import { GOC_GIA_DINH_NHAN, chenNhomGoc, mucGocDangDung, mucGocGiaDinh, type MucNhom } from "./goc-gia-dinh";

const MENU = [
  { label: "Trang chủ", href: "/" },
  { label: "Tin tức", href: "/tin-tuc" },
  { label: "Liên hệ", href: "/lien-he" },
];
const nhan = (m: readonly { label: string }[]) => m.map((x) => x.label);
const co = (tuSach: boolean, sucKhoe: boolean) => ({ tuSach, sucKhoe });

describe("[GOC-01] mucGocGiaDinh — mỗi cờ chỉ thêm mục CỦA NÓ, đúng thứ tự DISC → Tủ sách → Sức khỏe", () => {
  it.each([
    [false, false, false, []],
    [true, false, false, ["disc"]],
    [false, true, false, ["tu-sach"]],
    [false, false, true, ["suc-khoe"]],
    [true, true, false, ["disc", "tu-sach"]],
    [true, false, true, ["disc", "suc-khoe"]],
    [false, true, true, ["tu-sach", "suc-khoe"]],
    [true, true, true, ["disc", "tu-sach", "suc-khoe"]],
  ] as const)("disc=%s tuSach=%s sucKhoe=%s ⇒ %j", (disc, tuSach, sucKhoe, mong) => {
    expect(mucGocGiaDinh(disc, co(tuSach, sucKhoe)).map((m) => m.ma)).toEqual(mong);
  });
  it("không truyền cờ cổng thông tin (undefined) ⇒ chỉ còn DISC nếu bật (cờ TẮT khi không ai truyền)", () => {
    expect(mucGocGiaDinh(false, undefined)).toEqual([]);
    expect(mucGocGiaDinh(true, undefined).map((m) => m.ma)).toEqual(["disc"]);
  });
  it("nhãn + đường dẫn lấy từ ba hằng nguồn (không chép tay)", () => {
    const r = mucGocGiaDinh(true, co(true, true));
    expect(r.map((m) => [m.label, m.href])).toEqual([
      [DISC_NAV.label, DISC_NAV.href],
      [TU_SACH_NAV.label, TU_SACH_NAV.href],
      [SUC_KHOE_NAV.label, SUC_KHOE_NAV.href],
    ]);
    expect(r.map((m) => m.href)).toEqual(["/disc", "/tu-sach", "/suc-khoe"]);
  });
  it("nhãn DISC KHÔNG kèm 'miễn phí' (PRD v2.0) và tên nhóm là «Góc gia đình»", () => {
    expect(DISC_NAV.label).toBe("Khám phá DISC");
    expect(DISC_NAV.label).not.toMatch(/miễn phí/i);
    expect(GOC_GIA_DINH_NHAN).toBe("Góc gia đình");
  });
});

describe("[GOC-02] chenNhomGoc — nhóm đứng NGAY TRƯỚC «Liên hệ»", () => {
  it("cả ba tắt ⇒ trả nguyên (đối chứng dương của các ca dưới)", () => {
    expect(chenNhomGoc(MENU, false, co(false, false))).toEqual(MENU);
    expect(chenNhomGoc(MENU, false, undefined)).toEqual(MENU);
  });
  it("đúng MỘT mục bật ⇒ KHÔNG dựng nhóm một con: mục đó hiện thẳng như liên kết thường, đứng trước «Liên hệ»", () => {
    for (const [disc, c, nh, href] of [
      [true, co(false, false), "Khám phá DISC", "/disc"],
      [false, co(true, false), "Tủ sách", "/tu-sach"],
      [false, co(false, true), "Sức khỏe", "/suc-khoe"],
    ] as const) {
      const r = chenNhomGoc(MENU, disc, c);
      expect(nhan(r)).toEqual(["Trang chủ", "Tin tức", nh, "Liên hệ"]);
      expect(r.some((m) => "nhom" in m)).toBe(false);
      expect((r[2] as { href: string }).href).toBe(href);
    }
  });
  it("từ HAI mục bật ⇒ đúng MỘT mục nhóm «Góc gia đình», mang đủ các con theo cờ, đứng ngay trước «Liên hệ»", () => {
    const r = chenNhomGoc(MENU, true, co(true, true));
    expect(nhan(r)).toEqual(["Trang chủ", "Tin tức", "Góc gia đình", "Liên hệ"]);
    const nhom = (r[2] as MucNhom).nhom;
    expect(nhom.map((m) => m.href)).toEqual(["/disc", "/tu-sach", "/suc-khoe"]);
    // Ba mục KHÔNG còn nằm riêng trên thanh trên (đó là chỗ ba mục làm hàng menu tràn).
    expect(nhan(r)).not.toContain("Tủ sách");
    expect(nhan(r)).not.toContain("Sức khỏe");
    expect(nhan(r)).not.toContain("Khám phá DISC");
    expect(r.filter((m) => "nhom" in m)).toHaveLength(1);
  });
  it("hai mục bật (DISC tắt) ⇒ nhóm chỉ có Tủ sách + Sức khỏe — ca có thật trên prod nếu DISC chưa bật", () => {
    const r = chenNhomGoc(MENU, false, co(true, true));
    expect((r[2] as MucNhom).nhom.map((m) => m.ma)).toEqual(["tu-sach", "suc-khoe"]);
  });
  it("không có «Liên hệ» ⇒ đặt cuối, không ném", () => {
    expect(nhan(chenNhomGoc([{ label: "A", href: "/a" }], true, co(true, false)))).toEqual(["A", "Góc gia đình"]);
  });
  it("không đổi mảng đầu vào (không rò trạng thái giữa hai lần render)", () => {
    const truoc = JSON.stringify(MENU);
    chenNhomGoc(MENU, true, co(true, true));
    expect(JSON.stringify(MENU)).toBe(truoc);
  });
});

describe("[GOC-03] mucGocDangDung — dấu «đang ở đây»", () => {
  it("đúng đường dẫn hoặc trang con ⇒ true", () => {
    expect(mucGocDangDung("/tu-sach", "/tu-sach")).toBe(true);
    expect(mucGocDangDung("/tu-sach/2", "/tu-sach")).toBe(true);
  });
  it("đối chứng: tên giống đầu chuỗi nhưng KHÔNG phải trang con ⇒ false; rỗng/null ⇒ false", () => {
    expect(mucGocDangDung("/tu-sach-moi", "/tu-sach")).toBe(false);
    expect(mucGocDangDung("/suc-khoe", "/tu-sach")).toBe(false);
    expect(mucGocDangDung(null, "/tu-sach")).toBe(false);
    expect(mucGocDangDung(undefined, "/tu-sach")).toBe(false);
  });
});
