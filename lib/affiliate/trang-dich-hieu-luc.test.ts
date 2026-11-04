/**
 * [THL-*] `trangDichHieuLuc` · `rangBuocCuaCampaign` · `demLinkMatHieuLuc` — THUẦN (AFF-L6). Hàm DUY NHẤT quyết «trang đích nào dùng được trong chuỗi link của một (campaign × website)».
 *
 *   [THL-01] giải host: host riêng, không có thì host của baseUrl; baseUrl hỏng ⇒ host rỗng (không bao giờ khớp URL thật)
 *   [THL-02] campaign không chọn trang nào của website ⇒ KHÔNG hạn chế; có chọn ⇒ chỉ các trang đó; đọc THEO TỪNG website
 *   [THL-03] ràng buộc không tự «nở ra»: có chọn mà mọi trang đã chọn biến mất ⇒ danh sách RỖNG (không rơi về tất cả)
 *   [THL-04] demLinkMatHieuLuc: đếm đúng link khớp trước mà không khớp sau; link cũ (chưa có host) tính theo host của website; link ở tên miền khác không bị tính nhầm
 */
import { describe, expect, it } from "vitest";
import { demLinkMatHieuLuc, giaiHostTrangDich, rangBuocCuaCampaign, trangDichHieuLuc, trangDichKhopLink, type TrangDichDb } from "./trang-dich-hieu-luc";

const BASE = "https://quatang.edu.vn";
const td = (id: string, pathPattern: string, host: string | null = null, extra: Partial<TrangDichDb> = {}): TrangDichDb => ({ id, host, pathPattern, label: null, isActive: true, trackingEnabled: true, ...extra });
const DS = [td("a", "/khoa-hoc/*"), td("b", "/", "covua.quatang.edu.vn"), td("c", "/giai-dau/*", "covua.quatang.edu.vn")];

describe("[THL-01] giải host", () => {
  it("host riêng thắng; không có ⇒ host của baseUrl; baseUrl hỏng ⇒ rỗng", () => {
    expect(giaiHostTrangDich(BASE, "covua.quatang.edu.vn")).toBe("covua.quatang.edu.vn");
    expect(giaiHostTrangDich(BASE, null)).toBe("quatang.edu.vn");
    expect(giaiHostTrangDich("khong-phai-url", null)).toBe("");
    expect(trangDichHieuLuc({ baseUrl: BASE, trangDich: DS, rangBuoc: [] }).map((t) => t.host)).toEqual(["quatang.edu.vn", "covua.quatang.edu.vn", "covua.quatang.edu.vn"]);
  });
  it("cùng đường dẫn ở hai tên miền là hai trang khác nhau: khớp theo (tên miền, đường dẫn)", () => {
    const ra = trangDichHieuLuc({ baseUrl: BASE, trangDich: [td("g", "/"), td("h", "/", "covua.quatang.edu.vn")], rangBuoc: [] });
    expect(trangDichKhopLink(ra, "quatang.edu.vn", "/")).toBe(true);
    expect(trangDichKhopLink(ra.filter((t) => t.id === "h"), "quatang.edu.vn", "/")).toBe(false);
    expect(trangDichKhopLink(ra.filter((t) => t.id === "h"), "covua.quatang.edu.vn", "/")).toBe(true);
  });
});

describe("[THL-02] thu hẹp theo campaign", () => {
  it("không chọn ⇒ tất cả; có chọn ⇒ chỉ các trang đó", () => {
    expect(trangDichHieuLuc({ baseUrl: BASE, trangDich: DS, rangBuoc: [] }).map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(trangDichHieuLuc({ baseUrl: BASE, trangDich: DS, rangBuoc: ["c"] }).map((t) => t.id)).toEqual(["c"]);
    expect(trangDichHieuLuc({ baseUrl: BASE, trangDich: DS, rangBuoc: ["a", "c"] }).map((t) => t.id)).toEqual(["a", "c"]);
  });
  it("không lọc trang đang tắt: cờ đi cùng đối tượng để cổng quyết (màn hình nói được vì sao)", () => {
    const ra = trangDichHieuLuc({ baseUrl: BASE, trangDich: [td("a", "/x", null, { isActive: false }), td("b", "/y", null, { trackingEnabled: false })], rangBuoc: [] });
    expect(ra.map((t) => [t.id, t.isActive, t.trackingEnabled])).toEqual([["a", false, true], ["b", true, false]]);
    expect(trangDichKhopLink(ra, "quatang.edu.vn", "/x")).toBe(false);
    expect(trangDichKhopLink(ra, "quatang.edu.vn", "/y")).toBe(false);
  });
  it("rangBuocCuaCampaign đọc THEO TỪNG website: chọn ở A không hạn chế B", () => {
    const dong = [{ landingPageId: "a1", landingPage: { siteId: "A" } }, { landingPageId: "a2", landingPage: { siteId: "A" } }];
    expect(rangBuocCuaCampaign(dong, "A")).toEqual(["a1", "a2"]);
    expect(rangBuocCuaCampaign(dong, "B")).toEqual([]);
  });
});

describe("[THL-03] ràng buộc không tự «nở ra»", () => {
  it("có chọn mà trang đã chọn không còn thuộc website ⇒ RỖNG, không rơi về tất cả", () => {
    expect(trangDichHieuLuc({ baseUrl: BASE, trangDich: DS, rangBuoc: ["da-bi-xoa"] })).toEqual([]);
  });
});

describe("[THL-04] demLinkMatHieuLuc", () => {
  const truoc = trangDichHieuLuc({ baseUrl: BASE, trangDich: DS, rangBuoc: [] });
  const link = (landingHost: string | null, landingPath: string) => ({ landingHost, landingPath });
  it("đếm đúng link khớp trước mà không khớp sau", () => {
    const sau = trangDichHieuLuc({ baseUrl: BASE, trangDich: DS, rangBuoc: ["a"] });
    const links = [link("covua.quatang.edu.vn", "/giai-dau/2027"), link("covua.quatang.edu.vn", "/"), link("quatang.edu.vn", "/khoa-hoc/robot"), link(null, "/khoa-hoc/ai")];
    expect(demLinkMatHieuLuc(links, "quatang.edu.vn", truoc, sau)).toBe(2); // hai link ở covua chết; hai link ở tên miền gốc (kể cả link cũ host NULL) còn
  });
  it("link đã chết từ TRƯỚC không tính (không báo thổi phồng); không đổi gì ⇒ 0", () => {
    const links = [link("quatang.edu.vn", "/khong-co-trang-nao")];
    expect(demLinkMatHieuLuc(links, "quatang.edu.vn", truoc, trangDichHieuLuc({ baseUrl: BASE, trangDich: DS, rangBuoc: ["a"] }))).toBe(0);
    expect(demLinkMatHieuLuc([link("covua.quatang.edu.vn", "/")], "quatang.edu.vn", truoc, truoc)).toBe(0);
  });
  it("tắt một trang đích ⇒ chỉ link nằm trên đúng tên miền của nó bị tính", () => {
    const sau = trangDichHieuLuc({ baseUrl: BASE, trangDich: [DS[0]!, td("b", "/", "covua.quatang.edu.vn", { isActive: false }), DS[2]!], rangBuoc: [] });
    expect(demLinkMatHieuLuc([link("covua.quatang.edu.vn", "/"), link("quatang.edu.vn", "/khoa-hoc/x"), link("covua.quatang.edu.vn", "/giai-dau/1")], "quatang.edu.vn", truoc, sau)).toBe(1);
  });
});
