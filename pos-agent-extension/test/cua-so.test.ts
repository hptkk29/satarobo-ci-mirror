/**
 * Cửa sổ đồng bộ (roadmap §6 GĐ5 + hợp đồng §8.3), GIỜ VIỆT NAM, mọi mốc truyền tường minh:
 *   thường        [lastSyncedAt − 2h, now]
 *   lần đầu       3 ngày gần nhất (TỰ QUYẾT: làm tròn xuống 00:00 VN của ngày now − 72h)
 *   sau READY     từ min(lastSyncedAt − 2h, 00:00 hôm nay)
 *   có job        từ min(…, scanFrom của job)
 */
import { describe, expect, it } from "vitest";
import { chiaCuaSo, chonCuaSo, cuaSoThuong, mocDongBo, tuQuetBuSauReady } from "../src/lib/cua-so";
import { batDauNgayVN, dinhDangGioVN, docIso, isoVN, maThoiGianVN } from "../src/lib/gio-vn";
import { GIO, PHUT, T0 } from "./ho-tro/du-lieu";
import { BIEN_CUOI_CUA_SO_MS } from "../src/lib/hang-so";

const ms = (iso: string) => Date.parse(iso);
const NGAY = 24 * GIO;

describe("Giờ Việt Nam", () => {
  it("[EXT-CS-01] định dạng portal 'YYYY-MM-DD HH:mm:ss', ISO +07:00 không phần nghìn giây, đầu ngày VN", () => {
    expect(dinhDangGioVN(T0)).toBe("2026-10-07 10:20:00");
    expect(dinhDangGioVN(T0 + 999)).toBe("2026-10-07 10:20:00");
    expect(isoVN(T0)).toBe("2026-10-07T10:20:00+07:00");
    expect(isoVN(ms("2026-10-07T17:30:15Z"))).toBe("2026-10-08T00:30:15+07:00");
    expect(batDauNgayVN(T0)).toBe(ms("2026-10-07T00:00:00+07:00"));
    expect(batDauNgayVN(ms("2026-10-07T16:59:59Z"))).toBe(ms("2026-10-07T00:00:00+07:00"));
    expect(batDauNgayVN(ms("2026-10-07T17:00:00Z"))).toBe(ms("2026-10-08T00:00:00+07:00"));
    expect(maThoiGianVN(T0)).toBe("20261007-102000");
  });

  it("[EXT-CS-02] docIso chỉ nhận ISO có offset; chuỗi khác ⇒ null", () => {
    expect(docIso("2026-10-07T10:19:58+07:00")).toBe(ms("2026-10-07T10:19:58+07:00"));
    expect(docIso("2026-10-07T03:19:58.123Z")).toBe(ms("2026-10-07T03:19:58.123Z"));
    for (const x of ["2026-10-07 10:19:58", "2026-10-07T10:19:58", "", null, 5, "hôm nay"]) expect(docIso(x)).toBeNull();
  });
});

describe("Cửa sổ đồng bộ", () => {
  it("[EXT-CS-03] thường: [lastSyncedAt − 2h, now]", () => {
    const last = T0 - 5 * 60_000;
    expect(cuaSoThuong(last, T0)).toEqual({ tu: last - 2 * GIO, den: T0 });
  });

  it("[EXT-CS-04] lần đầu (chưa từng đồng bộ): 3 ngày, làm tròn xuống 00:00 VN", () => {
    expect(cuaSoThuong(null, T0)).toEqual({ tu: ms("2026-10-04T00:00:00+07:00"), den: T0 });
    expect(chonCuaSo({ lastSyncedAt: null, canQuetBuTu: null, scanFroms: [], now: T0 })).toEqual({
      tu: ms("2026-10-04T00:00:00+07:00"),
      den: T0,
    });
  });

  it("[EXT-CS-05] sau READY: min(lastSyncedAt − 2h, 00:00 hôm nay) — hai phía của phép min", () => {
    // đồng bộ cuối 09:00 hôm nay ⇒ 07:00 hôm nay > 00:00 ⇒ lấy 00:00 hôm nay
    expect(tuQuetBuSauReady(ms("2026-10-07T09:00:00+07:00"), T0)).toBe(ms("2026-10-07T00:00:00+07:00"));
    // đồng bộ cuối 20:00 hôm qua ⇒ 18:00 hôm qua < 00:00 hôm nay ⇒ lấy 18:00 hôm qua
    expect(tuQuetBuSauReady(ms("2026-10-06T20:00:00+07:00"), T0)).toBe(ms("2026-10-06T18:00:00+07:00"));
    // chưa từng đồng bộ ⇒ như lần đầu
    expect(tuQuetBuSauReady(null, T0)).toBe(ms("2026-10-04T00:00:00+07:00"));
  });

  it("[EXT-CS-06] chonCuaSo lấy mốc SỚM NHẤT giữa thường / quét bù đang chờ / scanFrom của job", () => {
    const last = T0 - 60_000;
    const quetBu = ms("2026-10-07T00:00:00+07:00");
    const scan = ms("2026-10-07T06:00:00+07:00");
    expect(chonCuaSo({ lastSyncedAt: last, canQuetBuTu: quetBu, scanFroms: [], now: T0 })).toEqual({ tu: quetBu, den: T0 });
    expect(chonCuaSo({ lastSyncedAt: last, canQuetBuTu: null, scanFroms: [scan, T0 - GIO], now: T0 })).toEqual({ tu: scan, den: T0 });
    // scanFrom TRONG TƯƠNG LAI hoặc NaN bị bỏ qua (không kéo cửa sổ thành rỗng / sai)
    expect(chonCuaSo({ lastSyncedAt: last, canQuetBuTu: null, scanFroms: [T0 + GIO, Number.NaN], now: T0 })).toEqual({
      tu: last - 2 * GIO,
      den: T0,
    });
  });

  it("[EXT-CS-07] trần 31 ngày (agent tắt quá lâu ⇒ phần cũ hơn đi đường import file)", () => {
    const last = T0 - 90 * NGAY;
    expect(cuaSoThuong(last, T0)).toEqual({ tu: T0 - 31 * NGAY, den: T0 });
  });

  it("[EXT-CS-08] lastSyncedAt Ở TƯƠNG LAI (đồng hồ máy bị lùi) ⇒ coi như now, không ra cửa sổ ngược", () => {
    const c = cuaSoThuong(T0 + 10 * GIO, T0);
    expect(c).toEqual({ tu: T0 - 2 * GIO, den: T0 });
  });

  it("[EXT-CS-09] chia cửa sổ dài thành mảnh ≤ 24h liền nhau (không hở, trùng đúng mốc nối)", () => {
    const tu = T0 - 50 * GIO;
    const ds = chiaCuaSo({ tu, den: T0 });
    expect(ds).toEqual([
      { tu, den: tu + 24 * GIO },
      { tu: tu + 24 * GIO, den: tu + 48 * GIO },
      { tu: tu + 48 * GIO, den: T0 },
    ]);
    expect(chiaCuaSo({ tu: T0 - GIO, den: T0 })).toEqual([{ tu: T0 - GIO, den: T0 }]);
    expect(chiaCuaSo({ tu: T0, den: T0 })).toEqual([{ tu: T0, den: T0 }]);
  });

  it("[EXT-CS-10] RV5 — mốc cuối cửa sổ theo giờ ĐÃ HIỆU CHỈNH (lechGio đo từ X-Server-Time) + biên; lastSyncedAt KHÔNG BAO GIỜ vượt giờ thật", () => {
    // đồng hồ máy CHẬM 3′ (máy chủ đi trước): cửa sổ phải phủ tới giờ máy chủ; lastSyncedAt giữ giờ máy (sớm hơn = an toàn)
    expect(mocDongBo(T0, 3 * PHUT)).toEqual({ denTimKiem: T0 + 3 * PHUT + BIEN_CUOI_CUA_SO_MS, lastSyncedAt: T0 });
    // đồng hồ máy NHANH 3′: lastSyncedAt = giờ máy chủ (không khai "đã đọc tới" một mốc chưa tới)
    expect(mocDongBo(T0, -3 * PHUT)).toEqual({ denTimKiem: T0 + BIEN_CUOI_CUA_SO_MS, lastSyncedAt: T0 - 3 * PHUT });
    expect(mocDongBo(T0, 0)).toEqual({ denTimKiem: T0 + BIEN_CUOI_CUA_SO_MS, lastSyncedAt: T0 });
    expect(BIEN_CUOI_CUA_SO_MS).toBeGreaterThanOrEqual(2 * PHUT);
    expect(BIEN_CUOI_CUA_SO_MS).toBeLessThanOrEqual(5 * PHUT);
  });
});
