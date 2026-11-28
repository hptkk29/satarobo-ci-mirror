/**
 * [TTD-*] `dungTheTrangDich` — mỗi trang đích một thẻ, link nào gắn vào thẻ (THUẦN).
 *   [TTD-01] cùng trang có link ĐANG DÙNG và link đã thu hồi MỚI HƠN ⇒ thẻ mang link đang dùng.
 *   [TTD-02] cùng trang chỉ còn link đã thu hồi ⇒ thẻ mang link MỚI NHẤT (đầu danh sách — `createdAt` giảm dần), và KHÔNG đưa ra liên kết để sao chép.
 *   [TTD-03] không có gốc link ngắn ⇒ dùng URL cuối, `laLinkNgan` false (không vẽ QR); trang chưa có link ⇒ `link` null; trùng trang ở hai chương trình ⇒ một thẻ.
 */
import { describe, expect, it } from "vitest";
import type { LinkCuaToi, TaoLinkCuaToi } from "./cua-toi";
import { dungTheTrangDich } from "./the-trang-dich";

const WEB = { siteId: "s1", ten: "Web", host: "h.vn", trangDich: [{ id: "t1", host: "h.vn", mau: "/a", nhan: "A", kieu: "CHINH_XAC" as const }, { id: "t2", host: "h.vn", mau: "/b", nhan: null, kieu: "CHINH_XAC" as const }] };
const ct = (membershipId: string) => ({ membershipId, campaignMa: "C", campaignTen: "C", websites: [WEB], soLinkDangChay: 0, soLinkToiDa: 50 });
const TAO: TaoLinkCuaToi = { chuongTrinh: [ct("m1"), ct("m2")], coGocLinkNgan: true };
const lk = (id: string, trangDich: string, hoatDong: boolean, ngan = true): LinkCuaToi => ({
  id, campaign: "C", website: "h.vn", trangDich, loai: "LINK", nhan: null, hoatDong, lyDoKhongDung: null, soLuotBam: 1, soLuotBamLoi: 0, soReferral: 2,
  lienKetNgan: hoatDong && ngan ? `https://h.vn/r/${id}` : null, lienKetTrucTiep: null, urlCuoi: hoatDong ? `https://h.vn${trangDich}?aff=${id}` : null,
});

describe("[TTD] thẻ trang đích", () => {
  it("[TTD-01] có link đang dùng ⇒ thẻ mang nó, dù link đã thu hồi mới hơn", () => {
    const [a] = dungTheTrangDich(TAO, [lk("MOI_THU_HOI", "/a", false), lk("DANG_DUNG", "/a", true)]);
    expect(a!.link).toMatchObject({ id: "DANG_DUNG", hoatDong: true, lienKet: "https://h.vn/r/DANG_DUNG", laLinkNgan: true });
  });
  it("[TTD-02] chỉ còn link đã thu hồi ⇒ link mới nhất, KHÔNG có liên kết để sao chép", () => {
    const [a] = dungTheTrangDich(TAO, [lk("MOI", "/a", false), lk("CU", "/a", false)]);
    expect(a!.link).toMatchObject({ id: "MOI", hoatDong: false, lienKet: null, laLinkNgan: false });
  });
  it("[TTD-03] không gốc link ngắn ⇒ URL cuối, không QR; trang chưa có link ⇒ null; trùng trang hai chương trình ⇒ một thẻ", () => {
    const the = dungTheTrangDich(TAO, [lk("X", "/a", true, false)]);
    expect(the.map((t) => t.khoa)).toEqual(["s1|t1", "s1|t2"]);
    expect(the[0]!.link).toMatchObject({ lienKet: "https://h.vn/a?aff=X", laLinkNgan: false });
    expect(the[0]!.vao.membershipId).toBe("m1");
    expect(the[1]!).toMatchObject({ ten: "/b", link: null });
  });
});
