// A-02 — Bộ lọc phạm vi dùng chung cho dashboard QLCS 4 tab (THUẦN, không cần DB).
//
// Vì sao test nằm ở tầng THUẦN: phần dễ sai của A-02 không phải câu truy vấn mà là
// bốn phép quyết định không có DB nào tham gia — giao "cơ sở được xem" × "cơ sở chọn",
// mốc ngày theo giờ VN, khi nào công tắc "Tách theo cơ sở" được phép bật, và khoá cache.
// Đúng khuôn `lib/students/birthday-dates.ts` (thuần, tách để Vitest chạy không cần DB).
import { describe, it, expect } from "vitest";
import {
  buildScopeFilters,
  visibleCentersForActor,
  scopeFilterCacheKey,
  scopeCenterWhere,
  scopeDateWhere,
  parseScopeFilterSearchParams,
  type ScopeFilterSearchParams,
} from "@/lib/reports/scope-filters";

// 09:00 giờ VN ngày 25/08/2026 (UTC+7, không DST).
const NOW = new Date("2026-08-25T02:00:00.000Z");

// Ba cơ sở "được dạy" trong hệ thống; actor thường chỉ thấy 2 cái đầu.
const CENTERS = [
  { id: "cs1", name: "CS1 — Nguyễn Hữu Thọ" },
  { id: "cs2", name: "CS2 — Hoàng Diệu" },
  { id: "cs3", name: "CS3 — Huế" },
];
const VISIBLE_2 = ["cs1", "cs2"];
const VISIBLE_3 = ["cs1", "cs2", "cs3"];

function build(sp: ScopeFilterSearchParams, visible = VISIBLE_2, now = NOW) {
  return buildScopeFilters({ visibleCenterIds: visible, sp, now });
}

// ───────────────────────────── Cơ sở: giao quyền × lựa chọn ─────────────────────────────

describe("[A-02] buildScopeFilters — chọn cơ sở", () => {
  it("không chọn gì → mặc định TẤT CẢ cơ sở trong phạm vi (spec A-02: mặc định `all`)", () => {
    const c = build({});
    expect(c.filters.centerIds).toEqual(["cs1", "cs2"]);
    expect(c.filters.isAllCenters).toBe(true);
    expect(c.droppedCenterCount).toBe(0);
  });

  it("chọn 'ALL' tường minh → y hệt không chọn gì", () => {
    expect(build({ center: "ALL" }).filters).toEqual(build({}).filters);
  });

  it("chọn 1 cơ sở → đúng 1, isAllCenters=false", () => {
    const c = build({ center: "cs2" });
    expect(c.filters.centerIds).toEqual(["cs2"]);
    expect(c.filters.isAllCenters).toBe(false);
  });

  it("chọn nhiều (chưa đủ) → giữ đủ, theo thứ tự phạm vi chứ không theo thứ tự URL", () => {
    const c = build({ center: ["cs3", "cs1"] }, VISIBLE_3);
    expect(c.filters.centerIds).toEqual(["cs1", "cs3"]);
    expect(c.filters.isAllCenters).toBe(false);
  });

  it("chọn trùng lặp → khử trùng, không nhân đôi cơ sở trong kết quả tách", () => {
    expect(build({ center: ["cs1", "cs1", "cs2"] }, VISIBLE_3).filters.centerIds).toEqual([
      "cs1",
      "cs2",
    ]);
  });

  it("chọn ĐỦ mọi cơ sở trong phạm vi → coi như 'tất cả' (isAllCenters=true)", () => {
    // Nếu không quy về ALL thì hai đường dẫn cho cùng một tập cơ sở lại sinh 2 entry
    // cache khác nhau, và các bảng có dòng centerId=null bị đối xử khác nhau.
    expect(build({ center: ["cs1", "cs2"] }).filters.isAllCenters).toBe(true);
  });
});

describe("[A-02] buildScopeFilters — cơ sở NGOÀI phạm vi bị loại IM LẶNG", () => {
  it("một phần ngoài phạm vi → chỉ giữ phần trong, KHÔNG ném lỗi, KHÔNG trả id lạ", () => {
    const c = build({ center: ["cs1", "cs3"] });
    expect(c.filters.centerIds).toEqual(["cs1"]);
    expect(c.filters.centerIds).not.toContain("cs3");
    expect(c.droppedCenterCount).toBe(1);
  });

  it("TẤT CẢ đều ngoài phạm vi → lùi về mặc định (toàn bộ phạm vi), không lộ gì về cơ sở lạ", () => {
    const c = build({ center: ["cs3", "khong-ton-tai"] });
    expect(c.filters.centerIds).toEqual(["cs1", "cs2"]);
    expect(c.filters.isAllCenters).toBe(true);
    expect(c.droppedCenterCount).toBe(2);
    // Chống rò: không một mẩu nào của yêu cầu ngoài phạm vi được mang ra ngoài.
    expect(JSON.stringify(c)).not.toContain("cs3");
    expect(JSON.stringify(c)).not.toContain("khong-ton-tai");
  });

  it("actor KHÔNG có cơ sở nào → tập rỗng (fail-closed), không tự nới ra toàn hệ thống", () => {
    const c = build({ center: "cs1" }, []);
    expect(c.filters.centerIds).toEqual([]);
    expect(c.filters.isAllCenters).toBe(true);
    expect(scopeCenterWhere(c.filters)).toEqual({ in: [] });
  });
});

// ───────────────────────────── Cấp Hội sở vs cấp cơ sở ─────────────────────────────

describe("[A-02] visibleCentersForActor — người cấp Hội sở", () => {
  it("SUPER_ADMIN thấy MỌI cơ sở, kể cả cơ sở không nằm trong visibleCenterIds", () => {
    const v = visibleCentersForActor(
      { isSuperAdmin: true, isHoLevel: false, visibleCenterIds: [] },
      CENTERS,
    );
    expect(v.map((c) => c.id)).toEqual(["cs1", "cs2", "cs3"]);
  });

  it("người cấp Hội sở (isHoLevel) cũng thấy mọi cơ sở", () => {
    const v = visibleCentersForActor(
      { isSuperAdmin: false, isHoLevel: true, visibleCenterIds: ["cs1"] },
      CENTERS,
    );
    expect(v.map((c) => c.id)).toEqual(["cs1", "cs2", "cs3"]);
  });

  it("QLCS thuần chỉ thấy đúng cơ sở được gán — CS3 không lọt vào dropdown", () => {
    const v = visibleCentersForActor(
      { isSuperAdmin: false, isHoLevel: false, visibleCenterIds: ["cs1", "cs2"] },
      CENTERS,
    );
    expect(v.map((c) => c.id)).toEqual(["cs1", "cs2"]);
  });

  it("QLCS Hội sở chọn được cơ sở bất kỳ; QLCS thuần chọn cùng URL đó thì bị loại", () => {
    const sp: ScopeFilterSearchParams = { center: "cs3" };
    const ho = build(sp, ["cs1", "cs2", "cs3"]);
    expect(ho.filters.centerIds).toEqual(["cs3"]);
    expect(ho.droppedCenterCount).toBe(0);

    const qlcs = build(sp, VISIBLE_2);
    expect(qlcs.filters.centerIds).toEqual(["cs1", "cs2"]);
    expect(qlcs.droppedCenterCount).toBe(1);
  });
});

// ───────────────────────────── Công tắc "Tách theo cơ sở" (OQ-4) ─────────────────────────────

describe("[A-02][OQ-4] groupByCenter — mặc định GỘP, công tắc chỉ sống khi ≥ 2 cơ sở", () => {
  it("mặc định là GỘP", () => {
    expect(build({}).filters.groupByCenter).toBe(false);
  });

  it("?split=1 với ≥ 2 cơ sở → tách", () => {
    const c = build({ split: "1" });
    expect(c.canSplit).toBe(true);
    expect(c.filters.groupByCenter).toBe(true);
  });

  it("?split=1 mà chỉ chọn 1 cơ sở → ÉP về gộp (tách và gộp cho cùng con số)", () => {
    const c = build({ center: "cs1", split: "1" });
    expect(c.canSplit).toBe(false);
    expect(c.filters.groupByCenter).toBe(false);
  });

  it("actor 0 cơ sở → không bao giờ bật được tách", () => {
    expect(build({ split: "1" }, []).filters.groupByCenter).toBe(false);
  });

  it("split khác '1' (0 / rác / thiếu) → gộp", () => {
    expect(build({ split: "0" }).filters.groupByCenter).toBe(false);
    expect(build({ split: "yes" }).filters.groupByCenter).toBe(false);
    expect(build({}).filters.groupByCenter).toBe(false);
  });
});

// ───────────────────────────── Khoảng ngày (giờ VN) ─────────────────────────────

describe("[A-02][OQ-B9] khoảng ngày — mặc định 'ngày 01 → hôm nay', mốc theo giờ VN", () => {
  it("thiếu cả hai → 01 tháng hiện tại 00:00 VN → hôm nay 23:59:59.999 VN", () => {
    const { filters, dateFromStr, dateToStr } = build({});
    // 01/08/2026 00:00 VN = 31/07/2026 17:00Z
    expect(filters.dateFrom.toISOString()).toBe("2026-07-31T17:00:00.000Z");
    // 25/08/2026 23:59:59.999 VN = 25/08/2026 16:59:59.999Z
    expect(filters.dateTo.toISOString()).toBe("2026-08-25T16:59:59.999Z");
    expect(dateFromStr).toBe("2026-08-01");
    expect(dateToStr).toBe("2026-08-25");
  });

  it("mốc 'hôm nay' tính theo giờ VN chứ không theo UTC — 00:30 VN 01/09 là THÁNG 9", () => {
    // 2026-08-31T17:30:00Z = 00:30 VN ngày 01/09/2026.
    const c = build({}, VISIBLE_2, new Date("2026-08-31T17:30:00.000Z"));
    expect(c.dateFromStr).toBe("2026-09-01");
    expect(c.dateToStr).toBe("2026-09-01");
  });

  it("thiếu MỘT đầu → đầu kia vẫn theo mặc định của nó", () => {
    expect(build({ dateFrom: "2026-08-10" }).dateToStr).toBe("2026-08-25");
    expect(build({ dateTo: "2026-08-20" }).dateFromStr).toBe("2026-08-01");
  });

  it("khoảng hợp lệ → giữ nguyên, cận trên là CUỐI ngày", () => {
    const { filters } = build({ dateFrom: "2026-07-01", dateTo: "2026-07-31" });
    expect(filters.dateFrom.toISOString()).toBe("2026-06-30T17:00:00.000Z");
    expect(filters.dateTo.toISOString()).toBe("2026-07-31T16:59:59.999Z");
  });

  it("ĐẢO NGƯỢC (từ > đến) → hoán đổi, không trả khoảng rỗng câm", () => {
    const c = build({ dateFrom: "2026-08-20", dateTo: "2026-08-10" });
    expect(c.dateFromStr).toBe("2026-08-10");
    expect(c.dateToStr).toBe("2026-08-20");
    expect(c.filters.dateFrom.getTime()).toBeLessThan(c.filters.dateTo.getTime());
  });

  it("VƯỢT TƯƠNG LAI → kẹp về hôm nay, và chuỗi trả về phản ánh giá trị ĐÃ kẹp", () => {
    const c = build({ dateFrom: "2026-08-01", dateTo: "2099-12-31" });
    expect(c.dateToStr).toBe("2026-08-25");
    expect(c.filters.dateTo.toISOString()).toBe("2026-08-25T16:59:59.999Z");
  });

  it("CẢ HAI đầu ở tương lai → thu về đúng ngày hôm nay, không sinh khoảng âm", () => {
    const c = build({ dateFrom: "2027-01-01", dateTo: "2027-01-31" });
    expect(c.dateFromStr).toBe("2026-08-25");
    expect(c.dateToStr).toBe("2026-08-25");
    expect(c.filters.dateFrom.getTime()).toBeLessThan(c.filters.dateTo.getTime());
  });

  it("chuỗi rác / rỗng → coi như thiếu, về mặc định (không ném lỗi, không NaN)", () => {
    for (const bad of ["", "hôm qua", "2026-13-45", "2026/08/01"]) {
      const c = build({ dateFrom: bad, dateTo: bad });
      expect(Number.isNaN(c.filters.dateFrom.getTime())).toBe(false);
      expect(Number.isNaN(c.filters.dateTo.getTime())).toBe(false);
      expect(c.dateFromStr).toBe("2026-08-01");
      expect(c.dateToStr).toBe("2026-08-25");
    }
  });

  it("tham số lặp → lấy giá trị ĐẦU (khớp URLSearchParams.get)", () => {
    expect(build({ dateFrom: ["2026-08-05", "2026-08-09"] }).dateFromStr).toBe("2026-08-05");
  });
});

// ───────────────────────────── Khoá cache (ràng buộc 7 của PRD §6.2) ─────────────────────────────

describe("[A-02] scopeFilterCacheKey — mọi trường của bộ lọc phải nằm trong khoá", () => {
  it("đổi groupByCenter → ĐỔI khoá (gộp và tách trả hai hình dạng khác nhau)", () => {
    const gop = build({ split: "0" }).filters;
    const tach = build({ split: "1" }).filters;
    expect(scopeFilterCacheKey(gop)).not.toBe(scopeFilterCacheKey(tach));
  });

  it("đổi tập cơ sở → đổi khoá", () => {
    expect(scopeFilterCacheKey(build({ center: "cs1" }).filters)).not.toBe(
      scopeFilterCacheKey(build({ center: "cs2" }).filters),
    );
  });

  it("cùng tập cơ sở, khác thứ tự trong URL → CÙNG khoá (không băm nhỏ cache vô ích)", () => {
    expect(scopeFilterCacheKey(build({ center: ["cs3", "cs1"] }, VISIBLE_3).filters)).toBe(
      scopeFilterCacheKey(build({ center: ["cs1", "cs3"] }, VISIBLE_3).filters),
    );
  });

  it("đổi khoảng ngày → đổi khoá", () => {
    expect(scopeFilterCacheKey(build({ dateFrom: "2026-08-01" }).filters)).not.toBe(
      scopeFilterCacheKey(build({ dateFrom: "2026-08-02" }).filters),
    );
  });

  it("cùng danh sách cơ sở nhưng khác isAllCenters → khác khoá (dòng centerId=null xử lý khác)", () => {
    const all = build({}).filters;
    const liet_ke = { ...all, isAllCenters: false };
    expect(scopeFilterCacheKey(all)).not.toBe(scopeFilterCacheKey(liet_ke));
  });
});

// ───────────────────────────── Helper dựng where (chống RT-2) ─────────────────────────────

describe("[A-02][RT-2] scopeCenterWhere / scopeDateWhere", () => {
  it("scopeCenterWhere LUÔN là { in: [...] } tường minh — kể cả khi chọn 'tất cả'", () => {
    // RT-2 đã bác bỏ giả định 'centerIds = null thì scopedDb vẫn chặn': AdsInsightDaily /
    // MarketingCostPeriod không có cột centerId, Conversation + RevenueTarget nằm trong
    // SCOPE_EXEMPT. Bộ lọc phải phát ra danh sách tường minh để chỗ gọi không thể quên.
    expect(scopeCenterWhere(build({}).filters)).toEqual({ in: ["cs1", "cs2"] });
    expect(scopeCenterWhere(build({ center: "cs2" }).filters)).toEqual({ in: ["cs2"] });
  });

  it("scopeDateWhere luôn có đủ hai cận", () => {
    const w = scopeDateWhere(build({}).filters);
    expect(w.gte.toISOString()).toBe("2026-07-31T17:00:00.000Z");
    expect(w.lte.toISOString()).toBe("2026-08-25T16:59:59.999Z");
  });
});

// ───────── Đọc bộ lọc từ URLSearchParams (đường ROUTE, vd xuất Excel C-04) ─────────

describe("[A-02] parseScopeFilterSearchParams — route giải lại đúng bộ lọc của màn hình", () => {
  it("GOM ĐỦ mọi ?center= lặp lại — đây là chỗ dễ mất cơ sở nhất", () => {
    // `URLSearchParams.get()` chỉ trả giá trị ĐẦU. Route dùng nhầm `get` thì tệp xuất ra
    // chỉ có cơ sở thứ nhất, không lỗi, không cảnh báo — người dùng chỉ phát hiện khi
    // ngồi đối chiếu tay với bảng trên màn.
    const sp = parseScopeFilterSearchParams(
      new URLSearchParams("center=cs1&center=cs2&center=cs3"),
    );
    expect(sp.center).toEqual(["cs1", "cs2", "cs3"]);
  });

  it("vắng ?center= ⇒ mảng rỗng, tức 'toàn bộ phạm vi' đúng như khi vắng mặt trên trang", () => {
    const sp = parseScopeFilterSearchParams(new URLSearchParams("dateFrom=2026-08-01"));
    expect(sp.center).toEqual([]);
    expect(buildScopeFilters({ visibleCenterIds: VISIBLE_2, sp, now: NOW }).filters).toMatchObject({
      centerIds: ["cs1", "cs2"],
      isAllCenters: true,
    });
  });

  it("chuỗi truy vấn do chính trang phát ra quay ngược lại cho ra ĐÚNG bộ lọc cũ", () => {
    // Đây là hợp đồng thật của C-04: link xuất được dựng bằng `qlcsFilterParams` từ bộ
    // lọc ĐÃ GIẢI, rồi route giải lại. Hai đầu lệch nhau là tệp khác màn hình.
    const goc = build({ center: ["cs2"], dateFrom: "2026-08-03", dateTo: "2026-08-09" });
    const lai = buildScopeFilters({
      visibleCenterIds: VISIBLE_2,
      sp: parseScopeFilterSearchParams(
        new URLSearchParams("center=cs2&dateFrom=2026-08-03&dateTo=2026-08-09"),
      ),
      now: NOW,
    });
    expect(lai.filters).toEqual(goc.filters);
  });

  it("cơ sở ngoài phạm vi gõ tay vào URL vẫn bị loại — nút xuất không phải cửa sau", () => {
    const lai = buildScopeFilters({
      visibleCenterIds: VISIBLE_2,
      sp: parseScopeFilterSearchParams(new URLSearchParams("center=cs1&center=cs3")),
      now: NOW,
    });
    expect(lai.filters.centerIds).toEqual(["cs1"]);
    expect(lai.droppedCenterCount).toBe(1);
  });

  it("tham số vắng mặt trả undefined chứ không phải chuỗi rỗng (chuỗi rỗng là ngày rác)", () => {
    const sp = parseScopeFilterSearchParams(new URLSearchParams(""));
    expect(sp.dateFrom).toBeUndefined();
    expect(sp.dateTo).toBeUndefined();
    expect(sp.split).toBeUndefined();
  });
});
