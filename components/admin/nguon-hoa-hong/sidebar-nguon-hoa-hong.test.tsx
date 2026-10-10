// @vitest-environment jsdom
/**
 * [NHH-FE-02] · [NHH-FE-02b] — hai mục sidebar của module "Nguồn lead & Chính sách hoa hồng", mỗi mục
 * một cờ (docs/source-commission/05 §1.5, §2.3; 06 §4.1).
 *
 * VÌ SAO HAI MỤC, KHÔNG PHẢI MỘT: bộ lọc sidebar AND cờ với `perm` tĩnh của MỘT mục. Một mục duy nhất mang
 * `perm` = hợp mọi key sẽ hiện cho Sale (chỉ có `commission:view-self`) suốt PILOT NGUỒN (cờ nguồn bật,
 * engine tắt) mà bấm vào không mở được tab nào — lời hứa suông (luật 12). Ca `[NHH-FE-02b]` canh đúng
 * hình dạng đó, kèm ĐỐI CHỨNG DƯƠNG: Marketing (có `sources:view`) THẤY "Nguồn lead" ở cùng cấu hình
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

const NGUON = "Nguồn lead";
const SO = "Sổ hoa hồng";

/** Mọi action của một RoleDef trong seed v2 — nguồn quyền thật của menu trên prod. */
function granted(code: string): string[] {
  const r = ROLE_SEED.find((x) => x.code === code);
  if (!r) throw new Error(`Không có RoleDef ${code} trong ROLE_SEED`);
  return r.perms.map((p) => p.action);
}

function dung(role: string, co: { nguonLeadEnabled: boolean; hoaHongEngineEnabled: boolean }) {
  render(<Sidebar granted={granted(role)} anMenu={[]} userId="" {...co} />);
}

const thay = (ten: string) => screen.queryByRole("link", { name: ten }) !== null;
const hrefCua = (ten: string) => screen.getByRole("link", { name: ten }).getAttribute("href");

describe("[NHH-FE-02] mỗi cờ gác đúng mục của nó (cờ tắt ⇒ mục ẩn, cờ bật ⇒ mục hiện)", () => {
  it("cả hai cờ TẮT ⇒ không ai thấy mục nào — kể cả vai giữ đủ quyền", () => {
    for (const role of ["SUPER_ADMIN", "CENTER_MANAGER", "HO_MARKETING"]) {
      cleanup();
      dung(role, { nguonLeadEnabled: false, hoaHongEngineEnabled: false });
      expect(thay(NGUON), `${role}: cờ nguồn tắt mà vẫn thấy "${NGUON}"`).toBe(false);
      expect(thay(SO), `${role}: cờ engine tắt mà vẫn thấy "${SO}"`).toBe(false);
    }
  });

  it("đối chứng dương: cả hai cờ BẬT ⇒ Quản lý cơ sở thấy CẢ HAI, đúng địa chỉ", () => {
    dung("CENTER_MANAGER", { nguonLeadEnabled: true, hoaHongEngineEnabled: true });
    expect(hrefCua(NGUON)).toBe("/nguon-hoa-hong/nguon");
    expect(hrefCua(SO)).toBe("/nguon-hoa-hong/so");
  });

  it("hai cờ ĐỘC LẬP: chỉ cờ nguồn bật ⇒ chỉ 'Nguồn lead'; chỉ cờ engine bật ⇒ chỉ 'Sổ hoa hồng'", () => {
    dung("CENTER_MANAGER", { nguonLeadEnabled: true, hoaHongEngineEnabled: false });
    expect([thay(NGUON), thay(SO)]).toEqual([true, false]);
    cleanup();
    dung("CENTER_MANAGER", { nguonLeadEnabled: false, hoaHongEngineEnabled: true });
    expect([thay(NGUON), thay(SO)]).toEqual([false, true]);
  });
});

describe("[NHH-FE-02b] vế PILOT: nguồn bật, engine tắt", () => {
  const PILOT = { nguonLeadEnabled: true, hoaHongEngineEnabled: false };

  it("Sale cơ sở (chỉ commission:view-self) KHÔNG thấy mục nào — không có mục để bấm vào rồi trống", () => {
    dung("CENTER_SALES_CSM", PILOT);
    expect(thay(NGUON)).toBe(false);
    expect(thay(SO)).toBe(false);
  });

  it("ĐỐI CHỨNG DƯƠNG: Marketing HO (có sources:view) THẤY 'Nguồn lead' ở đúng cấu hình đó", () => {
    dung("HO_MARKETING", PILOT);
    expect(thay(NGUON)).toBe(true);
    expect(thay(SO)).toBe(false); // engine tắt ⇒ sổ không có chỗ cho nó
  });

  it("ĐỐI CHỨNG DƯƠNG 2: engine bật ⇒ Sale thấy 'Sổ hoa hồng' (view-self đủ) nhưng vẫn không thấy 'Nguồn lead'", () => {
    dung("CENTER_SALES_CSM", { nguonLeadEnabled: true, hoaHongEngineEnabled: true });
    expect(thay(SO)).toBe(true);
    expect(thay(NGUON)).toBe(false);
  });
});

describe("[NHH-FE-02c] menu nói đúng điều gate nói (perm của mục = PAGE_GATES[href])", () => {
  it("Marketing HO có commission:view-self ⇒ gate của /so mở ⇒ THẤY 'Sổ hoa hồng' khi engine bật (H14: mọi vai nội bộ có thể là người hưởng)", () => {
    const gateSo = PAGE_GATES["/nguon-hoa-hong/so"] as readonly string[];
    expect(granted("HO_MARKETING").some((a) => gateSo.includes(a)), "gate /so phải mở cho Marketing").toBe(true);
    dung("HO_MARKETING", { nguonLeadEnabled: true, hoaHongEngineEnabled: true });
    expect(thay(SO)).toBe(true);
  });

  it("đối chứng âm: Giáo viên thuần không giữ key nào của hai gate ⇒ không thấy mục nào dù cả hai cờ bật", () => {
    const gates = [...PAGE_GATES["/nguon-hoa-hong/nguon"], ...PAGE_GATES["/nguon-hoa-hong/so"]] as readonly string[];
    expect(granted("TEACHER").some((a) => gates.includes(a)), "TEACHER không được giữ key module (chỉ từ PR12)").toBe(false);
    dung("TEACHER", { nguonLeadEnabled: true, hoaHongEngineEnabled: true });
    expect([thay(NGUON), thay(SO)]).toEqual([false, false]);
  });
});

describe("[NHH-FE-02f] không truyền cờ ⇒ mục ẨN (mặc định fail-closed)", () => {
  it("Sidebar dựng KHÔNG kèm hai cờ (người gọi quên nối dây) ⇒ cả hai mục ẩn dù vai giữ đủ quyền; truyền true thì hiện (đối chứng dương)", () => {
    // Đợt cấy 08/10 (S05): đổi mặc định `hoaHongEngineEnabled = false` thành `true` ra XANH — mọi ca dựng Sidebar đều
    // truyền cờ tường minh nên mặc định không bao giờ được dùng, và khi dây nối đứt thì mục HIỆN cho người chưa được bật.
    render(<Sidebar granted={granted("CENTER_MANAGER")} anMenu={[]} userId="" />);
    expect(thay(NGUON)).toBe(false);
    expect(thay(SO)).toBe(false);
    cleanup();
    render(<Sidebar granted={granted("CENTER_MANAGER")} anMenu={[]} userId="" nguonLeadEnabled hoaHongEngineEnabled />);
    expect(thay(NGUON)).toBe(true);
    expect(thay(SO)).toBe(true);
  });
});

describe("[NHH-FE-02g] cổng `perm` của từng mục có RĂNG thật — đo ở nhóm đang MỞ", () => {
  // Vì sao ca này tồn tại: [NHH-FE-02c] cho Giáo viên + hai cờ bật và đòi KHÔNG thấy mục, nhưng Giáo viên không có mục
  // nào của nhóm "CRM & Tuyển sinh" nên nhóm ĐÓNG ⇒ mục không có trong DOM dù `perm` có bị gỡ hay không. Cấy 08/10: bỏ hẳn
  // `perm` khỏi "Sổ hoa hồng" ⇒ 44/44 ca XANH (CLAUDE.md luật 11: ca chỉ khẳng định sự vắng mặt luôn đạt khi tính năng hỏng).
  // Cách đo đúng: đứng NGAY trên trang của mục (`usePathname` = href mục) để nhóm chứa nó mở nếu mục còn hiện.
  const CO = { nguonLeadEnabled: true, hoaHongEngineEnabled: true };

  it("đối chứng dương: ở /so, Quản lý cơ sở THẤY 'Sổ hoa hồng'; ở /nguon THẤY 'Nguồn lead' (nhóm mở thì mục có mặt)", () => {
    nav.path = "/nguon-hoa-hong/so";
    dung("CENTER_MANAGER", CO);
    expect(thay(SO)).toBe(true);
    cleanup();
    nav.path = "/nguon-hoa-hong/nguon";
    dung("CENTER_MANAGER", CO);
    expect(thay(NGUON)).toBe(true);
  });

  it("Giáo viên (không giữ key nào của hai gate) đứng ngay trên trang mục, cả hai cờ bật ⇒ KHÔNG thấy 'Sổ hoa hồng' lẫn 'Nguồn lead'", () => {
    const gates = [...PAGE_GATES["/nguon-hoa-hong/nguon"], ...PAGE_GATES["/nguon-hoa-hong/so"]] as readonly string[];
    expect(granted("TEACHER").some((a) => gates.includes(a))).toBe(false);
    for (const path of ["/nguon-hoa-hong/so", "/nguon-hoa-hong/nguon"]) {
      cleanup();
      nav.path = path;
      dung("TEACHER", CO);
      expect(thay(SO), `${path}: Giáo viên thấy "${SO}"`).toBe(false);
      expect(thay(NGUON), `${path}: Giáo viên thấy "${NGUON}"`).toBe(false);
    }
  });

  it("Marketing HO có sources:view nhưng sổ cũng mở bằng commission:view-self: đứng ở /nguon, engine tắt ⇒ thấy 'Nguồn lead', KHÔNG thấy 'Sổ hoa hồng'", () => {
    nav.path = "/nguon-hoa-hong/nguon";
    dung("HO_MARKETING", { nguonLeadEnabled: true, hoaHongEngineEnabled: false });
    expect(thay(NGUON)).toBe(true);
    expect(thay(SO)).toBe(false);
  });
});
