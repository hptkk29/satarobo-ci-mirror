// A-02-UI — điều hướng 4 tab dashboard QLCS.
//
// Bất biến DUY NHẤT mà bộ này canh: **đổi tab không được làm rơi bộ lọc**. Đó là
// AC A-02-3 ("4 tab đọc CÙNG searchParams") và cũng là chỗ dễ hỏng câm nhất — link
// tab quên một tham số thì người dùng bấm sang tab khác là số nhảy, không ai báo lỗi.
//
// Vì vậy ca nặng nhất ở đây là VÒNG TRÒN: dựng href → đọc lại href bằng đúng resolver
// mà trang dùng (`buildScopeFilters`) → phải ra y hệt bộ lọc ban đầu.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_QLCS_TAB,
  QLCS_TABS,
  QLCS_TAB_IDS,
  buildQlcsTabHref,
  resolveQlcsTab,
  type QlcsFilterQuery,
} from "@/lib/dashboard/qlcs-tabs";
import {
  buildScopeFilters,
  type ScopeFilterSearchParams,
} from "@/lib/reports/scope-filters";

/** URL → hình dạng `searchParams` mà Next trao cho page (lặp key ⇒ mảng). */
function searchParamsFromHref(href: string): ScopeFilterSearchParams & { tab?: string | string[] } {
  const qs = new URLSearchParams(href.slice(href.indexOf("?") + 1));
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(qs.keys())) {
    const all = qs.getAll(key);
    out[key] = all.length > 1 ? all : all[0]!;
  }
  return out as ScopeFilterSearchParams & { tab?: string | string[] };
}

const NOW = new Date("2026-08-25T09:00:00+07:00");

describe("resolveQlcsTab — tab lạ không được làm trắng trang", () => {
  it("vắng mặt / rỗng / giá trị lạ đều lùi về tab mặc định", () => {
    expect(resolveQlcsTab(undefined)).toBe(DEFAULT_QLCS_TAB);
    expect(resolveQlcsTab("")).toBe(DEFAULT_QLCS_TAB);
    expect(resolveQlcsTab("khong-co-that")).toBe(DEFAULT_QLCS_TAB);
    // `?tab[]=...` hay tham số lặp: lấy giá trị ĐẦU, khớp URLSearchParams.get().
    expect(resolveQlcsTab(["khong-co-that", "kinh-doanh"])).toBe(DEFAULT_QLCS_TAB);
  });

  it("nhận đúng cả 4 tab đã khai", () => {
    for (const id of QLCS_TAB_IDS) expect(resolveQlcsTab(id)).toBe(id);
    expect(resolveQlcsTab(["tuong-tac-kh"])).toBe("tuong-tac-kh");
  });

  it("QLCS_TABS khai đủ 4 tab, không trùng, và mặc định nằm trong đó", () => {
    expect(QLCS_TABS.map((t) => t.id)).toEqual([...QLCS_TAB_IDS]);
    expect(new Set(QLCS_TAB_IDS).size).toBe(QLCS_TAB_IDS.length);
    expect(QLCS_TAB_IDS).toContain(DEFAULT_QLCS_TAB);
    for (const t of QLCS_TABS) expect(t.label.length).toBeGreaterThan(0);
  });
});

describe("buildQlcsTabHref — link tab mang theo NGUYÊN bộ lọc", () => {
  const base = "/dashboard-qlcs";

  it("đang xem tất cả cơ sở ⇒ KHÔNG phát `center` (vắng mặt = tất cả, đúng resolveScopeCenters)", () => {
    const q: QlcsFilterQuery = {
      centerIds: ["cs1", "cs2"],
      isAllCenters: true,
      dateFrom: "2026-08-01",
      dateTo: "2026-08-25",
      split: false,
    };
    const href = buildQlcsTabHref(base, q, "kinh-doanh");
    expect(href.startsWith(`${base}?`)).toBe(true);
    expect(href).not.toContain("center=");
    expect(href).toContain("tab=kinh-doanh");
    expect(href).toContain("dateFrom=2026-08-01");
    expect(href).toContain("dateTo=2026-08-25");
  });

  it("chọn tay ⇒ phát MỘT `center` cho MỖI cơ sở (không nhét chuỗi ngăn phẩy)", () => {
    const href = buildQlcsTabHref(
      base,
      {
        centerIds: ["cs1", "cs2"],
        isAllCenters: false,
        dateFrom: "2026-07-01",
        dateTo: "2026-07-31",
        split: true,
      },
      "chi-phi-marketing",
    );
    const qs = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(qs.getAll("center")).toEqual(["cs1", "cs2"]);
    expect(qs.get("split")).toBe("1");
  });

  it("gộp (split=false) ⇒ KHÔNG phát `split` — mặc định phải là URL sạch", () => {
    const href = buildQlcsTabHref(
      base,
      {
        centerIds: ["cs1"],
        isAllCenters: false,
        dateFrom: "2026-08-01",
        dateTo: "2026-08-25",
        split: false,
      },
      "tai-chinh",
    );
    expect(href).not.toContain("split=");
  });
});

describe("[A-02-3] VÒNG TRÒN — bấm sang tab khác KHÔNG đổi một con số nào", () => {
  const base = "/dashboard-qlcs";
  const visible = ["cs1", "cs2", "cs3"];

  /** Bấm lần lượt qua cả 4 tab, mỗi lần đọc lại URL bằng chính resolver của trang. */
  function diTronVongTabs(sp: ScopeFilterSearchParams) {
    const start = buildScopeFilters({ visibleCenterIds: visible, sp, now: NOW });
    for (const tab of QLCS_TAB_IDS) {
      const href = buildQlcsTabHref(
        base,
        {
          centerIds: start.filters.centerIds,
          isAllCenters: start.filters.isAllCenters,
          dateFrom: start.dateFromStr,
          dateTo: start.dateToStr,
          split: start.filters.groupByCenter,
        },
        tab,
      );
      const spSau = searchParamsFromHref(href);
      const sau = buildScopeFilters({ visibleCenterIds: visible, sp: spSau, now: NOW });
      expect(resolveQlcsTab(spSau.tab), `href tab ${tab} đọc lại phải ra đúng tab đó`).toBe(tab);
      expect(sau.filters, `đổi sang tab ${tab} làm đổi bộ lọc`).toEqual(start.filters);
      expect(sau.canSplit).toBe(start.canSplit);
      expect([sau.dateFromStr, sau.dateToStr]).toEqual([start.dateFromStr, start.dateToStr]);
    }
  }

  it("mặc định (không searchParams): tất cả cơ sở + ngày 01 → hôm nay", () => {
    diTronVongTabs({});
  });

  it("chọn 2/3 cơ sở + tách theo cơ sở", () => {
    diTronVongTabs({ center: ["cs1", "cs3"], split: "1", dateFrom: "2026-06-05", dateTo: "2026-06-20" });
  });

  it("chọn 1 cơ sở: `split=1` bị ép tắt và KHÔNG được sống lại sau khi đổi tab", () => {
    const sp: ScopeFilterSearchParams = { center: "cs2", split: "1" };
    const start = buildScopeFilters({ visibleCenterIds: visible, sp, now: NOW });
    expect(start.canSplit).toBe(false);
    expect(start.filters.groupByCenter).toBe(false);
    diTronVongTabs(sp);
  });

  it("ngày tương lai bị kẹp: link tab mang NGÀY ĐÃ KẸP, không mang lại chuỗi rác", () => {
    const sp: ScopeFilterSearchParams = { dateFrom: "2026-08-01", dateTo: "2099-12-31" };
    const start = buildScopeFilters({ visibleCenterIds: visible, sp, now: NOW });
    expect(start.dateToStr).toBe("2026-08-25");
    const href = buildQlcsTabHref(
      base,
      {
        centerIds: start.filters.centerIds,
        isAllCenters: start.filters.isAllCenters,
        dateFrom: start.dateFromStr,
        dateTo: start.dateToStr,
        split: start.filters.groupByCenter,
      },
      "tuong-tac-kh",
    );
    expect(href).toContain("dateTo=2026-08-25");
    expect(href).not.toContain("2099");
  });

  it("cơ sở ngoài phạm vi trong URL: link tab KHÔNG mang nó sang tab sau", () => {
    const sp: ScopeFilterSearchParams = { center: ["cs1", "cs-cua-nguoi-khac"] };
    const start = buildScopeFilters({ visibleCenterIds: visible, sp, now: NOW });
    expect(start.droppedCenterCount).toBe(1);
    const href = buildQlcsTabHref(
      base,
      {
        centerIds: start.filters.centerIds,
        isAllCenters: start.filters.isAllCenters,
        dateFrom: start.dateFromStr,
        dateTo: start.dateToStr,
        split: start.filters.groupByCenter,
      },
      "kinh-doanh",
    );
    expect(href).not.toContain("cs-cua-nguoi-khac");
    expect(new URLSearchParams(href.slice(href.indexOf("?") + 1)).getAll("center")).toEqual(["cs1"]);
  });
});
