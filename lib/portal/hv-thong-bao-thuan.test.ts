import { describe, expect, it } from "vitest";
import {
  demTinMoi,
  docMocDaXem,
  laTinMoi,
  locTin,
  nhanChuaDoc,
  nhanThoiGian,
  sapXepTin,
  tenCookieDaXem,
} from "./hv-thong-bao-thuan";

const NOW = new Date("2026-11-05T03:00:00Z"); // Thứ Năm 05/11 10:00 giờ VN

describe("tin mới cho em", () => {
  it("[HVN-01] nhãn thời gian theo ngày LỊCH VN", () => {
    expect(nhanThoiGian("2026-11-05T01:30:00Z", NOW)).toBe("Hôm nay, 08:30");
    expect(nhanThoiGian("2026-11-04T14:10:00Z", NOW)).toBe("Hôm qua, 21:10");
    expect(nhanThoiGian("2026-11-02T03:00:00Z", NOW)).toBe("3 ngày trước");
    expect(nhanThoiGian("2026-10-28T03:00:00Z", NOW)).toBe("Tuần trước");
    expect(nhanThoiGian("2026-10-12T03:00:00Z", NOW)).toBe("12/10");
    expect(nhanThoiGian("rác", NOW)).toBe("");
  });
  it("[HVN-02] 17:30 UTC là 00:30 NGÀY HÔM SAU ở VN ⇒ 'Hôm nay', không lùi ngày", () => {
    expect(nhanThoiGian("2026-11-04T17:30:00Z", NOW)).toBe("Hôm nay, 00:30");
  });
  it("[HVN-03] chưa từng bấm đã-đọc ⇒ tin trong 2 ngày là mới; đã bấm ⇒ chỉ tin SAU mốc mới là mới", () => {
    expect(laTinMoi("2026-11-04T03:00:00Z", null, NOW)).toBe(true);
    expect(laTinMoi("2026-11-02T02:00:00Z", null, NOW)).toBe(false);
    const moc = Date.parse("2026-11-04T12:00:00Z");
    expect(laTinMoi("2026-11-04T03:00:00Z", moc, NOW)).toBe(false);
    expect(laTinMoi("2026-11-05T01:00:00Z", moc, NOW)).toBe(true);
    expect(laTinMoi("rác", null, NOW)).toBe(false);
  });
  it("[HVN-04] sắp mới → cũ, lọc theo mục, đếm tin mới, câu 'chưa đọc'", () => {
    const tin = [
      { id: "a", loc: "bt", luc: "2026-11-01T03:00:00Z" },
      { id: "b", loc: "huy", luc: "2026-11-05T01:00:00Z" },
      { id: "c", loc: "bt", luc: "2026-11-04T03:00:00Z" },
    ];
    expect(sapXepTin(tin).map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(locTin(tin, "tat")).toHaveLength(3);
    expect(locTin(tin, "bt").map((t) => t.id)).toEqual(["a", "c"]);
    expect(demTinMoi(tin, null, NOW)).toBe(2);
    expect(demTinMoi(tin, Date.parse("2026-11-05T02:00:00Z"), NOW)).toBe(0);
    expect(nhanChuaDoc(2)).toBe("Em có 2 tin chưa đọc");
    expect(nhanChuaDoc(0)).toBe("Em đã đọc hết tin rồi");
  });
  it("[HVN-05] cookie đã-xem: tách theo con; giá trị rác/quá xa tương lai bị bỏ", () => {
    expect(tenCookieDaXem("clx1234567890abcdef")).toBe("hv_xem_567890abcdef");
    expect(tenCookieDaXem("clxAAAAAAAAAAAAAAAA")).not.toBe(tenCookieDaXem("clxBBBBBBBBBBBBBBBB"));
    expect(docMocDaXem("1793000000000", NOW)).toBe(1793000000000);
    expect(docMocDaXem("abc", NOW)).toBeNull();
    expect(docMocDaXem(undefined, NOW)).toBeNull();
    expect(docMocDaXem("9999999999999", NOW)).toBeNull();
  });
});
