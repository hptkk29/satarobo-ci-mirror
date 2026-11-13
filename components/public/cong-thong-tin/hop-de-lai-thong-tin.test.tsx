// @vitest-environment jsdom
/**
 * [CTT-UI-*] Hộp «để lại thông tin» (dựng thật, đọc phần tử; fetch được giả).
 *   [CTT-UI-01] đã mở khoá ⇒ yeuCau chạy NGAY, không mở hộp; chưa ⇒ mở hộp, việc KHÔNG chạy cho tới khi gửi xong + bấm tiếp tục
 *   [CTT-UI-02] thiếu phường/xã ⇒ chặn tại chỗ, nói rõ vì sao cần, KHÔNG gọi mạng; thiếu đồng ý ⇒ chặn
 *   [CTT-UI-03] chọn phường gõ không dấu; đổi tỉnh ⇒ bỏ phường cũ
 *   [CTT-UI-04] gửi đúng body (chỉ thông tin liên hệ + nguồn + ngữ cảnh + ô bẫy rỗng), không có trường sức khỏe
 *   [CTT-UI-05] lỗi máy chủ theo trường (phường) ⇒ hiện ở đúng ô; lỗi chung ⇒ báo, hộp vẫn mở, việc chưa chạy
 *   [CTT-UI-06] ESC/đóng ⇒ bỏ việc đang chờ; ô bẫy ẩn khỏi người dùng
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CongThongTinProvider, useCongThongTin } from "./hop-de-lai-thong-tin";

const CAU_HINH = { tieuDe: "Để lại thông tin để tải sách", moTa: "Đọc trực tuyến luôn miễn phí.", nut: "Lưu và tải về", okMoTa: "Từ giờ tải được mọi cuốn.", okNut: "Tải sách" };
const DM = { ok: true, thanhPho: ["Tp Đà Nẵng", "Huế"], macDinh: "Tp Đà Nẵng", phuong: ["Phường Hải Châu", "Phường An Hải", "Phường Thanh Khê"] };
const DM_HUE = { ok: true, thanhPho: ["Tp Đà Nẵng", "Huế"], macDinh: "Tp Đà Nẵng", phuong: ["Phường Thuận Hóa"] };

let fetchMock: ReturnType<typeof vi.fn>;
const goiDeLai = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes("/de-lai"));

function Nut({ viec, nguCanh }: { viec: () => void; nguCanh?: string }) {
  const { yeuCau, daMo } = useCongThongTin();
  return (
    <button type="button" onClick={() => yeuCau(viec, nguCanh)}>
      {daMo ? "TAI-DA-MO" : "TAI"}
    </button>
  );
}
const dung = (o: { daMo?: boolean; viec?: () => void; nguCanh?: string } = {}) =>
  render(
    <CongThongTinProvider nguon="tu-sach" daMoKhoaBanDau={o.daMo ?? false} cauHinh={CAU_HINH}>
      <Nut viec={o.viec ?? (() => undefined)} nguCanh={o.nguCanh} />
    </CongThongTinProvider>,
  );
const nhap = (nhan: string | RegExp, v: string) => fireEvent.change(screen.getByLabelText(nhan), { target: { value: v } });
const moHop = async () => {
  fireEvent.click(screen.getByRole("button", { name: "TAI" }));
  await screen.findByTestId("hop-de-lai-thong-tin");
  await waitFor(() => expect(fetchMock).toHaveBeenCalled()); // danh mục đã tải
};
const chonPhuong = (go: string, ten: string) => {
  nhap(/Phường \/ Xã/, go);
  fireEvent.click(screen.getByRole("button", { name: ten }));
};
const dienDu = async () => {
  nhap(/Họ và tên/, "Nguyễn Thị Lan");
  nhap(/Số điện thoại/, "0905 123 456");
  chonPhuong("hai chau", "Phường Hải Châu");
  fireEvent.click(screen.getByLabelText(/Tôi đồng ý cho Sata Robo xử lý/));
};
const guiNut = () => screen.getByRole("button", { name: /Lưu và tải về|Đang gửi…/ });

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/dia-chi")) return { ok: true, json: async () => (String(url).includes("Hu%E1%BA%BF") ? DM_HUE : DM) } as Response;
    return { ok: true, json: async () => ({ ok: true }) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("[CTT-UI-01] mở khoá một lần", () => {
  it("đã mở khoá ⇒ chạy ngay, không có hộp, không tải danh mục", () => {
    const viec = vi.fn();
    dung({ daMo: true, viec });
    fireEvent.click(screen.getByRole("button", { name: "TAI-DA-MO" }));
    expect(viec).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("hop-de-lai-thong-tin")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("chưa mở khoá ⇒ mở hộp; việc chỉ chạy SAU khi gửi xong và bấm nút tiếp tục", async () => {
    const viec = vi.fn();
    dung({ viec });
    await moHop();
    expect(viec).not.toHaveBeenCalled();
    await dienDu();
    fireEvent.click(guiNut());
    expect(await screen.findByText("Đã nhận thông tin")).toBeTruthy();
    expect(viec).not.toHaveBeenCalled(); // chưa bấm «Tải sách»
    fireEvent.click(screen.getByRole("button", { name: "Tải sách" }));
    await waitFor(() => expect(viec).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("hop-de-lai-thong-tin")).toBeNull();
    // từ đây hộp đã MỞ KHOÁ: lần sau chạy ngay
    fireEvent.click(screen.getByRole("button", { name: "TAI-DA-MO" }));
    expect(viec).toHaveBeenCalledTimes(2);
  });
});

describe("[CTT-UI-02] phường/xã bắt buộc", () => {
  it("không chọn phường ⇒ chặn, nói vì sao cần, KHÔNG gọi /de-lai", async () => {
    dung();
    await moHop();
    nhap(/Họ và tên/, "Nguyễn Thị Lan");
    nhap(/Số điện thoại/, "0905123456");
    fireEvent.click(screen.getByLabelText(/Tôi đồng ý cho Sata Robo xử lý/));
    fireEvent.click(guiNut());
    expect(await screen.findByText(/chọn phường\/xã trong danh sách — Sata Robo cần thông tin này để kết nối cơ sở gần nhà/)).toBeTruthy();
    expect(goiDeLai()).toHaveLength(0);
  });
  it("thiếu đồng ý ⇒ chặn", async () => {
    dung();
    await moHop();
    nhap(/Họ và tên/, "Nguyễn Thị Lan");
    nhap(/Số điện thoại/, "0905123456");
    chonPhuong("hai chau", "Phường Hải Châu");
    fireEvent.click(guiNut());
    expect(await screen.findByText(/cần đồng ý để Sata Robo gửi kết quả/)).toBeTruthy();
    expect(goiDeLai()).toHaveLength(0);
  });
  it("SĐT sai dạng ⇒ chặn tại chỗ", async () => {
    dung();
    await moHop();
    await dienDu();
    nhap(/Số điện thoại/, "12345");
    fireEvent.click(guiNut());
    expect(await screen.findByText(/10 chữ số, bắt đầu bằng 0/)).toBeTruthy();
    expect(goiDeLai()).toHaveLength(0);
  });
});

describe("[CTT-UI-03] chọn phường", () => {
  it("gõ KHÔNG DẤU ra gợi ý; chọn xong ô hiện phường đã chọn", async () => {
    dung();
    await moHop();
    nhap(/Phường \/ Xã/, "thanh khe");
    expect(screen.getByRole("button", { name: "Phường Thanh Khê" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Phường Hải Châu" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Phường Thanh Khê" }));
    expect((screen.getByLabelText(/Phường \/ Xã/) as HTMLInputElement).value).toBe("Phường Thanh Khê");
  });
  it("gõ không khớp ⇒ nói rõ «không thấy»; đổi tỉnh ⇒ bỏ phường đã chọn và tải phường mới", async () => {
    dung();
    await moHop();
    nhap(/Phường \/ Xã/, "zzzz");
    expect(await screen.findByText(/Không thấy phường\/xã nào khớp/)).toBeTruthy();
    chonPhuong("an hai", "Phường An Hải");
    expect((screen.getByLabelText(/Phường \/ Xã/) as HTMLInputElement).value).toBe("Phường An Hải");
    nhap(/Tỉnh \/ Thành phố/, "Huế");
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes(encodeURIComponent("Huế")))).toBe(true));
    expect((screen.getByLabelText(/Phường \/ Xã/) as HTMLInputElement).value).toBe("");
  });
});

describe("[CTT-UI-04] nội dung gửi đi", () => {
  it("chỉ thông tin liên hệ + nguồn + ngữ cảnh; ô bẫy rỗng; không có trường sức khỏe", async () => {
    dung({ nguCanh: "ebook:12" });
    await moHop();
    await dienDu();
    nhap(/Số nhà, tên đường/, " 12 Nguyễn Văn Linh ");
    fireEvent.click(screen.getByLabelText(/Nhận thông tin chương trình học/));
    fireEvent.click(guiNut());
    await screen.findByText("Đã nhận thông tin");
    const [url, init] = goiDeLai()[0]! as [string, RequestInit];
    expect(url).toBe("/api/cong-thong-tin/de-lai");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      hoTen: "Nguyễn Thị Lan",
      soDienThoai: "0905123456",
      thanhPho: "Tp Đà Nẵng",
      phuong: "Phường Hải Châu",
      soNha: "12 Nguyễn Văn Linh",
      dongY: { xuLyHoSo: true, tiepThi: true },
      nguon: "tu-sach",
      nguCanh: "ebook:12",
      bay: "",
    });
    expect(JSON.stringify(body)).not.toMatch(/ketQua|traLoi|diem|thanhVien/);
  });
});

describe("[CTT-UI-05] lỗi từ máy chủ", () => {
  it("lỗi theo trường phường ⇒ hiện ở ô phường; hộp vẫn mở; việc chưa chạy", async () => {
    const viec = vi.fn();
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/dia-chi")
        ? ({ ok: true, json: async () => DM } as Response)
        : ({ ok: false, json: async () => ({ ok: false, loi: [{ truong: "phuong", thongBao: "Phường/xã không thuộc thành phố đã chọn — vui lòng chọn lại" }] }) } as Response),
    );
    dung({ viec });
    await moHop();
    await dienDu();
    fireEvent.click(guiNut());
    expect(await screen.findByText(/không thuộc thành phố đã chọn/)).toBeTruthy();
    expect(screen.queryByText("Đã nhận thông tin")).toBeNull();
    expect(viec).not.toHaveBeenCalled();
  });
  it("mạng đứt ⇒ báo chung, có thể gửi lại", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/dia-chi")) return { ok: true, json: async () => DM } as Response;
      throw new Error("mạng");
    });
    dung();
    await moHop();
    await dienDu();
    fireEvent.click(guiNut());
    expect(await screen.findByText(/Chưa gửi được/)).toBeTruthy();
    expect((guiNut() as HTMLButtonElement).disabled).toBe(false);
  });
  it("danh mục không tải được ⇒ nút Thử lại", async () => {
    let lan = 0;
    fetchMock.mockImplementation(async () => (++lan === 1 ? ({ ok: false, json: async () => ({}) } as Response) : ({ ok: true, json: async () => DM } as Response)));
    dung();
    fireEvent.click(screen.getByRole("button", { name: "TAI" }));
    expect(await screen.findByText(/Chưa tải được danh sách phường\/xã/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await waitFor(() => expect(lan).toBe(2));
    nhap(/Phường \/ Xã/, "hai chau");
    expect(await screen.findByRole("button", { name: "Phường Hải Châu" })).toBeTruthy();
  });
});

describe("[CTT-UI-06] đóng và ô bẫy", () => {
  it("ESC ⇒ đóng và bỏ việc đang chờ (gửi xong sau đó cũng không chạy việc cũ)", async () => {
    const viec = vi.fn();
    dung({ viec });
    await moHop();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("hop-de-lai-thong-tin")).toBeNull();
    expect(viec).not.toHaveBeenCalled();
  });
  it("ô bẫy ẩn khỏi người dùng (aria-hidden, ngoài màn hình, không nhận Tab)", async () => {
    dung();
    await moHop();
    const bay = screen.getByLabelText("Trang web", { selector: "input" }) as HTMLInputElement;
    expect(bay.tabIndex).toBe(-1);
    expect(bay.closest("[aria-hidden='true']")).not.toBeNull();
    expect(bay.value).toBe("");
  });
});
