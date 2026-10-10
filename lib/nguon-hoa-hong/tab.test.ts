/**
 * [NHH-FE-11] · [NHH-FE-02d] — luật THUẦN của khung module: tab nào hiện được, route gốc chuyển đi đâu.
 *
 * docs/source-commission/05 §1.5, 06 §4.1. Hàm thuần nên test không cần DB, không cần session.
 *
 * Mỗi tab gác bằng CẢ quyền LẪN cờ của nó (`05` §1.5): Nguồn = `sources:view` ∧ `nguon.enabled`; bốn tab còn
 * lại = key `commission*` ∧ `hoaHong.engineBat`. Quên một vế là hoặc dead-link (thấy tab bấm vào 404) hoặc
 * hở-quyền-theo-URL — nên mọi ca dưới đây đều có ĐỐI CHỨNG DƯƠNG (luật 11: ca chỉ khẳng định SỰ VẮNG MẶT luôn
 * ĐẠT khi tính năng hỏng hoàn toàn).
 */
import { describe, expect, it } from "vitest";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import {
  TAB_HREF,
  CUM_SO_DEM,
  TAB_KEYS,
  chonTabGoc,
  cacKeyCuaTab,
  tabMoDuoc,
  tabUngVien,
  type CoModule,
  type TabKey,
} from "./tab";

const quyen = (...keys: string[]) => {
  const s = new Set(keys);
  return (cacKey: readonly string[]) => cacKey.some((k) => s.has(k));
};
const CO_PILOT: CoModule = { nguon: true, engine: false };
const CO_DU: CoModule = { nguon: true, engine: true };
const CO_TAT: CoModule = { nguon: false, engine: false };

describe("[NHH-FE-02d] tabMoDuoc — quyền ∧ cờ, đúng cờ của đúng tab", () => {
  it("năm tab, mỗi tab một href gác trong PAGE_GATES (menu ≡ gate)", () => {
    expect([...TAB_KEYS]).toEqual(["nguon", "chinh-sach", "so", "ky", "khieu-nai"]);
    for (const k of TAB_KEYS) {
      expect(Object.keys(PAGE_GATES), `${TAB_HREF[k]} thiếu trong PAGE_GATES`).toContain(TAB_HREF[k]);
      expect(cacKeyCuaTab(k)).toEqual(PAGE_GATES[TAB_HREF[k]]);
    }
  });

  it("Nguồn: cần sources:view ∧ cờ nguồn — thiếu MỘT vế là ẩn", () => {
    expect(tabMoDuoc("nguon", { coQuyen: quyen("sources:view"), co: CO_PILOT })).toBe(true);
    expect(tabMoDuoc("nguon", { coQuyen: quyen("sources:view"), co: CO_TAT })).toBe(false); // thiếu cờ
    expect(tabMoDuoc("nguon", { coQuyen: quyen("commission:view-self"), co: CO_PILOT })).toBe(false); // thiếu quyền
  });

  it("bốn tab hoa hồng: cần key của CHÍNH nó ∧ cờ engine (cờ nguồn không thay được)", () => {
    const hop: [TabKey, string][] = [
      ["chinh-sach", "commission_policies:view"],
      ["so", "commission:view-self"],
      ["ky", "commission_periods:manage"],
      ["khieu-nai", "commission_disputes:review"],
    ];
    for (const [tab, key] of hop) {
      expect(tabMoDuoc(tab, { coQuyen: quyen(key), co: CO_DU }), `${tab} có key + engine bật`).toBe(true);
      expect(tabMoDuoc(tab, { coQuyen: quyen(key), co: CO_PILOT }), `${tab}: engine tắt ⇒ ẩn`).toBe(false);
      expect(tabMoDuoc(tab, { coQuyen: quyen("sources:view"), co: CO_DU }), `${tab}: key nguồn không mở tab hoa hồng`).toBe(false);
    }
  });

  it("tab Kỳ KHÔNG mở cho người chỉ có view-self (Sale): kỳ là việc của kế toán/QLCS", () => {
    expect(tabMoDuoc("ky", { coQuyen: quyen("commission:view-self"), co: CO_DU })).toBe(false);
    expect(tabMoDuoc("ky", { coQuyen: quyen("commission:view-center"), co: CO_DU })).toBe(true); // đối chứng dương
  });
});

describe("[NHH-FE-11] route gốc — chuyển sang tab ĐẦU TIÊN có hàng chờ > 0, không thì ứng viên đầu, rỗng ⇒ null (404)", () => {
  it("tabUngVien giữ đúng thứ tự năm tab và chỉ giữ tab quyền ∧ cờ", () => {
    expect(tabUngVien({ coQuyen: quyen("sources:view", "commission:view-self"), co: CO_DU })).toEqual(["nguon", "so", "khieu-nai"]); // view-self mở cả tab Khiếu nại (gate của nó)
    expect(tabUngVien({ coQuyen: quyen("sources:view", "commission:view-self"), co: CO_PILOT })).toEqual(["nguon"]);
    expect(tabUngVien({ coQuyen: quyen("commission:view-self"), co: CO_PILOT })).toEqual([]);
    expect(tabUngVien({ coQuyen: quyen("sources:view"), co: CO_TAT })).toEqual([]);
  });

  it("pilot nguồn (engine tắt), hàng chờ 0 ⇒ sang tab NGUỒN, KHÔNG sang tab Kỳ (tab Kỳ trả 404 lúc đó)", () => {
    const uv = tabUngVien({ coQuyen: quyen("sources:view", "commission:view-center", "commission_periods:manage"), co: CO_PILOT });
    expect(uv).toEqual(["nguon"]);
    expect(chonTabGoc(uv, {})).toBe("nguon");
    expect(chonTabGoc(uv, { nguon: 0 })).toBe("nguon");
  });

  it("có hàng chờ ⇒ ưu tiên tab đầu tiên có hàng chờ > 0 (không phải tab đầu tiên)", () => {
    const uv: TabKey[] = ["nguon", "chinh-sach", "so", "ky"];
    expect(chonTabGoc(uv, { nguon: 0, so: 3, ky: 9 })).toBe("so");
    // đối chứng dương: nguồn cũng có việc ⇒ nguồn đứng trước
    expect(chonTabGoc(uv, { nguon: 1, so: 3 })).toBe("nguon");
  });

  it("hàng chờ nằm ở tab KHÔNG nằm trong ứng viên thì bị bỏ qua (không nhảy vào tab người xem không vào được)", () => {
    expect(chonTabGoc(["nguon"], { ky: 5 })).toBe("nguon");
  });

  it("không ứng viên ⇒ null (route gốc trả 404, không phải trang trống)", () => {
    expect(chonTabGoc([], { nguon: 4 })).toBeNull();
  });

  it("cấy: chuyển cứng sang tab Kỳ sẽ làm ca pilot đỏ — chonTabGoc không bao giờ trả tab ngoài ứng viên", () => {
    for (const uv of [["nguon"], ["so"], ["nguon", "so"]] as TabKey[][]) {
      const kq = chonTabGoc(uv, { ky: 99 });
      expect(uv).toContain(kq);
    }
  });
});

describe("[NHH-FE-NAV-LB] CUM_SO_DEM — nhãn pill mỗi tab", () => {
  it("phủ ĐỦ năm tab (Record ⇒ thêm tab mà quên nhãn là lỗi biên dịch); tab Sổ và tab Kỳ KHÁC nhau và nói đúng phạm vi", () => {
    expect(Object.keys(CUM_SO_DEM).sort()).toEqual([...TAB_KEYS].sort());
    expect(CUM_SO_DEM.so).not.toBe(CUM_SO_DEM.ky);
    expect(CUM_SO_DEM.so).toMatch(/đang mở/);
    expect(CUM_SO_DEM.ky).toMatch(/chặn khoá/);
    expect(CUM_SO_DEM.ky).toMatch(/mọi kỳ chưa khoá/); // pill Kỳ cộng dồn mọi kỳ chưa khoá — phải nói ra
  });
});
