// @vitest-environment jsdom
// Ca [KNL-*] — khu «Ngoại lệ hoá đơn» (S12, Invoice Hub): render THẬT từng trạng thái của danh sách. Dịch vụ đọc là giả (đã đo trên Postgres thật ở
// `tests/finance/hoa-don-ngoai-le-db.test.ts`); thứ cần đo ở đây: cờ tắt ⇒ không vẽ gì, bốn trạng thái (rỗng 3 kiểu · lỗi · có dòng), bộ lọc GIỮ tham số của tab,
// nút theo quyền từng dòng, không lộ dữ liệu cá nhân. Mọi ca «KHÔNG thấy» kèm đối chứng dương.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { DanhSachNgoaiLe, DongNgoaiLe } from "@/lib/finance/hoa-don/ngoai-le-db";

const h = vi.hoisted(() => ({
  bat: vi.fn(async () => true),
  resolveActor: vi.fn(async (_id: string) => ({ userId: "u1", isSuperAdmin: true, grantsAllow: new Set<string>(), permissions: [] }) as unknown),
  doc: vi.fn(),
  tomTat: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../canh-bao/_ngoai-le-actions", () => ({ xuLyNgoaiLeAction: vi.fn() }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHubQuetBat: h.bat }));
vi.mock("@/lib/finance/hoa-don/ngoai-le-db", () => ({ docDanhSachNgoaiLe: h.doc, docTomTatNghiaVu: h.tomTat }));

import { KhuNgoaiLe, KhuNgoaiLeKhung } from "./khu-ngoai-le";

const CO = { nhan: true, daXuLy: true, boQua: true, lyDoKhong: null };
const dong = (o: Partial<DongNgoaiLe> = {}): DongNgoaiLe => ({
  id: "nl1",
  loai: "NGHI_TRUNG",
  muc: "CAN_XU_LY",
  trangThai: "MO",
  centerId: "cs1",
  tenCoSo: "Trụ sở chính - Nguyễn Hữu Thọ",
  orderId: "od1",
  maDon: "ORD-261101-000007",
  hoaDonId: null,
  nguoiXuLyId: null,
  lyDoXuLy: null,
  hanXuLy: null,
  createdAt: new Date("2026-10-30T18:30:00Z"),
  hanhDong: CO,
  ...o,
});
const kq = (o: Partial<DanhSachNgoaiLe> = {}): DanhSachNgoaiLe => ({ dong: [dong()], tong: 1, trang: 1, soTrang: 1, dem: { dangMo: 1, daDong: 4, khan: 0 }, ...o });
const ve = async (sp: Record<string, string | undefined> = {}) => {
  const ui = await KhuNgoaiLe({ userId: "u1", sp });
  return render(<div>{ui}</div>);
};

beforeEach(() => {
  vi.clearAllMocks();
  h.bat.mockResolvedValue(true);
  h.doc.mockResolvedValue(kq());
  h.tomTat.mockResolvedValue({ tong: 32, theoTrangThai: { CHO_XUAT: 31, DANG_XU_LY: 1 }, quetLanCuoiLuc: "2026-11-02T11:40:00.000Z" });
});
afterEach(cleanup);

describe("[KNL-01] cờ TẮT ⇒ tab giữ nguyên như trước S12", () => {
  it("cờ tắt ⇒ không vẽ gì và KHÔNG đọc dữ liệu; đối chứng: cờ bật thì vẽ", async () => {
    h.bat.mockResolvedValue(false);
    const { container } = await ve();
    expect(container.textContent).toBe("");
    expect(h.doc).not.toHaveBeenCalled();
    cleanup();
    h.bat.mockResolvedValue(true);
    await ve();
    expect(screen.getByRole("heading", { name: "Ngoại lệ hoá đơn" })).toBeTruthy();
  });
});

describe("[KNL-01b] dòng tóm tắt «scanner đã ghi nhận N nghĩa vụ» (02/11/2026: 0 ngoại lệ không còn trông như «chưa chạy»)", () => {
  it("có nghĩa vụ ⇒ in tổng + từng trạng thái + lần quét gần nhất, ĐỒNG THỜI khu vẫn nói 0 ngoại lệ (rỗng)", async () => {
    h.doc.mockResolvedValue(kq({ dong: [], tong: 0, dem: { dangMo: 0, daDong: 0, khan: 0 } }));
    const { container } = await ve();
    const t = container.querySelector('[data-khu="tom-tat-nghia-vu"]');
    expect(t?.textContent).toBe("Scanner đã ghi nhận 32 nghĩa vụ hoá đơn: 31 chờ xuất · 1 đang xử lý. Lần quét gần nhất: 02/11 18:40.");
  });
  it("chưa có nghĩa vụ ⇒ nói nguyên nhân có thể thay vì để trống", async () => {
    h.tomTat.mockResolvedValue({ tong: 0, theoTrangThai: {}, quetLanCuoiLuc: null });
    const { container } = await ve();
    expect(container.querySelector('[data-khu="tom-tat-nghia-vu"]')?.textContent).toMatch(/chưa ghi nhận nghĩa vụ hoá đơn nào/);
  });
  it("đọc tóm tắt LỖI (ném) ⇒ chỉ mất dòng tóm tắt, danh sách ngoại lệ vẫn vẽ bình thường; đối chứng ở ca đầu", async () => {
    h.tomTat.mockRejectedValue(new Error("boom"));
    const { container } = await ve();
    expect(container.querySelector('[data-khu="tom-tat-nghia-vu"]')).toBeNull();
    expect(screen.getByText("Ngoại lệ hoá đơn")).toBeTruthy();
    expect(screen.queryByText(/Không tải được ngoại lệ hoá đơn/)).toBeNull();
  });
  it("truyền ĐÚNG cơ sở đang lọc cho cả hai lần đọc (cùng phạm vi với danh sách)", async () => {
    await ve({ coSo: "cs1" });
    expect(h.tomTat.mock.calls[0]![1]).toEqual(h.doc.mock.calls[0]![2]);
  });
});

describe("[KNL-02] có dòng", () => {
  it("một dòng nói đúng: mức, việc bằng chữ thường ngày + gợi ý, đơn (liên kết), cơ sở, thời điểm THEO GIỜ VN, trạng thái; không lộ SĐT/tên khách", async () => {
    await ve();
    const hang = screen.getByRole("listitem");
    const trong = within(hang);
    expect(trong.getByText("Cần xử lý")).toBeTruthy();
    expect(trong.getByText("Nghi thu trùng")).toBeTruthy();
    expect(trong.getByText(/Xem hai khoản thu có cùng nội dung chuyển khoản/)).toBeTruthy();
    expect((trong.getByRole("link", { name: "ORD-261101-000007" }) as HTMLAnchorElement).getAttribute("href")).toBe("/orders/od1");
    expect(trong.getByText("Trụ sở chính - Nguyễn Hữu Thọ")).toBeTruthy();
    expect(trong.getByText("31/10/2026 01:30")).toBeTruthy(); // 18:30Z = 01:30 hôm sau theo giờ VN
    expect(trong.getByText("Mới")).toBeTruthy();
    expect(hang.textContent).not.toMatch(/\b0\d{9}\b|@/);
    expect(trong.getByRole("button", { name: /Nhận xử lý: Nghi thu trùng — đơn ORD-261101-000007/ })).toBeTruthy();
  });

  it("loại LẠ (chưa có nhãn) ⇒ vẫn vẽ bằng mã thay vì ném; ngoại lệ đã đóng hiện LÝ DO xử lý thay cho gợi ý và không có nút", async () => {
    h.doc.mockResolvedValue(
      kq({
        dong: [
          dong({ id: "a", loai: "LOAI_MOI_CHUA_BIET" }),
          dong({ id: "b", trangThai: "BO_QUA_CO_LY_DO", lyDoXuLy: "Khoản thu hộ đã được xác nhận", hanhDong: { nhan: false, daXuLy: false, boQua: false, lyDoKhong: null } }),
        ],
      }),
    );
    await ve({ nlNhom: "DA_DONG" });
    expect(screen.getByText("LOAI_MOI_CHUA_BIET")).toBeTruthy();
    const dongB = screen.getAllByRole("listitem")[1]!;
    expect(within(dongB).getByText(/Lý do: Khoản thu hộ đã được xác nhận/)).toBeTruthy();
    expect(within(dongB).getByText("Đã bỏ qua")).toBeTruthy();
    expect(within(dongB).queryAllByRole("button")).toHaveLength(0);
    expect(within(screen.getAllByRole("listitem")[0]!).getAllByRole("button").length).toBeGreaterThan(0); // đối chứng dương
  });

  it("dòng ngoài phạm vi kế toán ⇒ không nút, có câu giải thích (không ẩn lặng lẽ)", async () => {
    h.doc.mockResolvedValue(kq({ dong: [dong({ hanhDong: { nhan: false, daXuLy: false, boQua: false, lyDoKhong: "Ngoại lệ thuộc cơ sở khác — chỉ kế toán cơ sở đó hoặc kế toán Hội sở xử lý." } })] }));
    await ve();
    expect(within(screen.getByRole("listitem")).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/thuộc cơ sở khác/)).toBeTruthy();
  });

  it("mức KHẨN ⇒ nhãn «Khẩn» trên dòng và chip «n khẩn đang mở»; không khẩn ⇒ không chip", async () => {
    h.doc.mockResolvedValue(kq({ dong: [dong({ muc: "KHAN" })], dem: { dangMo: 2, daDong: 0, khan: 2 } }));
    await ve();
    expect(within(screen.getByRole("listitem")).getByText("Khẩn")).toBeTruthy();
    expect(screen.getByText("2 khẩn đang mở")).toBeTruthy();
    cleanup();
    h.doc.mockResolvedValue(kq());
    await ve();
    expect(screen.queryByText(/khẩn đang mở/)).toBeNull();
  });
});

describe("[KNL-03] bốn trạng thái", () => {
  it("rỗng, KHÔNG bộ lọc, đang mở ⇒ nói vì sao rỗng và hệ thống làm gì tiếp; nhóm đã đóng thì câu khác", async () => {
    h.doc.mockResolvedValue(kq({ dong: [], tong: 0, dem: { dangMo: 0, daDong: 0, khan: 0 } }));
    await ve();
    expect(screen.getByText("Không có ngoại lệ nào đang mở")).toBeTruthy();
    expect(screen.getByText(/Có việc cần người quyết thì nó hiện ở đây/)).toBeTruthy();
    cleanup();
    await ve({ nlNhom: "DA_DONG" });
    expect(screen.getByText("Chưa có ngoại lệ nào đã đóng")).toBeTruthy();
  });

  it("rỗng DO bộ lọc ⇒ câu khác + đường «Bỏ lọc» (bỏ mức/loại, GIỮ cơ sở)", async () => {
    h.doc.mockResolvedValue(kq({ dong: [], tong: 0 }));
    await ve({ nlMuc: "KHAN", coSo: "cs1" });
    expect(screen.getByText("Không có ngoại lệ nào khớp")).toBeTruthy();
    const bo = screen.getAllByRole("link", { name: "Bỏ lọc" });
    expect(bo.length).toBeGreaterThan(0);
    for (const a of bo) {
      const u = new URL((a as HTMLAnchorElement).getAttribute("href")!, "http://x");
      expect(u.searchParams.has("nlMuc")).toBe(false);
      expect(u.searchParams.get("coSo")).toBe("cs1");
    }
  });

  it("trang vượt cuối (có dữ liệu mà trang rỗng) ⇒ «Về trang đầu», không báo 'chưa có'", async () => {
    h.doc.mockResolvedValue(kq({ dong: [], tong: 7, trang: 9, soTrang: 1 }));
    await ve({ nlTrang: "9" });
    expect(screen.getByRole("link", { name: "Về trang đầu" })).toBeTruthy();
    expect(screen.queryByText("Không có ngoại lệ nào đang mở")).toBeNull();
  });

  it("LỖI đọc ⇒ câu thường ngày + «Thử lại» + nói các ngăn bên dưới vẫn dùng được; KHÔNG lộ nội dung lỗi", async () => {
    h.doc.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.9:5432"));
    const { container } = await ve({ coSo: "cs1" });
    expect(screen.getByText("Không tải được ngoại lệ hoá đơn")).toBeTruthy();
    expect(screen.getByText(/ngăn bên dưới vẫn dùng bình thường/)).toBeTruthy();
    expect((screen.getByRole("link", { name: "Thử lại" }) as HTMLAnchorElement).getAttribute("href")).toContain("coSo=cs1");
    expect(container.textContent).not.toMatch(/ECONNREFUSED|10\.0\.0\.9/);
  });

  it("khung chờ: vùng có aria-busy + nhãn đọc được (không spinner trần)", () => {
    render(<KhuNgoaiLeKhung />);
    const v = screen.getByLabelText("Đang tải ngoại lệ hoá đơn");
    expect(v.getAttribute("aria-busy")).toBe("true");
  });
});

describe("[KNL-04] bộ lọc nằm TRÊN URL và GIỮ phạm vi của tab", () => {
  it("chip nhóm: aria-current đúng chip; đổi nhóm giữ coSo/thang và bỏ trang; đếm theo nhóm hiện ở nhãn", async () => {
    await ve({ coSo: "cs1", thang: "2026-11", nlTrang: "3", nlMuc: "KHAN" });
    const mo = screen.getByRole("link", { name: /Đang mở \(1\)/ });
    const dongNhom = screen.getByRole("link", { name: /Đã đóng \(4\)/ });
    expect(mo.getAttribute("aria-current")).toBe("page");
    expect(dongNhom.getAttribute("aria-current")).toBeNull();
    const u = new URL((dongNhom as HTMLAnchorElement).getAttribute("href")!, "http://x");
    expect(Object.fromEntries(u.searchParams)).toEqual({ coSo: "cs1", thang: "2026-11", nlMuc: "KHAN", nlNhom: "DA_DONG" });
  });

  it("đang xem nhóm «Đã đóng» ⇒ chip «Đã đóng» là trang hiện tại, chip «Đang mở» KHÔNG; chip «Đang mở» dẫn về nhóm mặc định (gỡ khoá nlNhom)", async () => {
    await ve({ nlNhom: "DA_DONG", coSo: "cs1" });
    const mo = screen.getByRole("link", { name: /Đang mở/ });
    const dongNhom = screen.getByRole("link", { name: /Đã đóng/ });
    expect(dongNhom.getAttribute("aria-current")).toBe("page");
    expect(mo.getAttribute("aria-current")).toBeNull();
    const u = new URL((mo as HTMLAnchorElement).getAttribute("href")!, "http://x");
    expect(u.searchParams.has("nlNhom")).toBe(false);
    expect(u.searchParams.get("coSo")).toBe("cs1");
  });

  it("form lọc là GET về ĐÚNG tab Cảnh báo, mang ô ẩn cho tham số khác (coSo/thang) và giá trị đang chọn; ô chọn có nhãn", async () => {
    const { container } = await ve({ coSo: "cs1", thang: "2026-11", nlMuc: "KHAN", nlLoai: "TIEN_THUA", nlNhom: "DA_DONG" });
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/payments/hoa-don/canh-bao");
    const an = Object.fromEntries([...form.querySelectorAll("input[type=hidden]")].map((i) => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]));
    expect(an).toEqual({ coSo: "cs1", thang: "2026-11", nlNhom: "DA_DONG" });
    // Tên truy cập CHỈ là «Mức» / «Loại» (nhãn tách khỏi ô chọn): khớp CHÍNH XÁC, không dính chữ của các lựa chọn.
    expect((screen.getByRole("combobox", { name: "Mức" }) as HTMLSelectElement).value).toBe("KHAN");
    expect((screen.getByRole("combobox", { name: "Loại" }) as HTMLSelectElement).value).toBe("TIEN_THUA");
  });

  it("giá trị LẠ trên URL bị bỏ (không vào ô chọn, không vào truy vấn): dịch vụ nhận bộ lọc đã chuẩn hoá", async () => {
    await ve({ nlMuc: "'; drop table", nlLoai: "../etc", nlTrang: "-4", nlNhom: "ZZ" });
    expect(h.doc).toHaveBeenCalledTimes(1);
    expect(h.doc.mock.calls[0]![1]).toEqual({ nhom: "DANG_MO", muc: null, loai: null, trang: 1 });
  });

  it("?coSo= được chuẩn hoá theo phạm vi người xem trước khi gọi dịch vụ (Hội sở/super admin: giữ nguyên)", async () => {
    await ve({ coSo: "cs2" });
    expect(h.doc.mock.calls[0]![2]).toEqual({ coSoId: "cs2" });
  });

  it("phân trang: có thanh trang khi >1 trang, liên kết GIỮ bộ lọc; 1 trang ⇒ không thanh", async () => {
    h.doc.mockResolvedValue(kq({ tong: 45, soTrang: 3, trang: 2 }));
    await ve({ nlMuc: "KHAN", coSo: "cs1", nlTrang: "2" });
    const nav = screen.getByRole("navigation", { name: "Điều hướng trang" });
    const lien = [...nav.querySelectorAll("a")].map((a) => new URL(a.getAttribute("href")!, "http://x"));
    expect(lien.length).toBeGreaterThan(0);
    for (const u of lien) {
      expect(u.pathname).toBe("/payments/hoa-don/canh-bao");
      expect(u.searchParams.get("nlMuc")).toBe("KHAN");
      expect(u.searchParams.get("coSo")).toBe("cs1");
    }
    expect(screen.getByText(/45 ngoại lệ · trang 2\/3/)).toBeTruthy();
    cleanup();
    h.doc.mockResolvedValue(kq());
    await ve();
    expect(screen.queryByRole("navigation", { name: "Điều hướng trang" })).toBeNull();
  });
});
