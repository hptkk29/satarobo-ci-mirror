// Trần chi phí — CHỖ CẮM VÀO ĐƯỜNG GỬI ZALO. Test viết TRƯỚC hiện thực (luật cứng #5).
//
// Vì sao cắm ở `znsProvider.send` chứ không ở `sendZaloNotification`:
// có HAI ngăn xếp cùng tiêu tiền Zalo, và chúng chỉ gặp nhau ở đây.
//   A) sendZaloNotification (lib/zalo/service.ts) → znsProvider.send
//   B) requestOtp (lib/otp/service.ts) → zaloOtpProvider.send → znsProvider.send
// Đặt cổng ở `service.ts` thì toàn bộ tin OTP — đường tốn tiền đều nhất, mỗi tin
// 400đ — đi vòng qua cổng mà không ai biết.
//
// Bốn tính chất bộ này canh:
//   1. Mô phỏng KHÔNG tốn tiền ⇒ không đặt chỗ (nếu không, bật `test.satarobo.vn` lên
//      là ăn hết trần của prod dù chưa gửi tin nào cho ai).
//   2. Hết ngân sách ⇒ KHÔNG có `fetch` nào. Đây là "dừng cứng", không phải "ghi log
//      rồi vẫn gửi".
//   3. Bị chặn KHÔNG được trả `ok: true`. Kho này đã có tiền lệ đánh dấu "đã gửi" cho
//      tin chưa gửi (`lib/notify/attendance.ts:123`) và nó tạo ra số liệu nghiệm thu
//      giả — chỗ này đi theo nhánh đúng.
//   4. Nhà cung cấp từ chối ⇒ HOÀN lại suất đã đặt (ZBS 31/07: tin fail không tính
//      phí). Không hoàn thì một đợt lỗi xác thực ăn sạch trần tháng mà chưa gửi được
//      tin nào.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const datCho = vi.fn();
const hoan = vi.fn();
const getSetting = vi.fn();

vi.mock("@/lib/ngan-sach-goi-ra/so-chi", () => ({
  datChoNganSach: (...a: unknown[]) => datCho(...a),
  hoanNganSach: (...a: unknown[]) => hoan(...a),
}));
vi.mock("@/lib/settings/service", () => ({
  getSetting: (...a: unknown[]) => getSetting(...a),
}));
vi.mock("@/lib/zalo/token", () => ({
  getValidZaloAccessToken: async () => "token-gia",
  forceRefreshZaloToken: async () => "token-gia-2",
}));

const { znsProvider } = await import("@/lib/zalo/provider");

const GUI = { toPhone: "0900000001", templateKey: "616128", params: { otp: "123456" } };

/** Cấu hình mặc định: có credential + đã bật gửi thật. */
function batGuiThat() {
  process.env.ZALO_OA_ACCESS_TOKEN = "khoa-gia";
  getSetting.mockImplementation(async (key: string) => {
    if (key === "zalo.znsLive") return true;
    if (key === "outbound.znsUnitCostVnd") return 400;
    return undefined;
  });
}

const chapNhan = () =>
  datCho.mockResolvedValue({
    ok: true,
    truc: "ZALO",
    kyThang: "2026-08",
    daTieuVnd: 400,
    tranVnd: 2_000_000,
    conLaiVnd: 1_999_600,
    canhBaoVuaVuot: false,
  });

const tuChoi = () =>
  datCho.mockResolvedValue({
    ok: false,
    ma: "OUTBOUND_BUDGET_EXCEEDED",
    thongDiep: "Đã dùng hết ngân sách tin nhắn Zalo của kỳ 08/2026 (2.000.000đ / trần 2.000.000đ).",
    truc: "ZALO",
    kyThang: "2026-08",
    daTieuVnd: 2_000_000,
    tranVnd: 2_000_000,
  });

let fetchGia: ReturnType<typeof vi.fn>;
const moiTruongCu = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  fetchGia = vi.fn(async () => ({
    ok: true,
    json: async () => ({ error: 0, data: { msg_id: "msg-1" } }),
  }));
  vi.stubGlobal("fetch", fetchGia);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...moiTruongCu };
});

describe("trần chi phí · cổng nằm TRƯỚC lời gọi ra Zalo", () => {
  it("hết ngân sách ⇒ KHÔNG gọi API Zalo lần nào", async () => {
    batGuiThat();
    tuChoi();
    await znsProvider.send(GUI);
    expect(fetchGia).not.toHaveBeenCalled();
  });

  it("hết ngân sách ⇒ trả LỖI có mã riêng, KHÔNG giả vờ thành công", async () => {
    batGuiThat();
    tuChoi();
    const res = await znsProvider.send(GUI);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("OUTBOUND_BUDGET_EXCEEDED");
    expect(res.providerMessageId).toBeUndefined();
  });

  it("hết ngân sách ⇒ lỗi kèm câu người đọc hiểu được (không chỉ mã)", async () => {
    batGuiThat();
    tuChoi();
    const res = await znsProvider.send(GUI);
    expect(res.error).toContain("ngân sách");
    expect(res.error).toContain("08/2026");
  });

  it("còn ngân sách ⇒ vẫn gửi bình thường, và có trừ sổ đúng đơn giá cấu hình", async () => {
    batGuiThat();
    chapNhan();
    const res = await znsProvider.send(GUI);
    expect(res.ok).toBe(true);
    expect(fetchGia).toHaveBeenCalledTimes(1);
    expect(datCho).toHaveBeenCalledWith({ truc: "ZALO", chiPhiVnd: 400 });
  });
});

describe("trần chi phí · KHÔNG trừ tiền cho thứ không tốn tiền", () => {
  it("chưa bật gửi thật (mô phỏng) ⇒ không đặt chỗ ngân sách", async () => {
    process.env.ZALO_OA_ACCESS_TOKEN = "khoa-gia";
    process.env.ZALO_LIVE = "";
    getSetting.mockImplementation(async (key: string) =>
      key === "zalo.znsLive" ? false : 400,
    );
    const res = await znsProvider.send(GUI);
    expect(res.ok).toBe(true);
    expect(res.providerMessageId).toContain("SIMULATED");
    expect(datCho).not.toHaveBeenCalled();
  });

  it("chưa cấu hình credential ⇒ không đặt chỗ ngân sách", async () => {
    delete process.env.ZALO_OA_ACCESS_TOKEN;
    delete process.env.ZALO_OA_REFRESH_TOKEN;
    delete process.env.ZALO_APP_ID;
    delete process.env.ZALO_APP_SECRET;
    const res = await znsProvider.send(GUI);
    expect(res.ok).toBe(false);
    expect(datCho).not.toHaveBeenCalled();
  });

  it("thiếu mẫu ZNS ⇒ chặn TRƯỚC khi đặt chỗ (lượt này chắc chắn không gửi được)", async () => {
    batGuiThat();
    chapNhan();
    const res = await znsProvider.send({ ...GUI, templateKey: null });
    expect(res.ok).toBe(false);
    expect(datCho).not.toHaveBeenCalled();
  });
});

describe("trần chi phí · hoàn lại khi tin không thật sự phát sinh phí", () => {
  it("Zalo từ chối ⇒ hoàn lại đúng số đã đặt chỗ", async () => {
    batGuiThat();
    chapNhan();
    fetchGia.mockResolvedValue({
      ok: true,
      json: async () => ({ error: -118, message: "user has no zalo account" }),
    });
    const res = await znsProvider.send(GUI);
    expect(res.ok).toBe(false);
    expect(hoan).toHaveBeenCalledWith({ truc: "ZALO", chiPhiVnd: 400 });
  });

  it("gửi thành công ⇒ KHÔNG hoàn (tiền đã tiêu thật)", async () => {
    batGuiThat();
    chapNhan();
    await znsProvider.send(GUI);
    expect(hoan).not.toHaveBeenCalled();
  });

  it("một lượt thử lại sau khi làm mới token vẫn chỉ đặt chỗ MỘT suất", async () => {
    batGuiThat();
    chapNhan();
    fetchGia
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: -124, message: "access token expired" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 0, data: { msg_id: "msg-2" } }),
      });
    const res = await znsProvider.send(GUI);
    expect(res.ok).toBe(true);
    expect(fetchGia).toHaveBeenCalledTimes(2);
    expect(datCho).toHaveBeenCalledTimes(1);
    expect(hoan).not.toHaveBeenCalled();
  });
});

describe("trần chi phí · không đọc được đơn giá thì KHÔNG gửi (fail-closed)", () => {
  it("lỗi đọc cấu hình đơn giá ⇒ từ chối, không gọi API", async () => {
    process.env.ZALO_OA_ACCESS_TOKEN = "khoa-gia";
    getSetting.mockImplementation(async (key: string) => {
      if (key === "zalo.znsLive") return true;
      throw new Error("DB sập");
    });
    const res = await znsProvider.send(GUI);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("OUTBOUND_BUDGET_UNAVAILABLE");
    expect(fetchGia).not.toHaveBeenCalled();
  });
});
