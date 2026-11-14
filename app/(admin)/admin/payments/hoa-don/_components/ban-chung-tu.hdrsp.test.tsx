// @vitest-environment jsdom
/**
 * Ca [HDRSP-*] — lỗi do KIỂM TRÌNH DUYỆT THẬT (S5c, 01/11/2026: Chromium + axe-core 4.11 trên dev server, DB nhân bản)
 * tìm ra ở khu Hoá đơn mà test jsdom không thấy:
 *  · [HDRSP-01] nhãn trạng thái dùng `--state-warning` làm màu CHỮ trên nền `--state-warning-soft`: tương phản 1.95:1 (cần 4.5)
 *    — axe `color-contrast`, 9 nút/hàng trên màn Hoá đơn. Chữ phải dùng token `-ink` (globals.css §232 đã ghi sẵn lý do).
 *  · [HDRSP-02] ngăn chi tiết (xl) mở đầu bằng <h3> "Phiếu thu" mà chưa có <h2> nào — axe `heading-order` (h1 → h3).
 *  · [HDRSP-03] thẻ lần thu ở điện thoại cắt "ngày · mã đơn" bằng dấu … mà không có cách đọc đủ (không `title`).
 *  · [HDRSP-04] mở thẳng `?ngan=khong-xuat` ở 375px: ngăn đang mở nằm ngoài khung nhìn (left 551 > vw 375) của dải cuộn ngang,
 *    người dùng không thấy mình đang ở ngăn nào.
 *  · [HDRSP-05] liên kết phụ cao 18–20px (WCAG 2.5.8 đòi tối thiểu 24px), gồm "Chứng từ ngân hàng" và "Về ngăn Chờ xuất".
 * Canh bằng HÀNH VI trên cây DOM đã vẽ (class thật, thuộc tính thật, lời gọi scrollIntoView thật), không grep mã nguồn.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DongHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";

vi.mock("next/navigation", () => ({
  usePathname: () => "/payments/hoa-don",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("../_actions", () => ({
  kyTaiLenHoaDonAction: vi.fn(),
  xacMinhTepHoaDonAction: vi.fn(),
  luuHoaDonNhapAction: vi.fn(),
  khongXuatHoaDonAction: vi.fn(),
  goHoaDonAction: vi.fn(),
  huyHoaDonAction: vi.fn(),
  xacNhanHoaDonAction: vi.fn(),
  khongTrungHoaDonAction: vi.fn(),
  guiLaiEmailHoaDonAction: vi.fn(),
  xemTruocGanGhiDanhAction: vi.fn(),
  ganGhiDanhHoaDonAction: vi.fn(),
  goiYSoHoaDonAction: vi.fn().mockResolvedValue({ ok: false, error: "chưa tính" }),
  dinhChinhSoHoaDonAction: vi.fn(),
}));
vi.mock("./tai-tep-hoa-don", () => ({ taiTepHoaDon: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { BanChungTu } from "./ban-chung-tu";
import { TieuDeMuc } from "./tieu-de-muc";

const dong = (key: string, tenKhach: string, o: Partial<DongHangCho> = {}): DongHangCho => ({
  key,
  ngan: "cho",
  nhan: "Chờ xuất",
  tone: "warning",
  orderId: `don-${key}`,
  maDon: `ORD-${key}`,
  tenKhach,
  sdt: "090****456",
  coSo: { ma: "CS1", ten: "Cơ sở 1" },
  ngayThu: "2026-09-10",
  ngayThuLabel: "10/09/2026",
  ghiNhanLuc: "2026-09-10T03:00:00.000Z",
  soTien: 3_000_000,
  nguon: "CK",
  nguonLabel: "Chuyển khoản · FT1",
  nhanDot: "Đợt 1",
  thieu: 0,
  traTruoc: 0,
  ngoaiDot: 0,
  tienTha: 0,
  khoanIds: [`p-${key}`],
  khoan: [{ id: `p-${key}`, soTien: 3_000_000 }],
  coTtHoaDon: false,
  emailNhan: "ph***@gmail.com",
  kyHieuMau: "1C26TSR",
  coSoId: "cs1",
  cauHinhCoSo: [{ id: "ch26", centerId: "cs1", phapNhanMa: "SATA_ROBO", kyHieu: "1C26TSR", hieuLucTu: "2026-01-01", hieuLucDen: "2026-12-31", dangBat: true }],
  hanhDong: {
    taiPhieu: true,
    taiLen: { bat: true },
    xacNhan: { bat: false, lyDo: "Chưa tải tệp PDF hoá đơn lên" },
    khongXuat: true,
    ganThem: false,
    canhBao: [],
    ngoaiLe: null,
  },
  hoaDonNhap: null,
  hoaDon: null,
  lyDoKhongXuat: null,
  huy: { bat: false },
  dinhChinh: { bat: false },
  canDieuChinh: [],
  hoaDonDaHuy: [],
  email: null,
  khoanChuaGanGhiDanh: [],
  coTheGanGhiDanh: false,
  thanhPhanGop: [key],

  cocChuaTraDu: false,
  gopTuDongDonCoc: false,
  gopVoi: [],
  phatHanhMisa: { hien: false, bat: false, cau: null, moiTruong: null, nhaCungCap: "MISA_MEINVOICE" },
  misa: null,
  daGuiNhap: null,
  ...o,
});

const A = dong("dot:a", "Nguyễn Văn An");
const B = dong("dot:b", "Trần Thị Bình");
const LOC = { url: { coSo: null, thang: null }, coSo: null, thang: "2026-09", thangMacDinh: "2026-09", cacCoSo: [] };
const DEM = { cho: 2, lech: 0, nhap: 0, "phat-hanh": 0, "da-xuat": 0, "khong-xuat": 0, "don-huy": 0, "can-dieu-chinh": 0 } as const;

function dung(ghiDe: Partial<Parameters<typeof BanChungTu>[0]> = {}) {
  return (
    <BanChungTu
      khuVuc="hoa-don"
      ngan="cho"
      dem={{ ...DEM }}
      dongTrongNgan={[A, B]}
      dangChon={A}
      chonKhongThay={false}
      chuaChonCoSo={false}
      goiYBanDau={null}
      coQuyenNgoaiLeKyHieu={false}
      thieuCoSo={0}
      khoOk
      loc={LOC}
      {...ghiDe}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
});

describe("[HDRSP-01] nhãn trạng thái: chữ dùng token -ink, không dùng màu trạng thái gốc (tương phản ≥ 4.5)", () => {
  it("MỌI nhãn 'Chờ xuất' ở bảng + thẻ + ngăn chi tiết mang `text-state-warning-ink` và KHÔNG còn `var(--state-warning)]` làm màu chữ", () => {
    const { container } = render(dung());
    const nhan = [...container.querySelectorAll("span")].filter(
      (s) => s.textContent === "Chờ xuất" && s.className.includes("rounded-full") && s.className.includes("font-semibold") && !s.closest("nav"),
    );
    // 2 dòng × (thẻ điện thoại + hàng bảng) + 1 nhãn ở đầu ngăn chi tiết
    expect(nhan.length).toBeGreaterThanOrEqual(5);
    for (const s of nhan) {
      expect(s.className).toContain("text-state-warning-ink");
      expect(s.className).not.toContain("text-[color:var(--state-warning)]");
    }
  });

  it("đối chứng dương: tone danger ⇒ chữ `-ink` của danger (không chỉ riêng warning)", () => {
    const { container } = render(dung({ dongTrongNgan: [dong("dot:l", "Lệch Số", { ngan: "lech", nhan: "Lệch số", tone: "danger" })], dangChon: null, ngan: "lech" }));
    const nhan = [...container.querySelectorAll("tbody span")].filter((s) => s.textContent === "Lệch số");
    expect(nhan.length).toBe(1);
    expect(nhan[0]!.className).toContain("text-state-danger-ink");
    expect(nhan[0]!.className).not.toContain("text-[color:var(--state-danger)]");
  });
});

describe("[HDRSP-02] ngăn chi tiết có <h2> đứng TRƯỚC mọi <h3> (không nhảy h1 → h3)", () => {
  it("trong <aside> có h2 (đọc được cho trình đọc màn hình) nằm trước h3 đầu tiên", () => {
    render(dung());
    const aside = screen.getByLabelText("Chứng từ của lần thu");
    const h2 = aside.querySelector("h2");
    const h3 = aside.querySelector("h3");
    expect(h3).not.toBeNull();
    expect(h2).not.toBeNull();
    expect(h2!.compareDocumentPosition(h3!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("[HDRSP-03] chữ bị cắt … thì vẫn đọc đủ được (title)", () => {
  it("thẻ lần thu ở điện thoại: dòng 'ngày · mã đơn · đợt' và tên khách mang `title` = đúng chữ đã vẽ", () => {
    const { container } = render(dung({ dangChon: null }));
    const the = container.querySelector("ul.md\\:hidden li button") as HTMLElement;
    expect(the).not.toBeNull();
    const dongNgay = [...the.querySelectorAll("span.truncate")].find((s) => (s.textContent ?? "").includes("10/09/2026")) as HTMLElement;
    expect(dongNgay.getAttribute("title")).toBe(dongNgay.textContent);
    const ten = [...the.querySelectorAll("span.truncate")].find((s) => s.textContent === "Nguyễn Văn An") as HTMLElement;
    expect(ten.getAttribute("title")).toBe("Nguyễn Văn An");
  });
});

describe("[HDRSP-04] ngăn đang mở được cuộn vào khung nhìn của dải ngăn", () => {
  it("vẽ lần đầu ⇒ scrollIntoView gọi trên ĐÚNG liên kết aria-current (inline: center), không gọi trên ngăn khác", () => {
    const goi: HTMLElement[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: HTMLElement) {
      goi.push(this);
    });
    render(dung({ ngan: "khong-xuat", dongTrongNgan: [] }));
    const nav = screen.getByRole("navigation", { name: "Ngăn hoá đơn" });
    const dangMo = within(nav).getByRole("link", { current: "page" });
    expect(dangMo.textContent).toContain("Không xuất");
    expect(goi).toEqual([dangMo]);
    expect((Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ inline: "center", block: "nearest" });
  });

  it("đổi ngăn ⇒ cuộn theo ngăn mới", () => {
    const goi: string[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: HTMLElement) {
      goi.push(this.textContent ?? "");
    });
    const { rerender } = render(dung({ ngan: "cho" }));
    rerender(dung({ ngan: "da-xuat", dongTrongNgan: [] }));
    expect(goi.length).toBe(2);
    expect(goi[0]).toContain("Chờ xuất");
    expect(goi[1]).toContain("Đã xuất");
  });
});

describe("[HDRSP-05] liên kết phụ đủ vùng chạm tối thiểu 24px", () => {
  it("'Về ngăn Chờ xuất' (ngăn rỗng) có chiều cao tối thiểu 24px và 44px khi cảm ứng", () => {
    render(dung({ ngan: "da-xuat", dongTrongNgan: [], dangChon: null }));
    const lk = screen.getByRole("link", { name: "Về ngăn Chờ xuất" });
    expect(lk.className).toContain("min-h-6");
    expect(lk.className).toContain("pointer-coarse:min-h-11");
  });

  it("TieuDeMuc: mọi liên kết trong vùng hành động có chiều cao tối thiểu 24px (44px khi cảm ứng)", () => {
    render(<TieuDeMuc moTa="mô tả" hanhDong={<a href="/x">Chứng từ ngân hàng</a>} />);
    const lk = screen.getByRole("link", { name: "Chứng từ ngân hàng" });
    const vung = lk.parentElement as HTMLElement;
    expect(vung.className).toContain("[&_a]:min-h-6");
    expect(vung.className).toContain("[&_a]:pointer-coarse:min-h-11");
    expect(vung.className).toContain("[&_a]:inline-flex");
  });
});
