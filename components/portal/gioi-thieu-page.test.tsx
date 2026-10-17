// @vitest-environment jsdom
/**
 * [AFR-PT-UI-*] — trang «Giới thiệu» của cổng (AFF-P3 H3) trên phần tử thật. Mọi ca "KHÔNG thấy X" có đối chứng dương (luật 11).
 *   [AFR-PT-UI-01] số đúng chỗ, nhãn nói đúng thứ nó đếm; chờ chi = mọi trạng thái chưa PAID
 *   [AFR-PT-UI-02] link: đang dùng ⇒ URL cuối + link ngắn + nút sao chép + QR, kèm website · trang đích · lượt bấm · referral; ĐÃ THU HỒI ⇒ KHÔNG địa chỉ, KHÔNG nút; link tạm ngưng nói lý do; thiếu gốc link ngắn ⇒ nói thẳng
 *   [AFR-PT-UI-03] referral: nhãn dành cho đối tác (không lộ mã kỹ thuật), mã hồ sơ chỉ khi có, không PII; hoa hồng số âm in dấu trừ
 *   [AFR-PT-UI-04] trạng thái rỗng + hồ sơ đối tác không hoạt động có cảnh báo (đối chứng: đang hoạt động ⇒ không)
 *   [AFR-PT-UI-05] nút sao chép: thành công ⇒ «Đã sao chép»; trình duyệt chặn ⇒ nói thật, không giả vờ
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { GioiThieuCuaToi } from "@/lib/affiliate/cua-toi";
import { demRong } from "@/lib/affiliate/ghi-referral-dau-vao";
// Form tạo link + nút QR import Server Action của cổng (kéo next-auth/Prisma) — trang này chỉ cần chúng tồn tại; hành vi của chúng có file test riêng (tao-link-cua-toi.test.tsx).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/(portal)/portal/gioi-thieu/_actions", () => ({ taoLinkCuaToiAction: vi.fn(), taoQrCuaToiAction: vi.fn() }));

import { GioiThieuPageV2 } from "./gioi-thieu-page";

afterEach(cleanup);

const LINK_NGAN = "https://test.satarobo.vn/r/ABCDEFGHJK";
const URL_CUOI = "https://a.example.test/x?aff=ABCDEFGHJK&cmp=CD_A";

function duLieu(p: Partial<GioiThieuCuaToi> = {}): GioiThieuCuaToi {
  return {
    doiTac: [{ ten: "Đối tác Một", ma: "DT1", trangThai: "ACTIVE" }],
    link: [
      { id: "l1", campaign: "Chiến dịch A", website: "a.example.test", trangDich: "/x", loai: "LINK", nhan: "Zalo nhóm", hoatDong: true, lyDoKhongDung: null, soLuotBam: 40, soLuotBamLoi: 2, soReferral: 4, lienKetNgan: LINK_NGAN, lienKetTrucTiep: URL_CUOI, urlCuoi: URL_CUOI },
      { id: "l2", campaign: "Chiến dịch Cũ", website: "b.example.test", trangDich: "/y", loai: "LINK", nhan: null, hoatDong: false, lyDoKhongDung: null, soLuotBam: 3, soLuotBamLoi: 0, soReferral: 0, lienKetNgan: null, lienKetTrucTiep: null, urlCuoi: null },
    ],
    taoLink: {
      coGocLinkNgan: true,
      chuongTrinh: [
        { membershipId: "m1", campaignMa: "CD_A", campaignTen: "Chiến dịch A", soLinkDangChay: 1, soLinkToiDa: 50, websites: [{ siteId: "s1", ten: "Quà tặng", host: "a.example.test", trangDich: [{ id: "lp-x" + "/x", host: "a.example.test", mau: "/x", nhan: null, kieu: "CHINH_XAC" }] }] },
      ],
    },
    luotBam: { hopLe: 43, khongDung: 2 },
    referral: {
      theoTrangThai: { ...demRong(), VALID: 5, MANUAL_REVIEW: 1, REJECTED: 2, REJECTED_DUPLICATE: 1 },
      tong: 9,
      daDangKy: 2,
      gan: [
        { luc: "2026-10-10T17:30:00.000Z", campaign: "Chiến dịch A", trangThai: "VALID", maPhieu: "A1B2C3" },
        { luc: "2026-10-09T03:00:00.000Z", campaign: "Chiến dịch A", trangThai: "REJECTED_DUPLICATE", maPhieu: null },
        { luc: "2026-10-08T03:00:00.000Z", campaign: "Chiến dịch A", trangThai: "REJECTED", maPhieu: null },
      ],
    },
    hoaHong: {
      theoTrangThai: { ON_HOLD: { soDong: 0, tien: 0 }, PENDING: { soDong: 2, tien: 300_000 }, APPROVED: { soDong: 1, tien: 100_000 }, EXPORTED: { soDong: 0, tien: 0 }, PAID: { soDong: 1, tien: 250_000 } },
      daGhiSo: 650_000,
      choChi: 400_000,
      daChi: 250_000,
      dangGiu: 0,
      gan: [
        { luc: "2026-10-12T03:00:00.000Z", ky: "2026-10", campaign: "Chiến dịch A", loai: "Hoa hồng", soTien: 300_000, trangThaiChi: "PENDING" },
        { luc: "2026-10-13T03:00:00.000Z", ky: "2026-10", campaign: "Chiến dịch A", loai: "Điều chỉnh", soTien: -50_000, trangThaiChi: "APPROVED" },
      ],
    },
    hoaHongMotPhan: false,
    ...p,
  };
}
const so = (k: string) => document.querySelector(`[data-so="${k}"]`)?.textContent?.trim();

describe("[AFR-PT-UI-01] con số", () => {
  it("lượt bấm · khách được ghi nhận (VALID) · đã đăng ký · hoa hồng chờ chi (= mọi trạng thái chưa chi xong); ghi chú nói đúng thứ đếm", () => {
    render(<GioiThieuPageV2 data={duLieu()} />);
    expect(so("luot-bam")).toBe("43");
    expect(so("da-ghi-nhan")).toBe("5");
    expect(so("da-dang-ky")).toBe("2");
    expect(so("cho-chi")).toBe("400.000đ");
    expect(document.body.textContent).toContain("Trên 9 lượt gửi biểu mẫu");
    expect(document.body.textContent).toContain("+ 2 lượt vào link không còn dùng được");
    expect(document.body.textContent).toContain("Đã chi 250.000đ");
    // bốn ô trạng thái chi, đúng số
    expect(document.querySelector('[data-chi="PENDING"]')!.textContent).toBe("300.000đ");
    expect(document.querySelector('[data-chi="PAID"]')!.textContent).toBe("250.000đ");
  });
});

describe("[AFR-PT-UI-02] link", () => {
  it("link đang dùng: có địa chỉ + nút sao chép; link đã thu hồi: KHÔNG địa chỉ, KHÔNG nút (đối chứng: cả hai đều có thẻ)", () => {
    render(<GioiThieuPageV2 data={duLieu()} />);
    const the = Array.from(document.querySelectorAll("[data-link]"));
    expect(the).toHaveLength(2);
    expect(the[0]!.querySelector("[data-dia-chi]")!.textContent).toBe(LINK_NGAN);
    expect(the[0]!.querySelector("[data-url-cuoi]")!.textContent).toBe(URL_CUOI);
    expect(the[0]!.querySelector("button")!.getAttribute("aria-label")).toBe("Sao chép link Chiến dịch A");
    expect(the[0]!.querySelector('button[aria-label="Xem mã QR của Chiến dịch A — a.example.test"]')).not.toBeNull(); // có QR cho link đang dùng
    expect(the[0]!.textContent).toContain("Trang đích /x");
    expect(the[0]!.querySelector("[data-so-luot-bam]")!.textContent).toBe("40");
    expect(the[0]!.querySelector("[data-so-referral]")!.textContent).toBe("4");
    expect(the[0]!.textContent).toContain("Đang dùng");
    expect(the[1]!.querySelector("[data-dia-chi]")).toBeNull();
    expect(the[1]!.querySelector("[data-url-cuoi]")).toBeNull();
    expect(the[1]!.querySelector("button")).toBeNull(); // không sao chép, không QR
    expect(the[1]!.querySelector("[data-so-referral]")!.textContent).toBe("0");
    expect(the[1]!.textContent).toContain("Đã thu hồi");
  });

  it("link đang bật nhưng chuỗi chưa dùng được ⇒ nói lý do; không có lý do ⇒ không có câu đó", () => {
    const d = duLieu();
    d.link[0] = { ...d.link[0]!, lyDoKhongDung: "Campaign không ở trạng thái đang chạy." };
    const { unmount } = render(<GioiThieuPageV2 data={d} />);
    expect(document.querySelector("[data-link-tam-ngung]")!.textContent).toContain("Campaign không ở trạng thái đang chạy.");
    unmount();
    render(<GioiThieuPageV2 data={duLieu()} />);
    expect(document.querySelector("[data-link-tam-ngung]")).toBeNull();
  });
});

describe("[AFR-PT-UI-02b] gốc link ngắn · khối tạo link", () => {
  it("chưa cấu hình gốc link ngắn ⇒ link đang dùng vẫn có URL CUỐI nhưng KHÔNG có link ngắn / QR, và câu nói thẳng vì sao; đối chứng: có gốc ⇒ không câu đó", () => {
    const d = duLieu({ taoLink: { ...duLieu().taoLink, coGocLinkNgan: false } });
    d.link[0] = { ...d.link[0]!, lienKetNgan: null };
    const { unmount } = render(<GioiThieuPageV2 data={d} />);
    expect(document.querySelector("[data-url-cuoi]")!.textContent).toBe(URL_CUOI);
    expect(document.querySelector("[data-dia-chi]")).toBeNull();
    expect(document.querySelector('button[aria-label^="Xem mã QR"]')).toBeNull();
    expect(document.querySelector("[data-thieu-goc]")).not.toBeNull();
    unmount();
    render(<GioiThieuPageV2 data={duLieu()} />);
    expect(document.querySelector("[data-thieu-goc]")).toBeNull();
  });

  it("khối «Tạo link» CHỈ khi có hồ sơ đang hoạt động; hồ sơ tạm ngưng ⇒ không form (đối chứng: hoạt động ⇒ có form)", () => {
    const { unmount } = render(<GioiThieuPageV2 data={duLieu()} />);
    expect(document.querySelector("[data-tao-link]")).not.toBeNull();
    unmount();
    render(<GioiThieuPageV2 data={duLieu({ doiTac: [{ ten: "Đối tác Một", ma: "DT1", trangThai: "SUSPENDED" }] })} />);
    expect(document.querySelector("[data-tao-link]")).toBeNull();
    expect(document.querySelector("[data-rong='tao-link']")).toBeNull();
  });
});

describe("[AFR-PT-UI-03] khách giới thiệu · hoa hồng", () => {
  it("nhãn dành cho đối tác, không lộ mã kỹ thuật; mã hồ sơ chỉ khi có; ngày theo giờ VN (17:30Z 10/10 = 00:30 ngày 11/10)", () => {
    render(<GioiThieuPageV2 data={duLieu()} />);
    const dong = Array.from(document.querySelectorAll("[data-referral]")).map((r) => r.textContent ?? "");
    expect(dong).toHaveLength(3);
    expect(dong[0]).toContain("11/10/2026");
    expect(dong[0]).toContain("Đã ghi nhận");
    expect(dong[0]).toContain("A1B2C3");
    expect(dong[1]).toContain("Không được ghi nhận");
    expect(dong[1], "nhãn «trùng» không được lộ lý do").not.toContain("đã có người giới thiệu");
    expect(dong[1]).toContain("—");
    // không lộ mã kỹ thuật
    for (const ma of ["REJECTED_DUPLICATE", "MANUAL_REVIEW", "REJECTED", "VALID", "DISPUTED"]) expect(document.body.textContent).not.toContain(ma);
  });

  it("hoa hồng: số âm in dấu trừ thật, loại «Điều chỉnh» tách khỏi «Hoa hồng»; trạng thái chi đọc bằng tiếng Việt", () => {
    render(<GioiThieuPageV2 data={duLieu()} />);
    const dong = Array.from(document.querySelectorAll("[data-hoa-hong]")).map((r) => r.textContent ?? "");
    expect(dong[0]).toContain("Hoa hồng");
    expect(dong[0]).toContain("300.000đ");
    expect(dong[0]).toContain("Chờ chi");
    expect(dong[1]).toContain("Điều chỉnh");
    expect(dong[1]).toContain("−50.000đ");
    expect(dong[1]).toContain("Đã duyệt chi");
  });

  it("chỉ hiện «N lượt gần nhất trong tổng M» khi còn lượt cũ hơn", () => {
    const { unmount } = render(<GioiThieuPageV2 data={duLieu()} />);
    expect(document.body.textContent).toContain("Hiện 3 lượt gần nhất trong tổng 9 lượt");
    unmount();
    render(<GioiThieuPageV2 data={duLieu({ referral: { ...duLieu().referral, tong: 3 } })} />);
    expect(document.body.textContent).not.toContain("lượt gần nhất trong tổng");
  });

  it("bảng hoa hồng cũng nói «N dòng gần nhất trong tổng M» khi còn dòng cũ hơn (tổng = Σ số dòng các trạng thái chi); đủ dòng ⇒ không câu đó", () => {
    const { unmount } = render(<GioiThieuPageV2 data={duLieu()} />);
    // fixture: PENDING 2 + APPROVED 1 + EXPORTED 0 + PAID 1 = 4 dòng, nhưng chỉ 2 dòng gần nhất được đọc
    expect(document.querySelector("[data-bi-cat-hoa-hong]")!.textContent).toContain("Hiện 2 dòng gần nhất trong tổng 4 dòng");
    unmount();
    const d = duLieu();
    render(<GioiThieuPageV2 data={{ ...d, hoaHong: { ...d.hoaHong!, theoTrangThai: { ON_HOLD: { soDong: 0, tien: 0 }, PENDING: { soDong: 1, tien: 300_000 }, APPROVED: { soDong: 1, tien: -50_000 }, EXPORTED: { soDong: 0, tien: 0 }, PAID: { soDong: 0, tien: 0 } } } }} />);
    expect(document.querySelector("[data-bi-cat-hoa-hong]")).toBeNull();
  });
});

describe("[AFR-PT-UI-04] rỗng · hồ sơ không hoạt động", () => {
  it("không link / không khách / không hoa hồng ⇒ ba câu rỗng riêng, KHÔNG bảng", () => {
    render(
      <GioiThieuPageV2
        data={duLieu({
          link: [],
          referral: { theoTrangThai: demRong(), tong: 0, daDangKy: 0, gan: [] },
          hoaHong: { theoTrangThai: { ON_HOLD: { soDong: 0, tien: 0 }, PENDING: { soDong: 0, tien: 0 }, APPROVED: { soDong: 0, tien: 0 }, EXPORTED: { soDong: 0, tien: 0 }, PAID: { soDong: 0, tien: 0 } }, daGhiSo: 0, choChi: 0, daChi: 0, dangGiu: 0, gan: [] },
        })}
      />,
    );
    for (const k of ["link", "referral", "hoa-hong"]) expect(document.querySelector(`[data-rong="${k}"]`), k).not.toBeNull();
    expect(document.querySelector("table")).toBeNull();
    expect(so("cho-chi")).toBe("0đ");
  });

  it("hồ sơ KHÔNG ở trạng thái hoạt động ⇒ cảnh báo role=status nêu trạng thái; đối chứng: đang hoạt động ⇒ không cảnh báo", () => {
    const { unmount } = render(<GioiThieuPageV2 data={duLieu({ doiTac: [{ ten: "Đối tác Một", ma: "DT1", trangThai: "SUSPENDED" }] })} />);
    expect(document.querySelector("[data-khong-hoat-dong]")!.textContent).toContain("tạm ngưng");
    unmount();
    render(<GioiThieuPageV2 data={duLieu()} />);
    expect(document.querySelector("[data-khong-hoat-dong]")).toBeNull();
  });
});

describe("[AFR-PT-UI-06] SỐ TIỀN theo cấu hình (L3a): `hoaHong` null ⇒ không chỗ nào vẽ một con số tiền", () => {
  it("đối chứng dương: có `hoaHong` ⇒ thẻ «chờ chi», mục «Hoa hồng của bạn» và các số tiền; KHÔNG ghi chú «không hiển thị»", () => {
    render(<GioiThieuPageV2 data={duLieu()} />);
    expect(so("cho-chi")).toBe("400.000đ");
    expect(document.querySelector("#hoa-hong-td")).not.toBeNull();
    expect(document.querySelector("[data-khong-hien-tien]")).toBeNull();
    expect(document.querySelector("[data-hoa-hong-mot-phan]")).toBeNull();
  });

  it("`hoaHong` null ⇒ không thẻ «chờ chi», không mục hoa hồng, không số tiền nào trong DOM; vẫn thấy link, lượt bấm và trạng thái referral; có câu nói thật vì sao", () => {
    render(<GioiThieuPageV2 data={duLieu({ hoaHong: null })} />);
    expect(so("cho-chi")).toBeUndefined();
    expect(document.querySelector("#hoa-hong-td")).toBeNull();
    expect(document.querySelector("[data-chi]")).toBeNull();
    expect(document.querySelector("[data-hoa-hong]")).toBeNull();
    for (const sotien of ["400.000", "250.000", "300.000", "100.000", "650.000"]) expect(document.body.textContent, sotien).not.toContain(sotien);
    expect(document.querySelector("[data-khong-hien-tien]")!.textContent).toContain("không hiển thị");
    // đối chứng dương: phần không phải tiền vẫn có
    expect(so("luot-bam")).toBe("43");
    expect(so("da-ghi-nhan")).toBe("5");
    expect(document.querySelectorAll("[data-link]").length).toBe(2);
    expect(document.querySelectorAll("[data-referral]").length).toBe(3);
  });

  it("`hoaHongMotPhan` ⇒ ghi chú «chỉ gồm các chương trình có hiển thị số tiền» (không nói khoản bị ẩn là bao nhiêu)", () => {
    render(<GioiThieuPageV2 data={duLieu({ hoaHongMotPhan: true })} />);
    expect(document.querySelector("[data-hoa-hong-mot-phan]")!.textContent).toContain("Chỉ gồm các chương trình có hiển thị số tiền");
  });
});

describe("[AFR-PT-UI-05] nút sao chép", () => {
  it("thành công ⇒ «Đã sao chép» và ghi ĐÚNG địa chỉ; bị chặn ⇒ nói thật (không giả vờ thành công)", async () => {
    const ghi = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: ghi }, configurable: true });
    const { unmount } = render(<GioiThieuPageV2 data={duLieu()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sao chép link Chiến dịch A" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sao chép link Chiến dịch A" }).textContent).toContain("Đã sao chép"));
    expect(ghi).toHaveBeenCalledWith(URL_CUOI); // nút «Sao chép link …» chép URL CUỐI; nút «link ngắn» chép link ngắn (kiểm riêng bên dưới)
    fireEvent.click(screen.getByRole("button", { name: "Sao chép link ngắn Chiến dịch A" }));
    await waitFor(() => expect(ghi).toHaveBeenCalledWith(LINK_NGAN));
    unmount();

    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("chặn")) }, configurable: true });
    render(<GioiThieuPageV2 data={duLieu()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sao chép link Chiến dịch A" }));
    await waitFor(() => expect(document.body.textContent).toContain("Không sao chép được"));
    expect(screen.getByRole("button", { name: "Sao chép link Chiến dịch A" }).textContent).not.toContain("Đã sao chép");
  });
});
