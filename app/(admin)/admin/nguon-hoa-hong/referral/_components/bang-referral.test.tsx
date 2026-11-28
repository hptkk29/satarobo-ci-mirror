// @vitest-environment jsdom
/**
 * [RFU-*] — BangReferral · PhieuKhach · TrangThaiReferralPill trên phần tử thật (jsdom).
 *
 *   [RFU-01] cột đúng tên; thời điểm giờ VN; đối tác/campaign hiện tên + mã; nhãn cách đến
 *   [RFU-02] cả dòng là vùng bấm (luật 12): <tr relative cursor-pointer> + liên kết after:inset-0 trỏ đúng chi tiết; KHÔNG mũi tên trơ
 *   [RFU-03] «Nguồn đã giải»: lượt không có bậc quyết định ⇒ «Chưa quy được nguồn» (không in nhóm giữ chỗ); có thì in tên nhóm
 *   [RFU-04] «Phiếu khách»: mở được ⇒ LIÊN KẾT tới /leads/<id>; không mở được ⇒ chỉ mã rút gọn (không link); không gắn ⇒ «Chưa gắn phiếu» (đối chứng dương cả ba)
 *   [RFU-05] KHÔNG PII: dữ liệu thừa lọt vào props (tên/SĐT/email khách) không bao giờ được vẽ
 *   [RFU-06] trạng thái: nhãn tiếng Việt + tông đúng ngữ nghĩa cho cả năm
 *   [RFU-07] lý do: ô bảng rút gọn nhưng `title` mang câu đầy đủ; lý do trống không bịa
 *   [RFU-08] phân trang theo máy chủ: «Hiển thị a–b / N», liên kết trang; một trang thì không vẽ điều hướng
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { dichLyDoReferral, TRANG_THAI_REFERRAL, NHAN_TRANG_THAI_REFERRAL, type DongReferral } from "@/lib/affiliate/ghi-referral-dau-vao";
import { TrangThaiReferralPill } from "@/components/admin/nguon-hoa-hong/referral/trang-thai-referral-pill";
import { BangReferral, CHU_CHUA_QUY_NGUON, PhieuKhach } from "./bang-referral";

afterEach(cleanup);

const R = (p: Partial<DongReferral> & Pick<DongReferral, "id">): DongReferral => ({
  luc: "2026-10-13T03:05:00.000Z",
  doiTac: { id: "dt1", ten: "Chị An", ma: "AN001" },
  campaign: { id: "cp1", ten: "Giới thiệu Tết", ma: "TET_2027" },
  cachDen: "LINK",
  trangThai: "VALID",
  nguon: "Phụ huynh giới thiệu",
  lyDo: dichLyDoReferral(null),
  phieu: { coPhieu: true, maRutGon: "ABC123", leadId: "ckleadabc123" },
  ...p,
});

const dung = (dong: DongReferral[], tong = dong.length, trang = 1) => render(<BangReferral dong={dong} tong={tong} trang={trang} kichThuoc={25} hrefTrang={(t) => `/x?trang=${t}`} />);

describe("[RFU-01] cột và ô", () => {
  it("tám cột đúng tên; thời điểm theo giờ VN; đối tác và campaign: tên + mã; cách đến có nhãn", () => {
    dung([R({ id: "r1", cachDen: "QR" })]);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Thời điểm", "Đối tác", "Campaign", "Nguồn đã giải", "Cách đến", "Trạng thái", "Lý do / ghi chú", "Phiếu khách"]);
    expect(screen.getByText("13/10/2026 10:05")).toBeTruthy();
    expect(screen.getByText("Chị An")).toBeTruthy();
    expect(screen.getByText("AN001")).toBeTruthy();
    expect(screen.getByText("Giới thiệu Tết")).toBeTruthy();
    expect(screen.getByText("TET_2027")).toBeTruthy();
    expect(screen.getByText("QR")).toBeTruthy();
    expect(screen.getByText("Hợp lệ")).toBeTruthy();
  });
});

describe("[RFU-02] cả dòng là vùng bấm", () => {
  it("<tr> relative cursor-pointer + liên kết mang after:inset-0 trỏ ĐÚNG /nguon-hoa-hong/referral/<id>; không có mũi tên/chevron", () => {
    const { container } = dung([R({ id: "r1" })]);
    const tr = container.querySelector("tbody tr")!;
    expect(tr.className).toMatch(/\brelative\b/);
    expect(tr.className).toMatch(/cursor-pointer/);
    const lk = within(tr as HTMLElement).getByRole("link", { name: /Xem chi tiết referral/ });
    expect(lk.getAttribute("href")).toBe("/nguon-hoa-hong/referral/r1");
    expect(lk.className).toMatch(/after:inset-0/);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("mỗi dòng một liên kết chi tiết riêng, đúng id của dòng đó", () => {
    dung([R({ id: "r1" }), R({ id: "r2", luc: "2026-10-12T03:05:00.000Z" })]);
    const href = screen.getAllByRole("link", { name: /Xem chi tiết referral/ }).map((a) => a.getAttribute("href"));
    expect(href).toEqual(["/nguon-hoa-hong/referral/r1", "/nguon-hoa-hong/referral/r2"]);
  });
});

describe("[RFU-03] Nguồn đã giải nói thật", () => {
  it("không có nguồn đã giải ⇒ «Chưa quy được nguồn»; có ⇒ tên nhóm (đối chứng dương)", () => {
    dung([R({ id: "r1", nguon: null, trangThai: "REJECTED" }), R({ id: "r2", nguon: "Đối tác giới thiệu" })]);
    expect(screen.getAllByText(CHU_CHUA_QUY_NGUON)).toHaveLength(1);
    expect(screen.getByText("Đối tác giới thiệu")).toBeTruthy();
  });
});

describe("[RFU-04] Phiếu khách", () => {
  it("mở được ⇒ liên kết /leads/<id> mang mã rút gọn; nhãn truy cập nói rõ mở phiếu nào", () => {
    render(<PhieuKhach phieu={{ coPhieu: true, maRutGon: "ABC123", leadId: "ckleadabc123" }} />);
    const lk = screen.getByRole("link", { name: "Mở phiếu khách ABC123" });
    expect(lk.getAttribute("href")).toBe("/leads/ckleadabc123");
    expect(lk.textContent).toBe("#ABC123");
    expect(lk.className).toMatch(/z-10/); // nằm TRÊN lớp phủ của dòng
  });

  it("không mở được ⇒ KHÔNG có liên kết, chỉ mã rút gọn kèm lý do trong title; không lộ id đầy đủ", () => {
    const { container } = render(<PhieuKhach phieu={{ coPhieu: true, maRutGon: "ABC123", leadId: null }} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("#ABC123").getAttribute("title")).toMatch(/không mở được/i);
    expect(container.innerHTML).not.toContain("ckleadabc123");
  });

  it("chưa gắn phiếu ⇒ «Chưa gắn phiếu», không link, không mã", () => {
    render(<PhieuKhach phieu={{ coPhieu: false, maRutGon: null, leadId: null }} />);
    expect(screen.getByText("Chưa gắn phiếu")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("trong bảng: dòng có quyền thấy link phiếu, dòng không quyền thì không — cùng một bảng", () => {
    dung([R({ id: "r1" }), R({ id: "r2", phieu: { coPhieu: true, maRutGon: "ZZZ999", leadId: null } })]);
    expect(screen.getAllByRole("link", { name: /Mở phiếu khách/ })).toHaveLength(1);
    expect(screen.getByText("#ZZZ999")).toBeTruthy();
  });
});

describe("[RFU-05] không PII", () => {
  it("tên/SĐT/email khách lọt vào props (dù không thuộc kiểu) KHÔNG được vẽ", () => {
    const bao = { ...R({ id: "r1" }), parentName: "Nguyễn Văn Khách", phone: "0905123456", email: "khach@example.com", leadName: "Bé Bắp" } as DongReferral;
    const { container } = dung([bao]);
    for (const rò of ["Nguyễn Văn Khách", "0905123456", "84905123456", "khach@example.com", "Bé Bắp"]) expect(container.innerHTML).not.toContain(rò);
  });
});

describe("[RFU-06] trạng thái", () => {
  it("năm trạng thái: nhãn tiếng Việt + tông ngữ nghĩa trong class", () => {
    const tong = { VALID: "state-success", MANUAL_REVIEW: "state-warning", REJECTED: "state-danger", REJECTED_DUPLICATE: "muted", DISPUTED: "state-warning" } as const;
    for (const t of TRANG_THAI_REFERRAL) {
      const { container, unmount } = render(<TrangThaiReferralPill trangThai={t} />);
      expect(screen.getByText(NHAN_TRANG_THAI_REFERRAL[t])).toBeTruthy();
      expect(container.querySelector("span")!.className).toContain(tong[t]);
      unmount();
    }
  });

  it("mỗi pill có title nói trạng thái nghĩa là gì", () => {
    render(<TrangThaiReferralPill trangThai="MANUAL_REVIEW" />);
    expect(screen.getByText("Cần xem tay").getAttribute("title")).toMatch(/chờ người xem/);
  });
});

describe("[RFU-07] lý do", () => {
  it("ô bảng mang bản rút gọn, title mang câu ĐẦY ĐỦ; mã máy không lộ ra", () => {
    dung([R({ id: "r1", trangThai: "REJECTED", lyDo: dichLyDoReferral("LINK_KHONG_HOP_LE:LINK_DA_THU_HOI") })]);
    const o = screen.getByText(/^Link không còn hợp lệ:/);
    expect(o.getAttribute("title")).toContain("Link/mã giới thiệu không còn hợp lệ lúc gửi biểu mẫu.");
    expect(document.body.innerHTML).not.toContain("LINK_DA_THU_HOI");
  });

  it("lý do trống ⇒ «—» (không bịa)", () => {
    dung([R({ id: "r1" })]);
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("[RFU-08] phân trang", () => {
  it("60 lượt, trang 1 ⇒ «Hiển thị 1–25 / 60 lượt» + điều hướng; trang 3 ⇒ 51–60", () => {
    const { container, unmount } = dung([R({ id: "r1" })], 60, 1);
    expect(container.textContent).toContain("1–25");
    expect(container.textContent).toContain("/ 60 lượt");
    expect(container.querySelector('a[href="/x?trang=2"]')).toBeTruthy();
    unmount();
    const c3 = dung([R({ id: "r1" })], 60, 3);
    expect(c3.container.textContent).toContain("51–60");
  });

  it("vừa một trang ⇒ không vẽ điều hướng trang", () => {
    const { container } = dung([R({ id: "r1" })], 1, 1);
    expect(container.querySelector('a[href^="/x?trang="]')).toBeNull();
    expect(container.textContent).toContain("1–1");
  });
});
