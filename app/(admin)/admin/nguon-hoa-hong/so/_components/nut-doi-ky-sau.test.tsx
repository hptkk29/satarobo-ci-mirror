// @vitest-environment jsdom
/**
 * [NHH-DOI-FE-*] — NÚT "DỜI SANG KỲ SAU" ở dòng hàng chờ (tab Sổ) trên PHẦN TỬ THẬT, Server Action giả lập.
 *
 * Canh cái `tsc` không thấy: nút chỉ có khi dòng DỜI ĐƯỢC (`doiDuoc`) ∧ người xem giữ quyền quản lý kỳ — và vắng ở MỌI tổ hợp còn lại (đối chứng dương luôn kèm theo);
 * hộp thoại đòi lý do đủ dài mới cho gửi, gửi đúng `{ holdId, lyDo }`; server từ chối ⇒ lý do hiện NGAY TRONG hộp thoại, hộp thoại KHÔNG đóng, không toast thành công.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const R = vi.hoisted(() => ({ refresh: vi.fn() }));
const A = vi.hoisted(() => ({ doi: vi.fn() }));
const T = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: R.refresh }) }));
vi.mock("sonner", () => ({ toast: T }));
vi.mock("../../ky/_actions", () => ({ doiHangChoSangKySauAction: A.doi }));

import { LY_DO_TOI_THIEU } from "@/lib/hoa-hong/kieu";
import type { DongHangChoSo } from "@/lib/hoa-hong/hang-cho-so-doc";
import { HangChoSoBang } from "./hang-cho-so-bang";
import { NutDoiKySau } from "./nut-doi-ky-sau";

beforeEach(() => {
  for (const f of [...Object.values(R), ...Object.values(A), ...Object.values(T)]) f.mockReset();
});
afterEach(cleanup);

const dong = (p: Partial<DongHangChoSo> = {}): DongHangChoSo => ({
  id: "h1",
  holdKey: "hk1",
  ma: "PENDING_REGULATION",
  tenMa: "Chờ văn bản quy định",
  nhom: "CHAN_KHOA_KY",
  loai: "CHO_CHINH_SACH",
  chanKhoa: true,
  kyChan: "2026-10",
  doiDuoc: true,
  paymentId: "pay_1",
  orderId: "ord_1",
  orderItemId: null,
  studentId: "stu_1",
  tenHocVien: "Nguyễn Bảo Minh",
  centerId: "cs1",
  coSo: { code: "CS1", ten: "Cơ sở 211 Nguyễn Hữu Thọ" },
  vai: null,
  lyDoMa: null,
  lyDo: "Chuyển cơ sở — chưa có văn bản",
  khongCoLead: false,
  buoc: "Chờ văn bản quy định cho ca này",
  lienKet: null,
  tienVai: null,
  taoLuc: new Date("2026-11-02T00:00:00Z"),
  ...p,
});
const bang = (dongs: DongHangChoSo[], coTheDoiKy: boolean) =>
  render(<HangChoSoBang dong={dongs} tong={dongs.length} trang={1} kichThuoc={25} hrefTrang={() => "/x"} coTheDoiKy={coTheDoiKy} />);
const nutDoi = () => document.querySelectorAll<HTMLButtonElement>("[data-doi-ky-sau]");

describe("[NHH-DOI-FE-01] khi nào VẼ nút", () => {
  it("hàng chờ dời được ∧ có quyền quản lý kỳ ⇒ có nút (đối chứng dương); thiếu MỘT trong hai ⇒ không nút nào", () => {
    const { unmount } = bang([dong()], true);
    expect(nutDoi().length).toBeGreaterThan(0);
    // cột ≥ lg và khối dưới lý do < lg đều vẽ (CSS chọn cái hiện) — cùng holdId
    expect([...nutDoi()].every((n) => n.getAttribute("data-doi-ky-sau") === "h1")).toBe(true);
    unmount();

    bang([dong()], false); // dòng dời được nhưng người xem KHÔNG có quyền
    expect(nutDoi()).toHaveLength(0);
    cleanup();
    bang([dong({ doiDuoc: false, ma: "CAP_EXCEEDED", tenMa: "Vượt trần tổng tỉ lệ" })], true); // có quyền nhưng hàng chờ KHÔNG dời được
    expect(nutDoi()).toHaveLength(0);
    cleanup();
    bang([dong({ doiDuoc: false, chanKhoa: false, kyChan: null, ma: "UNRESOLVED_BENEFICIARY", tenMa: "Chưa phân giải người hưởng", nhom: "CHUA_PHAN_GIAI_NGUOI_HUONG" })], true);
    expect(nutDoi()).toHaveLength(0);
  });

  it("chỉ dòng dời được có nút khi cả trang lẫn quyền cùng bật: hai dòng, một dời được ⇒ nút mang đúng id dòng đó", () => {
    bang([dong({ id: "a", doiDuoc: false, ma: "POLICY_OVERLAP", tenMa: "Chính sách chồng nhau" }), dong({ id: "b" })], true);
    expect(new Set([...nutDoi()].map((n) => n.getAttribute("data-doi-ky-sau")))).toEqual(new Set(["b"]));
  });
});

describe("[NHH-DOI-FE-02] hộp thoại lý do", () => {
  const moHop = () => {
    render(<NutDoiKySau holdId="h1" tenMa="Chờ văn bản quy định" kyChan="2026-10" />);
    fireEvent.click(screen.getByRole("button", { name: "Dời sang kỳ sau" }));
    return screen.getByRole("dialog");
  };
  const xacNhan = () => document.querySelector<HTMLButtonElement>('[data-xac-nhan="DOI_KY_SAU"]')!;

  it("nêu HỆ QUẢ (kỳ 10/2026 hết bị chặn, không xoá, không sinh dòng sổ); xác nhận bị khoá cho tới khi lý do đủ dài", () => {
    const hop = moHop();
    expect(hop.textContent).toContain("Chờ văn bản quy định");
    expect(hop.textContent).toContain("kỳ 10/2026");
    expect(hop.textContent).toMatch(/Không xoá hàng chờ, không sinh dòng sổ/);
    expect(xacNhan().disabled).toBe(true);
    fireEvent.change(within(hop).getByLabelText(/Lý do dời/), { target: { value: "x".repeat(LY_DO_TOI_THIEU - 1) } });
    expect(xacNhan().disabled).toBe(true);
    fireEvent.change(within(hop).getByLabelText(/Lý do dời/), { target: { value: "x".repeat(LY_DO_TOI_THIEU) } });
    expect(xacNhan().disabled).toBe(false); // đối chứng dương: đủ dài ⇒ bấm được
    expect(A.doi).not.toHaveBeenCalled();
  });

  it("gửi đúng { holdId, lyDo }, thành công ⇒ toast + làm mới trang + đóng hộp thoại", async () => {
    A.doi.mockResolvedValue({ ok: true, thongBao: "Đã dời hàng chờ sang kỳ 11/2026.", kySau: "2026-11" });
    const hop = moHop();
    fireEvent.change(within(hop).getByLabelText(/Lý do dời/), { target: { value: "chờ văn bản của BGĐ" } });
    fireEvent.click(xacNhan());
    await waitFor(() => expect(R.refresh).toHaveBeenCalledTimes(1));
    expect(A.doi).toHaveBeenCalledWith({ holdId: "h1", lyDo: "chờ văn bản của BGĐ" });
    expect(T.success).toHaveBeenCalledWith("Đã dời hàng chờ sang kỳ 11/2026.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("server từ chối ⇒ lý do hiện TRONG hộp thoại (role=alert), hộp thoại KHÔNG đóng, không toast thành công, không làm mới", async () => {
    A.doi.mockResolvedValue({ ok: false, ma: "HANG_CHO_KHONG_DOI_DUOC", loi: "Hàng chờ “Vượt trần tổng tỉ lệ” không dời sang kỳ sau được." });
    const hop = moHop();
    fireEvent.change(within(hop).getByLabelText(/Lý do dời/), { target: { value: "chờ văn bản của BGĐ" } });
    fireEvent.click(xacNhan());
    const canhBao = await screen.findByRole("alert");
    expect(canhBao.textContent).toContain("không dời sang kỳ sau được");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(T.success).not.toHaveBeenCalled();
    expect(R.refresh).not.toHaveBeenCalled();
  });
});
