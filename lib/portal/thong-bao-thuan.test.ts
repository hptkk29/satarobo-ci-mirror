import { describe, expect, it } from "vitest";
import { gomNhom, loc, nhanGio, nhomThoiGian } from "@/lib/portal/thong-bao-thuan";
import type { FeedItem } from "@/lib/portal/notification-feed";

const NOW = new Date("2026-11-02T03:00:00.000Z"); // T2 02/11/2026 10:00 VN
const it_ = (id: string, category: FeedItem["category"], at: string): FeedItem => ({ id, category, title: id, body: "", childName: null, at, read: true });

describe("[TB-01] nhóm theo thời gian (lịch VN)", () => {
  it("hôm nay / tuần này / trước đó", () => {
    expect(nhomThoiGian("2026-11-02T01:00:00.000Z", NOW)).toBe("HÔM NAY");
    expect(nhomThoiGian("2026-10-31T14:10:00.000Z", NOW)).toBe("TUẦN NÀY");
    expect(nhomThoiGian("2026-10-26T03:00:00.000Z", NOW)).toBe("TRƯỚC ĐÓ");
  });
  it("ranh giới ngày theo giờ VN, không theo UTC", () => {
    expect(nhomThoiGian("2026-11-01T16:30:00.000Z", NOW)).toBe("TUẦN NÀY"); // 23:30 ngày 01/11 giờ VN
    expect(nhomThoiGian("2026-11-01T17:30:00.000Z", NOW)).toBe("HÔM NAY"); // 00:30 ngày 02/11 giờ VN
  });
  it("mới nhất ở trên; nhóm rỗng bị bỏ", () => {
    const g = gomNhom([it_("a", "NHAN_XET", "2026-10-31T14:10:00.000Z"), it_("b", "HOC_PHI", "2026-11-02T01:00:00.000Z"), it_("c", "HOC_PHI", "2026-10-30T14:10:00.000Z")], NOW);
    expect(g.map((x) => x.ten)).toEqual(["HÔM NAY", "TUẦN NÀY"]);
    expect(g[1]?.items.map((x) => x.id)).toEqual(["a", "c"]);
  });
});

describe("[TB-02] tab lọc + nhãn giờ", () => {
  const ds = [it_("n", "NHAN_XET", "2026-11-02T01:00:00Z"), it_("b", "HOC_BA", "2026-11-02T01:00:00Z"), it_("t", "THONG_BAO", "2026-11-02T01:00:00Z"), it_("k", "KHAO_SAT", "2026-11-02T01:00:00Z")];
  it("Học tập gồm nhận xét + học bạ; Trung tâm gồm thông báo + khảo sát; Tất cả không lọc", () => {
    expect(loc(ds, "hoc-tap").map((x) => x.id)).toEqual(["n", "b"]);
    expect(loc(ds, "trung-tam").map((x) => x.id)).toEqual(["t", "k"]);
    expect(loc(ds, "tat-ca")).toHaveLength(4);
    expect(loc(ds, "hoc-phi")).toEqual([]);
  });
  it("hôm nay chỉ giờ, ngày khác có thứ + ngày", () => {
    expect(nhanGio("2026-11-02T01:30:00.000Z", NOW)).toBe("08:30");
    expect(nhanGio("2026-10-31T14:10:00.000Z", NOW)).toBe("T7 31/10, 21:10");
  });
});
