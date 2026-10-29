// @vitest-environment jsdom
/**
 * EL-10 — màn tải video: lượt tải HỎNG GIỮA CHỪNG phải tự gửi lệnh huỷ.
 *
 * Hồi quy 25/08/2026. Bản đầu viết `if (dangHuy) await huy()` trong nhánh `catch`,
 * với `dangHuy` là STATE. `tai()` chạy trọn trong MỘT lượt kết xuất, nên
 * `setDangHuy(...)` gọi ở giữa hàm chỉ xếp lịch cho lượt kết xuất SAU — biến đã
 * đóng gói trong chính lượt gọi này vẫn là `null`. Điều kiện luôn sai ⇒ lệnh huỷ
 * KHÔNG BAO GIỜ được gửi.
 *
 * Vì sao nó lọt: case canh nó là một phép so CHUỖI MÃ NGUỒN
 * (`toContain("if (dangHuy) await huy()")`). Chuỗi đó có mặt đầy đủ, nên guard
 * xanh — trong khi hành vi thật là mã chết. Đây là bài học lặp lại lần thứ hai
 * trong cùng ticket: guard so chuỗi chỉ chứng minh CÓ VIẾT, không chứng minh
 * CÓ CHẠY. Case dưới đây bấm thật, hỏng thật, rồi soi lệnh đã gửi.
 *
 * Hỏng im lặng, chỉ thấy trên hoá đơn: các phần đã tải nằm lại R2 và R2 tính tiền
 * chúng cho tới khi cron đêm dọn — sau 24 giờ.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VideoUploader } from "./video-uploader";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// Server action — import thật sẽ kéo cả chuỗi prisma vào jsdom.
vi.mock("../_actions", () => ({
  luuBaiVideoAction: vi.fn(async () => ({ ok: true, data: { durationSec: 600 } })),
  xemTruocDoiNguonAction: vi.fn(),
}));

const KHOA = "elearning/master/lesson-1/uuid-1.mp4";
const UPLOAD_ID = "upload-abc";

/** Thân JSON theo khuôn `ok()` của `@/lib/api/response`. */
const than = (data: unknown) =>
  ({ json: async () => ({ ok: true, data }) }) as unknown as Response;

beforeAll(() => {
  // jsdom không giải mã media: `loadedmetadata` không bao giờ bắn, mà
  // `docSieuDuLieu` lại CHỜ đúng sự kiện đó. Không dựng thì test treo, không đỏ.
  Object.defineProperty(HTMLMediaElement.prototype, "duration", {
    get: () => 600,
    configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    get: () => 1280,
    configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    get: () => 720,
    configurable: true,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "src", {
    get: () => "",
    set(this: HTMLMediaElement) {
      queueMicrotask(() => this.onloadedmetadata?.(new Event("loadedmetadata")));
    },
    configurable: true,
  });
  URL.createObjectURL = vi.fn(() => "blob:giả-lập");
  URL.revokeObjectURL = vi.fn();
});

let buocDaGui: string[] = [];
let thanHuy: Record<string, unknown> | null = null;

/** Cho phép từng case quyết định lượt PUT lên R2 hỏng hay không. */
let phanHong = true;

beforeEach(() => {
  buocDaGui = [];
  thanHuy = null;
  phanHong = true;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);

      if (u.includes("/api/elearning/media/upload")) {
        const b = JSON.parse(String(init?.body)) as Record<string, unknown>;
        buocDaGui.push(String(b.buoc));
        if (b.buoc === "tao") {
          return than({ khoa: KHOA, uploadId: UPLOAD_ID, soPhan: 2, partSize: 8 * 1024 * 1024 });
        }
        if (b.buoc === "ky-phan") {
          return than({
            links: [
              { partNumber: 1, url: "https://r2.giả-lập/p1" },
              { partNumber: 2, url: "https://r2.giả-lập/p2" },
            ],
          });
        }
        if (b.buoc === "huy") {
          thanHuy = b;
          return than({ daHuy: true });
        }
        return than({});
      }

      // Lượt PUT thẳng lên R2.
      if (u.startsWith("https://r2.")) {
        return {
          ok: !phanHong,
          headers: { get: () => (phanHong ? null : '"etag-1"') },
        } as unknown as Response;
      }

      if (u.includes("/api/elearning/media/xac-minh")) {
        return {
          json: async () => ({
            ok: true,
            data: {
              durationSec: 600,
              rong: 1280,
              cao: 720,
              videoCodec: "avc1",
              audioCodec: "mp4a",
              brand: "isom",
            },
          }),
        } as unknown as Response;
      }

      throw new Error(`fetch không mong đợi: ${u}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type CoBai = Partial<{
  videoKeyHienCo: string | null;
  coNguonHienCo: boolean;
  coQuyenXuatBan: boolean;
  khoaDaXuatBan: boolean;
  coNguoiHoc: boolean;
}>;

/** Mặc định: bài CHƯA có nguồn (gắn lần đầu) — luồng cũ, không xem trước, không hỏi gì. */
function veForm(o: CoBai = {}) {
  return render(
    <VideoUploader
      lessonId="lesson-1"
      title="Bài 1"
      videoKeyHienCo={o.videoKeyHienCo ?? null}
      durationSecHienCo={o.videoKeyHienCo ? 600 : null}
      coNguonHienCo={o.coNguonHienCo ?? false}
      coQuyenXuatBan={o.coQuyenXuatBan ?? true}
      khoaDaXuatBan={o.khoaDaXuatBan ?? false}
      coNguoiHoc={o.coNguoiHoc ?? false}
    />,
  );
}

function chonTep(o: CoBai = {}) {
  veForm(o);
  // Bài ĐANG có MP4: ô chọn tệp chỉ hiện sau khi bấm 'Tải tệp mới thay thế' (đổi MP4 sang MP4 là việc có chủ đích).
  if (o.videoKeyHienCo) fireEvent.click(screen.getByTestId("thay-tep-video"));
  const oChon = screen.getByLabelText("Chọn tệp video MP4");
  const tep = new File([new Uint8Array(16)], "bai-1.mp4", { type: "video/mp4" });
  fireEvent.change(oChon, { target: { files: [tep] } });
}

describe("lượt tải hỏng giữa chừng", () => {
  it("🔴 PUT một phần thất bại ⇒ GỬI lệnh huỷ, đúng uploadId", async () => {
    chonTep();

    await waitFor(() => expect(buocDaGui).toContain("huy"), { timeout: 4000 });
    expect(thanHuy).toMatchObject({ buoc: "huy", khoa: KHOA, uploadId: UPLOAD_ID });
  });

  it("không hoàn tất lượt tải hỏng — `hoan-tat` KHÔNG được gửi", async () => {
    // Hoàn tất một lượt thiếu phần là để R2 ghép ra tệp hợp lệ về cấu trúc nhưng
    // hỏng nội dung, và không lỗi nào nổ ra.
    chonTep();

    await waitFor(() => expect(buocDaGui).toContain("huy"), { timeout: 4000 });
    expect(buocDaGui).not.toContain("hoan-tat");
  });
});

describe("lượt tải trót lọt", () => {
  it("tải xong thì KHÔNG gửi lệnh huỷ", async () => {
    // Guard hai chiều: nếu ai đó "vá" bằng cách gọi `huy()` vô điều kiện thì lượt
    // tải thành công cũng bị xoá tệp vừa tải lên.
    phanHong = false;
    chonTep();

    await waitFor(() => expect(buocDaGui).toContain("hoan-tat"), { timeout: 4000 });
    expect(buocDaGui).not.toContain("huy");
  });
});

describe("[VUP-DN] đổi video của bài ĐÃ CÓ nguồn — xem trước tác động, lý do, xác nhận (server ép, form chỉ hỏi)", () => {
  const THONG_BAO = "Bài này đã có 4 lượt học. Đổi video sẽ bắt đầu lại tiến độ. Xác nhận để tiếp tục.";
  const XT = {
    doiNguon: true,
    khoaDaXuatBan: true,
    coQuyenXuatBan: true,
    yeuCauQuyenXuatBan: true,
    yeuCauXacNhan: true,
    tacDong: { ghiDanhDangHoc: 3, ghiDanhDongBang: 1, daXongDangHoc: 1, daXongDongBang: 1, soCauHoiChen: 0 },
    thongBao: THONG_BAO,
    xacNhanToken: "chuoi-ky-1",
    hetHanLuc: 1,
  };
  const LY_DO = "Thay bằng bản quay lại đã sửa lỗi âm thanh";

  async function acts() {
    const m = await import("../_actions");
    const luu = vi.mocked(m.luuBaiVideoAction);
    const xem = vi.mocked(m.xemTruocDoiNguonAction);
    luu.mockReset();
    xem.mockReset();
    luu.mockResolvedValue({ ok: true, data: { durationSec: 600 } } as never);
    xem.mockResolvedValue({ ok: true, data: XT } as never);
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear(); // mock dùng chung cả tệp: bỏ lỗi của các ca trước
    refresh.mockClear();
    phanHong = false; // lượt PUT lên R2 thành công
    return { luu, xem, toast };
  }

  const DA_CO = { videoKeyHienCo: "elearning/master/lesson-1/cu.mp4", coNguonHienCo: true, khoaDaXuatBan: true, coNguoiHoc: true };

  /** Từ lúc hiện hộp: đọc → ghi lý do → tick → bấm. */
  const dienVaBam = async (lyDo = LY_DO) => {
    await screen.findByTestId("xac-nhan-doi-video");
    fireEvent.change(screen.getByTestId("ly-do-doi-video"), { target: { value: lyDo } });
    fireEvent.click(screen.getByTestId("tick-xac-nhan-doi-video"));
    fireEvent.click(screen.getByTestId("nut-xac-nhan-doi-video"));
  };

  it("🔴 bài ĐÃ có nguồn: tải xong ⇒ XEM TRƯỚC (đúng khoá tệp + thời lượng), hiện câu của server, CHƯA lưu, KHÔNG huỷ lượt tải, KHÔNG báo lỗi", async () => {
    const { luu, xem, toast } = await acts();
    chonTep(DA_CO);
    const hop = await screen.findByTestId("xac-nhan-doi-video");
    expect(hop.textContent).toContain(THONG_BAO);
    expect(xem).toHaveBeenCalledTimes(1);
    expect(xem.mock.calls[0]![0]).toEqual({ lessonId: "lesson-1", loai: "TEP", videoKey: KHOA, durationSec: 600 });
    expect(luu).not.toHaveBeenCalled();
    expect(thanHuy).toBeNull();
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it("🔴 nút xác nhận TẮT cho tới khi có lý do hợp lệ VÀ tick xác nhận (khoá đã xuất bản)", async () => {
    await acts();
    chonTep(DA_CO);
    await screen.findByTestId("xac-nhan-doi-video");
    const nut = screen.getByTestId("nut-xac-nhan-doi-video") as HTMLButtonElement;
    expect(nut.disabled).toBe(true); // chưa gì cả
    fireEvent.change(screen.getByTestId("ly-do-doi-video"), { target: { value: LY_DO } });
    expect(nut.disabled).toBe(true); // có lý do, chưa tick
    fireEvent.click(screen.getByTestId("tick-xac-nhan-doi-video"));
    expect(nut.disabled).toBe(false);
    fireEvent.change(screen.getByTestId("ly-do-doi-video"), { target: { value: "abc" } });
    expect(nut.disabled).toBe(true); // lý do quá ngắn (< 5 ký tự)
  });

  it("🔴 bấm xác nhận ⇒ gửi lại ĐÚNG đầu vào kèm CHUỖI XÁC NHẬN của server (không phải cờ boolean) + LÝ DO, không tải lại tệp, rồi làm mới trang", async () => {
    const { luu } = await acts();
    chonTep(DA_CO);
    await screen.findByTestId("xac-nhan-doi-video");
    const soLanTai = buocDaGui.filter((b) => b === "tao").length;
    await dienVaBam();
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
    const [dau, tuyChon] = luu.mock.calls[0] as unknown as [Record<string, unknown>, { reason: string }];
    expect(dau).toMatchObject({ lessonId: "lesson-1", videoKey: KHOA, durationSec: 600, xacNhanToken: "chuoi-ky-1" });
    expect(dau).not.toHaveProperty("xacNhanTacDong");
    expect(tuyChon).toEqual({ reason: LY_DO });
    expect(buocDaGui.filter((b) => b === "tao").length).toBe(soLanTai);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByTestId("xac-nhan-doi-video")).toBeNull();
  });

  it("🔴 TAC_DONG_DA_DOI (có người bắt đầu học từ lúc xem trước) ⇒ XEM TRƯỚC LẠI, hiện số liệu MỚI + báo thay đổi, ô TICK bị xoá (lý do GIỮ), KHÔNG lưu, KHÔNG báo lỗi chung", async () => {
    const { luu, xem, toast } = await acts();
    xem
      .mockResolvedValueOnce({ ok: true, data: XT } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: { ...XT, thongBao: "Bài này đã có 9 lượt học.", xacNhanToken: "chuoi-ky-2" },
      } as never);
    luu.mockResolvedValueOnce({ ok: false, error: { code: "TAC_DONG_DA_DOI", message: "Người học bị ảnh hưởng đã thay đổi" } } as never);
    chonTep(DA_CO);
    await dienVaBam();
    await waitFor(() => expect(xem).toHaveBeenCalledTimes(2));
    await screen.findByTestId("doi-tap-nguoi-hoc");
    expect(screen.getByTestId("xac-nhan-doi-video").textContent).toContain("9 lượt học");
    expect((screen.getByTestId("ly-do-doi-video") as HTMLTextAreaElement).value).toBe(LY_DO); // lý do GIỮ
    expect((screen.getByTestId("tick-xac-nhan-doi-video") as HTMLInputElement).checked).toBe(false); // xác nhận phải làm lại
    expect((screen.getByTestId("nut-xac-nhan-doi-video") as HTMLButtonElement).disabled).toBe(true);
    expect(luu).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    // xác nhận lại ⇒ lần gửi thứ hai mang CHUỖI MỚI
    fireEvent.click(screen.getByTestId("tick-xac-nhan-doi-video"));
    fireEvent.click(screen.getByTestId("nut-xac-nhan-doi-video"));
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(2));
    expect(luu.mock.calls[1]![0]).toMatchObject({ xacNhanToken: "chuoi-ky-2" });
  });

  it("lỗi chính sách khác của lần lưu (vd thiếu lý do) ⇒ hiện NGAY TRONG hộp, hộp còn nguyên để sửa rồi bấm lại", async () => {
    const { luu } = await acts();
    luu.mockResolvedValueOnce({ ok: false, error: { code: "CAN_LY_DO", message: "Cần ghi lý do đổi video (từ 5 đến 500 ký tự)." } } as never);
    chonTep(DA_CO);
    await dienVaBam();
    expect((await screen.findByTestId("loi-doi-video")).textContent).toContain("lý do");
    expect(screen.getByTestId("xac-nhan-doi-video")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("'Không đổi' ⇒ đóng hộp, KHÔNG lưu", async () => {
    const { luu } = await acts();
    chonTep(DA_CO);
    await screen.findByTestId("xac-nhan-doi-video");
    fireEvent.click(screen.getByRole("button", { name: "Không đổi" }));
    expect(screen.queryByTestId("xac-nhan-doi-video")).toBeNull();
    expect(luu).not.toHaveBeenCalled();
  });

  it("khoá NHÁP, chưa ai học (không cần xác nhận): vẫn phải ghi LÝ DO, KHÔNG có ô tick, nút bật khi đủ lý do", async () => {
    const { xem, luu } = await acts();
    xem.mockResolvedValue({
      ok: true,
      data: { ...XT, khoaDaXuatBan: false, yeuCauQuyenXuatBan: false, yeuCauXacNhan: false, thongBao: null, xacNhanToken: null, tacDong: { ...XT.tacDong, ghiDanhDangHoc: 0, ghiDanhDongBang: 0 } },
    } as never);
    chonTep({ ...DA_CO, khoaDaXuatBan: false, coNguoiHoc: false });
    await screen.findByTestId("xac-nhan-doi-video");
    expect(screen.queryByTestId("tick-xac-nhan-doi-video")).toBeNull();
    const nut = screen.getByTestId("nut-xac-nhan-doi-video") as HTMLButtonElement;
    expect(nut.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("ly-do-doi-video"), { target: { value: LY_DO } });
    expect(nut.disabled).toBe(false);
    fireEvent.click(nut);
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
    expect(luu.mock.calls[0]![0]).not.toHaveProperty("xacNhanToken");
    expect(luu.mock.calls[0]![1]).toEqual({ reason: LY_DO });
  });

  it("xem trước báo KHÔNG đổi nội dung thật ⇒ lưu thẳng, không hộp, không lý do", async () => {
    const { xem, luu } = await acts();
    xem.mockResolvedValue({ ok: true, data: { ...XT, doiNguon: false, yeuCauXacNhan: false, thongBao: null, xacNhanToken: null } } as never);
    chonTep(DA_CO);
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("xac-nhan-doi-video")).toBeNull();
    expect(luu.mock.calls[0]![1]).toBeUndefined();
  });

  it("bài CHƯA có nguồn (gắn lần đầu) ⇒ KHÔNG xem trước, lưu thẳng", async () => {
    const { xem, luu } = await acts();
    chonTep();
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(1));
    expect(xem).not.toHaveBeenCalled();
    expect(screen.queryByTestId("xac-nhan-doi-video")).toBeNull();
  });
});

describe("[VUP-MP4] thay MP4 bằng MP4 mới, và vô hiệu hoá khi không đủ quyền", () => {
  const DA_CO = { videoKeyHienCo: "elearning/master/lesson-1/cu.mp4", coNguonHienCo: true };

  it("🔴 bài đang có MP4 ⇒ có nút 'Tải tệp mới thay thế'; bấm ⇒ hiện ô chọn tệp", () => {
    veForm(DA_CO);
    expect(screen.queryByLabelText("Chọn tệp video MP4")).toBeNull();
    fireEvent.click(screen.getByTestId("thay-tep-video"));
    expect(screen.getByLabelText("Chọn tệp video MP4")).toBeTruthy();
  });

  it("bài chưa có nguồn ⇒ ô chọn tệp hiện sẵn, không có nút thay", () => {
    veForm();
    expect(screen.getByLabelText("Chọn tệp video MP4")).toBeTruthy();
    expect(screen.queryByTestId("thay-tep-video")).toBeNull();
  });

  it("🔴 khoá ĐÃ XUẤT BẢN + thiếu quyền xuất bản ⇒ KHÔNG vẽ nút thay lẫn ô chọn tệp, nói rõ vì sao (server vẫn kiểm)", () => {
    veForm({ ...DA_CO, khoaDaXuatBan: true, coQuyenXuatBan: false });
    expect(screen.queryByTestId("thay-tep-video")).toBeNull();
    expect(screen.queryByLabelText("Chọn tệp video MP4")).toBeNull();
    expect(screen.getByTestId("khong-du-quyen-doi-video").textContent).toContain("quyền xuất bản");
  });

  it("bài đã có người học (khoá nháp) + thiếu quyền ⇒ cũng bị vô hiệu hoá", () => {
    veForm({ ...DA_CO, khoaDaXuatBan: false, coNguoiHoc: true, coQuyenXuatBan: false });
    expect(screen.queryByTestId("thay-tep-video")).toBeNull();
    expect(screen.getByTestId("khong-du-quyen-doi-video").textContent).toContain("đã có người học");
  });

  it("đối chứng dương: khoá đã xuất bản + CÓ quyền xuất bản ⇒ nút thay có, không có câu chặn", () => {
    veForm({ ...DA_CO, khoaDaXuatBan: true, coQuyenXuatBan: true });
    expect(screen.getByTestId("thay-tep-video")).toBeTruthy();
    expect(screen.queryByTestId("khong-du-quyen-doi-video")).toBeNull();
  });

  it("khoá nháp, chưa ai học, thiếu quyền xuất bản ⇒ KHÔNG bị chặn (người soạn thường đổi được bài nháp)", () => {
    veForm({ ...DA_CO, khoaDaXuatBan: false, coNguoiHoc: false, coQuyenXuatBan: false });
    expect(screen.getByTestId("thay-tep-video")).toBeTruthy();
    expect(screen.queryByTestId("khong-du-quyen-doi-video")).toBeNull();
  });
});

describe("[VUP-HD] hardening: closure cũ, xác nhận hết hạn, thiếu quyền, nhãn nút", () => {
  const XT = {
    doiNguon: true,
    khoaDaXuatBan: true,
    coQuyenXuatBan: true,
    yeuCauQuyenXuatBan: true,
    yeuCauXacNhan: true,
    tacDong: { ghiDanhDangHoc: 3, ghiDanhDongBang: 1, daXongDangHoc: 1, daXongDongBang: 1, soCauHoiChen: 0 },
    thongBao: "Bài này đã có 4 lượt học.",
    xacNhanToken: "chuoi-ky-1",
    hetHanLuc: 1,
  };
  const LY_DO = "Thay bằng bản quay lại đã sửa lỗi âm thanh";
  const DA_CO = { videoKeyHienCo: "elearning/master/lesson-1/cu.mp4", coNguonHienCo: true, khoaDaXuatBan: true, coNguoiHoc: true };

  async function acts(xtKetQua: unknown = XT) {
    const m = await import("../_actions");
    const luu = vi.mocked(m.luuBaiVideoAction);
    const xem = vi.mocked(m.xemTruocDoiNguonAction);
    luu.mockReset();
    xem.mockReset();
    luu.mockResolvedValue({ ok: true, data: { durationSec: 600 } } as never);
    xem.mockResolvedValue({ ok: true, data: xtKetQua } as never);
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    refresh.mockClear();
    phanHong = false;
    return { luu, xem, toast };
  }
  const dienVaBam = async () => {
    await screen.findByTestId("xac-nhan-doi-video");
    fireEvent.change(screen.getByTestId("ly-do-doi-video"), { target: { value: LY_DO } });
    const tick = screen.queryByTestId("tick-xac-nhan-doi-video");
    if (tick && !(tick as HTMLInputElement).checked) fireEvent.click(tick);
    fireEvent.click(screen.getByTestId("nut-xac-nhan-doi-video"));
  };

  it("🔴 closure cũ: sau TAC_DONG_DA_DOI mà xem trước lại báo 'không còn đổi' ⇒ lưu thẳng; lưu thẳng LỖI ⇒ báo lỗi và form THOÁT được (không nuốt lỗi, không kẹt)", async () => {
    const { luu, xem, toast } = await acts();
    chonTep(DA_CO);
    await screen.findByTestId("xac-nhan-doi-video");
    luu
      .mockResolvedValueOnce({ ok: false, error: { code: "TAC_DONG_DA_DOI", message: "Người học bị ảnh hưởng đã thay đổi" } } as never)
      .mockResolvedValueOnce({ ok: false, error: { code: "KHAC", message: "Mạng chập chờn" } } as never);
    xem.mockResolvedValue({ ok: true, data: { ...XT, doiNguon: false, yeuCauXacNhan: false, yeuCauQuyenXuatBan: false, thongBao: null, xacNhanToken: null } } as never);
    await dienVaBam();
    await waitFor(() => expect(luu).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Mạng chập chờn"));
    // thoát được: về trạng thái có nút thay tệp (bài vẫn có MP4 cũ), không kẹt ở 'đang lưu'
    expect(await screen.findByTestId("thay-tep-video")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("🔴 xác nhận HẾT HẠN / nội dung bài đã đổi (CAN_XAC_NHAN_TAC_DONG) ⇒ hộp mới có câu giải thích và GIỮ lý do đã gõ", async () => {
    const { luu, xem } = await acts();
    chonTep(DA_CO);
    luu.mockResolvedValueOnce({ ok: false, error: { code: "CAN_XAC_NHAN_TAC_DONG", message: "Bài này đã có 4 lượt học." } } as never);
    await dienVaBam();
    await waitFor(() => expect(xem).toHaveBeenCalledTimes(2));
    expect((await screen.findByTestId("loi-doi-video")).textContent).toContain("hết hiệu lực");
    expect((screen.getByTestId("ly-do-doi-video") as HTMLTextAreaElement).value).toBe(LY_DO);
    expect(screen.queryByTestId("doi-tap-nguoi-hoc")).toBeNull();
  });

  it("🔴 người THIẾU quyền xuất bản (server báo `yeuCauQuyenXuatBan` + số liệu RỖNG): hộp chỉ nói thiếu quyền — không ô lý do, không nút xác nhận, không số liệu", async () => {
    const { luu } = await acts({
      ...XT,
      coQuyenXuatBan: false,
      tacDong: { ghiDanhDangHoc: 0, ghiDanhDongBang: 0, daXongDangHoc: 0, daXongDongBang: 0, soCauHoiChen: 0 },
      thongBao: null,
      xacNhanToken: null,
      hetHanLuc: null,
    });
    chonTep({ ...DA_CO, coQuyenXuatBan: true /* cờ UI cũ còn sáng; server là cổng */ });
    await screen.findByTestId("xac-nhan-doi-video");
    expect(screen.getByTestId("thieu-quyen-doi-video").textContent).toContain("quyền xuất bản");
    expect(screen.queryByTestId("ly-do-doi-video")).toBeNull();
    expect(screen.queryByTestId("nut-xac-nhan-doi-video")).toBeNull();
    expect(screen.getByTestId("xac-nhan-doi-video").textContent).not.toMatch(/lượt học/);
    expect(luu).not.toHaveBeenCalled();
  });

  it("nhãn nút nói đúng việc: khoá đã xuất bản nhưng CHƯA AI HỌC ⇒ 'Đổi video' (không hứa 'bắt đầu lại tiến độ'); thông báo thành công cũng vậy", async () => {
    const { toast } = await acts({ ...XT, tacDong: { ghiDanhDangHoc: 0, ghiDanhDongBang: 0, daXongDangHoc: 0, daXongDongBang: 0, soCauHoiChen: 0 }, thongBao: "Hiện chưa có ai xem bài này." });
    chonTep(DA_CO);
    await screen.findByTestId("xac-nhan-doi-video");
    expect(screen.getByTestId("nut-xac-nhan-doi-video").textContent).toBe("Đổi video");
    await dienVaBam();
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Đã đổi video của bài"));
  });

  it("đối chứng: có lượt ĐANG HỌC ⇒ nhãn nói 'bắt đầu lại tiến độ'; thông báo thành công cũng vậy", async () => {
    const { toast } = await acts();
    chonTep(DA_CO);
    await screen.findByTestId("xac-nhan-doi-video");
    expect(screen.getByTestId("nut-xac-nhan-doi-video").textContent).toBe("Đổi video và bắt đầu lại tiến độ");
    await dienVaBam();
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled());
    expect(String(vi.mocked(toast.success).mock.calls[0]![0])).toMatch(/bắt đầu lại/);
  });
});
