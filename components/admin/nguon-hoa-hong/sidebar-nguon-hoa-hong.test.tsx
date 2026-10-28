// @vitest-environment jsdom
/**
 * [NHH-FE-02] · [NHH-FE-02b] — MỘT mục sidebar «Nguồn Lead & Hoa hồng» của module (docs/source-commission/05 §1.5, §2.3; 06 §4.1;
 * 12 §2.8 — đặc tả Affiliate §3, §81: không còn hai mục gốc cạnh tranh).
 *
 * BẤT BIẾN ĐƯỢC GIỮ khi gộp hai mục (Nguồn lead · Sổ hoa hồng) thành một: mục chỉ hiện khi người xem MỞ ĐƯỢC ÍT NHẤT MỘT TAB
 * (quyền ∧ cờ của TỪNG tab — `tabUngVien`). Một mục gộp theo `perm` thuần (hợp mọi khoá) sẽ hiện cho Sale (chỉ có
 * `commission:view-self`) suốt PILOT NGUỒN (cờ nguồn bật, engine tắt) mà bấm vào route gốc chỉ nhận 404 — lời hứa suông (luật 12).
 * Ca `[NHH-FE-02b]` canh đúng hình dạng đó, kèm ĐỐI CHỨNG DƯƠNG: Marketing (có `sources:view`) THẤY mục ở cùng cấu hình
 * (CLAUDE.md luật 11: ca chỉ khẳng định SỰ VẮNG MẶT luôn ĐẠT khi tính năng hỏng hoàn toàn).
 *
 * Quyền lấy từ ROLE_SEED THẬT (RBAC v2) chứ không gõ tay danh sách — gõ tay là test kiểm test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ROLE_SEED } from "../../../prisma/seed-roles";
import { PAGE_GATES } from "@/lib/auth/page-gates";

// Đường dẫn đổi được theo ca: mặc định "/leads" mở nhóm "CRM & Tuyển sinh"; ca [NHH-FE-02g] đứng ở chính trang của mục.
const nav = vi.hoisted(() => ({ path: "/leads" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path, // mở nhóm "CRM & Tuyển sinh" — nhóm khác đóng thì mục con không có trong DOM
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/chat/use-chat-unread", () => ({
  useChatUnread: (_id: string, seed: number) => seed,
}));

import { Sidebar } from "../sidebar";

afterEach(() => {
  cleanup();
  nav.path = "/leads";
});

const MUC = "Nguồn Lead & Hoa hồng";
const HAI_MUC_CU = ["Nguồn lead", "Sổ hoa hồng"] as const;
const GOC = "/nguon-hoa-hong";

/** Mọi action của một RoleDef trong seed v2 — nguồn quyền thật của menu trên prod. */
function granted(code: string): string[] {
  const r = ROLE_SEED.find((x) => x.code === code);
  if (!r) throw new Error(`Không có RoleDef ${code} trong ROLE_SEED`);
  return r.perms.map((p) => p.action);
}

function dung(role: string, co: { nguonLeadEnabled: boolean; hoaHongEngineEnabled: boolean }) {
  render(<Sidebar granted={granted(role)} anMenu={[]} userId="" {...co} />);
}

const thay = (ten: string = MUC) => screen.queryByRole("link", { name: ten }) !== null;
const hrefCua = (ten: string = MUC) => screen.getByRole("link", { name: ten }).getAttribute("href");
/** Mọi link của module trên sidebar (theo địa chỉ) — đặc tả §81: chỉ MỘT, không hai mục gốc cạnh tranh. */
const linkModule = () => screen.queryAllByRole("link").filter((a) => (a.getAttribute("href") ?? "").startsWith(GOC));

describe("[NHH-FE-02] một mục, hiện theo tab mở được (cờ tắt ⇒ ẩn, cờ bật ⇒ hiện)", () => {
  it("cả hai cờ TẮT ⇒ không ai thấy mục — kể cả vai giữ đủ quyền", () => {
    for (const role of ["SUPER_ADMIN", "CENTER_MANAGER", "HO_MARKETING"]) {
      cleanup();
      dung(role, { nguonLeadEnabled: false, hoaHongEngineEnabled: false });
      expect(thay(), `${role}: cả hai cờ tắt mà vẫn thấy "${MUC}"`).toBe(false);
    }
  });

  it("đối chứng dương: cả hai cờ BẬT ⇒ Quản lý cơ sở thấy mục, đúng địa chỉ route gốc", () => {
    dung("CENTER_MANAGER", { nguonLeadEnabled: true, hoaHongEngineEnabled: true });
    expect(hrefCua()).toBe(GOC);
  });

  it("hai cờ ĐỘC LẬP nhưng MỖI cờ một mình đủ mở mục (cho người có quyền tab của cờ ấy): chỉ cờ nguồn ⇒ hiện; chỉ cờ engine ⇒ hiện", () => {
    dung("CENTER_MANAGER", { nguonLeadEnabled: true, hoaHongEngineEnabled: false });
    expect(thay()).toBe(true);
    cleanup();
    dung("CENTER_MANAGER", { nguonLeadEnabled: false, hoaHongEngineEnabled: true });
    expect(thay()).toBe(true);
  });

  it("[NHH-FE-02h] §81: sidebar chỉ có MỘT link của module, đúng nhãn — không còn hai mục gốc cũ", () => {
    dung("CENTER_MANAGER", { nguonLeadEnabled: true, hoaHongEngineEnabled: true });
    const lk = linkModule();
    expect(lk.map((a) => [a.textContent?.trim(), a.getAttribute("href")])).toEqual([[MUC, GOC]]);
    for (const cu of HAI_MUC_CU) expect(thay(cu), `mục cũ "${cu}" còn trên sidebar`).toBe(false);
  });
});

describe("[NHH-FE-02b] vế PILOT: nguồn bật, engine tắt", () => {
  const PILOT = { nguonLeadEnabled: true, hoaHongEngineEnabled: false };

  it("Sale cơ sở (chỉ commission:view-self) KHÔNG thấy mục — route gốc sẽ 404, nên không có link để bấm vào rồi trống", () => {
    dung("CENTER_SALES_CSM", PILOT);
    expect(thay()).toBe(false);
    expect(linkModule()).toHaveLength(0);
  });

  it("ĐỐI CHỨNG DƯƠNG: Marketing HO (có sources:view) THẤY mục ở đúng cấu hình đó", () => {
    dung("HO_MARKETING", PILOT);
    expect(thay()).toBe(true);
  });

  it("ĐỐI CHỨNG DƯƠNG 2: engine bật ⇒ Sale thấy mục (view-self mở tab Sổ) — cùng vai, chỉ khác cờ", () => {
    dung("CENTER_SALES_CSM", { nguonLeadEnabled: true, hoaHongEngineEnabled: true });
    expect(thay()).toBe(true);
  });

  it("vế ngược: engine bật, nguồn TẮT ⇒ vai chỉ có sources:view (không commission:*) KHÔNG thấy mục", () => {
    // Tab nào cũng cần ĐỦ quyền ∧ cờ; người chỉ giữ khoá của tab bị cờ tắt thì không có tab nào để vào.
    const chiNguon = ["sources:view"];
    nav.path = GOC; // đứng trong module để nhóm chứa mục MỞ — vắng mặt khi đó mới là do bộ lọc, không phải nhóm đóng
    render(<Sidebar granted={chiNguon} anMenu={[]} userId="" nguonLeadEnabled={false} hoaHongEngineEnabled />);
    expect(thay()).toBe(false);
    cleanup();
    render(<Sidebar granted={chiNguon} anMenu={[]} userId="" nguonLeadEnabled hoaHongEngineEnabled={false} />);
    expect(thay()).toBe(true);
  });
});

describe("[NHH-FE-02c] menu nói đúng điều gate nói (perm của mục = PAGE_GATES[gốc])", () => {
  it("perm của mục là HỢP mọi khoá module = PAGE_GATES['/nguon-hoa-hong'] (menu gọn theo vai ẩn được vì mục có perm)", () => {
    const gates = PAGE_GATES[GOC] as readonly string[];
    const mocHop = new Set([
      ...PAGE_GATES["/nguon-hoa-hong/nguon"],
      ...PAGE_GATES["/nguon-hoa-hong/affiliate"],
      ...PAGE_GATES["/nguon-hoa-hong/campaign"],
      ...PAGE_GATES["/nguon-hoa-hong/website"],
      ...PAGE_GATES["/nguon-hoa-hong/link"],
      ...PAGE_GATES["/nguon-hoa-hong/referral"],
      ...PAGE_GATES["/nguon-hoa-hong/chinh-sach"],
      ...PAGE_GATES["/nguon-hoa-hong/so"],
      ...PAGE_GATES["/nguon-hoa-hong/ky"],
      ...PAGE_GATES["/nguon-hoa-hong/khieu-nai"],
    ]);
    expect(new Set(gates)).toEqual(mocHop);
  });

  it("Marketing HO có commission:view-self ⇒ gate tab Sổ mở cho Marketing ⇒ engine bật thì THẤY mục (H14: mọi vai nội bộ có thể là người hưởng)", () => {
    const gateSo = PAGE_GATES["/nguon-hoa-hong/so"] as readonly string[];
    expect(granted("HO_MARKETING").some((a) => gateSo.includes(a)), "gate /so phải mở cho Marketing").toBe(true);
    dung("HO_MARKETING", { nguonLeadEnabled: false, hoaHongEngineEnabled: true });
    expect(thay()).toBe(true);
  });

  it("đối chứng âm: Giáo viên thuần không giữ key nào của module ⇒ không thấy mục dù cả hai cờ bật", () => {
    const gates = PAGE_GATES[GOC] as readonly string[];
    expect(granted("TEACHER").some((a) => gates.includes(a)), "TEACHER không được giữ key module (chỉ từ PR12)").toBe(false);
    dung("TEACHER", { nguonLeadEnabled: true, hoaHongEngineEnabled: true });
    expect(thay()).toBe(false);
  });
});

describe("[NHH-FE-02f] không truyền cờ ⇒ mục ẨN (mặc định fail-closed)", () => {
  it("Sidebar dựng KHÔNG kèm hai cờ (người gọi quên nối dây) ⇒ mục ẩn dù vai giữ đủ quyền; truyền true thì hiện (đối chứng dương)", () => {
    // Đợt cấy 08/10 (S05): đổi mặc định `hoaHongEngineEnabled = false` thành `true` ra XANH — mọi ca dựng Sidebar đều
    // truyền cờ tường minh nên mặc định không bao giờ được dùng, và khi dây nối đứt thì mục HIỆN cho người chưa được bật.
    render(<Sidebar granted={granted("CENTER_MANAGER")} anMenu={[]} userId="" />);
    expect(thay()).toBe(false);
    cleanup();
    render(<Sidebar granted={granted("CENTER_MANAGER")} anMenu={[]} userId="" nguonLeadEnabled hoaHongEngineEnabled />);
    expect(thay()).toBe(true);
  });
});

describe("[NHH-FE-02g] cổng `perm` của mục có RĂNG thật — đo ở nhóm đang MỞ", () => {
  // Vì sao ca này tồn tại: [NHH-FE-02c] cho Giáo viên + hai cờ bật và đòi KHÔNG thấy mục, nhưng Giáo viên không có mục
  // nào của nhóm "CRM & Tuyển sinh" nên nhóm ĐÓNG ⇒ mục không có trong DOM dù `perm` có bị gỡ hay không. Cấy 08/10: bỏ hẳn
  // `perm` khỏi "Sổ hoa hồng" ⇒ 44/44 ca XANH (CLAUDE.md luật 11: ca chỉ khẳng định sự vắng mặt luôn đạt khi tính năng hỏng).
  // Cách đo đúng: đứng NGAY trên trang của mục (`usePathname` = href mục) để nhóm chứa nó mở nếu mục còn hiện.
  const CO = { nguonLeadEnabled: true, hoaHongEngineEnabled: true };

  it("đối chứng dương: đứng ở một tab của module, Quản lý cơ sở THẤY mục (nhóm mở thì mục có mặt)", () => {
    for (const path of [GOC, "/nguon-hoa-hong/so", "/nguon-hoa-hong/nguon"]) {
      cleanup();
      nav.path = path;
      dung("CENTER_MANAGER", CO);
      expect(thay(), path).toBe(true);
    }
  });

  it("Giáo viên (không giữ key nào của module) đứng ngay trên trang của module, cả hai cờ bật ⇒ KHÔNG thấy mục", () => {
    const gates = PAGE_GATES[GOC] as readonly string[];
    expect(granted("TEACHER").some((a) => gates.includes(a))).toBe(false);
    for (const path of [GOC, "/nguon-hoa-hong/so", "/nguon-hoa-hong/nguon"]) {
      cleanup();
      nav.path = path;
      dung("TEACHER", CO);
      expect(thay(), `${path}: Giáo viên thấy "${MUC}"`).toBe(false);
    }
  });

  it("Sale ở pilot đứng NGAY trên trang module (nhóm mở) ⇒ vẫn KHÔNG thấy mục; Marketing cùng cấu hình thì THẤY", () => {
    // `[NHH-FE-02b]` đo ở nhóm ĐÓNG nên "vắng" có thể chỉ vì nhóm đóng. Đứng trong module để nhóm mở: vắng mặt khi đó là do bộ lọc.
    nav.path = "/nguon-hoa-hong/nguon";
    dung("CENTER_SALES_CSM", { nguonLeadEnabled: true, hoaHongEngineEnabled: false });
    expect(thay()).toBe(false);
    cleanup();
    nav.path = "/nguon-hoa-hong/nguon";
    dung("HO_MARKETING", { nguonLeadEnabled: true, hoaHongEngineEnabled: false });
    expect(thay()).toBe(true);
  });
});

describe("[AFF-NAV] cờ AFFILIATE tự đủ mở mục cho người chỉ giữ khoá Affiliate", () => {
  // Người CHỈ có `affiliates:view`: không giữ khoá nguồn lẫn hoa hồng ⇒ mục hiện ⇔ cờ affiliate (cờ nguồn/engine bật cũng không cứu).
  const CHI_AFFILIATE = ["affiliates:view"];

  it("cờ affiliate BẬT ⇒ thấy; TẮT ⇒ KHÔNG thấy dù nguồn + engine bật (đối chứng dương trong cùng ca)", () => {
    nav.path = GOC;
    render(<Sidebar granted={CHI_AFFILIATE} anMenu={[]} userId="" nguonLeadEnabled hoaHongEngineEnabled affiliateEnabled />);
    expect(thay()).toBe(true);
    cleanup();
    nav.path = GOC;
    render(<Sidebar granted={CHI_AFFILIATE} anMenu={[]} userId="" nguonLeadEnabled hoaHongEngineEnabled affiliateEnabled={false} />);
    expect(thay()).toBe(false);
  });

  it("khoá của tab Campaign (`affiliate_campaigns:view`) cũng mở mục khi cờ affiliate bật", () => {
    nav.path = GOC;
    render(<Sidebar granted={["affiliate_campaigns:view"]} anMenu={[]} userId="" affiliateEnabled />);
    expect(thay()).toBe(true);
  });

  it("không truyền `affiliateEnabled` (quên nối dây) ⇒ mục ẨN với người chỉ giữ khoá Affiliate", () => {
    nav.path = GOC;
    render(<Sidebar granted={CHI_AFFILIATE} anMenu={[]} userId="" nguonLeadEnabled hoaHongEngineEnabled />);
    expect(thay()).toBe(false);
  });

  it("vai thật từ seed: Marketing HO (có affiliates:view) THẤY mục chỉ nhờ cờ affiliate; Giáo viên không thấy dù cờ bật", () => {
    nav.path = GOC;
    render(<Sidebar granted={granted("HO_MARKETING").filter((a) => a.startsWith("affiliate"))} anMenu={[]} userId="" affiliateEnabled />);
    expect(thay()).toBe(true);
    cleanup();
    nav.path = GOC;
    render(<Sidebar granted={granted("TEACHER")} anMenu={[]} userId="" nguonLeadEnabled hoaHongEngineEnabled affiliateEnabled />);
    expect(thay()).toBe(false);
  });
});

describe("[AFF-NAV-CU] mục cũ «Nguồn giới thiệu» (/affiliates) chỉ lui khi tab Affiliate MỞ ĐƯỢC cho người này", () => {
  const CU = "Nguồn giới thiệu";
  // Mục cũ gác `leads:view-all`; nhóm "CRM & Tuyển sinh" mở ở "/leads".
  const lenh = (granted: string[], affiliateEnabled: boolean, nguonLeadEnabled = true) =>
    render(<Sidebar granted={granted} anMenu={[]} userId="" nguonLeadEnabled={nguonLeadEnabled} hoaHongEngineEnabled={false} affiliateEnabled={affiliateEnabled} />);

  it("cờ affiliate TẮT ⇒ mục cũ còn nguyên (hành vi hôm nay không đổi)", () => {
    lenh(["leads:view-all", "affiliates:view"], false);
    expect(thay(CU)).toBe(true);
  });

  it("cờ BẬT + có quyền tab Affiliate ⇒ mục cũ lui, mục mới «Nguồn Lead & Hoa hồng» thay chỗ", () => {
    lenh(["leads:view-all", "affiliates:view"], true);
    expect(thay(CU)).toBe(false);
    expect(thay()).toBe(true);
  });

  it("cờ BẬT nhưng người này KHÔNG có affiliates:view ⇒ mục cũ VẪN hiện (không lấy mất lối vào của họ)", () => {
    lenh(["leads:view-all"], true);
    expect(thay(CU)).toBe(true);
  });

  it("cờ affiliate BẬT nhưng cờ NGUỒN tắt (affiliate vô hiệu theo hopCoAffiliate ở nơi gọi) ⇒ co.affiliate=false ⇒ mục cũ còn", () => {
    // Sidebar nhận `affiliateEnabled` ĐÃ AND với cờ nguồn; ở đây mô phỏng kết quả đó (false).
    lenh(["leads:view-all", "affiliates:view"], false, false);
    expect(thay(CU)).toBe(true);
  });
});
