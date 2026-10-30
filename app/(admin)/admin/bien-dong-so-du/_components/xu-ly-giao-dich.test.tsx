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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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

/** Bấm vào dòng gợi ý của một đơn (cả dòng là một nút). */
function chonDonTrongDanhSach(code: string) {
  const nut = screen.getByText(code).closest("button");
  if (!nut) throw new Error(`không thấy nút của đơn ${code}`);
  fireEvent.click(nut);
}

describe("[GTB-UI] ô 'Gắn vào đơn' báo trước ở bước chọn đơn — dựng màn thật, bấm nút thật", () => {
  it("[GTB-UI1] chọn đơn mà kế toán đã bác giao dịch này ⇒ gửi (đơn, GIAO DỊCH ĐANG GẮN) lên máy chủ, nói đúng câu máy chủ trả, KHÔNG mở bảng chia và vẫn ở danh sách đơn", async () => {
    h.taiChiTietDonDeGan.mockResolvedValueOnce({ error: CAU_TU_CHOI });
    await moDanhSachDon();

    chonDonTrongDanhSach(donBac.code);

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

    chonDonTrongDanhSach(donKhac.code);

    await screen.findByText(/cho từng con/);
    expect(h.taiChiTietDonDeGan).toHaveBeenCalledTimes(1);
    expect(h.taiChiTietDonDeGan).toHaveBeenCalledWith("don-khac", BT);
    expect(h.error).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ghi phân bổ" })).toBeTruthy();
  });

  it("[GTB-UI3] chỗ gọi thứ hai: sau khi 'Tạo đợt' tại chỗ, màn nạp LẠI bảng chia và lần này cũng gửi giao dịch đang gắn", async () => {
    await moDanhSachDon();
    chonDonTrongDanhSach(donKhac.code);
    await screen.findByText(/cho từng con/);
    expect(h.taiChiTietDonDeGan).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Tạo đợt cho Bé Hai/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Tạo đợt" }));

    await waitFor(() => expect(h.taiChiTietDonDeGan).toHaveBeenCalledTimes(2));
    expect(h.taoDotChoConTaiChoAction).toHaveBeenCalledTimes(1);
    expect(h.taiChiTietDonDeGan).toHaveBeenNthCalledWith(2, "don-khac", BT);
  });
});
