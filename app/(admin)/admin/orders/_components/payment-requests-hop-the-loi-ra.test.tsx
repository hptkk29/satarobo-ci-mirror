// @vitest-environment jsdom
/**
 * Ca [HNG-R*] — HỘP PHIẾU THẺ SAU KHI GHÉP Việc 3 × Việc 4 (docs/pos-hai-nut-khai-may.md §7.8). Bấm nút thật, soi cái gì CÓ và KHÔNG CÓ trên màn.
 *
 * Hộp có BA lối, mỗi lối một tiền đề NGƯỢC nhau: "Kiểm tra thanh toán" (việc hằng ngày) · "Tôi nhập sai mã trên máy" (khách ĐÃ quẹt thành công, sale gõ
 * sai mã) · "Huỷ phiếu thẻ" (khách CHƯA quẹt). Hai ca `[HN3-*]` và `[HN4-*]` được viết khi việc kia chưa tồn tại nên mỗi bên xanh MỘT MÌNH mà ghép lại
 * thì hỏng (§7.1: "sạch chữ, SAI nghĩa"). Tệp này đo CHÍNH hộp đã ghép trên mọi tổ hợp trạng thái.
 *
 * FIXTURE ĐI QUA ĐƯỜNG THẬT: view do `dungPhieuPosView` dựng từ hàng thô, `theDangMo` do `kieuTheDangMo` tính — KHÔNG gõ tay `huyPhieuThe`, `hienThi`, `theDangMo`.
 * Lý do đo được: `[HN3-R10]`/`[HN3-R11]` đỏ vì fixture mặc định `huyDuoc: true` cho phiếu mà máy chủ chắc chắn trả `huyDuoc: false` — ca nói về một trạng thái
 * không tồn tại. Fixture dựng bằng đường thật thì không thể vẽ ra trạng thái ấy.
 *
 * Câu CHỮ NGƯỜI DÙNG THẤY cố ý viết lại NGUYÊN VĂN (test ghim đúng chữ, đổi chữ mà quên test thì đỏ). Đồng hồ ĐÓNG BĂNG (luật 19).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { dungPhieuPosView, kieuTheDangMo, type PhieuPosDeXem } from "@/lib/payments/pos/phieu-pos-luat";
import { thongDiepPos } from "@/lib/payments/pos/thong-diep-pos";
import { cauTuChoi } from "@/lib/payments/pos/sai-ma";
import { CAU_TU_CHOI_HUY_PHIEU_THE, ghepCauTuChoiHuy } from "@/lib/payments/pos/huy-phieu-the-cau";
import type { PhieuGopView } from "./cong-no-theo-con";

const h = vi.hoisted(() => ({
  taoPhieuGopAction: vi.fn(),
  huyPhieuGopAction: vi.fn(),
  dongPhieuGopAction: vi.fn(),
  taoPhieuPosAction: vi.fn(),
  kiemTraPhieuPosAction: vi.fn(),
  baoAdminPhieuPosAction: vi.fn(),
  huyPhieuTheAction: vi.fn(),
  timUngVienSaiMaAction: vi.fn(),
  guiSaiMaAction: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  message: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error, warning: vi.fn(), message: h.message } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("../_actions", () => ({
  taoPhieuGopAction: h.taoPhieuGopAction,
  huyPhieuGopAction: h.huyPhieuGopAction,
  dongPhieuGopAction: h.dongPhieuGopAction,
  taoPhieuPosAction: h.taoPhieuPosAction,
  kiemTraPhieuPosAction: h.kiemTraPhieuPosAction,
  baoAdminPhieuPosAction: h.baoAdminPhieuPosAction,
  huyPhieuTheAction: h.huyPhieuTheAction,
}));
vi.mock("../_qr-actions", () => ({ issueQrForRequest: vi.fn(), regenerateQr: vi.fn() }));
vi.mock("../_pos-sai-ma-actions", () => ({ timUngVienSaiMaAction: h.timUngVienSaiMaAction, guiSaiMaAction: h.guiSaiMaAction }));

import { PaymentRequestsSection, type PaymentRequestRow } from "./payment-requests-section";

// ── CHỮ NGƯỜI DÙNG THẤY — nguyên văn ─────────────────────────────────────────────────────────────────────────────────────
const NUT_KIEM = "Kiểm tra thanh toán";
const NUT_SAI_MA = "Tôi nhập sai mã trên máy";
const NUT_HUY = "Huỷ phiếu thẻ";
const NUT_XAC_NHAN = "Xác nhận huỷ phiếu thẻ";
const TICK = "Tôi chắc khách chưa quẹt thẻ (hoặc đã huỷ giao dịch trên máy)";
const CAU_PHAN_BIET = "Khách CHƯA quẹt, hoặc đổi cách trả? Dùng “Huỷ phiếu thẻ” bên dưới.";
const CAU_DUNG_KHI = /Dùng khi biên lai máy đã báo THÀNH CÔNG nhưng mã ở ô Ghi chú gõ sai\./;
const CAU_CHO_KE_TOAN = "Chờ kế toán xác nhận giao dịch nhập sai mã. Khách đã quẹt thành công — ĐỪNG cho khách quẹt lại.";
const CAU_DA_HUY_TOAST = "Đã huỷ phiếu thẻ mã H6WR4";
const CAU_PHIEU_THE_DA_HUY = "Phiếu thu thẻ đã huỷ — không còn chờ quẹt. Thu thẻ lại thì mở phiếu thẻ mới.";

// Luật 19 — đồng hồ đóng băng; mọi mốc trong fixture tính từ nó.
const BAY_GIO = new Date("2026-10-09T06:30:00Z"); // 13:30 giờ VN
const PHUT = 60_000;
const TAO = new Date(BAY_GIO.getTime() - 2 * PHUT);

const CAU_CHUA_THAY = thongDiepPos({
  loai: "CHUA_THAY",
  code5: "H6WR4",
  duLieuLuc: new Date(BAY_GIO.getTime() - PHUT),
  gdMoiNhatLuc: new Date(BAY_GIO.getTime() - PHUT),
  taoLuc: TAO,
  baoAdminTuLuc: new Date(TAO.getTime() + 10 * PHUT),
}).cau;
const CAU_DANG_XU_LY = thongDiepPos({ loai: "DANG_CHO_NGAN_HANG", code5: "H6WR4", maTrangThai: "Đang xử lý" }).cau;
/** Câu `tuChoiSaiMa` ghi vào phiếu thẻ lúc kế toán từ chối — HÀM THẬT của Việc 3 (VIỆC 6 · a2: view nhận ra nó qua yêu cầu MỚI NHẤT, lý do của `yeuCau("TU_CHOI")` bên dưới). */
const CAU_SAU_TU_CHOI = cauTuChoi("Giao dịch của khách khác");
/** Nguyên văn câu cảnh báo cấp ĐƠN (Việc 5) — gõ lại ở đây để ca canh CHỮ chứ không chỉ canh dây nối. */
const CAU_DON_DA_CO_VET_BAC = "Đơn này từng có một giao dịch bị kế toán từ chối. Nếu khách đã quẹt thành công trên máy, ĐỪNG cho khách quẹt lại — báo kế toán.";

const DOT: PaymentRequestRow = {
  id: "pr3",
  orderItemId: null,
  installmentNo: 3,
  amountDue: 800_000,
  allocated: 0,
  dueDate: null,
  status: "PENDING",
  matchKey: null,
};

// ── dựng view bằng ĐƯỜNG THẬT ────────────────────────────────────────────────────────────────────────────────────────────
function raw(p: Partial<PhieuPosDeXem> = {}): PhieuPosDeXem {
  return {
    id: "i1",
    code5: "H6WR4",
    amount: 800_000,
    status: "CHO_QUET",
    createdAt: TAO,
    expiresAt: new Date(TAO.getTime() + 24 * 60 * PHUT),
    lastCheckAt: null,
    lastResultKind: null,
    lastResultMessage: null,
    paymentBillId: "b1",
    posTerminal: { id: "m1", maThietBi: "TB-1", maQuay: "QTTFBKATK", ten: null },
    bankTransaction: null,
    paymentBill: { status: "OPEN", lines: [{ paymentRequestId: "pr3" }] },
    coGiaoDichChoTay: false,
    saiMaYeuCau: [],
    coDongTheChuaKetLuan: false,
    donDaCoVetBac: false,
    ...p,
  };
}
const yeuCau = (trangThai: PhieuPosDeXem["saiMaYeuCau"][number]["trangThai"]): PhieuPosDeXem["saiMaYeuCau"] => [
  { trangThai, lyDoTuChoi: trangThai === "TU_CHOI" ? "Giao dịch của khách khác" : null, dangGhiLuc: null, btStatus: "UNMATCHED", btDaGoGan: false },
];
const PHIEU_MO = { billId: "b1", tongTien: 800_000, dong: [{ paymentRequestId: "pr3", ten: "Đợt 3", soTien: 800_000 }] };
const chuaThay: Partial<PhieuPosDeXem> = { lastCheckAt: new Date(BAY_GIO.getTime() - PHUT), lastResultKind: "NOT_FOUND", lastResultMessage: CAU_CHUA_THAY };

const viewTu = (p: Partial<PhieuPosDeXem> = {}) => dungPhieuPosView({ intent: raw(p), phieuMo: PHIEU_MO, now: BAY_GIO });

function phieuGop(p: Partial<PhieuGopView> = {}): PhieuGopView {
  return {
    billId: "b1",
    ma: "H6WR4",
    tongTien: 800_000,
    daNhan: 0,
    dong: [{ paymentRequestId: "pr3", installmentNo: 3, ten: "Đợt 3", soTien: 800_000 }],
    qrUrl: "https://img.vietqr.io/image/970407-0000-compact2.png?amount=800000",
    noiDungCk: "MAI 0910000101 H6WR4",
    theDangMo: "DANG_CHO",
    ...p,
  };
}

type Props = Parameters<typeof PaymentRequestsSection>[0];

/** Props của trang theo MỘT hàng thô: view + `theDangMo` đều do đường thật tính, như máy chủ làm. */
function trang(p: Partial<PhieuPosDeXem> = {}, q: Partial<Props> = {}): Props {
  const r = raw(p);
  return {
    orderId: "o1",
    requests: [DOT],
    initialSessions: {},
    canManage: false,
    duocPhatPhieu: true,
    duocDongPhieu: false,
    batThuTheoCon: true,
    phieuGop: phieuGop({ theDangMo: kieuTheDangMo({ phieu: [r], coGiaoDichChoTay: r.coGiaoDichChoTay, now: BAY_GIO }) }),
    duocThuThePos: true,
    phieuPos: viewTu(p),
    mayPos: [{ id: "m1", nhan: "QTTFBKATK" }],
    khaiMay: { title: "Khai máy ở Cơ sở → Máy POS quẹt thẻ", href: null },
    ...q,
  };
}

function dung(p: Partial<PhieuPosDeXem> = {}, q: Partial<Props> = {}) {
  const v = render(<PaymentRequestsSection {...trang(p, q)} />);
  /** Máy chủ trả lại trang sau `router.refresh()`: hàng thô MỚI ⇒ view + theDangMo mới, cùng đường thật. */
  const lamMoi = (p2: Partial<PhieuPosDeXem>, q2: Partial<Props> = {}) => v.rerender(<PaymentRequestsSection {...trang(p2, q2)} />);
  return { ...v, lamMoi };
}

/** Mở hộp phiếu thẻ từ ô nào đang mời mở nó (tuỳ phiếu nằm ở dòng đợt hay ở dải kết quả). */
function moHop() {
  const mo =
    screen.queryByRole("button", { name: /Thẻ · đang chờ|Thẻ: chờ kế toán|Thẻ · chưa rõ/ }) ??
    screen.queryByRole("button", { name: "Mở phiếu thẻ" });
  if (!mo) throw new Error("không có ô nào mở hộp phiếu thẻ — fixture không dựng ra trạng thái này trên màn");
  fireEvent.click(mo);
  return screen.getByRole("dialog", { name: /Thu thẻ POS/ });
}

/** Bảy điều mà sale thấy ở hộp. */
function nhin(hop: HTMLElement) {
  return {
    kiemTra: within(hop).queryByRole("button", { name: NUT_KIEM }) !== null,
    nhapSaiMa: within(hop).queryByRole("button", { name: NUT_SAI_MA }) !== null,
    huy: within(hop).queryByRole("button", { name: NUT_HUY }) !== null,
    // "có dòng nói vì sao chưa huỷ được": dòng xám có tiền tố HOẶC khung cảnh báo tiền đang bay (không tiền tố).
    dongLyDo: within(hop).queryByText(/^Chưa huỷ được phiếu thẻ/) !== null || hop.querySelector("[data-tien-dang-bay]") !== null,
    phanBiet: within(hop).queryByText(CAU_PHAN_BIET) !== null,
    // lý do chưa huỷ được ở TÔNG CẢNH BÁO (role=alert), không phải dòng 12px xám — khi có dấu hiệu tiền đang bay.
    canhTienBay: hop.querySelector("[data-tien-dang-bay][role='alert']") !== null,
    // hộp đang MỜI khách quẹt (bốn bước hướng dẫn).
    moiQuet: within(hop).queryByText("Nhập số tiền vào máy.") !== null,
  };
}
type Nhin = ReturnType<typeof nhin>;
const nhinLa = (kiemTra: boolean, nhapSaiMa: boolean, huy: boolean, dongLyDo: boolean, phanBiet: boolean, canhTienBay = false, moiQuet = false): Nhin => ({
  kiemTra,
  nhapSaiMa,
  huy,
  dongLyDo,
  phanBiet,
  canhTienBay,
  moiQuet,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(BAY_GIO);
  vi.clearAllMocks();
  // Luật 18: một ca ĐỎ giữa chừng để lại hộp thoại trong <body>, ca sau đọc nhầm hộp cũ.
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  h.huyPhieuTheAction.mockResolvedValue({ ok: true, intentId: "i1", code5: "H6WR4" });
});
afterEach(() => vi.useRealTimers());

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R1 — MA TRẬN: trạng thái THẬT × lối ra
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HNG-R1] ma trận trạng thái × lối ra của hộp phiếu thẻ (view dựng bằng đường thật)", () => {
  type Hang = { ten: string; p: Partial<PhieuPosDeXem>; thay: Nhin; cau?: string | RegExp; canh?: boolean };
  const BANG: Hang[] = [
    // 7 cột: (kiemTra, nhapSaiMa, huy, dongLyDo, phanBiet, canhTienBay, moiQuet). `moiQuet` = hộp in bốn bước mời khách quẹt.
    { ten: "chưa kiểm lần nào (khách chưa quẹt)", p: {}, thay: nhinLa(true, false, true, false, false, false, true) },
    {
      ten: "'Chưa thấy' ⇒ CẢ HAI nút nguy hiểm + câu nói khác biệt",
      p: chuaThay,
      thay: nhinLa(true, true, true, false, true, false, true),
      cau: CAU_CHUA_THAY,
    },
    {
      ten: "máy báo lần quẹt gần nhất THẤT BẠI ⇒ chỉ nút huỷ (V62: THAT_BAI không có 'nhập sai mã')",
      p: { status: "THAT_BAI", lastResultKind: "FAILED", lastResultMessage: "Giao dịch thất bại — cho quẹt lại." },
      thay: nhinLa(true, false, true, false, false, false, true),
    },
    {
      // Rà ghép 10/10/2026: dấu hiệu TIỀN ĐANG BAY ⇒ lý do ở tông cảnh báo (role=alert) NGAY dưới câu trạng thái, và hộp KHÔNG mời quẹt (ẩn bốn bước).
      ten: "có dòng 'Đang xử lý' mang mã (ĐỪNG cho quẹt lại) ⇒ KHÔNG nút huỷ, lý do ở TÔNG CẢNH BÁO, KHÔNG mời quẹt",
      p: { lastResultKind: "NOT_FOUND", lastResultMessage: CAU_DANG_XU_LY },
      thay: nhinLa(true, false, false, true, false, true, false),
      cau: CAU_DANG_XU_LY,
    },
    {
      ten: "lỗi kết nối ở lượt kiểm gần nhất ⇒ dòng lý do XÁM (chưa biết gì — không phải dấu hiệu tiền đang bay), vẫn mời quẹt như trước",
      p: { lastResultKind: "PROVIDER_ERROR", lastResultMessage: "Lỗi kết nối hệ thống thanh toán (mã X) — đã báo admin." },
      thay: nhinLa(true, false, false, true, false, false, true),
    },
    {
      // Rà ghép 10/10/2026 (bản đầu ghim NGƯỢC: 'nút nhập sai mã như V3'): cổng G-A của bước TÌM từ chối đúng cảnh này ("Có giao dịch mang mã X — bấm Kiểm tra thanh toán")
      // nên nút chắc chắn ăn từ chối ⇒ không vẽ (luật 12). Câu chính "Chưa thấy…" và dòng cảnh báo cãi nhau ⇒ câu đúng ở tông cảnh báo, không mời quẹt.
      ten: "'Chưa thấy' + giao dịch thẻ MANG ĐÚNG MÃ đang chờ kế toán ⇒ lý do ở tông cảnh báo, KHÔNG nút nhập sai mã (sẽ bị từ chối), KHÔNG mời quẹt",
      p: { ...chuaThay, coGiaoDichChoTay: true },
      thay: nhinLa(true, false, false, true, false, true, false),
    },
    {
      ten: "'Chưa thấy' + dòng thẻ mang mã CHƯA NGÃ NGŨ (Việc 4: lượt kiểm lưu trước vẫn nói 'Chưa thấy') ⇒ tông cảnh báo, KHÔNG nút nhập sai mã, KHÔNG mời quẹt",
      p: { ...chuaThay, coDongTheChuaKetLuan: true },
      thay: nhinLa(true, false, false, true, false, true, false),
    },
    {
      ten: "lượt kiểm thấy khách ĐÃ quẹt (PAID) mà phiếu vẫn CHO_QUET ⇒ tông cảnh báo, KHÔNG mời quẹt",
      p: { lastResultKind: "PAID", lastResultMessage: "Đã thu" },
      thay: nhinLa(true, false, false, true, false, true, false),
    },
    {
      ten: "ĐÃ GỬI kế toán (CAN_XU_LY + yêu cầu chờ duyệt) ⇒ không nút nào; hộp nói 'Chờ kế toán xác nhận giao dịch nhập sai mã'",
      p: { ...chuaThay, status: "CAN_XU_LY", bankTransaction: { status: "UNMATCHED", allocations: [] }, saiMaYeuCau: yeuCau("CHO_DUYET") },
      thay: nhinLa(true, false, false, false, false),
      cau: CAU_CHO_KE_TOAN,
    },
    {
      // VIỆC 6 · a2 (chủ dự án chốt 10/10/2026): sau từ chối nút "Huỷ phiếu thẻ" QUAY LẠI. Hộp vẫn chỉ có MỘT lệnh cấm quẹt lại (dòng đỏ của yêu cầu) và KHÔNG mời quẹt (ẩn bốn bước).
      ten: "NGAY SAU kế toán TỪ CHỐI (câu lưu = câu từ chối) ⇒ nút HUỶ HIỆN; MỘT lệnh cấm (dòng đỏ); không nút nhập sai mã (câu đang hiện không phải 'Chưa thấy'); KHÔNG mời quẹt",
      p: { lastResultKind: "NOT_FOUND", lastResultMessage: CAU_SAU_TU_CHOI, saiMaYeuCau: yeuCau("TU_CHOI") },
      thay: nhinLa(true, false, true, false, false, false, false),
      canh: true,
    },
    {
      ten: "vài phút sau (poller ghi 'Chưa thấy' trần) ⇒ VẪN nút huỷ (không nhấp nháy); nút nhập sai mã hiện lại (V76) ⇒ CẢ HAI nút + câu phân biệt; MỘT lệnh cấm; KHÔNG mời quẹt",
      p: { ...chuaThay, saiMaYeuCau: yeuCau("TU_CHOI") },
      thay: nhinLa(true, true, true, false, true, false, false),
      canh: true,
    },
    {
      ten: "sau từ chối, lượt kiểm ghi dòng 'Đang xử lý' ⇒ KHÔNG huỷ được: KHÔNG nút huỷ VÀ KHÔNG dòng 'Chưa huỷ được' thứ hai dưới dòng đỏ; KHÔNG mời quẹt",
      p: { lastResultKind: "NOT_FOUND", lastResultMessage: CAU_DANG_XU_LY, saiMaYeuCau: yeuCau("TU_CHOI") },
      thay: nhinLa(true, false, false, false, false, false, false),
    },
    {
      ten: "yêu cầu sai mã đang GIỮ trên phiếu còn CHO_QUET (dữ liệu vi phạm bất biến) ⇒ tông cảnh báo; KHÔNG mời gửi thêm (DB sẽ từ chối), KHÔNG mời quẹt",
      p: { ...chuaThay, saiMaYeuCau: yeuCau("CHO_DUYET") },
      thay: nhinLa(true, false, false, true, false, true, false),
    },
    {
      ten: "đã thu ⇒ không lối nào ngoài Kiểm tra",
      p: { status: "DA_THU", bankTransaction: { status: "MATCHED", allocations: [{ paymentRequestId: "pr3" }] } },
      thay: nhinLa(true, false, false, false, false),
    },
  ];

  for (const [i, hang] of BANG.entries()) {
    it(`[HNG-R1-${i + 1}] ${hang.ten}`, () => {
      dung(hang.p);
      const hop = moHop();
      expect(nhin(hop)).toEqual(hang.thay);
      if (hang.cau) expect(within(hop).getAllByText(hang.cau).length, "câu của trạng thái có mặt").toBeGreaterThanOrEqual(1);
      if (hang.canh) {
        // Sau từ chối: dòng cảnh báo đỏ là lệnh cấm DUY NHẤT — đếm số lần "ĐỪNG cho khách quẹt lại" trong hộp (bản hỏng in HAI lần).
        expect(within(hop).getByRole("alert").textContent).toContain("ĐỪNG cho khách quẹt lại");
        expect((hop.textContent ?? "").match(/ĐỪNG cho khách quẹt lại/g)?.length, "đúng MỘT lệnh cấm").toBe(1);
        expect(within(hop).queryByText("Nhập số tiền vào máy."), "ẩn bốn bước mời quẹt").toBeNull();
      }
    });
  }

  it("[HNG-R1-cot] ĐỐI CHỨNG DƯƠNG (luật 11): mỗi cột của bảng có cả ô TRUE lẫn ô FALSE — không cột nào 'luôn một giá trị' xanh nhờ trùng hợp", () => {
    for (const cot of ["kiemTra", "nhapSaiMa", "huy", "dongLyDo", "phanBiet", "canhTienBay", "moiQuet"] as const) {
      const giaTri = new Set(BANG.map((x) => x.thay[cot]));
      if (cot === "kiemTra") expect(giaTri.has(true), cot).toBe(true);
      else expect(giaTri, cot).toEqual(new Set([true, false]));
    }
  });

  it("[HNG-R1-huy] HUY (huỷ tay) ⇒ không nút nào của phiếu mở; hộp nói theo trạng thái — mở từ dải kết quả khi còn giao dịch chờ kế toán", () => {
    dung({ status: "HUY", coGiaoDichChoTay: true });
    const hop = moHop();
    expect(nhin(hop)).toEqual(nhinLa(false, false, false, false, false));
    expect(within(hop).queryByText(CAU_PHIEU_THE_DA_HUY), "còn giao dịch chờ ⇒ câu CẢNH BÁO, không mời 'thu thẻ lại'").toBeNull();
    expect(within(hop).getByText(/ĐỪNG cho khách quẹt lại, chờ kế toán xử lý xong\./)).toBeTruthy();
  });

  it("[HNG-R1-quyen] quyền: người KHÔNG có `payments:pos-check` không thấy lối nào của hộp; ĐỐI CHỨNG DƯƠNG: có quyền ⇒ cùng trạng thái ấy hiện cả hai nút", () => {
    const v = dung(chuaThay, { duocThuThePos: false, phieuPos: null });
    expect(screen.queryByRole("button", { name: /Thẻ · đang chờ|Thẻ: chờ kế toán|Mở phiếu thẻ/ }), "không ô nào mở hộp").toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: NUT_HUY })).toBeNull();
    expect(screen.queryByRole("button", { name: NUT_SAI_MA })).toBeNull();
    v.lamMoi(chuaThay, { duocThuThePos: true });
    expect(nhin(moHop())).toEqual(nhinLa(true, true, true, false, true, false, true));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R2 — HAI NÚT NGUY HIỂM: xếp hạng và nói khác biệt
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HNG-R2] khi cả hai nút nguy hiểm cùng hiện: câu nói khác biệt đứng NGAY dưới câu của nút nhập sai mã", () => {
  it("[HNG-R2] câu phân biệt nằm TRONG khối của nút 'Tôi nhập sai mã', liền sau câu 'Dùng khi biên lai…'; nút huỷ ở chân hộp (footer), KHÔNG cùng khối", () => {
    dung(chuaThay);
    const hop = moHop();
    const nut = within(hop).getByRole("button", { name: NUT_SAI_MA });
    const khoi = nut.parentElement as HTMLElement;
    const dung_ = within(khoi).getByText(CAU_DUNG_KHI);
    const phanBiet = within(khoi).getByText(CAU_PHAN_BIET);
    expect(dung_.nextElementSibling, "hai vế đọc LIỀN nhau: ĐÃ quẹt ⇒ nút này · CHƯA quẹt ⇒ nút huỷ").toBe(phanBiet);
    // Nút huỷ ở footer (xa nút chính theo thiết kế V4), không lẫn vào khối nhập sai mã.
    const nutHuy = within(hop).getByRole("button", { name: NUT_HUY });
    expect(khoi.contains(nutHuy)).toBe(false);
    expect(nutHuy.closest('[data-slot="dialog-footer"]'), "nút huỷ nằm ở footer").not.toBeNull();
    expect(nut.closest('[data-slot="dialog-footer"]'), "nút nhập sai mã nằm ở thân, không ở footer").toBeNull();
  });

  it("[HNG-R2b] chỉ MỘT nút ⇒ không câu phân biệt (chưa kiểm: chỉ nút huỷ · có giao dịch mang mã chờ kế toán: không nút nào) — ĐỐI CHỨNG của ca trên", () => {
    const v = dung({});
    expect(within(moHop()).queryByText(CAU_PHAN_BIET)).toBeNull();
    // Rà ghép 10/10/2026: bản đầu ghim 'giao dịch chờ ⇒ VẪN có nút nhập sai mã' — cổng G-A của bước tìm từ chối đúng cảnh này nên nút là lời hứa suông.
    v.lamMoi({ ...chuaThay, coGiaoDichChoTay: true });
    const hop = screen.getByRole("dialog", { name: /Thu thẻ POS/ });
    expect(within(hop).queryByRole("button", { name: NUT_SAI_MA }), "có giao dịch mang mã ⇒ bước tìm chắc chắn từ chối ⇒ không mời bấm").toBeNull();
    expect(within(hop).queryByText(CAU_PHAN_BIET)).toBeNull();
    // ĐỐI CHỨNG DƯƠNG: bỏ giao dịch chờ (trang mới về) ⇒ nút nhập sai mã VỀ, kèm câu phân biệt (cả hai nút).
    v.lamMoi({ ...chuaThay });
    const sau = screen.getByRole("dialog", { name: /Thu thẻ POS/ });
    expect(within(sau).getByRole("button", { name: NUT_SAI_MA })).toBeTruthy();
    expect(within(sau).getByText(CAU_PHAN_BIET)).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R3 — bước "Chọn giao dịch của khách" thay NoiDungPhieu: không có nút huỷ trong bước (U08 — ca HÀNH VI chỉ viết được sau ghép)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const UV_CHO_KT = {
  bankTransactionId: "bt2",
  gioQuet: "2026-10-09T13:29:10+07:00",
  soTien: 800_000,
  soTheCuoi: null,
  ghiChu: "",
  xemTruoc: { quyet: "CHO_KE_TOAN" as const, lyDo: ["NHIEU_UNG_VIEN" as const] },
};
const ketQuaTim = (ungVien: unknown[]) => ({
  ok: true,
  ungVien,
  conNua: false,
  soTien: 800_000,
  may: "QTTFBKATK",
  tuLuc: "2026-10-09T13:23:00+07:00",
  cau: null,
});

describe("[HNG-R3] bước 'Chọn giao dịch của khách' ⊥ nút huỷ", () => {
  it("[HNG-R3] trong bước chọn KHÔNG có nút 'Huỷ phiếu thẻ'; 'Quay lại phiếu' trả nút huỷ về, và hộp xác nhận mở lại SẠCH", async () => {
    h.timUngVienSaiMaAction.mockResolvedValue(ketQuaTim([UV_CHO_KT]));
    dung(chuaThay);
    const hop = moHop();
    expect(within(hop).getByRole("button", { name: NUT_HUY }), "ĐỐI CHỨNG DƯƠNG: trước khi vào bước thì CÓ").toBeTruthy();

    fireEvent.click(within(hop).getByRole("button", { name: NUT_SAI_MA }));
    expect(await within(hop).findByText("Chọn giao dịch của khách")).toBeTruthy();
    expect(within(hop).queryByRole("button", { name: NUT_HUY }), "trong bước: khách ĐÃ quẹt, huỷ phiếu là việc ngược").toBeNull();
    expect(within(hop).queryByRole("button", { name: NUT_KIEM })).toBeNull();

    fireEvent.click(within(hop).getByRole("button", { name: /Quay lại phiếu/ }));
    const sau = screen.getByRole("dialog", { name: /Thu thẻ POS/ });
    expect(within(sau).getByRole("button", { name: NUT_HUY }), "quay lại ⇒ nút huỷ về").toBeTruthy();
    fireEvent.click(within(sau).getByRole("button", { name: NUT_HUY }));
    const xn = screen.getByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ });
    expect((within(xn).getByRole("checkbox", { name: TICK }) as HTMLInputElement).checked, "ô tick sạch").toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R4 — lượt huỷ ĐANG CHẠY: hộp ngoài không đóng được; việc khác trên cùng phiếu đứng yên
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HNG-R4] lượt huỷ đang chạy ⇒ hộp ngoài KHÔNG đóng được (kể cả bằng nút X) và 'Kiểm tra thanh toán' khoá", () => {
  it("[HNG-R4] action huỷ treo: bấm X của hộp ngoài không đóng, 'Kiểm tra' khoá; huỷ xong ⇒ X đóng được (đối chứng dương)", async () => {
    // Hàm giải phóng để ở thuộc tính (không phải `let`): TS thu hẹp `let x: T | undefined` thành `undefined` ở closure.
    const treo: { xong?: (v: unknown) => void } = {};
    h.huyPhieuTheAction.mockReturnValue(new Promise((r) => (treo.xong = r)));
    try {
      dung(chuaThay);
      const hop = moHop();
      fireEvent.click(within(hop).getByRole("button", { name: NUT_HUY }));
      const xn = screen.getByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ });
      fireEvent.click(within(xn).getByRole("radio", { name: "Khách đổi cách trả" }));
      fireEvent.click(within(xn).getByRole("checkbox", { name: TICK }));
      fireEvent.click(within(xn).getByRole("button", { name: NUT_XAC_NHAN }));
      await waitFor(() => expect(h.huyPhieuTheAction).toHaveBeenCalledTimes(1));

      // Hộp ngoài bị hộp xác nhận che nên nằm ngoài cây truy cập — chạm thẳng nút X của NÓ (`data-slot`) để mô phỏng việc đóng hộp ngoài.
      const dongNgoai = hop.querySelector<HTMLElement>('[data-slot="dialog-close"]');
      expect(dongNgoai, "hộp ngoài có nút X").not.toBeNull();
      fireEvent.click(dongNgoai!);
      expect(screen.getByRole("dialog", { name: /Thu thẻ POS/, hidden: true }), "đang huỷ ⇒ hộp ngoài vẫn mở").toBeTruthy();
      expect((within(hop).getByRole("button", { name: NUT_KIEM, hidden: true }) as HTMLButtonElement).disabled, "Kiểm tra khoá khi đang huỷ").toBe(true);

      treo.xong?.({ ok: true, intentId: "i1", code5: "H6WR4" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ })).toBeNull());
      await waitFor(() => expect(h.success).toHaveBeenCalledWith(CAU_DA_HUY_TOAST));
      // Đợi TÍN HIỆU THẬT rằng lượt huỷ đã hết (transition xong ⇒ `dangHuy` false ⇒ "Kiểm tra" mở khoá) rồi mới bấm X. Bấm ngay sau `toast.success` là ĐUA: toast gọi
      // TRƯỚC khi transition kết thúc, nên `dongDuoc` còn false thêm vài nhịp — máy chậm thì hộp không đóng và ca đỏ GIẢ (đo ở lượt cấy lỗi M5: đỏ ngoài tập).
      await waitFor(() =>
        expect((within(screen.getByRole("dialog", { name: /Thu thẻ POS/ })).getByRole("button", { name: NUT_KIEM }) as HTMLButtonElement).disabled).toBe(false),
      );
      // ĐỐI CHỨNG DƯƠNG: hết việc ⇒ nút X của hộp ngoài đóng được.
      const dongSau = screen.getByRole("dialog", { name: /Thu thẻ POS/ }).querySelector<HTMLElement>('[data-slot="dialog-close"]');
      expect(dongSau, "hộp ngoài vẫn còn nút X").not.toBeNull();
      fireEvent.click(dongSau!);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    } finally {
      treo.xong?.({ ok: false, error: "dọn ca test" }); // một transition treo rò sang ca sau (React 19 gộp async transition cùng làn) — xem `[HN4-U05]`
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R5 — sau huỷ: refresh đúng, state KHÔNG sống sót (router.refresh() không reset useState)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HNG-R5] sau huỷ ở hộp đã ghép: câu cũ không sống sót, nút của phiếu mở biến mất", () => {
  it("[HNG-R5] Kiểm tra ('Chưa thấy') → mở rồi đóng bước nhập sai mã → huỷ ⇒ trang mới (HUY): không 'Chưa thấy', không hai nút nguy hiểm, câu 'đã huỷ'", async () => {
    h.kiemTraPhieuPosAction.mockResolvedValue({
      ok: true,
      ketQua: { status: "CHO_QUET", doiTrangThai: false, thongDiep: CAU_CHUA_THAY, mucDo: "canh_bao", ketLuan: null, tuCache: false, kiemLuc: "2026-10-09T13:29:00+07:00" },
    });
    h.timUngVienSaiMaAction.mockResolvedValue(ketQuaTim([UV_CHO_KT]));
    const v = dung({});
    const hop = moHop();
    fireEvent.click(within(hop).getByRole("button", { name: NUT_KIEM }));
    expect(await within(hop).findByText(CAU_CHUA_THAY)).toBeTruthy();
    expect(within(hop).getByRole("button", { name: NUT_SAI_MA }), "ĐỐI CHỨNG DƯƠNG: có nút nhập sai mã trước khi huỷ").toBeTruthy();

    fireEvent.click(within(hop).getByRole("button", { name: NUT_SAI_MA }));
    await within(hop).findByText("Chọn giao dịch của khách");
    fireEvent.click(within(hop).getByRole("button", { name: /Quay lại phiếu/ }));

    fireEvent.click(within(screen.getByRole("dialog", { name: /Thu thẻ POS/ })).getByRole("button", { name: NUT_HUY }));
    const xn = screen.getByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ });
    fireEvent.click(within(xn).getByRole("radio", { name: "Khách đổi cách trả" }));
    fireEvent.click(within(xn).getByRole("checkbox", { name: TICK }));
    fireEvent.click(within(xn).getByRole("button", { name: NUT_XAC_NHAN }));
    await waitFor(() => expect(h.success).toHaveBeenCalledWith(CAU_DA_HUY_TOAST));
    expect(h.refresh, "lượt huỷ làm mới thêm đúng MỘT lần (lượt Kiểm tra trước đó đã làm mới một lần)").toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ })).toBeNull());

    // Máy chủ trả trang mới: phiếu thẻ đã HUY, phiếu gộp hết thẻ mở. (Hàng thô HUY mang CÂU LƯU CŨ "Chưa thấy…" — view phải nói theo trạng thái.)
    v.lamMoi({ status: "HUY", ...chuaThay }, { phieuGop: phieuGop({ theDangMo: null }) });
    const sau = screen.getByRole("dialog", { name: /Thu thẻ POS/ });
    expect(within(sau).queryByText(CAU_CHUA_THAY), "câu của lượt Kiểm tra cũ phải biến mất").toBeNull();
    expect(within(sau).getByText(CAU_PHIEU_THE_DA_HUY)).toBeTruthy();
    expect(nhin(sau)).toEqual(nhinLa(false, false, false, false, false));
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R6 — câu máy chủ "Đang chờ quẹt thẻ cho mã này — huỷ phiếu thẻ trước" chỉ tới nút THẬT (trong hộp đã ghép)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HNG-R6] câu chặn 'Huỷ phiếu' của phiếu gộp chỉ đường mà hộp đã ghép THẬT SỰ có", () => {
  const CAU_CO_NUT = "Đang chờ quẹt thẻ cho mã này — huỷ phiếu thẻ trước (bấm “Thẻ · đang chờ” ở dòng đợt, rồi “Huỷ phiếu thẻ”).";

  it("[HNG-R6] 'Chưa thấy' (huỷ được): panel QR chỉ tới nút ⇒ đi theo thì CÓ nút huỷ — và nó đứng cạnh nút nhập sai mã với câu phân biệt", () => {
    dung(chuaThay);
    fireEvent.click(screen.getByRole("button", { name: /QR · H6WR4/ }));
    expect(screen.getByText(CAU_CO_NUT)).toBeTruthy();
    const hop = moHop();
    expect(nhin(hop)).toEqual(nhinLa(true, true, true, false, true, false, true));
  });

  it("[HNG-R6b] (VIỆC 6 · a2 viết lại) kế toán đã TỪ CHỐI và huỷ ĐƯỢC: panel QR chỉ tới nút ⇒ đi theo thì CÓ nút huỷ trong hộp — lời hứa của panel khớp cái hộp vẽ (bài học V4.9)", () => {
    for (const p of [{ ...chuaThay, saiMaYeuCau: yeuCau("TU_CHOI") }, { lastResultKind: "NOT_FOUND" as const, lastResultMessage: CAU_SAU_TU_CHOI, saiMaYeuCau: yeuCau("TU_CHOI") }]) {
      // `cleanup()` của RTL (gỡ cây React + hộp thoại portal), KHÔNG `document.body.innerHTML = ""` giữa ca: xoá thân trang khi cây React còn gắn làm `afterEach` của RTL ném
      // "The node to be removed is not a child of this node" và kéo đỏ cả các ca đứng sau (đo lần chạy đầu của VIỆC 6 · a2).
      cleanup();
      dung(p);
      fireEvent.click(screen.getByRole("button", { name: /QR · H6WR4/ }));
      expect(screen.getByText(CAU_CO_NUT), "panel QR chỉ tới nút thật").toBeTruthy();
      const hop = moHop();
      expect(within(hop).getByRole("button", { name: NUT_HUY }), "…và hộp CÓ nút").toBeTruthy();
      expect(within(hop).getByRole("alert").textContent, "lệnh cấm của kế toán vẫn nằm ở hộp").toContain("ĐỪNG cho khách quẹt lại");
    }
  });

  it("[HNG-R6c] kế toán đã TỪ CHỐI nhưng huỷ KHÔNG được (còn dòng thẻ mang mã chưa ngã ngũ): panel QR KHÔNG hứa nút, nói lý do ⇒ hộp cũng KHÔNG có nút và không cãi lại", () => {
    dung({ ...chuaThay, saiMaYeuCau: yeuCau("TU_CHOI"), coDongTheChuaKetLuan: true });
    fireEvent.click(screen.getByRole("button", { name: /QR · H6WR4/ }));
    const cap = ghepCauTuChoiHuy(CAU_TU_CHOI_HUY_PHIEU_THE.DONG_THE_CHUA_NGA_NGU);
    expect(screen.getByText(`Đang chờ quẹt thẻ cho mã này — chưa huỷ được mã, và phiếu thẻ cũng chưa huỷ được: ${cap}`)).toBeTruthy();
    expect(screen.queryByText(CAU_CO_NUT), "không chỉ tới một nút không có").toBeNull();
    const hop = moHop();
    expect(within(hop).queryByRole("button", { name: NUT_HUY })).toBeNull();
    expect(within(hop).getByRole("alert").textContent, "lệnh cấm của kế toán nằm ở hộp").toContain("ĐỪNG cho khách quẹt lại");
    expect(within(hop).queryByText(/^Chưa huỷ được phiếu thẻ/), "không dòng lý do thứ hai dưới dòng đỏ").toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R10 — VIỆC 6 · a2: HUỶ SAU TỪ CHỐI (chủ dự án chốt 10/10/2026) — hộp đi trọn đường: từ chối → nút quay lại → huỷ → cảnh báo cấp đơn còn trên màn
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HNG-R10] huỷ SAU khi kế toán từ chối: nút quay lại, bấm được đến cùng, và giữa lúc huỷ với lúc mở phiếu mới vẫn còn lời nhắc 'ĐỪNG quẹt lại'", () => {
  it("[HNG-R10a] ngay sau từ chối: hộp có nút huỷ ⇒ chọn lý do + tick ⇒ `huyPhieuTheAction` nhận ĐÚNG intentId · lý do · tick; ĐỐI CHỨNG: dòng đỏ + KHÔNG bốn bước + KHÔNG 'Chép số/Chép mã' ở cả trước lẫn sau khi mở hộp xác nhận", async () => {
    dung({ lastResultKind: "NOT_FOUND", lastResultMessage: CAU_SAU_TU_CHOI, saiMaYeuCau: yeuCau("TU_CHOI") });
    const hop = moHop();
    expect(within(hop).queryByText("Nhập số tiền vào máy."), "sau từ chối không mời quẹt lại").toBeNull();
    expect(within(hop).queryByRole("button", { name: /Chép số|Chép mã/ }), "…và không dụ chép số / mã vào máy").toBeNull();
    fireEvent.click(within(hop).getByRole("button", { name: NUT_HUY }));
    const xn = screen.getByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ });
    // Xác nhận MẠNH vẫn bắt buộc (mọi ca cho huỷ đều đòi tick — V4.3): chưa tick thì nút xác nhận khoá.
    expect((within(xn).getByRole("button", { name: NUT_XAC_NHAN }) as HTMLButtonElement).disabled, "chưa chọn lý do / chưa tick ⇒ khoá").toBe(true);
    fireEvent.click(within(xn).getByRole("radio", { name: "Khách đổi cách trả" }));
    expect((within(xn).getByRole("button", { name: NUT_XAC_NHAN }) as HTMLButtonElement).disabled, "có lý do mà chưa tick ⇒ vẫn khoá").toBe(true);
    fireEvent.click(within(xn).getByRole("checkbox", { name: TICK }));
    fireEvent.click(within(xn).getByRole("button", { name: NUT_XAC_NHAN }));
    await waitFor(() => expect(h.huyPhieuTheAction).toHaveBeenCalledTimes(1));
    expect(h.huyPhieuTheAction).toHaveBeenCalledWith({ orderId: "o1", intentId: "i1", lyDo: "KHACH_DOI_CACH_TRA", xacNhanKhachChuaQuet: true });
    await waitFor(() => expect(h.success).toHaveBeenCalledWith(CAU_DA_HUY_TOAST));
    expect(h.refresh, "huỷ xong làm mới trang đúng một lần").toHaveBeenCalledTimes(1);
  });

  it("[HNG-R10b] máy chủ vẫn từ chối (giữa lúc dựng màn và lúc bấm, kế toán / poller đã đổi sự thật) ⇒ toast lỗi nguyên văn + làm mới trang; phiếu CÒN MỞ nên nút KHÔNG biến mất", async () => {
    h.huyPhieuTheAction.mockResolvedValue({ ok: false, error: ghepCauTuChoiHuy(CAU_TU_CHOI_HUY_PHIEU_THE.DONG_THE_CHUA_NGA_NGU) });
    dung({ lastResultKind: "NOT_FOUND", lastResultMessage: CAU_SAU_TU_CHOI, saiMaYeuCau: yeuCau("TU_CHOI") });
    const hop = moHop();
    fireEvent.click(within(hop).getByRole("button", { name: NUT_HUY }));
    const xn = screen.getByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ });
    fireEvent.click(within(xn).getByRole("radio", { name: "Mở nhầm / nhập nhầm số tiền" }));
    fireEvent.click(within(xn).getByRole("checkbox", { name: TICK }));
    fireEvent.click(within(xn).getByRole("button", { name: NUT_XAC_NHAN }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith(ghepCauTuChoiHuy(CAU_TU_CHOI_HUY_PHIEU_THE.DONG_THE_CHUA_NGA_NGU)));
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ })).toBeNull());
    // Hộp xác nhận đóng (`datMo(false)`) TRƯỚC khi transition của lượt huỷ kết thúc, nên ngay lúc đó nút còn ghi "Đang huỷ…" — chờ nó trở lại nhãn "Huỷ phiếu thẻ" (nút KHÔNG biến mất: phiếu còn mở).
    await waitFor(() =>
      expect(within(screen.getByRole("dialog", { name: /Thu thẻ POS/ })).getByRole("button", { name: NUT_HUY }), "props chưa đổi ⇒ nút còn đó để thử lại").toBeTruthy(),
    );
  });

  it("[HNG-R10c] SAU HUỶ của đơn đã có vết bác: hộp HUY mang ĐÚNG MỘT cảnh báo cấp đơn 'ĐỪNG cho khách quẹt lại' (không còn dòng đỏ của yêu cầu — phiếu đã đóng); ĐỐI CHỨNG: đơn sạch ⇒ không cảnh báo", () => {
    // Trước VIỆC 6 cổng huỷ chặn huỷ-sau-từ-chối nên lệnh cấm luôn còn trên màn tới khi phiếu hết hạn; nay sale huỷ được, hộp đổi sang 'Phiếu thu thẻ đã huỷ… Thu thẻ lại thì mở phiếu mới'
    // và khoảng GIỮA huỷ với mở phiếu mới không còn gì nhắc. `donDaCoVetBac` theo ĐƠN nên view của phiếu HUY mang nó.
    const v = dung({ ...chuaThay, saiMaYeuCau: yeuCau("TU_CHOI"), donDaCoVetBac: true });
    const truoc = moHop();
    expect(within(truoc).getAllByRole("alert"), "TRƯỚC huỷ: đúng MỘT lệnh cấm — dòng đỏ của yêu cầu (cảnh báo cấp đơn nhường chỗ, không in hai lần)").toHaveLength(1);
    expect(within(truoc).queryByText(CAU_DON_DA_CO_VET_BAC)).toBeNull();

    // Máy chủ trả trang mới sau khi huỷ: phiếu HUY (hàng thô mang CÂU LƯU CŨ), đơn VẪN có vết bác. Hộp ngoài đang mở nên lên thẳng trạng thái 'đã huỷ'.
    v.lamMoi({ status: "HUY", donDaCoVetBac: true, saiMaYeuCau: yeuCau("TU_CHOI"), ...chuaThay }, { phieuGop: phieuGop({ theDangMo: null }) });
    const hop = screen.getByRole("dialog", { name: /Thu thẻ POS/ });
    expect(within(hop).getByText(CAU_PHIEU_THE_DA_HUY), "câu trạng thái của phiếu đã huỷ").toBeTruthy();
    expect(within(hop).getAllByRole("alert"), "đúng MỘT cảnh báo").toHaveLength(1);
    expect(within(hop).getByRole("alert").textContent).toBe(CAU_DON_DA_CO_VET_BAC);
    expect(nhin(hop), "không nút nào của phiếu mở").toEqual(nhinLa(false, false, false, false, false));

    // ĐỐI CHỨNG DƯƠNG: cùng phiếu HUY nhưng đơn SẠCH ⇒ không cảnh báo (huỷ một phiếu chưa từng dính vết bác không bị doạ).
    v.lamMoi({ status: "HUY", donDaCoVetBac: false, ...chuaThay }, { phieuGop: phieuGop({ theDangMo: null }) });
    const sau = screen.getByRole("dialog", { name: /Thu thẻ POS/ });
    expect(within(sau).queryByRole("alert")).toBeNull();
    expect(within(sau).queryByText(CAU_DON_DA_CO_VET_BAC)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R7 — RÀ ĐỐI KHÁNG BẢN GHÉP (10/10/2026): tiền có thể đang bay ⇒ câu ĐÚNG ở chỗ MẠNH, và hộp không mời quẹt
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HNG-R7] dấu hiệu tiền đang bay: lý do ở tông cảnh báo NGAY dưới câu trạng thái, TRƯỚC mọi nút; không bốn bước, không 'Chép'", () => {
  it("[HNG-R7] 'Chưa thấy' + dòng thẻ mang mã chưa ngã ngũ: khung cảnh báo đứng liền sau câu trạng thái (trước chân hộp), nói 'ĐỪNG cho khách quẹt lại'; bốn bước + 'Cùng mã với QR' + 'Chép số/Chép mã' đều ẩn", () => {
    dung({ ...chuaThay, coDongTheChuaKetLuan: true });
    const hop = moHop();
    const canh = hop.querySelector<HTMLElement>("[data-tien-dang-bay]");
    expect(canh, "có khung cảnh báo tiền đang bay").not.toBeNull();
    expect(canh!.getAttribute("role")).toBe("alert");
    expect(canh!.textContent).toContain("khách có thể đã bị trừ tiền");
    expect(canh!.textContent).toContain("ĐỪNG cho khách quẹt lại");
    expect(canh!.textContent, "tông cảnh báo không mang tiền tố 12px xám 'Chưa huỷ được…'").not.toMatch(/^Chưa huỷ được phiếu thẻ/);
    // Thứ tự đọc: câu trạng thái ("Chưa thấy…") TRƯỚC, khung cảnh báo SAU, chân hộp (nút) sau cùng.
    const trangThai = within(hop).getByText(CAU_CHUA_THAY);
    expect(trangThai.compareDocumentPosition(canh!) & Node.DOCUMENT_POSITION_FOLLOWING, "khung cảnh báo đứng SAU câu trạng thái").toBeTruthy();
    const chanHop = hop.querySelector('[data-slot="dialog-footer"]')!;
    expect(canh!.compareDocumentPosition(chanHop) & Node.DOCUMENT_POSITION_FOLLOWING, "…và TRƯỚC chân hộp").toBeTruthy();
    expect(canh!.closest('[data-slot="dialog-footer"]')).toBeNull();
    // Không mời quẹt, không dụ chép số / mã vào máy.
    expect(within(hop).queryByText("Nhập số tiền vào máy.")).toBeNull();
    expect(within(hop).queryByText("Cùng mã với QR chuyển khoản")).toBeNull();
    expect(within(hop).queryByRole("button", { name: /Chép số|Chép mã/ })).toBeNull();
    // Việc hằng ngày vẫn còn: bấm Kiểm tra để chốt kết quả (ĐỐI CHỨNG DƯƠNG ở ca R7b bên dưới).
    expect(within(hop).queryByRole("button", { name: NUT_KIEM })).toBeTruthy();
  });

  it("[HNG-R7b] ĐỐI CHỨNG DƯƠNG: phiếu 'Chưa thấy' trần ⇒ KHÔNG khung cảnh báo tiền đang bay; bốn bước + 'Chép số' + 'Chép mã' có đủ", () => {
    dung(chuaThay);
    const hop = moHop();
    expect(hop.querySelector("[data-tien-dang-bay]")).toBeNull();
    expect(within(hop).getByText("Nhập số tiền vào máy.")).toBeTruthy();
    expect(within(hop).getByRole("button", { name: /Chép số/ })).toBeTruthy();
    expect(within(hop).getByRole("button", { name: /Chép mã/ })).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R8 — cửa sổ "đang huỷ, trang chưa về": props còn là phiếu CHO_QUET cũ
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HNG-R8] đang huỷ (transition còn giữ, trang chưa về) ⇒ hộp KHÔNG mời quẹt, KHÔNG mời 'Tôi nhập sai mã', KHÔNG dụ chép số / mã", () => {
  it("[HNG-R8] action huỷ treo: bốn bước biến mất, 'Tôi nhập sai mã' biến mất, 'Chép' biến mất, 'Kiểm tra' khoá; huỷ lỗi (đối chứng) ⇒ tất cả TRỞ LẠI", async () => {
    const treo: { xong?: (v: unknown) => void } = {};
    h.huyPhieuTheAction.mockReturnValue(new Promise((r) => (treo.xong = r)));
    try {
      dung(chuaThay);
      const hop = moHop();
      // Trước khi huỷ: đầy đủ (đối chứng dương).
      expect(within(hop).getByText("Nhập số tiền vào máy.")).toBeTruthy();
      expect(within(hop).getByRole("button", { name: NUT_SAI_MA })).toBeTruthy();
      expect(within(hop).getByRole("button", { name: /Chép mã/ })).toBeTruthy();

      fireEvent.click(within(hop).getByRole("button", { name: NUT_HUY }));
      const xn = screen.getByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ });
      fireEvent.click(within(xn).getByRole("radio", { name: "Khách đổi cách trả" }));
      fireEvent.click(within(xn).getByRole("checkbox", { name: TICK }));
      fireEvent.click(within(xn).getByRole("button", { name: NUT_XAC_NHAN }));
      await waitFor(() => expect(h.huyPhieuTheAction).toHaveBeenCalledTimes(1));

      // Hộp ngoài bị hộp xác nhận che nên nằm ngoài cây truy cập — đọc với `hidden: true`.
      const ngoai = screen.getByRole("dialog", { name: /Thu thẻ POS/, hidden: true });
      expect(within(ngoai).queryByText("Nhập số tiền vào máy."), "không mời quẹt khi đang huỷ").toBeNull();
      expect(within(ngoai).queryByRole("button", { name: NUT_SAI_MA, hidden: true }), "máy chủ chắc chắn từ chối (phiếu không còn chờ quẹt) ⇒ không vẽ").toBeNull();
      expect(within(ngoai).queryByRole("button", { name: /Chép số|Chép mã/, hidden: true })).toBeNull();
      expect((within(ngoai).getByRole("button", { name: NUT_KIEM, hidden: true }) as HTMLButtonElement).disabled).toBe(true);
    } finally {
      treo.xong?.({ ok: false, error: "dọn ca test" });
    }
    // Huỷ bị từ chối ⇒ phiếu vẫn mở ⇒ các lối TRỞ LẠI (không để hộp trống vĩnh viễn sau một lần huỷ hỏng).
    await waitFor(() => expect(h.error).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Huỷ phiếu thẻ mã H6WR4/ })).toBeNull());
    await waitFor(() => {
      const sau = screen.getByRole("dialog", { name: /Thu thẻ POS/ });
      expect(within(sau).getByText("Nhập số tiền vào máy.")).toBeTruthy();
      expect(within(sau).getByRole("button", { name: NUT_SAI_MA })).toBeTruthy();
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R9 — bước 'Chọn giao dịch' KHÔNG kẹt khi trang mới về với phiếu đã đóng
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("[HNG-R9] bước 'Chọn giao dịch' nhường chỗ cho câu trạng thái khi phiếu (cùng intentId) đã rời trạng thái chờ quẹt", () => {
  it("[HNG-R9] mở bước chọn → trang về với phiếu HUY (cùng intentId): hộp nói 'Phiếu thu thẻ đã huỷ', KHÔNG kẹt ở bước chọn; ĐỐI CHỨNG: phiếu còn CHO_QUET thì bước chọn GIỮ", async () => {
    h.timUngVienSaiMaAction.mockResolvedValue(ketQuaTim([UV_CHO_KT]));
    const v = dung(chuaThay);
    const hop = moHop();
    fireEvent.click(within(hop).getByRole("button", { name: NUT_SAI_MA }));
    expect(await within(hop).findByText("Chọn giao dịch của khách")).toBeTruthy();

    // Đối chứng dương: trang về mà phiếu VẪN chờ quẹt (ví dụ làm mới vì lý do khác) ⇒ bước chọn ở nguyên.
    v.lamMoi({ ...chuaThay, lastCheckAt: new Date(BAY_GIO.getTime() - 2 * PHUT) });
    expect(screen.getByText("Chọn giao dịch của khách"), "phiếu còn chờ quẹt ⇒ bước chọn giữ").toBeTruthy();

    // Trang về với phiếu đã HUY (huỷ ở tab khác / người khác) — CÙNG intentId.
    v.lamMoi({ status: "HUY", ...chuaThay }, { phieuGop: phieuGop({ theDangMo: null }) });
    const sau = screen.getByRole("dialog", { name: /Thu thẻ POS/ });
    expect(within(sau).queryByText("Chọn giao dịch của khách"), "không kẹt ở bước chọn").toBeNull();
    expect(within(sau).getByText(CAU_PHIEU_THE_DA_HUY)).toBeTruthy();
  });
});
