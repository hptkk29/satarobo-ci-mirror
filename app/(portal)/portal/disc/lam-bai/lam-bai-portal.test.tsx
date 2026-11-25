// @vitest-environment jsdom
/**
 * [PLB-UI-*] Màn làm bài DISC trong cổng học viên: không hỏi lại hồ sơ, chỉ hỏi phần thiếu; dữ liệu GIẢ; không mạng/DB.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BoDeDisc } from "@/lib/disc/engine";
import type { GoiBoDe } from "@/components/disc/api-client";
import type { KetQuaLuuPortal } from "@/lib/disc/portal-lam-bai";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./_actions", () => ({ luuBaiDiscPortalAction: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

import { LamBaiPortal, type LamBaiPortalProps } from "./lam-bai-portal";

const HOM_NAY = new Date("2027-01-15T05:00:00Z"); // năm học 2026–2027

const boGia = (ma: string): BoDeDisc => ({
  ma,
  phienBan: "gia-1",
  doiTuong: "TH",
  nguoiLonTraLoiHo: false,
  cauHoi: [
    { id: `${ma}-1`, noiDung: "Câu giả số một" },
    { id: `${ma}-2`, noiDung: "Câu giả số hai" },
  ],
});
const layBoDeGia = () => vi.fn<GoiBoDe>(async (y) => ({ ok: true, boDe: boGia(y.vai === "PH" ? "GIA-PH" : "GIA-HS") }));

const DU: Pick<LamBaiPortalProps, "studentId" | "tenPhuHuynh" | "tenHocSinh" | "namSinhPhuHuynh" | "namSinhHocSinh" | "lopDaLuu"> = {
  studentId: "s1",
  tenPhuHuynh: "Mẹ Giả Một",
  tenHocSinh: "Bé Giả Hai",
  namSinhPhuHuynh: 1988,
  namSinhHocSinh: 2017,
  lopDaLuu: null,
};

function dung(o: Partial<LamBaiPortalProps> = {}) {
  const layBoDe = o.layBoDe ?? layBoDeGia();
  const luu = o.luu ?? vi.fn(async (): Promise<KetQuaLuuPortal> => ({ ok: true, submissionId: "sub-1" }));
  const dieuHuong = o.dieuHuong ?? vi.fn();
  render(<LamBaiPortal {...DU} {...o} layBoDe={layBoDe} luu={luu} dieuHuong={dieuHuong} homNay={HOM_NAY} />);
  return { layBoDe, luu, dieuHuong };
}

beforeEach(() => {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: () => "khoa-gia-0123456789abcdef-xyz" } });
});
afterEach(() => cleanup());

const lamBai = () => {
  fireEvent.click(screen.getByLabelText(/Rất đúng/));
  fireEvent.click(screen.getByTestId("disc-cau-tiep"));
  fireEvent.click(screen.getByLabelText(/Rất đúng/));
  fireEvent.click(screen.getByTestId("disc-cau-xong"));
};

describe("[PLB-UI-1] đủ hồ sơ trong tài khoản ⇒ bấm là làm luôn", () => {
  it("không hiện form hồ sơ; tải bộ đề bằng năm sinh có sẵn và lớp tính theo năm học (2017 ⇒ lớp 4)", async () => {
    const { layBoDe } = dung();
    await screen.findByTestId("disc-lam-bai");
    expect(screen.queryByTestId("disc-portal-bo-sung")).toBeNull();
    expect(screen.getByText("Câu giả số một")).toBeTruthy();
    expect(layBoDe).toHaveBeenCalledWith({ vai: "PH", namSinh: 1988 });
    expect(layBoDe).toHaveBeenCalledWith({ vai: "HS", bacHoc: "4", namSinh: 2017 });
  });
  it("làm hết hai bài ⇒ màn xác nhận KHÔNG hỏi SĐT/email; thiếu đồng ý ⇒ không gửi", async () => {
    const { luu } = dung();
    await screen.findByTestId("disc-lam-bai");
    lamBai();
    lamBai();
    const xn = await screen.findByTestId("disc-portal-xac-nhan");
    expect(xn.querySelector('input[type="tel"], input[type="email"]')).toBeNull();
    expect(screen.queryByLabelText(/Số điện thoại/)).toBeNull();
    fireEvent.click(screen.getByTestId("disc-portal-luu"));
    expect((await screen.findByTestId("disc-portal-loi")).textContent).toMatch(/đồng ý/);
    expect(luu).not.toHaveBeenCalled();
  });
  it("tích đồng ý ⇒ gửi đúng con, câu trả lời thô, KHÔNG gửi điểm/SĐT/hồ sơ; xong thì chuyển về lịch sử", async () => {
    const { luu, dieuHuong } = dung();
    await screen.findByTestId("disc-lam-bai");
    lamBai();
    lamBai();
    await screen.findByTestId("disc-portal-xac-nhan");
    fireEvent.click(screen.getByLabelText(/Bắt buộc:/));
    fireEvent.click(screen.getByTestId("disc-portal-luu"));
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
    const g = (luu as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
    expect(g.studentId).toBe("s1");
    expect(g.dongYXuLy).toBe(true);
    expect(g.boSung).toEqual({});
    expect(Object.keys(g).sort()).toEqual(["bai", "boSung", "dongYXuLy", "idempotencyKey", "studentId"]);
    expect(JSON.stringify(g)).not.toMatch(/soDienThoai|email|diem|Mẹ Giả|Bé Giả/);
    await waitFor(() => expect(dieuHuong).toHaveBeenCalledWith("/portal/disc?moi=1"));
  });
  it("máy chủ từ chối vì trả lời phẳng ⇒ hiện câu của máy chủ + nút quay lại ĐÚNG bài của con (không bảo sửa hồ sơ)", async () => {
    const luu = vi.fn(async (): Promise<KetQuaLuuPortal> => ({
      ok: false,
      loi: "DU_LIEU_KHONG_HOP_LE",
      chiTiet: [{ truong: "bai.hocSinh.traLoi", thongBao: "Hãy chọn đúng mức." }],
    }));
    dung({ luu });
    await screen.findByTestId("disc-lam-bai");
    lamBai();
    lamBai();
    await screen.findByTestId("disc-portal-xac-nhan");
    fireEvent.click(screen.getByLabelText(/Bắt buộc:/));
    fireEvent.click(screen.getByTestId("disc-portal-luu"));
    const loi = await screen.findByTestId("disc-portal-loi");
    expect(loi.textContent).toMatch(/Hãy chọn đúng mức/);
    expect(loi.textContent).not.toMatch(/hồ sơ|số điện thoại/);
    fireEvent.click(screen.getByRole("button", { name: "Quay lại bài của con" }));
    await screen.findByTestId("disc-lam-bai");
    expect(screen.getByText("Bé Giả Hai")).toBeTruthy();
  });
});

describe("[PLB-UI-2] chỉ hỏi PHẦN CÒN THIẾU", () => {
  it("thiếu năm sinh của con ⇒ chỉ một ô (của con), kèm lớp tự tính theo năm học; nhập sai ⇒ báo lỗi, chưa tải bộ đề", async () => {
    const { layBoDe } = dung({ namSinhHocSinh: null });
    const form = await screen.findByTestId("disc-portal-bo-sung");
    expect(form.querySelectorAll("input").length).toBe(1);
    expect(screen.queryByLabelText(/Năm sinh của bạn/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Năm sinh của Bé Giả Hai/), { target: { value: "2017" } });
    expect(screen.getByText(/Lớp 4/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Năm sinh của Bé Giả Hai/), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /Bắt đầu làm bài/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/4 chữ số/);
    expect(layBoDe).not.toHaveBeenCalled();
  });
  it("điền đủ phần thiếu ⇒ vào bài; phần bổ sung đi cùng lúc lưu (server vẫn kiểm lại)", async () => {
    const { luu, layBoDe } = dung({ namSinhPhuHuynh: null, namSinhHocSinh: null });
    fireEvent.change(await screen.findByLabelText(/Năm sinh của bạn/), { target: { value: "1988" } });
    fireEvent.change(screen.getByLabelText(/Năm sinh của Bé Giả Hai/), { target: { value: "2017" } });
    fireEvent.click(screen.getByRole("button", { name: /Bắt đầu làm bài/ }));
    await screen.findByTestId("disc-lam-bai");
    expect(layBoDe).toHaveBeenCalledWith({ vai: "PH", namSinh: 1988 });
    lamBai();
    lamBai();
    await screen.findByTestId("disc-portal-xac-nhan");
    fireEvent.click(screen.getByLabelText(/Bắt buộc:/));
    fireEvent.click(screen.getByTestId("disc-portal-luu"));
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
    expect(((luu as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { boSung: unknown }).boSung).toEqual({ namSinhPhuHuynh: 1988, namSinhHocSinh: 2017 });
  });
});
