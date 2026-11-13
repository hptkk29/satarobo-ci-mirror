// @vitest-environment jsdom
/**
 * Bài video — ô DÁN LINK YOUTUBE ở màn tải video.
 *
 * Điều phải đúng:
 *  · link Riêng tư / tắt nhúng / sai host lộ ra Ở BƯỚC KIỂM TRA, kèm cách khắc phục — không
 *    để tới lúc nhân viên mở bài mới biết;
 *  · không lưu được trước khi đọc được thời lượng (thời lượng là MẪU SỐ của mọi % đã xem);
 *  · cái gửi lên server là link chuẩn dựng lại từ mã + thời lượng + xác nhận phụ đề.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";

const h = vi.hoisted(() => ({
  luu: vi.fn(),
  xem: vi.fn(),
  refresh: vi.fn(),
  tao: vi.fn(),
  docDuration: vi.fn(),
  toastOk: vi.fn(),
  toastLoi: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: h.toastOk, error: h.toastLoi, message: vi.fn() } }));
vi.mock("../_actions", () => ({ luuBaiVideoYoutubeAction: h.luu, xemTruocDoiNguonAction: h.xem }));
vi.mock("@/lib/elearning/youtube-iframe", async (goc) => {
  const that = await goc<typeof import("@/lib/elearning/youtube-iframe")>();
  return { ...that, taoTrinhPhatYoutube: h.tao, docThoiLuongYoutube: h.docDuration };
});

import { YoutubeLinkForm } from "./youtube-link-form";
import { LoiYoutube } from "@/lib/elearning/youtube-iframe";

const MA = "aBcDeFg_H-1";

const PROPS: ComponentProps<typeof YoutubeLinkForm> = {
  lessonId: "les1",
  title: "Bài an toàn",
  youtubeIdHienCo: null,
  durationSecHienCo: null,
  coPhuDeHienCo: false,
  coTepHienCo: false,
  // Mặc định: người soạn CÓ quyền xuất bản, khoá nháp, chưa ai học. Từng ca đổi cờ nào thì nêu cờ đó.
  coQuyenXuatBan: true,
  khoaDaXuatBan: false,
  coNguoiHoc: false,
};

const player = { destroy: vi.fn() };

function dan(link: string) {
  fireEvent.change(screen.getByLabelText("Link YouTube"), { target: { value: link } });
}
const bamKiem = () => fireEvent.click(screen.getByRole("button", { name: "Kiểm tra link" }));

beforeEach(() => {
  h.luu.mockReset().mockResolvedValue({ ok: true, data: { durationSec: 754 } });
  h.xem.mockReset();
  h.refresh.mockReset();
  h.toastOk.mockReset();
  h.toastLoi.mockReset();
  h.tao.mockReset().mockResolvedValue(player);
  h.docDuration.mockReset().mockResolvedValue(754);
  player.destroy.mockReset();
});

afterEach(cleanup);

describe("[YTF-01] kiểm tra link", () => {
  it("link không phải YouTube ⇒ báo ngay, KHÔNG dựng trình phát", async () => {
    render(<YoutubeLinkForm {...PROPS} />);
    dan("https://vimeo.com/123456789");
    bamKiem();
    expect((await screen.findByRole("alert")).textContent).toContain("không phải link một video YouTube");
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("host giả danh YouTube ⇒ từ chối như link lạ", async () => {
    render(<YoutubeLinkForm {...PROPS} />);
    dan(`https://youtube.com.evil.com/watch?v=${MA}`);
    bamKiem();
    await screen.findByRole("alert");
    expect(h.tao).not.toHaveBeenCalled();
  });

  it("link đúng ⇒ dựng trình phát thử với ĐÚNG mã, rồi hiện thời lượng đọc được", async () => {
    render(<YoutubeLinkForm {...PROPS} />);
    dan(`https://www.youtube.com/watch?v=${MA}&t=5s`);
    bamKiem();
    expect((await screen.findByTestId("yt-thoi-luong")).textContent).toBe("12 phút 34 giây");
    expect(h.tao).toHaveBeenCalledTimes(1);
    expect(h.tao.mock.calls[0]![1]).toMatchObject({ videoId: MA });
  });

  it("🔴 video Riêng tư (101/150) ⇒ nhắc đổi sang Không công khai, KHÔNG cho lưu", async () => {
    h.tao.mockRejectedValue(new LoiYoutube(101));
    render(<YoutubeLinkForm {...PROPS} />);
    dan(`https://youtu.be/${MA}`);
    bamKiem();
    const loi = (await screen.findByRole("alert")).textContent!;
    expect(loi).toContain("Riêng tư");
    expect(loi).toContain("Không công khai");
    expect(screen.queryByRole("button", { name: "Lưu link vào bài" })).toBeNull();
  });

  it("🔴 Riêng tư báo bằng onError SAU onReady ⇒ vẫn ra câu nhắc đúng, không phải câu chung", async () => {
    // Đo bằng trình duyệt thật 27/10: YouTube bắn onReady rồi mới onError(100). Bản đầu không
    // hứng lỗi muộn nên ra "không đọc được thời lượng (video phát trực tiếp?)".
    h.tao.mockImplementation(async (_host: unknown, o: { onLoi?: (m: number) => void }) => {
      setTimeout(() => o.onLoi?.(150), 0);
      return player;
    });
    h.docDuration.mockImplementation(
      async (_p: unknown, _han: unknown, loi?: () => number | null) => {
        await new Promise((r) => setTimeout(r, 20));
        const l = loi?.() ?? null;
        if (l !== null) throw new LoiYoutube(l);
        return 754;
      },
    );
    render(<YoutubeLinkForm {...PROPS} />);
    dan(`https://youtu.be/${MA}`);
    bamKiem();
    const loi = (await screen.findByRole("alert")).textContent!;
    expect(loi).toContain("Riêng tư");
    expect(loi).not.toContain("phát trực tiếp");
    expect(screen.queryByRole("button", { name: "Lưu link vào bài" })).toBeNull();
  });

  it("🔴 tắt nhúng (150) ⇒ nhắc bật Cho phép nhúng", async () => {
    h.tao.mockRejectedValue(new LoiYoutube(150));
    render(<YoutubeLinkForm {...PROPS} />);
    dan(`https://youtu.be/${MA}`);
    bamKiem();
    expect((await screen.findByRole("alert")).textContent).toContain("nhúng");
  });

  it("không đọc được thời lượng (video phát trực tiếp) ⇒ báo, không cho lưu", async () => {
    h.docDuration.mockRejectedValue(new LoiYoutube(0));
    render(<YoutubeLinkForm {...PROPS} />);
    dan(`https://youtu.be/${MA}`);
    bamKiem();
    expect((await screen.findByRole("alert")).textContent).toContain("thời lượng");
    expect(screen.queryByRole("button", { name: "Lưu link vào bài" })).toBeNull();
  });

  it("video dưới 5 giây hoặc dài hơn 3 giờ ⇒ từ chối ngay ở client", async () => {
    for (const giay of [3, 4 * 3600]) {
      h.docDuration.mockResolvedValue(giay);
      const { unmount } = render(<YoutubeLinkForm {...PROPS} />);
      dan(`https://youtu.be/${MA}`);
      bamKiem();
      await screen.findByRole("alert");
      expect(screen.queryByRole("button", { name: "Lưu link vào bài" }), String(giay)).toBeNull();
      unmount();
    }
  });

  it("chưa dán gì ⇒ nút Kiểm tra bị khoá", () => {
    render(<YoutubeLinkForm {...PROPS} />);
    expect((screen.getByRole("button", { name: "Kiểm tra link" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("[YTF-02] lưu link vào bài", () => {
  async function toiBuocLuu() {
    render(<YoutubeLinkForm {...PROPS} />);
    dan(`https://www.youtube.com/watch?v=${MA}&t=5s`);
    bamKiem();
    await screen.findByTestId("yt-thoi-luong");
  }

  it("🔴 gửi LINK CHUẨN dựng lại từ mã + thời lượng ĐỌC ĐƯỢC + xác nhận phụ đề", async () => {
    await toiBuocLuu();
    fireEvent.click(screen.getByLabelText(/đã bật phụ đề tiếng Việt/));
    fireEvent.click(screen.getByRole("button", { name: "Lưu link vào bài" }));
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(1));
    expect(h.luu.mock.calls[0]![0]).toEqual({
      lessonId: "les1",
      title: "Bài an toàn",
      url: `https://youtu.be/${MA}`,
      durationSec: 754,
      coPhuDe: true,
    });
  });

  it("không tích phụ đề ⇒ gửi coPhuDe = false (mặc định KHÔNG tự nhận có phụ đề)", async () => {
    await toiBuocLuu();
    fireEvent.click(screen.getByRole("button", { name: "Lưu link vào bài" }));
    await waitFor(() => expect(h.luu).toHaveBeenCalled());
    expect(h.luu.mock.calls[0]![0].coPhuDe).toBe(false);
  });

  it("lưu xong ⇒ báo, làm tươi trang để màn hiện nguồn mới", async () => {
    await toiBuocLuu();
    fireEvent.click(screen.getByRole("button", { name: "Lưu link vào bài" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(h.toastOk).toHaveBeenCalled();
  });

  it("server từ chối ⇒ hiện lỗi của server, GIỮ nguyên kết quả kiểm để bấm lại được", async () => {
    h.luu.mockResolvedValue({ ok: false, error: { code: "X", message: "Không có quyền" } });
    await toiBuocLuu();
    fireEvent.click(screen.getByRole("button", { name: "Lưu link vào bài" }));
    await waitFor(() => expect(h.toastLoi).toHaveBeenCalledWith("Không có quyền"));
    expect(h.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Lưu link vào bài" })).toBeTruthy();
  });
});

describe("[YTF-03] trạng thái hiện có của bài", () => {
  it("bài đang dùng YouTube ⇒ nói rõ, kèm thời lượng", () => {
    render(<YoutubeLinkForm {...PROPS} youtubeIdHienCo={MA} durationSecHienCo={754} />);
    expect(screen.getByText(/Bài đang dùng link YouTube/).textContent).toContain("12 phút 34 giây");
  });

  it("bài đang có tệp MP4 ⇒ cảnh báo lưu link sẽ thay tệp", () => {
    render(<YoutubeLinkForm {...PROPS} coTepHienCo />);
    expect(screen.getByText(/sẽ thay thế tệp đó/)).toBeTruthy();
  });

  it("giải thích Riêng tư KHÔNG dùng được và xem ngoài hệ thống không được tính", () => {
    render(<YoutubeLinkForm {...PROPS} />);
    const t = document.body.textContent!;
    expect(t).toContain("Riêng tư");
    expect(t).toContain("KHÔNG phát được");
    expect(t).toContain("không được tính");
  });
});

describe("[YTF-DN] đổi video của bài ĐÃ CÓ nguồn — xem trước tác động, lý do, xác nhận (server ép, form chỉ hỏi)", () => {
  const THONG_BAO = "Bài này đã có 5 lượt học (2 đã xong bài). Đổi video sẽ chụp lại rồi bắt đầu lại tiến độ. Xác nhận để tiếp tục.";
  const XT = {
    doiNguon: true,
    khoaDaXuatBan: true,
    coQuyenXuatBan: true,
    yeuCauQuyenXuatBan: true,
    yeuCauXacNhan: true,
    tacDong: { ghiDanhDangHoc: 3, ghiDanhDongBang: 2, daXongDangHoc: 1, daXongDongBang: 1, soCauHoiChen: 0 },
    thongBao: THONG_BAO,
    xacNhanToken: "chuoi-ky-1",
    hetHanLuc: 1,
  };
  const LY_DO = "Video cũ sai nội dung, thay bằng bản đã sửa";
  const DA_CO = { youtubeIdHienCo: "zzzzzzzzzzz", durationSecHienCo: 600, khoaDaXuatBan: true, coNguoiHoc: true };
  const NUT_LUU = "Xem tác động và lưu link";

  async function denBuocLuu(o: Partial<ComponentProps<typeof YoutubeLinkForm>> = DA_CO) {
    h.xem.mockResolvedValue({ ok: true, data: XT });
    render(<YoutubeLinkForm {...PROPS} {...o} />);
    dan(`https://youtu.be/${MA}`);
    bamKiem();
    await screen.findByTestId("yt-thoi-luong");
  }
  const dienVaBam = async (lyDo = LY_DO) => {
    await screen.findByTestId("xac-nhan-doi-video");
    fireEvent.change(screen.getByTestId("ly-do-doi-video"), { target: { value: lyDo } });
    fireEvent.click(screen.getByTestId("tick-xac-nhan-doi-video"));
    fireEvent.click(screen.getByTestId("nut-xac-nhan-doi-video"));
  };

  it("🔴 bài ĐÃ có nguồn: 'Lưu' ⇒ XEM TRƯỚC (đúng link chuẩn + thời lượng), hiện câu CỦA SERVER, CHƯA lưu, KHÔNG báo lỗi", async () => {
    await denBuocLuu();
    fireEvent.click(screen.getByRole("button", { name: NUT_LUU }));
    const hop = await screen.findByTestId("xac-nhan-doi-video");
    expect(hop.textContent).toContain(THONG_BAO);
    expect(h.xem).toHaveBeenCalledTimes(1);
    expect(h.xem.mock.calls[0]![0]).toEqual({ lessonId: "les1", loai: "YOUTUBE", url: `https://youtu.be/${MA}`, durationSec: 754 });
    expect(h.luu).not.toHaveBeenCalled();
    expect(h.toastLoi).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("🔴 nút xác nhận TẮT cho tới khi có lý do hợp lệ VÀ tick xác nhận", async () => {
    await denBuocLuu();
    fireEvent.click(screen.getByRole("button", { name: NUT_LUU }));
    await screen.findByTestId("xac-nhan-doi-video");
    const nut = screen.getByTestId("nut-xac-nhan-doi-video") as HTMLButtonElement;
    expect(nut.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("ly-do-doi-video"), { target: { value: LY_DO } });
    expect(nut.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("tick-xac-nhan-doi-video"));
    expect(nut.disabled).toBe(false);
    fireEvent.change(screen.getByTestId("ly-do-doi-video"), { target: { value: "ngắn" } });
    expect(nut.disabled).toBe(true);
  });

  it("🔴 bấm xác nhận ⇒ gửi lại kèm CHUỖI XÁC NHẬN của server (không phải cờ boolean) + LÝ DO, rồi làm mới trang", async () => {
    await denBuocLuu();
    fireEvent.click(screen.getByRole("button", { name: NUT_LUU }));
    await dienVaBam();
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(1));
    const [dau, tuyChon] = h.luu.mock.calls[0] as [Record<string, unknown>, { reason: string }];
    expect(dau).toEqual({
      lessonId: "les1",
      title: "Bài an toàn",
      url: `https://youtu.be/${MA}`,
      durationSec: 754,
      coPhuDe: false,
      xacNhanToken: "chuoi-ky-1",
    });
    expect(dau).not.toHaveProperty("xacNhanTacDong");
    expect(tuyChon).toEqual({ reason: LY_DO });
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    expect(screen.queryByTestId("xac-nhan-doi-video")).toBeNull();
  });

  it("🔴 TAC_DONG_DA_DOI ⇒ XEM TRƯỚC LẠI, hiện số liệu MỚI + báo thay đổi, ô TICK bị xoá (lý do đã gõ được GIỮ), KHÔNG báo lỗi chung; xác nhận lại ⇒ gửi CHUỖI MỚI", async () => {
    await denBuocLuu();
    h.xem
      .mockResolvedValueOnce({ ok: true, data: XT })
      .mockResolvedValueOnce({ ok: true, data: { ...XT, thongBao: "Bài này đã có 9 lượt học.", xacNhanToken: "chuoi-ky-2" } });
    h.luu.mockResolvedValueOnce({ ok: false, error: { code: "TAC_DONG_DA_DOI", message: "Người học bị ảnh hưởng đã thay đổi" } });
    fireEvent.click(screen.getByRole("button", { name: NUT_LUU }));
    await dienVaBam();
    await waitFor(() => expect(h.xem).toHaveBeenCalledTimes(2));
    await screen.findByTestId("doi-tap-nguoi-hoc");
    expect(screen.getByTestId("xac-nhan-doi-video").textContent).toContain("9 lượt học");
    expect((screen.getByTestId("ly-do-doi-video") as HTMLTextAreaElement).value).toBe(LY_DO); // giữ lý do, không bắt gõ lại
    expect((screen.getByTestId("tick-xac-nhan-doi-video") as HTMLInputElement).checked).toBe(false); // nhưng xác nhận phải làm lại trên số liệu MỚI
    expect((screen.getByTestId("nut-xac-nhan-doi-video") as HTMLButtonElement).disabled).toBe(true);
    expect(h.toastLoi).not.toHaveBeenCalled();
    expect(h.luu).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("tick-xac-nhan-doi-video"));
    fireEvent.click(screen.getByTestId("nut-xac-nhan-doi-video"));
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(2));
    expect(h.luu.mock.calls[1]![0]).toMatchObject({ xacNhanToken: "chuoi-ky-2" });
  });

  it("lỗi chính sách khác (thiếu lý do, thiếu quyền) ⇒ hiện NGAY TRONG hộp; hộp còn nguyên", async () => {
    await denBuocLuu();
    h.luu.mockResolvedValueOnce({ ok: false, error: { code: "CAN_QUYEN_XUAT_BAN", message: "Khoá này đã xuất bản — cần quyền xuất bản." } });
    fireEvent.click(screen.getByRole("button", { name: NUT_LUU }));
    await dienVaBam();
    expect((await screen.findByTestId("loi-doi-video")).textContent).toContain("cần quyền xuất bản");
    expect(screen.getByTestId("xac-nhan-doi-video")).toBeTruthy();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("'Không đổi' ⇒ đóng hộp, KHÔNG lưu, nút xem tác động quay lại", async () => {
    await denBuocLuu();
    fireEvent.click(screen.getByRole("button", { name: NUT_LUU }));
    await screen.findByTestId("xac-nhan-doi-video");
    fireEvent.click(screen.getByRole("button", { name: "Không đổi" }));
    expect(screen.queryByTestId("xac-nhan-doi-video")).toBeNull();
    expect(screen.getByRole("button", { name: NUT_LUU })).toBeTruthy();
    expect(h.luu).not.toHaveBeenCalled();
  });

  it("khoá NHÁP, chưa ai học (không cần xác nhận): vẫn phải ghi LÝ DO, KHÔNG có ô tick, nút bật khi đủ lý do, KHÔNG gửi chuỗi", async () => {
    await denBuocLuu({ ...DA_CO, khoaDaXuatBan: false, coNguoiHoc: false });
    h.xem.mockResolvedValue({
      ok: true,
      data: { ...XT, khoaDaXuatBan: false, yeuCauQuyenXuatBan: false, yeuCauXacNhan: false, thongBao: null, xacNhanToken: null, tacDong: { ...XT.tacDong, ghiDanhDangHoc: 0, ghiDanhDongBang: 0 } },
    });
    fireEvent.click(screen.getByRole("button", { name: NUT_LUU }));
    await screen.findByTestId("xac-nhan-doi-video");
    expect(screen.queryByTestId("tick-xac-nhan-doi-video")).toBeNull();
    const nut = screen.getByTestId("nut-xac-nhan-doi-video") as HTMLButtonElement;
    expect(nut.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("ly-do-doi-video"), { target: { value: LY_DO } });
    expect(nut.disabled).toBe(false);
    fireEvent.click(nut);
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(1));
    expect(h.luu.mock.calls[0]![0]).not.toHaveProperty("xacNhanToken");
    expect(h.luu.mock.calls[0]![1]).toEqual({ reason: LY_DO });
  });

  it("xem trước báo KHÔNG đổi nội dung thật ⇒ lưu thẳng, không hộp, không lý do", async () => {
    await denBuocLuu();
    h.xem.mockResolvedValue({ ok: true, data: { ...XT, doiNguon: false, yeuCauXacNhan: false, thongBao: null, xacNhanToken: null } });
    fireEvent.click(screen.getByRole("button", { name: NUT_LUU }));
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("xac-nhan-doi-video")).toBeNull();
    expect(h.luu.mock.calls[0]![1]).toBeUndefined();
  });

  it("bài CHƯA có nguồn ⇒ KHÔNG xem trước, lưu thẳng bằng nút 'Lưu link vào bài'", async () => {
    render(<YoutubeLinkForm {...PROPS} />);
    dan(`https://youtu.be/${MA}`);
    bamKiem();
    await screen.findByTestId("yt-thoi-luong");
    fireEvent.click(screen.getByRole("button", { name: "Lưu link vào bài" }));
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(1));
    expect(h.xem).not.toHaveBeenCalled();
  });

  it("kiểm tra LINK KHÁC sau khi đã hiện hộp ⇒ hộp cũ biến mất (bản xem trước thuộc về link cũ)", async () => {
    await denBuocLuu();
    fireEvent.click(screen.getByRole("button", { name: NUT_LUU }));
    await screen.findByTestId("xac-nhan-doi-video");
    dan("https://youtu.be/QqQqQqQqQq1");
    bamKiem();
    await waitFor(() => expect(screen.queryByTestId("xac-nhan-doi-video")).toBeNull());
  });

  it("🔴 khoá ĐÃ XUẤT BẢN + thiếu quyền xuất bản ⇒ ô dán link và nút Kiểm tra bị khoá, nói rõ vì sao (server vẫn kiểm)", () => {
    render(<YoutubeLinkForm {...PROPS} {...DA_CO} coQuyenXuatBan={false} />);
    expect((screen.getByLabelText("Link YouTube") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Kiểm tra link" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("khong-du-quyen-doi-video").textContent).toContain("quyền xuất bản");
  });

  it("đối chứng dương: có quyền xuất bản ⇒ ô dán link mở; khoá nháp chưa ai học + thiếu quyền ⇒ cũng KHÔNG bị chặn", () => {
    const { unmount } = render(<YoutubeLinkForm {...PROPS} {...DA_CO} coQuyenXuatBan />);
    expect((screen.getByLabelText("Link YouTube") as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByTestId("khong-du-quyen-doi-video")).toBeNull();
    unmount();
    render(<YoutubeLinkForm {...PROPS} {...DA_CO} khoaDaXuatBan={false} coNguoiHoc={false} coQuyenXuatBan={false} />);
    expect((screen.getByLabelText("Link YouTube") as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByTestId("khong-du-quyen-doi-video")).toBeNull();
  });
});

describe("[YTF-HD] hardening: closure cũ, xác nhận hết hạn, thiếu quyền, nhãn nút", () => {
  const XT = {
    doiNguon: true,
    khoaDaXuatBan: true,
    coQuyenXuatBan: true,
    yeuCauQuyenXuatBan: true,
    yeuCauXacNhan: true,
    tacDong: { ghiDanhDangHoc: 3, ghiDanhDongBang: 2, daXongDangHoc: 1, daXongDongBang: 1, soCauHoiChen: 0 },
    thongBao: "Bài này đã có 5 lượt học.",
    xacNhanToken: "chuoi-ky-1",
    hetHanLuc: 1,
  };
  const LY_DO = "Video cũ sai nội dung, thay bằng bản đã sửa";
  const DA_CO: Partial<ComponentProps<typeof YoutubeLinkForm>> = { youtubeIdHienCo: "zzzzzzzzzzz", durationSecHienCo: 600, khoaDaXuatBan: true, coNguoiHoc: true };

  async function den(xtKetQua: unknown = XT, o: Partial<ComponentProps<typeof YoutubeLinkForm>> = DA_CO) {
    h.xem.mockResolvedValue({ ok: true, data: xtKetQua });
    render(<YoutubeLinkForm {...PROPS} {...o} />);
    dan(`https://youtu.be/${MA}`);
    bamKiem();
    await screen.findByTestId("yt-thoi-luong");
    fireEvent.click(screen.getByRole("button", { name: "Xem tác động và lưu link" }));
    await screen.findByTestId("xac-nhan-doi-video");
  }
  const dienVaBam = async () => {
    fireEvent.change(screen.getByTestId("ly-do-doi-video"), { target: { value: LY_DO } });
    const tick = screen.queryByTestId("tick-xac-nhan-doi-video");
    if (tick && !(tick as HTMLInputElement).checked) fireEvent.click(tick);
    fireEvent.click(screen.getByTestId("nut-xac-nhan-doi-video"));
  };

  it("🔴 closure cũ: sau TAC_DONG_DA_DOI mà xem trước lại báo 'không còn đổi' ⇒ lưu thẳng; lưu thẳng LỖI ⇒ báo lỗi và form THOÁT được (không kẹt 'Đang xử lý…', không nuốt lỗi)", async () => {
    await den();
    h.luu
      .mockResolvedValueOnce({ ok: false, error: { code: "TAC_DONG_DA_DOI", message: "Người học bị ảnh hưởng đã thay đổi" } })
      .mockResolvedValueOnce({ ok: false, error: { code: "KHAC", message: "Mạng chập chờn" } });
    h.xem.mockResolvedValue({ ok: true, data: { ...XT, doiNguon: false, yeuCauXacNhan: false, yeuCauQuyenXuatBan: false, thongBao: null, xacNhanToken: null } });
    await dienVaBam();
    await waitFor(() => expect(h.luu).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(h.toastLoi).toHaveBeenCalledWith("Mạng chập chờn"));
    // thoát được: nút xem tác động có lại, bấm được
    const nut = (await screen.findByRole("button", { name: "Xem tác động và lưu link" })) as HTMLButtonElement;
    expect(nut.disabled).toBe(false);
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("🔴 xác nhận HẾT HẠN / nội dung bài đã đổi (CAN_XAC_NHAN_TAC_DONG) ⇒ hộp mới có câu giải thích và GIỮ lý do đã gõ", async () => {
    await den();
    h.luu.mockResolvedValueOnce({ ok: false, error: { code: "CAN_XAC_NHAN_TAC_DONG", message: "Bài này đã có 5 lượt học." } });
    await dienVaBam();
    await waitFor(() => expect(h.xem).toHaveBeenCalledTimes(2));
    expect((await screen.findByTestId("loi-doi-video")).textContent).toContain("hết hiệu lực");
    expect((screen.getByTestId("ly-do-doi-video") as HTMLTextAreaElement).value).toBe(LY_DO);
    expect(screen.queryByTestId("doi-tap-nguoi-hoc")).toBeNull(); // đây không phải 'tập người học đổi'
  });

  it("🔴 người THIẾU quyền xuất bản (server báo `yeuCauQuyenXuatBan` + số liệu RỖNG): hộp chỉ nói thiếu quyền — không ô lý do, không nút xác nhận, không số liệu", async () => {
    await den({
      ...XT,
      coQuyenXuatBan: false,
      tacDong: { ghiDanhDangHoc: 0, ghiDanhDongBang: 0, daXongDangHoc: 0, daXongDongBang: 0, soCauHoiChen: 0 },
      thongBao: null,
      xacNhanToken: null,
      hetHanLuc: null,
    }, { ...DA_CO, coQuyenXuatBan: true /* cờ UI cũ còn sáng; server là cổng */ });
    expect(screen.getByTestId("thieu-quyen-doi-video").textContent).toContain("quyền xuất bản");
    expect(screen.queryByTestId("ly-do-doi-video")).toBeNull();
    expect(screen.queryByTestId("nut-xac-nhan-doi-video")).toBeNull();
    expect(screen.getByTestId("xac-nhan-doi-video").textContent).not.toMatch(/lượt học/);
    expect(h.luu).not.toHaveBeenCalled();
  });

  it("nhãn nút nói đúng việc: khoá đã xuất bản nhưng CHƯA AI HỌC ⇒ 'Đổi video' (không hứa 'bắt đầu lại tiến độ'); thông báo thành công cũng vậy", async () => {
    await den({ ...XT, tacDong: { ghiDanhDangHoc: 0, ghiDanhDongBang: 0, daXongDangHoc: 0, daXongDongBang: 0, soCauHoiChen: 0 }, thongBao: "Hiện chưa có ai xem bài này." });
    expect(screen.getByTestId("nut-xac-nhan-doi-video").textContent).toBe("Đổi video");
    await dienVaBam();
    await waitFor(() => expect(h.toastOk).toHaveBeenCalledWith("Đã đổi video của bài"));
    expect(h.toastOk.mock.calls[0]![0]).not.toMatch(/bắt đầu lại/);
  });

  it("đối chứng: có lượt ĐANG HỌC ⇒ nhãn nói 'bắt đầu lại tiến độ'; thông báo thành công cũng vậy", async () => {
    await den();
    expect(screen.getByTestId("nut-xac-nhan-doi-video").textContent).toBe("Đổi video và bắt đầu lại tiến độ");
    await dienVaBam();
    await waitFor(() => expect(h.toastOk).toHaveBeenCalled());
    expect(h.toastOk.mock.calls[0]![0]).toMatch(/bắt đầu lại/);
  });
});
