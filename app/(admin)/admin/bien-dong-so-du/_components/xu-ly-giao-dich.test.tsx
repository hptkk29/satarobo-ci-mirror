// @vitest-environment jsdom
/**
 * Ca [GTB-UI1..UI3] — VIỆC 6 · MỤC 1 (a1), phần MÀN: ô "Gắn vào đơn" của một giao dịch UNMATCHED (`XuLyGiaoDich`) BÁO TRƯỚC, ngay ở bước chọn đơn, khi kế toán đã bác giao dịch này cho đơn
 * vừa chọn — thay vì mở bảng chia, để người ta gõ xong số tiền rồi mới nghe "không gắn được" ở nút Lưu (luật 12: không hứa suông).
 *
 * Vì sao có test HÀNH VI bên cạnh lưới đọc mã `[GTB-W5c]`: lưới ấy chỉ đếm chữ `taiChiTietDonDeGan(…, bankTransactionId)` trong tệp. Việc màn có THẬT SỰ gửi giao dịch đang gắn lên máy chủ,
 * và có THẬT SỰ nói câu từ chối thay vì mở bảng chia, chỉ đo được khi dựng màn thật và bấm nút thật. Hai chỗ gọi nên mỗi chỗ một ca:
 *   · `chonDon` (bấm một đơn trong danh sách gợi ý)                    — UI1 (đơn đã bị bác ⇒ nói câu từ chối, KHÔNG mở bảng chia) · UI2 (đối chứng dương: đơn khác ⇒ mở bảng chia, không toast lỗi)
 *   · `taiLaiChiTiet` (nạp lại bảng chia sau khi "Tạo đợt" tại chỗ)    — UI3
 *
 * Máy chủ được thay bằng hàm giả (`../_actions`, `../_gan-theo-con`): cổng THẬT (đọc vết bác DƯỚI khoá đơn, từ chối TRƯỚC phép ghi đầu tiên) đã nằm ở `tests/finance/pos-ban-tay-bi-bac.test.ts`
 * (`[GTB-DB-11]` đo chính action báo trước bằng Postgres thật). Ở đây chỉ đo phần của MÀN: gửi gì lên, và làm gì với câu trả lời.
 *
 * Mỗi ca chạy được MỘT MÌNH (luật 18): không đồng hồ thật (luật 19), không trạng thái chung — `beforeEach` dọn mock và <body>.
 */
import { Component, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Các ca [P7-3x]/[P7-PR] chờ tới 10 s (`findBy…`/`waitFor`) vì transition async của React 19 chậm khi máy tải; trần mặc định 5 s làm chúng đỏ GIẢ
// (đo khi cấy lỗi tuần tự: ca vô can [P7-31]/[P7-32] timeout ở 5 s rồi xanh khi chạy lại). Nâng trần, không đổi ca nào.
vi.setConfig({ testTimeout: 25_000 });

const h = vi.hoisted(() => ({
  timDonDeGan: vi.fn(),
  boQuaGiaoDich: vi.fn(),
  ganGiaoDichVaoDon: vi.fn(),
  taiChiTietDonDeGan: vi.fn(),
  ganGiaoDichTheoConAction: vi.fn(),
  taoDotChoConTaiChoAction: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: h.success, error: h.error } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
// Hai tệp "use server" kéo auth/DB — không thuộc ca này. Màn gọi chúng bằng ĐÚNG hai specifier dưới đây.
vi.mock("../_actions", () => ({ timDonDeGan: h.timDonDeGan, boQuaGiaoDich: h.boQuaGiaoDich, ganGiaoDichVaoDon: h.ganGiaoDichVaoDon }));
vi.mock("../_gan-theo-con", () => ({
  taiChiTietDonDeGan: h.taiChiTietDonDeGan,
  ganGiaoDichTheoConAction: h.ganGiaoDichTheoConAction,
  taoDotChoConTaiChoAction: h.taoDotChoConTaiChoAction,
}));

import type { DonUngVien } from "../_actions";
import type { ChiTietDonDeGan } from "../_gan-theo-con";
import { XuLyGiaoDich } from "./xu-ly-giao-dich";

const BT = "bt-x";
const SO_TIEN = 3_168_000;
/** Chữ nguyên văn của `CAU_GAN_TAY_DA_BI_BAC` (lib/finance/ghi-tien-don.ts) — màn chỉ chuyển tiếp chuỗi máy chủ trả về, nên ở đây là một chuỗi bất kỳ nhận ra được. */
const CAU_TU_CHOI = "Kế toán đã từ chối giao dịch này cho đơn này nên bạn không gắn được — nhờ kế toán xử lý.";

const donBac: DonUngVien = {
  id: "don-bac",
  code: "ORD-269979-000301",
  customerName: "Phụ huynh Một",
  studentName: "Bé Một",
  customerPhone: "0905123456",
  courseName: "Sata 3",
  conThieu: SO_TIEN,
  phieuId: "pr-1",
  soDot: 1,
};
const donKhac: DonUngVien = { ...donBac, id: "don-khac", code: "ORD-269979-000302", studentName: "Bé Hai", customerPhone: "0905123457" };

const chiTietDonKhac = (p: Partial<ChiTietDonDeGan> = {}): ChiTietDonDeGan => ({
  orderId: "don-khac",
  code: "ORD-269979-000302",
  kieuMoi: true,
  donPhamVi: false,
  con: [{ orderItemId: "oi-1", ten: "Bé Hai", khoa: "Sata 3", conNo: SO_TIEN, dot: [] }],
  dotChungChuaChiaCon: [],
  chuaGanCon: 0,
  ...p,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Luật 18: một ca đỏ giữa chừng không được để lại DOM cho ca sau (cùng nếp với khu-sai-ma-pos.test.tsx).
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
  // Ô tìm đơn được ĐỔ SẴN nội dung CK của giao dịch và tìm luôn ⇒ cả hai đơn hiện ngay như gợi ý (đúng cảnh thật: đơn đã bị bác vẫn có thể nằm trong gợi ý).
  h.timDonDeGan.mockResolvedValue([donBac, donKhac]);
  h.taiChiTietDonDeGan.mockResolvedValue(chiTietDonKhac());
  h.taoDotChoConTaiChoAction.mockResolvedValue({ ok: true, message: "Đã tạo đợt." });
});

/** Dựng màn, bấm "Gắn vào đơn", đợi hai đơn gợi ý hiện ra. */
async function moDanhSachDon() {
  render(<XuLyGiaoDich bankTransactionId={BT} amount={SO_TIEN} goiY="K7M2N" />);
  fireEvent.click(screen.getByRole("button", { name: "Gắn vào đơn" }));
  await screen.findByText(donBac.code);
  await screen.findByText(donKhac.code);
}

/** Như `chonDonTrongDanhSach` nhưng CHỜ nút mở (danh sách có thể hiện khi lượt tìm chưa xong — xem [P7-33]). */
async function chonDonKhiMo(code: string) {
  await bamKhiMo(screen.getByText(code).closest("button")!);
}

/** Bấm vào dòng gợi ý của một đơn (cả dòng là một nút). Chỉ dùng trong vòng `waitFor` (tự bấm lại). */
function chonDonTrongDanhSach(code: string) {
  const nut = screen.getByText(code).closest("button");
  if (!nut) throw new Error(`không thấy nút của đơn ${code}`);
  fireEvent.click(nut);
}

describe("[GTB-UI] ô 'Gắn vào đơn' báo trước ở bước chọn đơn — dựng màn thật, bấm nút thật", () => {
  it("[GTB-UI1] chọn đơn mà kế toán đã bác giao dịch này ⇒ gửi (đơn, GIAO DỊCH ĐANG GẮN) lên máy chủ, nói đúng câu máy chủ trả, KHÔNG mở bảng chia và vẫn ở danh sách đơn", async () => {
    h.taiChiTietDonDeGan.mockResolvedValueOnce({ error: CAU_TU_CHOI });
    await moDanhSachDon();

    await chonDonKhiMo(donBac.code);

    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
    // Gửi ĐÚNG giao dịch đang gắn: thiếu đối số này thì máy chủ không có gì để báo trước (và `tsc` chỉ bắt thiếu, không bắt chuỗi rỗng).
    expect(h.taiChiTietDonDeGan).toHaveBeenCalledTimes(1);
    expect(h.taiChiTietDonDeGan).toHaveBeenCalledWith("don-bac", BT);
    expect(h.error).toHaveBeenCalledWith(CAU_TU_CHOI);
    expect(h.success).not.toHaveBeenCalled();
    // KHÔNG mở bảng chia — cũng không mở nhầm panel "cờ tắt" bằng một đối tượng lỗi (`{ error }` không có `kieuMoi`).
    expect(screen.queryByText(/cho từng con/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Rót vào đơn" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ghi phân bổ" })).toBeNull();
    // Người dùng vẫn ở danh sách đơn và chọn được đơn khác.
    expect(screen.getByText(donKhac.code)).toBeTruthy();
  });

  it("[GTB-UI2] ĐỐI CHỨNG DƯƠNG, cùng cảnh đổi đúng một yếu tố: chọn đơn KHÁC (giao dịch này chưa bị bác cho nó) ⇒ cũng gửi giao dịch đang gắn, KHÔNG toast lỗi, mở bảng chia", async () => {
    await moDanhSachDon();

    await chonDonKhiMo(donKhac.code);

    await screen.findByText(/cho từng con/);
    expect(h.taiChiTietDonDeGan).toHaveBeenCalledTimes(1);
    expect(h.taiChiTietDonDeGan).toHaveBeenCalledWith("don-khac", BT);
    expect(h.error).not.toHaveBeenCalled();
    // Chờ CHÍNH nút: chữ "cho từng con" hiện trước khi nút xong nhãn cuối — dưới tải (cả bộ unit / CI
    // gương) `getByRole` hụt. Lỏng đo 11/10/2026: đỏ ở gương PR #607, xanh 3/3 khi chạy riêng.
    expect(await screen.findByRole("button", { name: "Ghi phân bổ" })).toBeTruthy();
  });

  it("[GTB-UI3] chỗ gọi thứ hai: sau khi 'Tạo đợt' tại chỗ, màn nạp LẠI bảng chia và lần này cũng gửi giao dịch đang gắn", async () => {
    await moDanhSachDon();
    await chonDonKhiMo(donKhac.code);
    await screen.findByText(/cho từng con/);
    expect(h.taiChiTietDonDeGan).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Tạo đợt cho Bé Hai/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Tạo đợt" }));

    await waitFor(() => expect(h.taiChiTietDonDeGan).toHaveBeenCalledTimes(2));
    expect(h.taoDotChoConTaiChoAction).toHaveBeenCalledTimes(1);
    expect(h.taiChiTietDonDeGan).toHaveBeenNthCalledWith(2, "don-khac", BT);
  });
});

describe("[P-D-13] cổng D — đơn theo PHẠM VI HỌC không chia đợt thu: nút 'Tạo đợt cho…' trên màn gắn giao dịch", () => {
  it("[P-D-13a] đơn phạm vi: KHÔNG có nút 'Tạo đợt cho…', màn nói đúng lý do (cùng câu máy chủ từ chối); bảng chia VẪN mở (đối chứng: màn có render)", async () => {
    h.taiChiTietDonDeGan.mockResolvedValueOnce(chiTietDonKhac({ donPhamVi: true }));
    await moDanhSachDon();
    await chonDonKhiMo(donKhac.code);
    await screen.findByText(/cho từng con/);
    expect(await screen.findByRole("button", { name: "Ghi phân bổ" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Tạo đợt cho Bé Hai/ })).toBeNull();
    expect(screen.getByText("Đơn theo phạm vi học không dùng kế hoạch thanh toán nhiều đợt.")).toBeTruthy();
  });

  it("[P-D-13b] ĐỐI CHỨNG DƯƠNG — đơn thường: nút 'Tạo đợt cho…' VẪN có, không có câu lý do", async () => {
    await moDanhSachDon();
    await chonDonKhiMo(donKhac.code);
    await screen.findByText(/cho từng con/);
    expect(await screen.findByRole("button", { name: /Tạo đợt cho Bé Hai/ })).toBeTruthy();
    expect(screen.queryByText("Đơn theo phạm vi học không dùng kế hoạch thanh toán nhiều đợt.")).toBeNull();
  });
});

// ── [P7] Lời gọi ĐỌC/GHI của panel rớt giữa chừng KHÔNG được sập cả trang ───────────────────────────────────────────────────
//
// Lỗi (đo trên test.satarobo.vn 13–14/10/2026): chọn một đơn (khung chia hiện ra) → "← Đổi đơn" → gõ vào ô tìm ⇒ trang báo "Có lỗi xảy ra / Thử lại / Về
// Dashboard". Các lời gọi máy chủ của panel chạy trong `startTransition(async …)`; React 19 ném lỗi của transition bất đồng bộ cho error boundary gần nhất,
// nên MỘT lời gọi tìm đơn rớt (tìm chạy sau MỖI phím gõ) là mất cả trang. Exception cụ thể ở máy chủ chưa đọc được (không có log) — test dựng LỚP lỗi:
// "lời gọi máy chủ từ chối" → panel phải giữ nguyên và nói bằng lời, KHÔNG để lọt lên boundary.
class BienLoi extends Component<{ children: ReactNode }, { loi: boolean }> {
  state = { loi: false };
  static getDerivedStateFromError() {
    return { loi: true };
  }
  render() {
    return this.state.loi ? <p data-testid="co-loi-xay-ra">Có lỗi xảy ra</p> : this.props.children;
  }
}

const dotMo = [{ paymentRequestId: "pr-1", installmentNo: 1, conLai: SO_TIEN, hanDong: null }];

/** Dựng panel TRONG error boundary, chọn đơn khác (khung chia hiện), bấm "← Đổi đơn" ⇒ trả ô tìm. */
async function doiDonRoiLayOTim() {
  render(
    <BienLoi>
      <XuLyGiaoDich bankTransactionId={BT} amount={SO_TIEN} goiY="K7M2N" />
    </BienLoi>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Gắn vào đơn" }));
  await screen.findByText(donKhac.code, {}, { timeout: 10_000 });
  // Bấm LẠI chừng nào khung chia chưa hiện: trên runner tải nặng (CI shard 3/3, 14/10) lượt bấm đầu không ăn và ca chờ cạn 10 giây.
  // Đó là nhiễu của bài đo, không phải hành vi cần canh; ca cần ĐẾM số lần nạp chi tiết gọi chonDonTrongDanhSach trực tiếp.
  await waitFor(
    () => {
      if (!screen.queryByText(/cho từng con/)) chonDonTrongDanhSach(donKhac.code);
      expect(screen.getByText(/cho từng con/)).toBeTruthy();
    },
    { timeout: 15_000, interval: 1_500 },
  );
  fireEvent.click(screen.getByRole("button", { name: /Đổi đơn/ }));
  return screen.getByPlaceholderText(/Mã đơn/) as HTMLInputElement;
}

const khongSapTrang = () => expect(screen.queryByTestId("co-loi-xay-ra")).toBeNull();

describe("[P7-3x] panel 'Gắn vào đơn': lời gọi máy chủ rớt không sập trang", () => {
  beforeEach(() => {
    // React ghi console.error cho mỗi lỗi lọt boundary — ồn, không phải kết quả đo.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("[P7-31] 'Đổi đơn' rồi gõ ô tìm mà máy chủ từ chối ⇒ KHÔNG sập trang, nói bằng lời; gõ tiếp thì phục hồi", async () => {
    const o = await doiDonRoiLayOTim();
    h.timDonDeGan.mockRejectedValueOnce(new Error("Failed to fetch"));

    fireEvent.change(o, { target: { value: "ab" } });

    expect(await screen.findByText(/Không kết nối được máy chủ/, {}, { timeout: 10_000 })).toBeTruthy();
    khongSapTrang();
    expect(screen.getByPlaceholderText(/Mã đơn/)).toBeTruthy(); // panel còn nguyên, ô tìm còn đó

    // Phục hồi: lượt gõ kế tiếp thành công ⇒ câu lỗi biến mất, kết quả hiện.
    fireEvent.change(o, { target: { value: "abc" } });
    expect(await screen.findByText(donBac.code, {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByText(/Không kết nối được máy chủ/)).toBeNull();
    khongSapTrang();
  });

  it("[P7-32] ĐỐI CHỨNG DƯƠNG: cùng cảnh 'Đổi đơn' rồi gõ, máy chủ TRẢ LỜI ⇒ kết quả hiện, không câu lỗi", async () => {
    const o = await doiDonRoiLayOTim();
    fireEvent.change(o, { target: { value: "ab" } });
    expect(await screen.findByText(donBac.code, {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.queryByText(/Không kết nối được máy chủ/)).toBeNull();
    khongSapTrang();
  });

  it("[P7-33] chọn đơn mà nạp chi tiết rớt ⇒ toast, vẫn ở danh sách đơn, KHÔNG sập trang", async () => {
    render(
      <BienLoi>
        <XuLyGiaoDich bankTransactionId={BT} amount={SO_TIEN} goiY="K7M2N" />
      </BienLoi>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Gắn vào đơn" }));
    await screen.findByText(donKhac.code, {}, { timeout: 10_000 });
    h.taiChiTietDonDeGan.mockRejectedValueOnce(new Error("Failed to fetch"));

    // Danh sách hiện TRƯỚC khi lượt tìm kết thúc (nút còn `disabled`) — click trần một lần bị nuốt ⇒ timeout 10 s trên runner
    // tải nặng (PR #752, 18/10/2026). Cấy giữ transition thêm 300 ms tái hiện đúng 10170 ms. Chờ nút mở rồi mới bấm.
    await chonDonKhiMo(donKhac.code);

    await waitFor(() => expect(h.error).toHaveBeenCalledWith(expect.stringMatching(/Không kết nối được máy chủ/)), { timeout: 10_000 });
    khongSapTrang();
    expect(screen.getByText(donKhac.code)).toBeTruthy();
    expect(screen.queryByText(/cho từng con/)).toBeNull();
  });

  it("[P7-34] GHI rớt giữa đường ('Ghi phân bổ') ⇒ KHÔNG sập trang, KHÔNG nói 'thất bại' (phép ghi có thể đã commit), tải lại số liệu", async () => {
    h.taiChiTietDonDeGan.mockResolvedValue(
      chiTietDonKhac({ con: [{ orderItemId: "oi-1", ten: "Bé Hai", khoa: "Sata 3", conNo: SO_TIEN, dot: dotMo }] }),
    );
    h.ganGiaoDichTheoConAction.mockRejectedValueOnce(new Error("Failed to fetch"));
    render(
      <BienLoi>
        <XuLyGiaoDich bankTransactionId={BT} amount={SO_TIEN} goiY="K7M2N" />
      </BienLoi>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Gắn vào đơn" }));
    await screen.findByText(donKhac.code, {}, { timeout: 10_000 });
    await chonDonKhiMo(donKhac.code); // cùng race với [P7-33]
    fireEvent.click(await screen.findByRole("button", { name: "đủ" }, { timeout: 10_000 }));
    const nutGhi = await screen.findByRole("button", { name: "Ghi phân bổ" }, { timeout: 10_000 });
    await waitFor(() => expect((nutGhi as HTMLButtonElement).disabled).toBe(false), { timeout: 10_000 });

    fireEvent.click(nutGhi);

    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    const cau = String(h.error.mock.calls[0]![0]);
    expect(cau).toMatch(/Chưa biết kết quả/);
    expect(cau).not.toMatch(/thất bại/i);
    expect(h.refresh).toHaveBeenCalled();
    khongSapTrang();
  });

  it("[P7-35] kết quả của lượt tìm CŨ về muộn KHÔNG ghi đè kết quả của lượt gõ mới", async () => {
    const o = await doiDonRoiLayOTim();
    let traLuotCu: (v: DonUngVien[]) => void = () => {};
    h.timDonDeGan.mockImplementationOnce(() => new Promise<DonUngVien[]>((r) => (traLuotCu = r)));
    h.timDonDeGan.mockResolvedValueOnce([donKhac]);

    fireEvent.change(o, { target: { value: "ab" } }); // lượt cũ — treo
    fireEvent.change(o, { target: { value: "abc" } }); // lượt mới — về ngay
    expect(await screen.findByText(donKhac.code, {}, { timeout: 10_000 })).toBeTruthy();

    await act(async () => {
      traLuotCu([donBac]); // lượt cũ về SAU
    });

    expect(screen.queryByText(donBac.code)).toBeNull();
    expect(screen.getByText(donKhac.code)).toBeTruthy();
  });

  it("[P7-36] máy chủ trả KHÔNG PHẢI mảng (undefined) ⇒ coi như không có đơn, KHÔNG sập trang", async () => {
    const o = await doiDonRoiLayOTim();
    h.timDonDeGan.mockResolvedValueOnce(undefined);

    fireEvent.change(o, { target: { value: "ab" } });

    expect(await screen.findByText(/Không có đơn nào đang chờ thu/, {}, { timeout: 10_000 })).toBeTruthy();
    khongSapTrang();
  });
});


// ═══ [P7-PR] Bao phủ nhánh lỗi / lượt / cổng chia hết của panel — vá các lỗ cấy lỗi độc lập (head 5c93fec60) ═══════════════════════════════════════
//
// Mỗi ca chạy được MỘT MÌNH (luật 18). Panel dựng TRONG error boundary thật: một catch ném lại lỗi ⇒ `co-loi-xay-ra`.
const T10 = { timeout: 10_000 };
const dongDotMo = (conLai: number) => [{ paymentRequestId: "pr-1", installmentNo: 1, conLai, hanDong: null }];
const chiTietCoDot = (conLai: number = SO_TIEN, p: Partial<ChiTietDonDeGan> = {}) =>
  chiTietDonKhac({ con: [{ orderItemId: "oi-1", ten: "Bé Hai", khoa: "Sata 3", conNo: SO_TIEN, dot: dongDotMo(conLai) }], ...p });

/** Một lời gọi treo, tự quyết lúc nào trả/lỗi. */
function treoTim() {
  let ok: (v: DonUngVien[]) => void = () => {};
  let loi: (e: unknown) => void = () => {};
  const p = new Promise<DonUngVien[]>((a, b) => {
    ok = a;
    loi = b;
  });
  return { p, ok, loi };
}

/** Dựng panel trong boundary, mở "Gắn vào đơn", đợi danh sách gợi ý. `xoaDanhSach` ⇒ xoá ô tìm để danh sách cũ không làm ca xanh giả. */
async function moTim(opts: { xoaDanhSach?: boolean; laKeToan?: boolean } = {}) {
  render(
    <BienLoi>
      <XuLyGiaoDich bankTransactionId={BT} amount={SO_TIEN} goiY="K7M2N" laKeToan={opts.laKeToan} />
    </BienLoi>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Gắn vào đơn" }));
  await screen.findByText(donKhac.code, {}, T10);
  const o = screen.getByPlaceholderText(/Mã đơn/) as HTMLInputElement;
  if (opts.xoaDanhSach) {
    fireEvent.change(o, { target: { value: "" } });
    await waitFor(() => expect(screen.queryByText(donKhac.code)).toBeNull(), T10);
  }
  return o;
}

/** Bấm một nút CHỈ KHI nó đã mở: nút của panel đóng (disabled) suốt transition đang chạy, và click vào nút đóng là mất — trên runner tải nặng ca đỏ vì đó. */
async function bamKhiMo(nut: HTMLElement) {
  await waitFor(() => expect((nut as HTMLButtonElement).disabled).toBe(false), T10);
  fireEvent.click(nut);
}

/** Chọn đơn khác (đã dặn `taiChiTietDonDeGan` trả gì ở ca gọi) ⇒ bảng chia hoặc panel cờ-tắt. */
async function moBangChia(chiTiet: ChiTietDonDeGan, laKeToan = false) {
  h.taiChiTietDonDeGan.mockResolvedValueOnce(chiTiet);
  await moTim({ laKeToan });
  // Bấm LẠI chừng nào chưa có lời gọi nạp chi tiết nào: trên runner tải nặng (CI shard 3/3, 14/10) lượt bấm đầu không ăn
  // (nút đang trong transition của lượt tìm) ⇒ ca chờ cạn 10 giây và kéo theo các ca sau. Chỉ bấm khi số lần gọi còn 0 ⇒ không bao giờ nạp đôi.
  await waitFor(
    () => {
      if (h.taiChiTietDonDeGan.mock.calls.length === 0) chonDonTrongDanhSach(donKhac.code);
      expect(h.taiChiTietDonDeGan).toHaveBeenCalledTimes(1);
    },
    { timeout: 15_000, interval: 1_500 },
  );
}

describe("[P7-PR] lượt tìm và nhánh lỗi của ô tìm", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("[P7-PR1a] lượt CŨ reject muộn KHÔNG ghi đè kết quả của lượt mới (không câu lỗi, danh sách còn)", async () => {
    const o = await moTim({ xoaDanhSach: true });
    const cu = treoTim();
    h.timDonDeGan.mockImplementationOnce(() => cu.p);
    h.timDonDeGan.mockResolvedValueOnce([donKhac]);
    fireEvent.change(o, { target: { value: "ab" } }); // lượt cũ — treo
    fireEvent.change(o, { target: { value: "abc" } }); // lượt mới — về ngay
    await screen.findByText(donKhac.code, {}, T10);

    await act(async () => {
      cu.loi(new Error("Failed to fetch")); // lượt cũ rớt SAU
    });

    expect(screen.queryByText(/Không kết nối được máy chủ/)).toBeNull();
    expect(screen.getByText(donKhac.code)).toBeTruthy();
    khongSapTrang();
  });

  it("[P7-PR1b] lượt mới đã rớt (câu lỗi hiện) rồi lượt CŨ resolve muộn ⇒ vẫn là câu lỗi của lượt mới, không có danh sách cũ", async () => {
    const o = await moTim({ xoaDanhSach: true });
    const cu = treoTim();
    h.timDonDeGan.mockImplementationOnce(() => cu.p);
    h.timDonDeGan.mockRejectedValueOnce(new Error("Failed to fetch"));
    fireEvent.change(o, { target: { value: "ab" } });
    fireEvent.change(o, { target: { value: "abc" } });
    // Lượt cũ còn treo ⇒ `dangChay` còn true và câu lỗi CHƯA hiện (nó chỉ hiện khi không còn lượt nào chạy): chờ lượt cũ về rồi mới đo.
    await screen.findByText(/Đang tìm/, {}, T10);

    await act(async () => {
      cu.ok([donBac]);
    });

    expect(await screen.findByText(/Không kết nối được máy chủ/, {}, T10)).toBeTruthy();
    expect(screen.queryByText(donBac.code)).toBeNull();
    khongSapTrang();
  });

  it("[P7-PR2] lượt cũ về muộn SAU KHI ô tìm đã xoá ⇒ KHÔNG hiện kết quả cũ (không sống lại)", async () => {
    const o = await moTim({ xoaDanhSach: true });
    const cu = treoTim();
    h.timDonDeGan.mockImplementationOnce(() => cu.p);
    fireEvent.change(o, { target: { value: "ab" } }); // lượt cũ — treo
    fireEvent.change(o, { target: { value: "" } }); // xoá ô: đáng lẽ HUỶ lượt cũ
    expect(screen.queryByText(donBac.code)).toBeNull();

    await act(async () => {
      cu.ok([donBac]);
    });

    expect(screen.queryByText(donBac.code)).toBeNull();
    expect(screen.queryByText(donKhac.code)).toBeNull();
    khongSapTrang();
  });

  it("[P7-PR3] câu lỗi tìm biến mất khi xoá ô", async () => {
    const o = await moTim({ xoaDanhSach: true });
    h.timDonDeGan.mockRejectedValueOnce(new Error("Failed to fetch"));
    fireEvent.change(o, { target: { value: "ab" } });
    await screen.findByText(/Không kết nối được máy chủ/, {}, T10);

    fireEvent.change(o, { target: { value: "" } });

    expect(screen.queryByText(/Không kết nối được máy chủ/)).toBeNull();
    khongSapTrang();
  });

  it("[P7-PR4] đang có danh sách rồi lượt tìm kế tiếp rớt ⇒ danh sách CŨ biến mất (không bấm nhầm đơn của lượt trước)", async () => {
    const o = await moTim(); // danh sách gợi ý (donBac + donKhac) đang hiện
    expect(screen.getByText(donBac.code)).toBeTruthy();
    h.timDonDeGan.mockRejectedValueOnce(new Error("Failed to fetch"));

    fireEvent.change(o, { target: { value: "ab" } });

    await screen.findByText(/Không kết nối được máy chủ/, {}, T10);
    expect(screen.queryByText(donBac.code)).toBeNull();
    expect(screen.queryByText(donKhac.code)).toBeNull();
    khongSapTrang();
  });
});

describe("[P7-PR] lời gọi GHI rớt ở các nhánh còn lại — nói 'chưa biết kết quả', tải lại, không sập trang", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const kiemGhiRot = async () => {
    await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1), T10);
    const cau = String(h.error.mock.calls[0]![0]);
    expect(cau).toMatch(/Chưa biết kết quả/);
    expect(cau).not.toMatch(/thất bại/i);
    khongSapTrang();
  };

  it("[P7-PR5] 'Rót vào đơn' (cờ tắt) rớt giữa đường ⇒ báo, refresh, panel còn", async () => {
    await moBangChia(chiTietDonKhac({ kieuMoi: false }));
    const nut = await screen.findByRole("button", { name: "Rót vào đơn" }, T10);
    h.ganGiaoDichVaoDon.mockRejectedValueOnce(new Error("Failed to fetch"));

    await bamKhiMo(nut);

    await kiemGhiRot();
    expect(h.refresh).toHaveBeenCalled();
    // findBy, không getBy: dưới tải nặng (hook commit chạy `vitest related` 20 luồng) panel còn đang
    // dựng lại sau `refresh` — chữ khẳng định KHÔNG đổi (nút vẫn phải có mặt), chỉ chờ nó có mặt.
    expect(await screen.findByRole("button", { name: "Rót vào đơn" }, T10)).toBeTruthy();
  });

  it("[P7-PR6] 'Xác nhận bỏ qua' rớt giữa đường ⇒ báo, refresh, không sập trang", async () => {
    render(
      <BienLoi>
        <XuLyGiaoDich bankTransactionId={BT} amount={SO_TIEN} goiY="K7M2N" laKeToan />
      </BienLoi>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Không phải học phí" }));
    fireEvent.change(screen.getByPlaceholderText(/tiền nhà/), { target: { value: "khách chuyển nhầm" } });
    h.boQuaGiaoDich.mockRejectedValueOnce(new Error("Failed to fetch"));

    fireEvent.click(screen.getByRole("button", { name: "Xác nhận bỏ qua" }));

    await kiemGhiRot();
    expect(h.refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Xác nhận bỏ qua" })).toBeTruthy();
  });

  it("[P7-PR7] 'Tạo đợt' tại chỗ rớt giữa đường ⇒ báo, nạp lại bảng chia (onXong), form đóng, không sập trang", async () => {
    await moBangChia(chiTietCoDot());
    fireEvent.click(await screen.findByRole("button", { name: /Tạo đợt cho Bé Hai/ }, T10));
    h.taoDotChoConTaiChoAction.mockRejectedValueOnce(new Error("Failed to fetch"));
    h.taiChiTietDonDeGan.mockClear();

    await bamKhiMo(await screen.findByRole("button", { name: "Tạo đợt" }, T10));

    await kiemGhiRot();
    await waitFor(() => expect(h.taiChiTietDonDeGan).toHaveBeenCalledTimes(1), T10); // onXong ⇒ nạp lại
    await waitFor(() => expect(screen.queryByRole("button", { name: "Tạo đợt" })).toBeNull(), T10);
    expect(screen.getByRole("button", { name: /Tạo đợt cho Bé Hai/ })).toBeTruthy();
  });

  it("[P7-PR8] nạp lại bảng chia sau 'Tạo đợt' rớt ⇒ toast, bảng chia còn nguyên, không sập trang", async () => {
    await moBangChia(chiTietCoDot());
    fireEvent.click(await screen.findByRole("button", { name: /Tạo đợt cho Bé Hai/ }, T10));
    h.taiChiTietDonDeGan.mockRejectedValueOnce(new Error("Failed to fetch"));

    await bamKhiMo(await screen.findByRole("button", { name: "Tạo đợt" }, T10)); // taoDot ok ⇒ onXong ⇒ taiLaiChiTiet rớt

    await waitFor(() => expect(h.error).toHaveBeenCalledWith(expect.stringMatching(/Không kết nối được máy chủ/)), T10);
    expect(h.taoDotChoConTaiChoAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/cho từng con/)).toBeTruthy();
    khongSapTrang();
  });
});

describe("[P7-PR] cổng 'chia hết' của nút Ghi phân bổ và lối tắt 'đủ'", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const nutGhi = () => screen.getByRole("button", { name: "Ghi phân bổ" }) as HTMLButtonElement;
  const oDot = () => screen.getByPlaceholderText("0") as HTMLInputElement;

  it("[P7-PR9] 'Ghi phân bổ' KHOÁ khi chưa nhập / thiếu / thừa, MỞ khi tổng đúng bằng số giao dịch", async () => {
    h.ganGiaoDichTheoConAction.mockResolvedValue({ ok: true, message: "Đã ghi." });
    await moBangChia(chiTietCoDot(SO_TIEN * 2));
    await screen.findByRole("button", { name: "Ghi phân bổ" }, T10);
    expect(nutGhi().disabled).toBe(true); // chưa nhập

    fireEvent.change(oDot(), { target: { value: "1000" } });
    expect(screen.getByText("Còn thiếu")).toBeTruthy();
    expect(nutGhi().disabled).toBe(true); // thiếu

    fireEvent.change(oDot(), { target: { value: String(SO_TIEN + 1) } });
    expect(screen.getByText("Đang thừa")).toBeTruthy();
    expect(nutGhi().disabled).toBe(true); // thừa 1đ

    fireEvent.change(oDot(), { target: { value: String(SO_TIEN) } });
    expect(screen.getByText("Khớp đủ")).toBeTruthy();
    expect(nutGhi().disabled).toBe(false); // khớp

    fireEvent.click(nutGhi());
    await waitFor(() => expect(h.ganGiaoDichTheoConAction).toHaveBeenCalledTimes(1), T10);
    expect(h.ganGiaoDichTheoConAction.mock.calls[0]![0]).toMatchObject({ dong: [{ paymentRequestId: "pr-1", soTien: SO_TIEN }] });
  });

  it("[P7-PR9b] tổng chia cho NHIỀU đợt cộng đúng mới mở nút (không chỉ xét ô cuối)", async () => {
    const dot2 = [
      { paymentRequestId: "pr-1", installmentNo: 1, conLai: SO_TIEN, hanDong: null },
      { paymentRequestId: "pr-2", installmentNo: 2, conLai: SO_TIEN, hanDong: null },
    ];
    await moBangChia(chiTietDonKhac({ con: [{ orderItemId: "oi-1", ten: "Bé Hai", khoa: "Sata 3", conNo: SO_TIEN * 2, dot: dot2 }] }));
    await screen.findByRole("button", { name: "Ghi phân bổ" }, T10);
    const [a, b] = screen.getAllByPlaceholderText("0") as HTMLInputElement[];
    fireEvent.change(a!, { target: { value: "1000000" } });
    fireEvent.change(b!, { target: { value: "1000000" } });
    expect(nutGhi().disabled).toBe(true); // 2.000.000 ≠ 3.168.000
    fireEvent.change(b!, { target: { value: String(SO_TIEN - 1_000_000) } });
    expect(nutGhi().disabled).toBe(false); // 1.000.000 + 2.168.000 = đúng
  });

  it("[P7-PR10a] lối tắt 'đủ' kẹp theo phần còn lại của đợt: conLai 1.000.000 < số giao dịch ⇒ điền 1000000", async () => {
    await moBangChia(chiTietCoDot(1_000_000));
    fireEvent.click(await screen.findByRole("button", { name: "đủ" }, T10));
    expect(oDot().value).toBe("1000000");
  });

  it("[P7-PR10b] đối chứng: conLai LỚN HƠN số giao dịch ⇒ 'đủ' điền đúng số giao dịch", async () => {
    await moBangChia(chiTietCoDot(SO_TIEN * 3));
    fireEvent.click(await screen.findByRole("button", { name: "đủ" }, T10));
    expect(oDot().value).toBe(String(SO_TIEN));
  });
});
