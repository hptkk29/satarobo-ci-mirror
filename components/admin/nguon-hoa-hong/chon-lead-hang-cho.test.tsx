// @vitest-environment jsdom
/**
 * [CLH-UI-*] TICK CHỌN LEAD + thanh «Gán nguồn hàng loạt» của hàng chờ nguồn (`chon-lead-hang-cho.tsx`) — trên PHẦN TỬ THẬT (jsdom); hàm gọi máy chủ được TIÊM.
 *
 *   [CLH-UI-01] chưa tick ⇒ KHÔNG có thanh hành động (đối chứng dương: tick một ô ⇒ có thanh + nút «Gán nguồn hàng loạt»)
 *   [CLH-UI-02] ô «chọn cả trang» chọn / bỏ chọn mọi dòng của trang; lưng chừng khi chọn một phần
 *   [CLH-UI-03] «Chọn cả N lead theo bộ lọc» CHỈ hiện khi đã tick hết trang mà bộ lọc còn nhiều hơn; bấm ⇒ phạm vi gửi đi là CẢ BỘ LỌC (kieu=loc, đúng lyDo); tick lại một ô ⇒ trở về danh sách id
 *   [CLH-UI-04] phạm vi `ids` gửi đúng các id đã tick (không thừa, không thiếu)
 *   [CLH-UI-05] «Bỏ chọn» xoá chọn; đổi được lead nào ⇒ chọn bị xoá + trang làm mới; đóng hộp thoại mà chưa đổi ⇒ GIỮ chọn
 *   [CLH-UI-06] một cú bấm vào ô tick KHÔNG lọt xuống dòng (dòng là vùng bấm mở Sheet)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions-gan-hang-loat", () => ({ ganNguonHangLoatAction: vi.fn() }));

import type { KetQuaGanHangLoatAction } from "@/lib/nguon/gan-nguon-hang-loat-nhan";
import { ChonLeadProvider, OChonLead, OChonTatCa } from "./chon-lead-hang-cho";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const NGUON = [{ id: "g-walk", code: "WALK_IN", name: "Nguồn KH tự đến Trung tâm", commissionEnabled: false }];
const TRANG = ["a", "b", "c"];
const lo = (o: Partial<Extract<KetQuaGanHangLoatAction, { ok: true }>> = {}): KetQuaGanHangLoatAction => ({
  ok: true, daDoi: 0, boQuaCoTien: 0, boQuaKhoa: 0, boQuaCungNguon: 0, boQuaVuaDoi: 0, khongDoiDuoc: 0, loiDauTien: null, daQuet: 0, conTro: null, hetLead: true, ...o,
});

function Bang({ tong = 3, lyDo = null, chay, dongClick }: { tong?: number; lyDo?: "UNKNOWN" | "THIEU_NGUOI" | null; chay?: unknown; dongClick?: () => void }) {
  return (
    <ChonLeadProvider trangIds={TRANG} tong={tong} lyDo={lyDo} coSoId="cs2" phamViNhan="CS2" nguon={NGUON} chay={chay as never}>
      <table>
        <thead>
          <tr>
            <th>
              <OChonTatCa />
            </th>
          </tr>
        </thead>
        <tbody>
          {TRANG.map((id) => (
            <tr key={id} onClick={dongClick}>
              <td>
                <OChonLead leadId={id} ten={`Lead ${id}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChonLeadProvider>
  );
}

const tick = (ten: string) => fireEvent.click(screen.getByRole("checkbox", { name: ten }));
const o = (ten: string) => screen.getByRole("checkbox", { name: ten }) as HTMLInputElement;

describe("[CLH-UI-01] thanh hành động chỉ khi đã tick", () => {
  it("chưa tick ⇒ không thanh, không nút; tick một ô ⇒ có thanh + nút", () => {
    render(<Bang />);
    expect(screen.queryByRole("region", { name: "Lead đã chọn" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Gán nguồn hàng loạt" })).toBeNull();
    tick("Chọn Lead a");
    const thanh = screen.getByRole("region", { name: "Lead đã chọn" });
    expect(thanh.textContent).toContain("Đã chọn 1 lead");
    expect(screen.getByRole("button", { name: "Gán nguồn hàng loạt" })).toBeTruthy();
  });
});

describe("[CLH-UI-02] chọn cả trang", () => {
  it("chọn cả ⇒ mọi ô tick; lưng chừng khi một phần; bỏ ⇒ sạch", () => {
    render(<Bang tong={3} />);
    const tatCa = o("Chọn cả trang này");
    expect(tatCa.checked).toBe(false);
    tick("Chọn Lead b");
    expect(tatCa.indeterminate).toBe(true);
    expect(tatCa.checked).toBe(false);
    fireEvent.click(tatCa);
    for (const id of TRANG) expect(o(`Chọn Lead ${id}`).checked).toBe(true);
    expect(o("Chọn cả trang này").checked).toBe(true);
    expect(screen.getByRole("region", { name: "Lead đã chọn" }).textContent).toContain("Đã chọn 3 lead");
    fireEvent.click(o("Chọn cả trang này"));
    for (const id of TRANG) expect(o(`Chọn Lead ${id}`).checked).toBe(false);
    expect(screen.queryByRole("region", { name: "Lead đã chọn" })).toBeNull();
  });
});

describe("[CLH-UI-03] chọn cả bộ lọc", () => {
  it("chỉ hiện khi đã tick hết trang mà bộ lọc còn nhiều hơn; bấm ⇒ gửi kieu=loc; tick lại ⇒ về ids", async () => {
    const chay = vi.fn().mockResolvedValue(lo({ daDoi: 207, daQuet: 207, conTro: "z" }));
    render(<Bang tong={207} lyDo="UNKNOWN" chay={chay as never} />);
    tick("Chọn Lead a");
    expect(screen.queryByRole("button", { name: /Chọn cả 207 lead/ })).toBeNull(); // mới tick một phần
    fireEvent.click(o("Chọn cả trang này"));
    fireEvent.click(screen.getByRole("button", { name: "Chọn cả 207 lead «Chưa rõ nguồn»" }));
    expect(screen.getByRole("region", { name: "Lead đã chọn" }).textContent).toContain("Đã chọn cả 207 lead «Chưa rõ nguồn»");
    fireEvent.click(screen.getByRole("button", { name: "Gán nguồn hàng loạt" }));
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "Lead nhập từ file Excel cũ, không căn cứ" } });
    fireEvent.click(screen.getByRole("button", { name: "Xem trước" }));
    await waitFor(() => expect(chay).toHaveBeenCalled());
    expect(chay.mock.calls[0]![0]).toMatchObject({ pham: { kieu: "loc", lyDo: "UNKNOWN" }, coSoId: "cs2", chiXem: true });
  });

  it("không hiện khi bộ lọc chỉ có đúng số lead của trang (không còn gì để chọn thêm); tick lại một ô khi đang «cả bộ lọc» ⇒ về chọn theo ô", () => {
    const { unmount } = render(<Bang tong={3} />);
    fireEvent.click(o("Chọn cả trang này"));
    expect(screen.queryByRole("button", { name: /Chọn cả \d+ lead/ })).toBeNull();
    unmount();
    render(<Bang tong={50} lyDo="THIEU_NGUOI" />);
    fireEvent.click(o("Chọn cả trang này"));
    fireEvent.click(screen.getByRole("button", { name: /Chọn cả 50 lead/ }));
    tick("Chọn Lead a"); // bỏ tick một ô ⇒ không còn là «cả bộ lọc»
    expect(screen.getByRole("region", { name: "Lead đã chọn" }).textContent).toContain("Đã chọn 2 lead");
  });
});

describe("[CLH-UI-04] phạm vi ids", () => {
  it("gửi đúng các id đã tick", async () => {
    const chay = vi.fn().mockResolvedValue(lo({ daDoi: 2, daQuet: 2, conTro: "z" }));
    render(<Bang tong={100} chay={chay as never} />);
    tick("Chọn Lead a");
    tick("Chọn Lead c");
    fireEvent.click(screen.getByRole("button", { name: "Gán nguồn hàng loạt" }));
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "Lead nhập từ file Excel cũ, không căn cứ" } });
    fireEvent.click(screen.getByRole("button", { name: "Xem trước" }));
    await waitFor(() => expect(chay).toHaveBeenCalled());
    const { pham } = chay.mock.calls[0]![0];
    expect(pham.kieu).toBe("ids");
    expect([...pham.ids].sort()).toEqual(["a", "c"]);
  });
});

describe("[CLH-UI-05] bỏ chọn / sau khi đổi", () => {
  it("«Bỏ chọn» xoá chọn", () => {
    render(<Bang />);
    tick("Chọn Lead a");
    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn" }));
    expect(screen.queryByRole("region", { name: "Lead đã chọn" })).toBeNull();
    expect(o("Chọn Lead a").checked).toBe(false);
  });

  it("đổi được lead ⇒ xoá chọn + làm mới trang; đóng mà chưa đổi ⇒ GIỮ chọn, không làm mới", async () => {
    const chay = vi
      .fn()
      .mockResolvedValueOnce(lo({ daDoi: 1, daQuet: 1, conTro: "a" })) // xem trước
      .mockResolvedValueOnce(lo({ daDoi: 1, daQuet: 1, conTro: "a" })); // ghi
    render(<Bang tong={100} chay={chay as never} />);
    tick("Chọn Lead a");
    fireEvent.click(screen.getByRole("button", { name: "Gán nguồn hàng loạt" }));
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" })); // chưa đổi gì
    expect(ROUTER.refresh).not.toHaveBeenCalled();
    expect(o("Chọn Lead a").checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Gán nguồn hàng loạt" }));
    fireEvent.change(screen.getByLabelText(/Lý do/), { target: { value: "Lead nhập từ file Excel cũ, không căn cứ" } });
    fireEvent.click(screen.getByRole("button", { name: "Xem trước" }));
    fireEvent.click(await screen.findByRole("button", { name: "Đổi 1 lead" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Đã gán 1 lead"));
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(ROUTER.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "Lead đã chọn" })).toBeNull();
    expect(o("Chọn Lead a").checked).toBe(false);
  });
});

describe("[CLH-UI-06] ô tick không kích hoạt dòng", () => {
  it("bấm ô tick KHÔNG gọi onClick của dòng (dòng là vùng bấm mở Sheet)", () => {
    const dong = vi.fn();
    render(<Bang dongClick={dong} />);
    tick("Chọn Lead a");
    expect(dong).not.toHaveBeenCalled();
  });
});
