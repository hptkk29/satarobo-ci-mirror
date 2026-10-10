// @vitest-environment jsdom
/**
 * [BL8-UI] `<BangNhapLegacy/>` — nút GHI chỉ mở khi (1) đã XEM TRƯỚC trên ĐÚNG lựa chọn hiện tại, (2) bản xem trước không còn lỗi, (3) người dùng đã tích xác nhận.
 * Đổi bất kỳ ô nào sau khi xem trước (ngày, đơn, bỏ chọn) phải làm bản xem trước hết hiệu lực — không thì người dùng ghi một lựa chọn mà server chưa từng phán.
 * Hành vi của form (không grep mã). Luật nghiệp vụ đã có ca ở `legacy-nhap.test.ts` / `tests/finance/bao-luu-nhap-legacy.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ xem: vi.fn(), ghi: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("../_actions", () => ({
  xemTruocLegacyAction: (...a: unknown[]) => h.xem(...a),
  nhapLegacyAction: (...a: unknown[]) => h.ghi(...a),
}));
// Ô tải tệp thật gọi R2 — giả bằng một nút đặt sẵn khoá đơn.
vi.mock("../../_components/tai-tep-bao-luu", () => ({
  TaiTepBaoLuu: ({ giaTri, onChange }: { giaTri: { key: string; ten: string } | null; onChange: (t: { key: string; ten: string } | null) => void }) => (
    <button type="button" onClick={() => onChange({ key: "bao-luu/2026-10/aaaaaaaa11111111.pdf", ten: "don.pdf" })}>
      {giaTri ? "Đã có đơn" : "Tải đơn"}
    </button>
  ),
}));
vi.mock("@/components/ui/phan-trang-bang", () => ({ PhanTrangBang: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import { BangNhapLegacy, type DongUngVien } from "./bang-nhap-legacy";

const DONG: DongUngVien[] = [
  { khoa: "B:gd1", nhom: "B", studentId: "hv1", tenHocVien: "An", maHocVien: null, enrollmentId: "gd1", reserveId: null, ten: "Sata 3 — Lớp 1", ngayGoiY: "2026-08-15", nguonNgay: "nhật ký", ghiDanhChon: [] },
  { khoa: "A:r1", nhom: "A", studentId: "hv2", tenHocVien: "Bình", maHocVien: null, enrollmentId: null, reserveId: "r1", ten: "Dòng cũ cả-học-viên", ngayGoiY: "2026-07-01", nguonNgay: "x", ghiDanhChon: [{ id: "gd2", ten: "Sata 3 — Lớp 2" }] },
];
const XEM_OK = {
  ok: true as const, sanSang: true, loLoi: [],
  cac: [{ nhom: "B" as const, studentId: "hv1", enrollmentId: "gd1", tenHocVien: "An", khoa: "Sata 3", trangThaiGhiDanhTruoc: "PAUSED", chuyenSangTamDung: false, batDau: "2026-08-14T17:00:00.000Z", han: "2027-02-28T17:00:00.000Z", loi: [], canhBao: ["Hạn đã qua"] }],
};

function dung() {
  return render(<BangNhapLegacy dong={DONG} hieuLuc="2026-09-01" homNay="2026-10-08" catNgang={false} />);
}
const chonAn = () => {
  fireEvent.click(screen.getByLabelText("Chọn An"));
  fireEvent.click(screen.getByText("Tải đơn"));
};

beforeEach(() => {
  cleanup();
  h.xem.mockReset();
  h.ghi.mockReset();
  h.refresh.mockReset();
  h.xem.mockResolvedValue(XEM_OK);
  h.ghi.mockResolvedValue({ ok: true, soCa: 1 });
});

describe("[BL8-UI] bảng nhập ca LEGACY", () => {
  it("[BL8-UI-01] chưa chọn ca ⇒ nút Xem trước khoá; chưa xem trước ⇒ KHÔNG có nút Ghi", () => {
    dung();
    expect(screen.getByRole("button", { name: /Xem trước \(0 ca\)/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Ghi \d+ ca/ })).toBeNull();
  });

  it("[BL8-UI-02] chọn ca + đơn ⇒ xem trước gửi ĐÚNG đầu vào (ngày gợi ý, khoá đơn, nhóm B giữ ghi danh); hiện cảnh báo của server; Ghi khoá tới khi tích xác nhận", async () => {
    dung();
    chonAn();
    fireEvent.click(screen.getByRole("button", { name: /Xem trước \(1 ca\)/ }));
    await waitFor(() => expect(screen.getByLabelText("Bản xem trước")).toBeTruthy());
    expect(h.xem).toHaveBeenCalledWith({
      cas: [{ nhom: "B", studentId: "hv1", enrollmentId: "gd1", reserveId: null, ngayBatDau: "2026-08-15", applicationFileKey: "bao-luu/2026-10/aaaaaaaa11111111.pdf" }],
    });
    expect(screen.getByText(/Hạn đã qua/)).toBeTruthy();
    const ghi = screen.getByRole("button", { name: /Ghi 1 ca/ });
    expect(ghi).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /đã đối chiếu từng đơn giấy/ }));
    expect(ghi).not.toBeDisabled();
    expect(h.ghi).not.toHaveBeenCalled();
    fireEvent.click(ghi);
    await waitFor(() => expect(h.ghi).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
  });

  it("[BL8-UI-03] đổi ngày SAU khi xem trước ⇒ bản xem trước biến mất (phải xem lại); bỏ chọn cũng vậy", async () => {
    dung();
    chonAn();
    fireEvent.click(screen.getByRole("button", { name: /Xem trước \(1 ca\)/ }));
    await waitFor(() => expect(screen.getByLabelText("Bản xem trước")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Ngày bắt đầu nghỉ của An"), { target: { value: "2026-08-20" } });
    expect(screen.queryByLabelText("Bản xem trước")).toBeNull();
    expect(screen.queryByRole("button", { name: /Ghi 1 ca/ })).toBeNull();
  });

  it("[BL8-UI-04] bản xem trước còn LỖI ⇒ hiện lỗi, KHÔNG có ô xác nhận và KHÔNG có nút Ghi", async () => {
    h.xem.mockResolvedValue({ ...XEM_OK, sanSang: false, cac: [{ ...XEM_OK.cac[0]!, loi: ["Thiếu đơn bảo lưu đã ký (BR-07)."], canhBao: [] }] });
    dung();
    chonAn();
    fireEvent.click(screen.getByRole("button", { name: /Xem trước \(1 ca\)/ }));
    await waitFor(() => expect(screen.getByText(/Thiếu đơn bảo lưu đã ký/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Ghi \d+ ca/ })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /đã đối chiếu/ })).toBeNull();
  });

  it("[BL8-UI-05] nhóm A cả-học-viên: ghi danh áp dụng gửi lên theo ô chọn khoá; lỗi từ server khi GHI hiện nguyên văn và bản xem trước bị huỷ", async () => {
    h.xem.mockResolvedValue({ ...XEM_OK, cac: [{ ...XEM_OK.cac[0]!, nhom: "A" as const, studentId: "hv2", enrollmentId: "gd2", tenHocVien: "Bình" }] });
    h.ghi.mockResolvedValue({ ok: false, error: "Ca 1 (Bình): Ghi danh đã có hồ sơ bảo lưu đang mở" });
    dung();
    fireEvent.click(screen.getByRole("tab", { name: /A · Dòng cũ còn mở/ }));
    fireEvent.click(screen.getByLabelText("Chọn Bình"));
    fireEvent.click(screen.getByText("Tải đơn"));
    fireEvent.change(screen.getByLabelText("Ghi danh áp dụng cho Bình"), { target: { value: "gd2" } });
    fireEvent.click(screen.getByRole("button", { name: /Xem trước \(1 ca\)/ }));
    await waitFor(() => expect(screen.getByLabelText("Bản xem trước")).toBeTruthy());
    expect(h.xem).toHaveBeenCalledWith({
      cas: [{ nhom: "A", studentId: "hv2", enrollmentId: "gd2", reserveId: "r1", ngayBatDau: "2026-07-01", applicationFileKey: "bao-luu/2026-10/aaaaaaaa11111111.pdf" }],
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /đã đối chiếu/ }));
    fireEvent.click(screen.getByRole("button", { name: /Ghi 1 ca/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/đã có hồ sơ bảo lưu đang mở/));
    expect(screen.queryByLabelText("Bản xem trước")).toBeNull();
  });
});
