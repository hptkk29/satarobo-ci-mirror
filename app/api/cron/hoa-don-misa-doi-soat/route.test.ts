// @vitest-environment node
/**
 * Ca [PHM-CRON-*] — route cron `hoa-don-misa-doi-soat`: cổng CRON_SECRET như mọi cron khác, rồi gọi người
 * chạy với cổng lấy qua `layCongHoaDon()` + mốc giờ của lượt. Luật đối soát canh ở
 * `tests/finance/hoa-don-phat-hanh-misa.test.ts` ([PHM-2x]).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  doiSoat: vi.fn(async (_i: { cong: unknown; now: Date; slaKhongRoPhut: number | null }) => ({ quet: 2, daXacNhan: 1, loi: 0, conCho: 1, hong: 0 })),
  // Pha P2 (scanner bóng, Invoice Hub S8). Mặc định cờ TẮT ⇒ `null`.
  bong: vi.fn(async (_i: { now: Date; conThoiGian: () => boolean }): Promise<unknown> => null),
  // Pha P3 (dọn yêu cầu thông tin người mua, Invoice Hub S11). Mặc định cờ TẮT ⇒ `null`.
  nguoiMua: vi.fn(async (_i: { now: Date }): Promise<unknown> => null),
  // [09/11/2026] Pha P4 «tự xuất sau n giờ» ĐÃ GỠ — `tuXuat` chỉ còn để chứng minh cron KHÔNG gọi nó ([TXR-01]).
  tuXuat: vi.fn(async (_i: { now: Date; conThoiGian: () => boolean }): Promise<unknown> => null),
  // Pha P5 (pháp nhân KÝ USB: tạo lệnh chờ ký + báo kế toán, BGĐ 04/11/2026). Mặc định cờ `hoaDon.kyUsb` TẮT ⇒ `null`.
  kyUsb: vi.fn(async (_now: Date): Promise<unknown> => null),
  tamDung: vi.fn(async (_pn: string) => ({ tamDung: false as boolean })),
  chanChuaGui: vi.fn(async (_id: string): Promise<string | null> => null),
  layCongHsm: vi.fn(async (_pn: string, _muc: string) => ({ ok: true as const, cong: { cheDo: "GIA_LAP", moiTruong: "gia-lap" } })),
  cong: { cheDo: "GIA_LAP", moiTruong: "gia-lap" } as unknown,
}));
vi.mock("@/lib/finance/hoa-don/phat-hanh-misa", () => ({ doiSoatPhatHanhTreo: h.doiSoat }));
// Ngưỡng «quá hạn» đến từ CẤU HÌNH (feature.ts) — route chỉ chuyển nó cho người chạy.
vi.mock("@/lib/finance/hoa-don/feature", () => ({ docSlaKhongRoPhut: async () => 77 }));
vi.mock("@/lib/finance/hoa-don/cong-phat-hanh", () => ({ layCongHoaDon: () => h.cong }));
vi.mock("@/lib/finance/hoa-don/ket-noi/cong-theo-phap-nhan", () => ({ layCongHsmChoPhapNhan: h.layCongHsm }));
vi.mock("@/lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db", () => ({ kyDangTamDung: h.tamDung, lyDoKhongGuiDuocHoaDonHeThong: h.chanChuaGui }));
vi.mock("@/lib/finance/hoa-don/ky-usb/quet-tao-lenh", () => ({ chayKyUsbCuaCron: h.kyUsb }));
vi.mock("@/lib/finance/hoa-don/quet-nghia-vu-db", () => ({ chayQuetBong: h.bong }));
vi.mock("@/lib/finance/hoa-don/yeu-cau-nguoi-mua-quet", () => ({ chayDonDepNguoiMua: h.nguoiMua }));

import { NextRequest } from "next/server";
import * as route from "./route";

const BI_MAT = "bi-mat-cron-test-phm";
let cu: string | undefined;
beforeAll(() => {
  cu = process.env.CRON_SECRET;
  process.env.CRON_SECRET = BI_MAT;
});
afterAll(() => {
  if (cu === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = cu;
});
beforeEach(() => {
  vi.clearAllMocks();
  h.bong.mockImplementation(async () => null);
  h.nguoiMua.mockImplementation(async () => null);
  h.tuXuat.mockImplementation(async () => null);
  h.kyUsb.mockImplementation(async () => null);
  h.tamDung.mockImplementation(async () => ({ tamDung: false }));
  h.layCongHsm.mockImplementation(async () => ({ ok: true as const, cong: { cheDo: "GIA_LAP", moiTruong: "gia-lap" } }));
});

const goi = (authorization?: string) =>
  route.GET(
    new NextRequest("http://localhost/api/cron/hoa-don-misa-doi-soat", {
      headers: authorization ? { authorization } : {},
    }),
  );

describe("[PHM-CRON-01] cổng CRON_SECRET", () => {
  it("thiếu / sai bearer ⇒ 401, KHÔNG đối soát gì, KHÔNG quét bóng", async () => {
    expect((await goi()).status).toBe(401);
    expect((await goi("Bearer sai")).status).toBe(401);
    expect(h.doiSoat).not.toHaveBeenCalled();
    expect(h.bong).not.toHaveBeenCalled();
  });

  it("đối chứng: đúng bearer ⇒ 200, đối soát MỘT lần với ĐÚNG cổng của layCongHoaDon + mốc giờ Date", async () => {
    const res = await goi(`Bearer ${BI_MAT}`);
    expect(res.status).toBe(200);
    expect(h.doiSoat).toHaveBeenCalledTimes(1);
    expect(h.doiSoat.mock.calls[0]![0].cong).toBe(h.cong);
    expect(h.doiSoat.mock.calls[0]![0].now).toBeInstanceOf(Date);
    expect((h.doiSoat.mock.calls[0]![0] as { slaKhongRoPhut: unknown }).slaKhongRoPhut).toBe(77);
    expect(await res.json()).toMatchObject({ ok: true, data: { quet: 2, daXacNhan: 1 } });
  });
});

describe("[QNR-*] pha P2 — scanner bóng nghĩa vụ (Invoice Hub S8) gắn vào cron", () => {
  const P1 = { quet: 2, daXacNhan: 1, loi: 0, conCho: 1, hong: 0 };
  const AUTH = `Bearer ${BI_MAT}`;

  it("[QNR-01] cờ TẮT (scanner trả null) ⇒ phản hồi GIỮ NGUYÊN từng chữ so với trước S8: đúng dữ liệu của P1, không thêm khoá nào", async () => {
    const res = await goi(AUTH);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: unknown };
    expect(body.data).toEqual(P1);
    expect(Object.keys(body.data as object).sort()).toEqual(Object.keys(P1).sort());
  });

  it("[QNR-02] cờ BẬT ⇒ P1 vẫn nguyên, kết quả scanner nằm dưới khoá `bong` (KHÔNG đè khoá `quet` của P1); P1 chạy TRƯỚC P2", async () => {
    h.bong.mockImplementation(async () => ({ don: 3, tao: 3 }));
    const res = await goi(AUTH);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, data: { ...P1, bong: { don: 3, tao: 3 } } });
    expect(h.doiSoat.mock.invocationCallOrder[0]!).toBeLessThan(h.bong.mock.invocationCallOrder[0]!);
    expect(h.bong).toHaveBeenCalledTimes(1);
    expect(h.bong.mock.calls[0]![0].now).toBeInstanceOf(Date);
  });

  it("[QNR-03] scanner báo lỗi cấp lượt (trả {loi}) ⇒ vẫn 200 và kết quả P1 còn nguyên", async () => {
    h.bong.mockImplementation(async () => ({ don: 0, loi: "QUET:ECONNRESET" }));
    const res = await goi(AUTH);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, data: { ...P1, bong: { loi: "QUET:ECONNRESET" } } });
  });

  it("[QNR-04] P1 ném ⇒ vẫn chạy P2 (một pha lỗi không làm hỏng pha sau — ADR §7.2) rồi trả LỖI của P1 như trước S8 (đối chứng: P1 lành thì 200)", async () => {
    h.doiSoat.mockRejectedValueOnce(new Error("MISA chết"));
    h.bong.mockImplementation(async () => ({ don: 1 }));
    const res = await goi(AUTH);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(h.bong).toHaveBeenCalledTimes(1);
    expect((await goi(AUTH)).status).toBe(200);
  });

  it("[QNR-05] ngân sách thời gian: `conThoiGian` đúng lúc bắt đầu, SAI sau 40 giây (P1 đã ăn bao nhiêu thì P2 chỉ còn phần còn lại)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-02T03:00:00Z"));
      h.doiSoat.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date("2026-11-02T03:00:30Z")); // P1 chạy mất 30 giây
        return P1;
      });
      let conTrongKhiGoi: boolean | null = null;
      h.bong.mockImplementation(async (i) => {
        conTrongKhiGoi = i.conThoiGian();
        vi.setSystemTime(new Date("2026-11-02T03:00:41Z"));
        return { don: 0, saiSauDo: i.conThoiGian() };
      });
      const res = await goi(AUTH);
      expect(res.status).toBe(200);
      expect(conTrongKhiGoi).toBe(true); // 30s < 40s
      expect(await res.json()).toMatchObject({ data: { bong: { saiSauDo: false } } }); // 41s ≥ 40s
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("[YCR-*] pha P3 — dọn yêu cầu thông tin người mua (Invoice Hub S11) gắn vào cron", () => {
  it("[YCR-01] cờ TẮT (trả null) ⇒ phản hồi GIỮ NGUYÊN từng chữ: không thêm khoá `nguoiMua`", async () => {
    const res = await goi(`Bearer ${BI_MAT}`);
    expect(await res.json()).toEqual({ ok: true, data: { quet: 2, daXacNhan: 1, loi: 0, conCho: 1, hong: 0 } });
  });

  it("[YCR-02] cờ BẬT ⇒ kết quả nằm dưới khoá `nguoiMua`, P1 nguyên; được gọi với mốc giờ Date", async () => {
    h.nguoiMua.mockResolvedValue({ hetHan: 3, daXoaDuLieu: 1, choXuLyQuaHan: 0 });
    const j = (await (await goi(`Bearer ${BI_MAT}`)).json()) as { data: Record<string, unknown> };
    expect(j.data).toMatchObject({ quet: 2, nguoiMua: { hetHan: 3, daXoaDuLieu: 1 } });
    expect(h.nguoiMua.mock.calls[0]![0].now).toBeInstanceOf(Date);
  });

  it("[YCR-03] P2 và P3 cùng bật ⇒ cả hai khoá có mặt; P3 báo lỗi cấp lượt ({loi}) ⇒ vẫn 200", async () => {
    h.bong.mockResolvedValue({ don: 1 });
    h.nguoiMua.mockResolvedValue({ hetHan: 0, daXoaDuLieu: 0, choXuLyQuaHan: 0, loi: "QUET:Error" });
    const res = await goi(`Bearer ${BI_MAT}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: Record<string, unknown> }).data).toMatchObject({ bong: { don: 1 }, nguoiMua: { loi: "QUET:Error" } });
  });

  it("[YCR-04] P1 ném ⇒ P3 vẫn chạy (một pha lỗi không làm hỏng pha sau) rồi lỗi P1 được ném lại", async () => {
    h.doiSoat.mockRejectedValueOnce(new Error("MISA chết"));
    h.nguoiMua.mockResolvedValue({ hetHan: 1, daXoaDuLieu: 0, choXuLyQuaHan: 0 });
    const res = await goi(`Bearer ${BI_MAT}`);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(h.nguoiMua).toHaveBeenCalledTimes(1);
  });
});

describe("[TXR-*] [09/11/2026 — BGĐ đổi] pha P4 «tự xuất sau n giờ» ĐÃ GỠ khỏi cron", () => {
  it("[TXR-01] cron KHÔNG gọi tự xuất nữa (kể cả khi hàm cũ còn trả kết quả): phản hồi GIỮ NGUYÊN các khoá của P1, không có khoá `tuXuat`", async () => {
    h.tuXuat.mockResolvedValue({ soGio: 2, daXuat: 1 }); // nếu ai nối lại, kết quả này sẽ lọt vào phản hồi
    const res = await goi(`Bearer ${BI_MAT}`);
    expect(await res.json()).toEqual({ ok: true, data: { quet: 2, daXacNhan: 1, loi: 0, conCho: 1, hong: 0 } });
    expect(h.tuXuat).not.toHaveBeenCalled();
  });

  it("[TXR-02] đối chứng: các pha còn lại (đối soát P1 · dọn yêu cầu P3) VẪN chạy mỗi lượt — gỡ P4 không kéo theo gỡ nhầm pha khác", async () => {
    await goi(`Bearer ${BI_MAT}`);
    expect(h.doiSoat).toHaveBeenCalledTimes(1);
    expect(h.nguoiMua).toHaveBeenCalledTimes(1);
    expect(h.kyUsb).toHaveBeenCalledTimes(1);
  });
});

describe("[KYR-*] pha P5 — pháp nhân ký USB + tạm dừng ký (BGĐ 04/11/2026) gắn vào cron", () => {
  const P1 = { quet: 2, daXacNhan: 1, loi: 0, conCho: 1, hong: 0 };
  it("[KYR-01] cờ `hoaDon.kyUsb` TẮT (trả null) ⇒ phản hồi GIỮ NGUYÊN từng chữ: không thêm khoá `kyUsb`", async () => {
    const res = await goi(`Bearer ${BI_MAT}`);
    expect(await res.json()).toEqual({ ok: true, data: P1 });
    expect(h.kyUsb).toHaveBeenCalledTimes(1); // luôn được hỏi; tắt/bật do chính nó quyết
  });
  it("[KYR-02] đối chứng dương: bật (trả kết quả) ⇒ kết quả nằm dưới khoá `kyUsb`, các khoá khác không đổi", async () => {
    h.kyUsb.mockResolvedValueOnce({ quet: 3, taoMoi: 2 });
    const body = (await (await goi(`Bearer ${BI_MAT}`)).json()) as { data: Record<string, unknown> };
    expect(body.data).toEqual({ ...P1, kyUsb: { quet: 3, taoMoi: 2 } });
  });
  it("[KYR-03] đối soát lấy cổng ở mức «TRA_CUU» (tạm dừng KHÔNG được chặn việc tra cứu bản đã gửi) và truyền `khoaGui` theo trạng thái tạm dừng", async () => {
    await goi(`Bearer ${BI_MAT}`);
    const arg = h.doiSoat.mock.calls[0]![0] as unknown as { congTheoPhapNhan: (n: string, pn: string) => Promise<unknown>; khoaGui: (pn: string) => Promise<boolean> };
    await arg.congTheoPhapNhan("VIN_HOADON", "NEW_VISION");
    expect(h.layCongHsm).toHaveBeenCalledWith("NEW_VISION", "TRA_CUU");
    expect(await arg.khoaGui("NEW_VISION")).toBe(false);
    h.tamDung.mockResolvedValueOnce({ tamDung: true });
    expect(await arg.khoaGui("NEW_VISION")).toBe(true);
  });
});
