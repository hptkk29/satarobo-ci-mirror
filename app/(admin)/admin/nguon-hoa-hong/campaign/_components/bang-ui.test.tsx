// @vitest-environment jsdom
/**
 * [AFB-*] — Hai bảng phía server (campaign · thành viên) và khối XEM TRƯỚC NGUỒN trên phần tử thật (jsdom).
 *
 *   [AFB-01] BangCampaign: cột · SPLIT ghi «chưa dùng được» · nhãn hết hạn / chưa bắt đầu · liên kết cả dòng · phân trang
 *   [AFB-02] BangMembership: cột «Thao tác» chỉ khi có quyền (đối chứng dương) · KHÔNG PII · câu rỗng nói đúng
 *   [AFB-03] XemTruocNguon: bậc quyết định · «Cần xem tay» KÈM lý do (không «Không rõ») · cảnh báo nguồn hỏng · không đối tác
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/campaign/_actions", () => ({ doiTrangThaiMembershipAction: vi.fn(), suaMembershipAction: vi.fn() }));

import type { DoiTacChonView, DongCampaignView, DongMembershipView, XemTruocView } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { BangCampaign } from "./bang-campaign";
import { BangMembership } from "./bang-membership";
import { XemTruocNguon } from "./xem-truoc-nguon";

afterEach(cleanup);

const NOW = new Date("2026-10-13T03:00:00.000Z");

const C = (p: Partial<DongCampaignView> & Pick<DongCampaignView, "id" | "code" | "name">): DongCampaignView => ({
  status: "ACTIVE",
  attributionModel: "FIRST_VALID",
  effectiveFrom: null,
  effectiveTo: null,
  soDoiTacHoatDong: 0,
  soWebsite: 0,
  capNhatLuc: "2026-10-13T02:00:00.000Z",
  ...p,
});

describe("[AFB-01] BangCampaign", () => {
  const dung = (dong: DongCampaignView[], tong = dong.length, trang = 1) =>
    render(<BangCampaign dong={dong} tong={tong} trang={trang} kichThuoc={25} hrefTrang={(t) => `/x?trang=${t}`} now={NOW} />);

  it("sáu cột đúng tên; tên campaign là LIÊN KẾT tới chi tiết theo MÃ; số đối tác = đang tham gia (cột nói rõ trong title)", () => {
    dung([C({ id: "1", code: "TET_2027", name: "Giới thiệu Tết", soDoiTacHoatDong: 1234, soWebsite: 2 })]);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Campaign", "Trạng thái", "Mô hình ghi nhận", "Hiệu lực", "Đối tác", "Website"]);
    expect(screen.getByRole("columnheader", { name: "Đối tác" }).getAttribute("title")).toMatch(/đang tham gia/);
    expect(screen.getByRole("link", { name: "Giới thiệu Tết" }).getAttribute("href")).toBe("/nguon-hoa-hong/campaign/TET_2027");
    expect(screen.getByText("1.234")).toBeTruthy();
    expect(screen.getByText("Đang chạy")).toBeTruthy();
    expect(screen.getByText("Không giới hạn")).toBeTruthy();
  });

  it("cả dòng là vùng bấm: <tr> relative cursor-pointer + liên kết mang after:inset-0 (luật 12); KHÔNG có mũi tên trơ", () => {
    const { container } = dung([C({ id: "1", code: "TET_2027", name: "Giới thiệu Tết" })]);
    const tr = container.querySelector("tbody tr")!;
    expect(tr.className).toMatch(/\brelative\b/);
    expect(tr.className).toMatch(/cursor-pointer/);
    expect(screen.getByRole("link", { name: "Giới thiệu Tết" }).className).toMatch(/after:inset-0/);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("SPLIT ghi «Cần chính sách riêng — chưa dùng được» ngay trong bảng; mô hình khác thì KHÔNG ghi (đối chứng dương)", () => {
    dung([C({ id: "1", code: "A_A", name: "Chia", attributionModel: "SPLIT" }), C({ id: "2", code: "B_B", name: "Thường" })]);
    expect(screen.getAllByText(/Cần chính sách riêng — chưa dùng được/)).toHaveLength(1);
    expect(screen.getByText("Chia giữa nhiều người")).toBeTruthy();
    expect(screen.getByText("Người đầu tiên hợp lệ")).toBeTruthy();
  });

  it("hiệu lực: quá hạn ⇒ «Đã hết hạn»; chưa tới ngày ⇒ «Chưa bắt đầu»; đang trong khoảng ⇒ không nhãn; campaign ĐÃ KẾT THÚC không gắn nhãn", () => {
    dung([
      C({ id: "1", code: "HET_HAN", name: "Quá hạn", effectiveTo: "2026-10-01T00:00:00.000Z" }),
      C({ id: "2", code: "CHUA_BD", name: "Sắp tới", effectiveFrom: "2026-11-01T00:00:00.000Z" }),
      C({ id: "3", code: "DANG_CHAY", name: "Trong khoảng", effectiveFrom: "2026-09-01T00:00:00.000Z", effectiveTo: "2026-12-31T00:00:00.000Z" }),
      C({ id: "4", code: "DA_KET", name: "Khép lại", status: "ENDED", effectiveTo: "2026-10-01T00:00:00.000Z" }),
    ]);
    expect(screen.getAllByText("Đã hết hạn")).toHaveLength(1);
    expect(screen.getAllByText("Chưa bắt đầu")).toHaveLength(1);
    expect(within(screen.getByRole("link", { name: "Quá hạn" }).closest("tr") as HTMLElement).getByText("Đã hết hạn")).toBeTruthy();
    expect(within(screen.getByRole("link", { name: "Trong khoảng" }).closest("tr") as HTMLElement).queryByText(/Đã hết hạn|Chưa bắt đầu/)).toBeNull();
    expect(within(screen.getByRole("link", { name: "Khép lại" }).closest("tr") as HTMLElement).queryByText("Đã hết hạn")).toBeNull();
  });

  it("phân trang: 'Hiển thị a–b / tổng' đúng; nhiều trang ⇒ có điều hướng; một trang ⇒ không", () => {
    const hai = Array.from({ length: 2 }, (_, i) => C({ id: `${i}`, code: `MA_${i}`, name: `C${i}` }));
    const { unmount } = dung(hai, 60, 2);
    expect(document.body.textContent).toMatch(/Hiển thị\s*26–50\s*\/ 60 campaign/);
    expect(screen.getAllByRole("link").some((l) => l.getAttribute("href") === "/x?trang=1")).toBe(true);
    unmount();
    dung(hai, 2, 1);
    expect(screen.queryAllByRole("link").some((l) => (l.getAttribute("href") ?? "").startsWith("/x?trang="))).toBe(false);
  });
});

describe("[AFB-02] BangMembership", () => {
  const M = (id: string, p: Partial<DongMembershipView> = {}): DongMembershipView => ({
    id,
    doiTac: { id: `p${id}`, code: `DT_${id}`, ten: `Đối tác ${id}`, kind: "ORGANIZATION", loai: "Trường học", status: "ACTIVE" },
    status: "PENDING",
    groupLabel: null,
    effectiveFrom: "2026-10-01T00:00:00.000Z",
    effectiveTo: null,
    approvedAt: null,
    capNhatLuc: "2026-10-13T02:00:00.000Z",
    ...p,
  });
  const dung = (dong: DongMembershipView[], p: { coTheGhi?: boolean; dangLoc?: boolean; campaignStatus?: "ACTIVE" | "ENDED" } = {}) =>
    render(<BangMembership dong={dong} tong={dong.length} trang={1} kichThuoc={25} hrefTrang={(t) => `/x?trang=${t}`} campaignStatus={p.campaignStatus ?? "ACTIVE"} coTheGhi={p.coTheGhi ?? false} dangLoc={p.dangLoc ?? false} />);

  it("cột «Thao tác» + nút CHỈ khi có quyền `affiliate_memberships:manage`; đối chứng dương: có quyền ⇒ thấy", () => {
    dung([M("1")], { coTheGhi: false });
    expect(screen.queryByRole("columnheader", { name: "Thao tác" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Duyệt/ })).toBeNull();
    cleanup();
    dung([M("1")], { coTheGhi: true });
    expect(screen.getByRole("columnheader", { name: "Thao tác" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Duyệt/ })).toBeTruthy();
  });

  it("hiện tên · mã · loại · trạng thái · nhãn · hiệu lực; KHÔNG SĐT / email (kiểu dữ liệu không có chỗ cho chúng)", () => {
    dung([M("1", { status: "ACTIVE", groupLabel: "Nhóm A", approvedAt: "2026-10-05T00:00:00.000Z", effectiveTo: "2026-12-31T00:00:00.000Z" })]);
    expect(screen.getByText("Đối tác 1")).toBeTruthy();
    expect(document.body.textContent).toMatch(/DT_1.*Tổ chức.*Trường học/);
    expect(screen.getByText("Đang tham gia")).toBeTruthy();
    expect(screen.getByText("Nhóm A")).toBeTruthy();
    expect(document.body.textContent).toMatch(/01\/10\/2026 – 31\/12\/2026/);
    expect(document.body.textContent).toMatch(/Duyệt 05\/10\/2026/);
    expect(document.body.textContent).not.toMatch(/@|\b0\d{9}\b/);
  });

  it("dòng có đối tác KHÔNG còn hoạt động ⇒ ghi chú rõ ngay dưới tên", () => {
    dung([M("1", { doiTac: { id: "p1", code: "DT_1", ten: "Đối tác 1", kind: "PERSON", loai: null, status: "SUSPENDED" } })]);
    expect(screen.getByText(/đối tác không hoạt động/)).toBeTruthy();
  });

  it("danh sách rỗng: không lọc ⇒ nói chưa có + chỉ đường (chỉ khi có quyền và campaign chưa kết thúc); đang lọc ⇒ nói đúng «ở trạng thái này»", () => {
    dung([], { coTheGhi: true });
    expect(document.body.textContent).toMatch(/Chưa có đối tác nào trong campaign này\. Thêm đối tác ở form bên trên/);
    cleanup();
    dung([], { coTheGhi: false });
    expect(document.body.textContent).toMatch(/Chưa có đối tác nào trong campaign này\.$/);
    cleanup();
    dung([], { coTheGhi: true, campaignStatus: "ENDED" });
    expect(document.body.textContent).not.toMatch(/form bên trên/);
    cleanup();
    dung([], { dangLoc: true });
    expect(document.body.textContent).toMatch(/Không có đối tác nào ở trạng thái này/);
  });
});

describe("[AFB-03] XemTruocNguon", () => {
  const DT: DoiTacChonView[] = [
    { id: "p1", code: "DT_A", ten: "Đối tác A", kind: "PERSON", loai: "Trường học", trongCampaign: null },
    { id: "p2", code: "DT_B", ten: "Đối tác B", kind: "ORGANIZATION", loai: null, trongCampaign: "ACTIVE" },
  ];
  const dung = (ketQua: XemTruocView | null, dangChon: string | null = null, doiTac = DT) =>
    render(<XemTruocNguon action="/nguon-hoa-hong/campaign/TET" giu={{ tt: "ACTIVE", trang: null }} doiTac={doiTac} conNua={false} dangChon={dangChon} ketQua={ketQua} />);
  const doiTacView = (p: Partial<XemTruocView["doiTac"]> = {}): XemTruocView["doiTac"] => ({ id: "p1", code: "DT_A", ten: "Đối tác A", loai: "Trường học", nhan: ["KOL"], trongCampaign: null, ...p });

  it("là form GET về chính trang, giữ tham số khác (`tt`) bằng ô ẩn, bỏ tham số rỗng; ô chọn chỉ có tên · mã · loại", () => {
    const { container } = dung(null);
    const f = container.querySelector("form")!;
    expect(f.getAttribute("method")).toBe("get");
    expect(f.getAttribute("action")).toBe("/nguon-hoa-hong/campaign/TET#xem-truoc-nguon");
    expect([...f.querySelectorAll("input[type=hidden]")].map((i) => `${(i as HTMLInputElement).name}=${(i as HTMLInputElement).value}`)).toEqual(["tt=ACTIVE"]);
    const o = screen.getByLabelText("Đối tác muốn thử") as HTMLSelectElement;
    expect(o.name).toBe("xemTruoc");
    expect([...o.options].map((x) => x.textContent).slice(1)).toEqual(["Đối tác A (DT_A) · Trường học", "Đối tác B (DT_B)"]);
  });

  it("có nguồn: nêu tên nguồn + bậc quyết định bằng NHÃN của giai-nguon.ts; không cảnh báo thì không có dòng «Cảnh báo»", () => {
    dung({ doiTac: doiTacView(), ketQua: { loai: "NGUON", nguon: { id: "s1", code: "DOI_TAC", ten: "Giới thiệu bởi đối tác", status: "ACTIVE" }, sourceGroupId: "s1", tu: "RULE_LOAI_VA_NHAN", canhBao: null } }, "p1");
    const kq = screen.getByRole("status", { name: "Kết quả xem trước nguồn" });
    expect(kq.textContent).toMatch(/Giới thiệu bởi đối tác/);
    expect(kq.textContent).toMatch(/Quy tắc campaign theo loại và nhãn/);
    expect(kq.textContent).toMatch(/loại Trường học · nhãn KOL · chưa là thành viên campaign này/);
    expect(within(kq).queryByText("Cảnh báo")).toBeNull();
  });

  it("nguồn được chọn nhưng đã hỏng ⇒ vẫn nêu nguồn đó KÈM cảnh báo nguyên nhân", () => {
    dung({ doiTac: doiTacView({ trongCampaign: "ACTIVE" }), ketQua: { loai: "NGUON", nguon: { id: "s1", code: "DOI_TAC", ten: "Giới thiệu bởi đối tác", status: "INACTIVE" }, sourceGroupId: "s1", tu: "MAC_DINH_CAMPAIGN", canhBao: "Nguồn «Giới thiệu bởi đối tác» đang ở trạng thái «Tạm ngừng»." } }, "p1");
    const kq = screen.getByRole("status", { name: "Kết quả xem trước nguồn" });
    expect(within(kq).getByText("Cảnh báo")).toBeTruthy();
    expect(kq.textContent).toMatch(/Tạm ngừng/);
    expect(kq.textContent).toMatch(/Nguồn mặc định của campaign/);
    expect(kq.textContent).toMatch(/trong campaign: đang tham gia/);
  });

  it("THIẾU CẤU HÌNH ⇒ «Cần xem tay» KÈM LÝ DO và hệ quả; không có «Không rõ» / UNKNOWN ở bất kỳ đâu", () => {
    dung({ doiTac: doiTacView({ loai: null, nhan: [] }), ketQua: { loai: "XEM_TAY", lyDo: "Chưa cấu hình nguồn cho loại/nhãn của đối tác này trong campaign." } }, "p1");
    const kq = screen.getByRole("status", { name: "Kết quả xem trước nguồn" });
    expect(kq.textContent).toMatch(/Cần xem tay/);
    expect(kq.textContent).toMatch(/Chưa cấu hình nguồn cho loại\/nhãn/);
    expect(kq.textContent).toMatch(/chưa có loại · chưa có nhãn/);
    expect(document.body.textContent).not.toMatch(/Không rõ|UNKNOWN/);
  });

  it("đã chọn đối tác mà không tìm thấy ⇒ nói thẳng; chưa chọn ⇒ không có khối kết quả; không đối tác nào ⇒ ô và nút khoá", () => {
    dung(null, "p-da-xoa");
    expect(screen.getByRole("status").textContent).toMatch(/Không tìm thấy đối tác này/);
    expect(screen.queryByRole("status", { name: "Kết quả xem trước nguồn" })).toBeNull();
    cleanup();
    dung(null, null);
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    dung(null, null, []);
    expect((screen.getByLabelText("Đối tác muốn thử") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Xem trước/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
