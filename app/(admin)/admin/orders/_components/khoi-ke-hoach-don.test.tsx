// @vitest-environment jsdom
/**
 * Ca [P-D-1x] — CỔNG D: đơn theo PHẠM VI HỌC không dùng kế hoạch thanh toán nhiều đợt, DỰNG THẬT trên trang chi tiết đơn.
 *
 * Lỗi sinh ra lớp test này (đo trên test.satarobo.vn 13/10/2026): đơn SCOPE tạo bằng form mới vẫn hiện khối "Kế hoạch thanh
 * toán" nguyên như đơn thường — "Chưa thiết lập kế hoạch", ô Thu cọc trước, Chia thành 1·2·3·4 đợt, nút "Lưu kế hoạch" — và
 * câu gợi ý "Muốn tách: lập kế hoạch ở mục…". Hàm thuần `khoiKeHoachTrangDon` xanh vĩnh viễn kể cả khi component vẫn vẽ khối
 * cũ; chỉ dựng thật mới biết.
 *
 * Mọi ca "KHÔNG thấy X" đi kèm ĐỐI CHỨNG DƯƠNG (đơn thường vẫn thấy X) — nếu không, ca xanh cả khi cả trang không render gì.
 * Câu chữ cố ý VIẾT LẠI NGUYÊN VĂN ở đây thay vì import hằng: test phải ghim đúng chữ chủ dự án chốt.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { keHoachDon, type BoiCanhDon, type DongVao } from "@/lib/orders/pham-vi/ke-hoach-don";
import { metadataChoDong } from "@/lib/orders/pham-vi/doc-dong";
import { tinhNoTheoCon, type DongDon, type NoTheoConKetQua } from "@/lib/finance/no-theo-con";

// Mọi server action bị thay bằng vi.fn(): Proxy `has` + `get` trả hàm cho MỌI tên import (danh sách import của cây component dài
// và đổi theo thời gian — liệt kê tay là mời một ca đỏ "No export defined on the mock" mỗi lần ai đó thêm một action).
const { macDinh } = vi.hoisted(() => ({
  macDinh: () =>
    new Proxy({} as Record<string, unknown>, {
      has: () => true,
      get: (_t, k) => (k === "then" || typeof k === "symbol" ? undefined : () => undefined),
    }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../_actions", macDinh);
vi.mock("../_qr-actions", macDinh);
vi.mock("../_pos-sai-ma-actions", macDinh);

import { OrderDetailClient } from "./order-detail-client";
import { PaymentRequestsSection, type PaymentRequestRow } from "./payment-requests-section";
import { CongNoTheoCon } from "./cong-no-theo-con";

afterEach(cleanup);

const CAU_NHAN = "Đơn theo phạm vi học không dùng kế hoạch thanh toán nhiều đợt.";
const CAU_PHI_BU = "Đơn phí học bù chỉ đóng một lần — không lập kế hoạch thanh toán.";

// ── fixture: dòng SCOPE THẬT (đi qua planner + hàm ghi mà tạo đơn dùng) ─────────────────────────────────────────────────
const BOI_CANH: BoiCanhDon = {
  phamViBat: true,
  nguonGia48: "Course.price",
  chinhSach: CHINH_SACH_PL02,
  hieuLuc: cuaSoHieuLucPL02(),
  cheDoMocNgay: "ORDER_CREATED",
  thuTuMacDinh: "LOWER_VALUE_FIRST",
  taoDon: new Date("2026-10-11T03:00:00Z"), // luật 19
  coKeHoachDot: false,
};
const dongVao: DongVao = {
  loai: "COURSE_ENROLLMENT",
  tenDong: "Sata 3",
  soLuong: 1,
  donGiaKhach: 8_976_000,
  soKhoanGiam: 0,
  laLopNhom: true,
  tongSoBuoiKhoa: 48,
  soBuoiMua: 48,
  gia48: 10_560_000,
  conKhoa: "con-a",
};
function metadataScope(): Record<string, unknown> {
  const kq = keHoachDon([dongVao], BOI_CANH);
  const md = metadataChoDong(kq, 0, { courseId: "khoa-sata3", soBuoi: 48 }, "khoa-sata3");
  if (kq.kieu !== "SCOPE" || !md) throw new Error("fixture: dòng không SCOPE");
  return md;
}

const NGAY = new Date("2026-10-11T03:00:00Z");
function dongDon(o: Record<string, unknown> = {}) {
  return {
    id: "oi-1",
    orderId: "o1",
    type: "COURSE_ENROLLMENT",
    itemName: "Sata 3",
    quantity: 1,
    unitPrice: 8_976_000,
    totalPrice: 8_976_000,
    discountAmount: 0,
    metadata: { courseId: "khoa-sata3", soBuoi: 48 },
    studentId: null,
    student: null,
    product: null,
    productId: null,
    enrollmentId: null,
    createdAt: NGAY,
    ...o,
  };
}
function donFixture(items: unknown[]) {
  return {
    id: "o1",
    code: "ORD-261013-000002",
    type: "COURSE",
    status: "PENDING_PAYMENT",
    subtotal: 8_976_000,
    discountAmount: 0,
    shippingFee: 0,
    totalAmount: 8_976_000,
    voucherCode: null,
    paymentMethodId: null,
    paymentMethod: null,
    paidAt: null,
    gatewayTxnId: null,
    bankReference: null,
    customerName: "Phụ huynh fixture",
    customerPhone: "0905123499",
    customerEmail: null,
    customerAddress: null,
    customerWard: null,
    customerCity: null,
    customerNote: null,
    internalNote: null,
    studentId: null,
    student: null,
    lead: null,
    center: null,
    centerId: null,
    history: [],
    createdAt: NGAY,
    updatedAt: NGAY,
    items,
  };
}

type PropsChiTiet = Parameters<typeof OrderDetailClient>[0];
function propsChiTiet(items: unknown[], p: Partial<PropsChiTiet> = {}): PropsChiTiet {
  return {
    order: donFixture(items) as unknown as PropsChiTiet["order"],
    canManage: true,
    qrUrl: null,
    transferContent: "",
    dueNow: { amount: 8_976_000, label: "Toàn đơn" },
    installments: [],
    paymentRequests: [
      { id: "pr0", orderItemId: null, installmentNo: 0, amountDue: 8_976_000, allocated: 0, dueDate: null, status: "PENDING", matchKey: null },
    ],
    qrSessions: {},
    duocPhatPhieu: true,
    duocDongPhieu: false,
    batThuTheoCon: false,
    phieuGop: null,
    duocThuThePos: false,
    phieuPos: null,
    mayPos: [],
    khaiMay: { title: "", href: null },
    paymentMethods: [],
    accounting: { confirmed: 0, pending: 0 },
    congNo: { phaiDong: 8_976_000, daThu: 0, conThieu: 8_976_000, choXacNhan: 0, traVuot: 0, xong: false },
    donNhiem: { nhiem: false, lyDo: [], conNhaKhac: [], soKhoanChuaGan: 0, tienChuaGan: 0 },
    khoiHoaDon: null,
    khoiNguoiMua: {
      xemPii: true, hoTen: "Phụ huynh fixture", hoTenTheoKhach: true, tenDonVi: null, maSoThue: null, cccd: null, diaChi: null,
      email: null, emailTheoKhach: false, thieu: { chan: [], nhac: [] }, daKhai: false, giaTriSua: null,
    } as unknown as PropsChiTiet["khoiNguoiMua"],
    ...p,
  };
}
const dungChiTiet = (items: unknown[], p: Partial<PropsChiTiet> = {}) => render(<OrderDetailClient {...propsChiTiet(items, p)} />);

const tieuDeKeHoach = () => screen.queryByRole("heading", { name: /Kế hoạch thanh toán/ });
const nutLuuKeHoach = () => screen.queryByRole("button", { name: /Lưu kế hoạch/ });

describe("[P-D-10] trang chi tiết đơn — khối KẾ HOẠCH THANH TOÁN", () => {
  it("[P-D-10a] đơn SCOPE: KHÔNG có khối kế hoạch, ô Thu cọc, Chia thành N đợt, nút Lưu kế hoạch; có nhãn mới; không còn câu 'Muốn tách'", () => {
    dungChiTiet([dongDon({ metadata: metadataScope() })]);
    expect(tieuDeKeHoach()).toBeNull();
    expect(nutLuuKeHoach()).toBeNull();
    expect(screen.queryByText(/Chưa thiết lập kế hoạch/)).toBeNull();
    expect(screen.queryByText(/Thu cọc trước/i)).toBeNull();
    expect(screen.queryByText(/Chia thành/i)).toBeNull();
    expect(screen.queryByText(/Muốn tách/)).toBeNull();
    expect(screen.queryByText(/chưa tách đợt/)).toBeNull();
    expect(screen.getByTestId("don-pham-vi-khong-ke-hoach").textContent).toContain(CAU_NHAN);
    // Đối chứng: bảng phiếu thu (QR) VẪN có — đơn phạm vi vẫn thu tiền được qua phiếu toàn đơn.
    expect(screen.getAllByText(/Phiếu thu/).length).toBeGreaterThan(0);
  });

  it("[P-D-10b] ĐỐI CHỨNG DƯƠNG — đơn thường (không dấu phamVi): khối kế hoạch, 'Chưa thiết lập kế hoạch', Thu cọc, Chia thành, nút Lưu kế hoạch và câu 'Muốn tách' NGUYÊN CHỮ", () => {
    dungChiTiet([dongDon()]);
    expect(tieuDeKeHoach()).not.toBeNull();
    expect(screen.getByText(/Chưa thiết lập kế hoạch/)).toBeTruthy();
    expect(screen.getByText(/Thu cọc trước/i)).toBeTruthy();
    expect(screen.getAllByText(/Chia thành/i).length).toBeGreaterThan(0);
    expect(nutLuuKeHoach()).not.toBeNull();
    expect(screen.getByText(/Muốn tách/)).toBeTruthy();
    expect(screen.queryByTestId("don-pham-vi-khong-ke-hoach")).toBeNull();
  });

  it("[P-D-10c] ĐỐI CHỨNG DƯƠNG — đơn có dấu phamVi HỎNG (phiên bản lạ) = đơn thường: khối kế hoạch vẫn hiện", () => {
    const md = metadataScope();
    const khoi = md.phamVi as Record<string, unknown>;
    dungChiTiet([dongDon({ metadata: { ...md, phamVi: { ...khoi, phienBan: 2 } } })]);
    expect(tieuDeKeHoach()).not.toBeNull();
    expect(screen.queryByTestId("don-pham-vi-khong-ke-hoach")).toBeNull();
  });

  it("[P-D-10d] đơn phí học bù: câu RIÊNG của phí học bù, không dùng nhãn phạm vi (đường cũ nguyên chữ)", () => {
    dungChiTiet([dongDon({ type: "MAKEUP_FEE", metadata: null })]);
    expect(screen.getByText(new RegExp(CAU_PHI_BU))).toBeTruthy();
    expect(screen.queryByTestId("don-pham-vi-khong-ke-hoach")).toBeNull();
    expect(tieuDeKeHoach()).toBeNull();
  });

  it("[P-D-10e] quyết định theo DẤU trên dòng, không theo ai xem: người KHÔNG có quyền sửa (canManage=false) cũng thấy nhãn, không thấy khối", () => {
    dungChiTiet([dongDon({ metadata: metadataScope() })], { canManage: false });
    expect(screen.getByTestId("don-pham-vi-khong-ke-hoach")).toBeTruthy();
    expect(tieuDeKeHoach()).toBeNull();
    cleanup();
    dungChiTiet([dongDon()], { canManage: false });
    expect(tieuDeKeHoach()).not.toBeNull(); // đối chứng
  });
});

describe("[P-D-11] bảng phiếu thu — câu gợi ý 'Muốn tách: lập kế hoạch…' trỏ tới một mục có thật", () => {
  const PHIEU_TOAN_DON: PaymentRequestRow = {
    id: "pr0", orderItemId: null, installmentNo: 0, amountDue: 8_976_000, allocated: 0, dueDate: null, status: "PENDING", matchKey: null,
  };
  type P = Parameters<typeof PaymentRequestsSection>[0];
  const props = (p: Partial<P> = {}): P => ({
    orderId: "o1",
    requests: [PHIEU_TOAN_DON],
    initialSessions: {},
    canManage: true,
    duocPhatPhieu: true,
    duocDongPhieu: false,
    batThuTheoCon: false,
    donPhamVi: false,
    daGhiNhanDon: 0,
    phieuGop: null,
    duocThuThePos: false,
    phieuPos: null,
    mayPos: [],
    khaiMay: { title: "", href: null },
    ...p,
  });

  it("[P-D-11a] đơn phạm vi: KHÔNG có câu gợi ý; đơn thường (đối chứng dương): CÓ", () => {
    render(<PaymentRequestsSection {...props({ donPhamVi: true })} />);
    expect(screen.queryByText(/chưa tách đợt/)).toBeNull();
    expect(screen.queryByText(/Muốn tách/)).toBeNull();
    cleanup();
    render(<PaymentRequestsSection {...props({ donPhamVi: false })} />);
    expect(screen.getByText(/chưa tách đợt/)).toBeTruthy();
    expect(screen.getByText(/Muốn tách/)).toBeTruthy();
  });
});

describe("[P-D-12] công nợ theo con — nút 'Đợt' (tạo đợt thu cho bé)", () => {
  // HAI con: `CongNoTheoCon` không vẽ gì cho đơn một con (`so.con.length < 2`) — fixture một con làm mọi ca "không thấy nút" xanh vì trang trống.
  const DONG: DongDon[] = [
    { orderItemId: "oi-an", ten: "Nguyễn Minh An", khoa: "Sata3", tamTinh: 10_560_000, giam: 1_584_000 },
    { orderItemId: "oi-binh", ten: "Nguyễn Minh Bình", khoa: "Sata4", tamTinh: 11_520_000, giam: 0 },
  ];
  const so = (): NoTheoConKetQua => tinhNoTheoCon({ dong: DONG, khoanDaXacNhan: [], khoanChoXacNhan: [], khoanDaVe: [], dot: [] });
  type P = Parameters<typeof CongNoTheoCon>[0];
  const props = (p: Partial<P> = {}): P => ({
    orderId: "o1",
    so: so(),
    duocSua: true,
    duocGan: false,
    duocBoGan: false,
    donPhamVi: false,
    hapThu: "KHONG_HAP_THU" as unknown as P["hapThu"],
    phieuThu: [],
    keHoachDon: [],
    tongDon: 8_976_000,
    tenConLead: {},
    ...p,
  });
  const nutTaoDot = () => screen.queryAllByRole("button", { name: /Tạo đợt thu cho/ });

  it("[P-D-12a] ĐỐI CHỨNG DƯƠNG — đơn thường: có nút 'Đợt'", () => {
    render(<CongNoTheoCon {...props({ donPhamVi: false })} />);
    expect(nutTaoDot()).toHaveLength(2); // mỗi bé một nút
  });

  it("[P-D-12b] đơn phạm vi: KHÔNG có nút 'Đợt'; hàng chi tiết in đúng lý do máy chủ sẽ từ chối", () => {
    render(<CongNoTheoCon {...props({ donPhamVi: true })} />);
    expect(screen.getByText(/Nguyễn Minh An/)).toBeTruthy(); // đối chứng: khối CÓ render (không phải trang trống)
    expect(nutTaoDot()).toHaveLength(0);
    expect(screen.getAllByText(CAU_NHAN)).toHaveLength(2); // mỗi bé một hàng chi tiết, cùng một lý do
  });

  it("[P-D-12c] đơn phạm vi + người xem không có quyền sửa: không nút, không câu lý do (cùng khuôn ẩn nút của cả khối)", () => {
    render(<CongNoTheoCon {...props({ donPhamVi: true, duocSua: false })} />);
    expect(screen.getByText(/Nguyễn Minh An/)).toBeTruthy();
    expect(nutTaoDot()).toHaveLength(0);
    expect(screen.queryByText(CAU_NHAN)).toBeNull();
  });
});


// ═══ [P7-2x] Hai con số "Đã thu" trên trang đơn PHẠM VI — nhãn nói đúng sổ nào, số liệu KHÔNG đổi ═════════════════════════════════════════════
//
// Smoke 13–14/10 (ORD-261013-000002): ghi 10.200.000đ tiền mặt ⇒ khối Công nợ "Đã thu 10.200.000đ" còn phiếu thu "Đã thu 0đ — Chờ thu"; gắn thêm 5.600.000đ ngân hàng ⇒ phiếu "Đã thu 5.600.000đ"
// còn công nợ "Đã thu 15.800.000đ · Thu vượt". Hai SỔ khác nhau (trục B ghi nhận vs đối khớp allocation) — chỉ CÂU CHỮ được sửa, và chỉ cho đơn có dấu phạm vi.
describe("[P7-2] nhãn 'Đã thu' của đơn theo phạm vi", () => {
  const PHIEU = (allocated: number, o: Partial<PaymentRequestRow> = {}): PaymentRequestRow => ({
    id: "pr0", orderItemId: null, installmentNo: 0, amountDue: 10_200_000, allocated, dueDate: null, status: allocated >= 10_200_000 ? "PAID" : allocated > 0 ? "PARTIAL" : "PENDING", matchKey: null, ...o,
  });
  type P = Parameters<typeof PaymentRequestsSection>[0];
  const props = (p: Partial<P> = {}): P => ({
    orderId: "o1",
    requests: [PHIEU(0)],
    initialSessions: {},
    canManage: true,
    duocPhatPhieu: true,
    duocDongPhieu: false,
    batThuTheoCon: false,
    donPhamVi: true,
    daGhiNhanDon: 10_200_000,
    phieuGop: null,
    duocThuThePos: false,
    phieuPos: null,
    mayPos: [],
    khaiMay: { title: "", href: null },
    ...p,
  });
  const cotDaThu = () => screen.queryByRole("columnheader", { name: "Đã thu" });
  const cotDoiKhop = () => screen.queryByRole("columnheader", { name: "Đã đối khớp" });
  const chuThich = () => screen.queryByTestId("chu-thich-da-thu-lech");

  it("[P7-21] ca smoke 1: ghi tay 10.200.000đ, phiếu đối khớp 0đ ⇒ cột 'Đã đối khớp' (không 'Đã thu') + chú thích nêu cả hai số", () => {
    render(<PaymentRequestsSection {...props()} />);
    expect(cotDoiKhop()).not.toBeNull();
    expect(cotDaThu()).toBeNull();
    expect(cotDoiKhop()!.getAttribute("title")).toMatch(/Tiền mặt hoặc khoản ghi tay nằm ở sổ kế toán/);
    const ct = chuThich()!.textContent!;
    expect(ct).toContain("Phiếu thu chỉ đếm tiền ngân hàng / thẻ POS đã đối khớp (0đ)");
    expect(ct).toContain("Khối Công nợ đếm mọi khoản đã ghi nhận (10.200.000đ)");
  });

  it("[P7-22] ca smoke 3: đối khớp 5.600.000đ, công nợ 15.800.000đ ⇒ chú thích in ĐÚNG hai số đó", () => {
    render(<PaymentRequestsSection {...props({ requests: [PHIEU(5_600_000)], daGhiNhanDon: 15_800_000 })} />);
    const ct = chuThich()!.textContent!;
    expect(ct).toContain("(5.600.000đ)");
    expect(ct).toContain("(15.800.000đ)");
  });

  it("[P7-23] hai số TRÙNG nhau ⇒ không chú thích (không có gì để giải thích), nhưng nhãn cột vẫn 'Đã đối khớp'", () => {
    render(<PaymentRequestsSection {...props({ requests: [PHIEU(10_200_000)], daGhiNhanDon: 10_200_000 })} />);
    expect(chuThich()).toBeNull();
    expect(cotDoiKhop()).not.toBeNull();
  });

  it("[P7-24] ĐỐI CHỨNG DƯƠNG — đơn thường với CÙNG hai số lệch: cột 'Đã thu' NGUYÊN CHỮ, không title, không chú thích", () => {
    render(<PaymentRequestsSection {...props({ donPhamVi: false, requests: [PHIEU(5_600_000)], daGhiNhanDon: 15_800_000 })} />);
    expect(cotDaThu()).not.toBeNull();
    expect(cotDaThu()!.hasAttribute("title")).toBe(false);
    expect(cotDoiKhop()).toBeNull();
    expect(chuThich()).toBeNull();
  });

  it("[P7-25] đơn thường: toàn bộ DOM của khối KHÔNG phụ thuộc `daGhiNhanDon` (golden — prop mới không rò vào đường cũ)", () => {
    const a = render(<PaymentRequestsSection {...props({ donPhamVi: false, daGhiNhanDon: 0 })} />).container.innerHTML;
    cleanup();
    const b = render(<PaymentRequestsSection {...props({ donPhamVi: false, daGhiNhanDon: 987_654_321 })} />).container.innerHTML;
    expect(b).toBe(a);
  });

  it("[P7-26] SỐ LIỆU không đổi: thân bảng đơn phạm vi == thân bảng đơn thường (chỉ tiêu đề cột và chú thích khác)", () => {
    const r = { requests: [PHIEU(5_600_000)], daGhiNhanDon: 15_800_000 };
    const thanPhamVi = render(<PaymentRequestsSection {...props({ ...r, donPhamVi: true })} />).container.querySelector("tbody")!.innerHTML;
    cleanup();
    const thanThuong = render(<PaymentRequestsSection {...props({ ...r, donPhamVi: false })} />).container.querySelector("tbody")!.innerHTML;
    expect(thanPhamVi).toBe(thanThuong);
    expect(thanPhamVi).toContain("5.600.000đ"); // đối chứng: thân bảng CÓ số (không phải rỗng hai bên)
  });

  it("[P7-27] khối Công nợ trên trang đơn PHẠM VI: ô 'Đã thu' thêm dòng nói nó đếm gì; số in ra KHÔNG đổi", () => {
    dungChiTiet([dongDon({ metadata: metadataScope() })], {
      congNo: { phaiDong: 8_976_000, daThu: 8_976_000, conThieu: 0, choXacNhan: 8_976_000, traVuot: 0, xong: true },
    });
    const o = screen.getByText("Đã thu", { selector: "p" }).parentElement!;
    expect(o.textContent).toContain("8.976.000đ");
    expect(o.textContent).toContain("Đã ghi nhận, kể cả chờ kế toán");
    // Đi qua dây nối thật: trang cấp `daGhiNhanDon` = ô Công nợ ⇒ phiếu (đối khớp 0) in chú thích với ĐÚNG số ở ô đó.
    expect(screen.getByTestId("chu-thich-da-thu-lech").textContent).toContain("(8.976.000đ)");
    expect(screen.getByRole("columnheader", { name: "Đã đối khớp" })).toBeTruthy();
  });

  it("[P7-28] ĐỐI CHỨNG DƯƠNG — cùng trang với đơn thường: ô 'Đã thu' không dòng phụ, cột phiếu 'Đã thu', không chú thích", () => {
    dungChiTiet([dongDon()], {
      congNo: { phaiDong: 8_976_000, daThu: 8_976_000, conThieu: 0, choXacNhan: 8_976_000, traVuot: 0, xong: true },
    });
    const o = screen.getByText("Đã thu", { selector: "p" }).parentElement!;
    expect(o.textContent).not.toContain("Đã ghi nhận, kể cả chờ kế toán");
    expect(screen.getByRole("columnheader", { name: "Đã thu" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Đã đối khớp" })).toBeNull();
    expect(screen.queryByTestId("chu-thich-da-thu-lech")).toBeNull();
  });
});

describe("[P7-PN] chú thích 'Đã thu' dùng ĐÚNG số công nợ; đơn không-SCOPE không bị gắn nhãn", () => {
  it("[P7-PN1] ba số công nợ KHÁC nhau: chú thích in đúng 'đã thu' (8.976.000đ), không lẫn tổng phải đóng / chờ xác nhận / còn thiếu", () => {
    dungChiTiet([dongDon({ metadata: metadataScope() })], {
      congNo: { phaiDong: 10_000_000, daThu: 8_976_000, conThieu: 1_024_000, choXacNhan: 7_000_000, traVuot: 0, xong: false },
    });
    const ct = screen.getByTestId("chu-thich-da-thu-lech").textContent!;
    expect(ct).toContain("đã ghi nhận (8.976.000đ)");
    expect(ct).toContain("đã đối khớp (0đ)"); // phiếu fixture: allocated = 0
    for (const sai of ["10.000.000", "7.000.000", "1.024.000"]) expect(ct, sai).not.toContain(sai);
  });

  it("[P7-PN2] đơn phí học bù (MAKEUP_FEE) có tiền ghi nhận lệch phiếu: GIỮ NGUYÊN cột/ô 'Đã thu', không chú thích, không nhãn 'Đã đối khớp'", () => {
    dungChiTiet([dongDon({ type: "MAKEUP_FEE", metadata: null })], {
      congNo: { phaiDong: 8_976_000, daThu: 8_976_000, conThieu: 0, choXacNhan: 8_976_000, traVuot: 0, xong: true },
    });
    const o = screen.getByText("Đã thu", { selector: "p" }).parentElement!;
    expect(o.textContent).not.toContain("Đã ghi nhận, kể cả chờ kế toán");
    expect(screen.getByRole("columnheader", { name: "Đã thu" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Đã đối khớp" })).toBeNull();
    expect(screen.queryByTestId("chu-thich-da-thu-lech")).toBeNull();
  });
});
