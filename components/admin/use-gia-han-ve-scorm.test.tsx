// @vitest-environment jsdom
// [GHV-nn] Gia hạn chủ động vé SCORM: định kỳ khi tab hiện, ngay khi hiện lại, dừng khi hết hạn, lùi nhịp khi lỗi, dọn khi unmount.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  GIA_HAN_CHU_KY_MS,
  GIA_HAN_LUI_BAC_MS,
  useGiaHanVeScorm,
} from "./use-gia-han-ve-scorm";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
let hienThi: "visible" | "hidden" = "visible";

function datHienThi(v: "visible" | "hidden") {
  hienThi = v;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  hienThi = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => hienThi });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const tien = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("[GHV-1] định kỳ", () => {
  it("[GHV-1a] không gọi trước 4 phút; đến 4 phút gọi đúng body {ticket} và giữ vé MỚI trong ref", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, ticket: "ve-2", expiresInSec: 600 }));
    const { result } = renderHook(() => useGiaHanVeScorm({ ticket: "ve-1" }));
    await tien(GIA_HAN_CHU_KY_MS - 1000);
    expect(fetchMock).not.toHaveBeenCalled();
    await tien(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/scorm/gia-han");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual({ ticket: "ve-1" });
    expect(result.current.layVe()).toBe("ve-2");
    // Vòng kế dùng vé mới.
    await tien(GIA_HAN_CHU_KY_MS);
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toEqual({ ticket: "ve-2" });
  });

  it("[GHV-1b] chuDong=false ⇒ KHÔNG gọi định kỳ (PDF), nhưng giaHanNgay vẫn dùng được", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, ticket: "ve-9", expiresInSec: 600 }));
    const { result } = renderHook(() => useGiaHanVeScorm({ ticket: "ve-1", chuDong: false }));
    await tien(GIA_HAN_CHU_KY_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();
    let kq = "";
    await act(async () => {
      kq = await result.current.giaHanNgay();
    });
    expect(kq).toBe("ok");
    expect(result.current.layVe()).toBe("ve-9");
  });
});

describe("[GHV-2] tab ẩn / hiện", () => {
  it("[GHV-2a] tab ẩn lúc đến hạn ⇒ KHÔNG gọi; hiện lại ⇒ gọi NGAY", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, ticket: "ve-2", expiresInSec: 600 }));
    renderHook(() => useGiaHanVeScorm({ ticket: "ve-1" }));
    datHienThi("hidden");
    await tien(GIA_HAN_CHU_KY_MS * 2);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      datHienThi("visible");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("[GHV-2b] lật tab liên tục sau một lần thành công ⇒ không gọi dồn (<30s)", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, ticket: "ve-2", expiresInSec: 600 }));
    renderHook(() => useGiaHanVeScorm({ ticket: "ve-1" }));
    await tien(GIA_HAN_CHU_KY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      datHienThi("hidden");
      datHienThi("visible");
      datHienThi("hidden");
      datHienThi("visible");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("[GHV-3] hết hạn thật", () => {
  for (const [status, reason] of [
    [401, "phien"],
    [403, "ve-sai"],
    [403, "het-han-toi-da"],
  ] as const) {
    it(`[GHV-3] ${status}/${reason} ⇒ phien=het-han, DỪNG hẳn (không gọi nữa)`, async () => {
      fetchMock.mockResolvedValue(json(status, { ok: false, reason }));
      const { result } = renderHook(() => useGiaHanVeScorm({ ticket: "ve-1" }));
      await tien(GIA_HAN_CHU_KY_MS);
      expect(result.current.phien).toEqual({ loai: "het-han", lyDo: reason });
      await tien(GIA_HAN_CHU_KY_MS * 5);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // Dừng HẲN cả ở hai lối còn lại: tab hiện lại và gọi tay (PDF "Thử lại") đều không bắn thêm request.
      await act(async () => {
        datHienThi("hidden");
        datHienThi("visible");
        await vi.advanceTimersByTimeAsync(0);
      });
      let kq = "";
      await act(async () => {
        kq = await result.current.giaHanNgay();
      });
      expect(kq).toBe("het-han");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }

  it("[GHV-3x] 401 không kèm lý do ⇒ vẫn là mất phiên (lyDo=phien)", async () => {
    fetchMock.mockResolvedValue(json(401, {}));
    const { result } = renderHook(() => useGiaHanVeScorm({ ticket: "ve-1" }));
    await tien(GIA_HAN_CHU_KY_MS);
    expect(result.current.phien).toEqual({ loai: "het-han", lyDo: "phien" });
  });

  it("[GHV-3z] 403 với lý do KHÔNG phải hết hạn (nguon-goc…) ⇒ dừng IM LẶNG, không báo hết hạn oan", async () => {
    fetchMock.mockResolvedValue(json(403, { ok: false, reason: "nguon-goc" }));
    const { result } = renderHook(() => useGiaHanVeScorm({ ticket: "ve-1" }));
    await tien(GIA_HAN_CHU_KY_MS * 4);
    expect(result.current.phien).toEqual({ loai: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("[GHV-3w] 400/413 (định dạng) ⇒ dừng im lặng, không thử lại mãi", async () => {
    fetchMock.mockResolvedValue(json(400, { ok: false, reason: "dinh-dang" }));
    const { result } = renderHook(() => useGiaHanVeScorm({ ticket: "ve-1" }));
    await tien(GIA_HAN_CHU_KY_MS * 4);
    expect(result.current.phien).toEqual({ loai: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("[GHV-3y] route chưa có (404) ⇒ dừng IM LẶNG, không báo hết hạn oan", async () => {
    fetchMock.mockResolvedValue(new Response("Not found", { status: 404 }));
    const { result } = renderHook(() => useGiaHanVeScorm({ ticket: "ve-1" }));
    await tien(GIA_HAN_CHU_KY_MS * 4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.phien).toEqual({ loai: "ok" });
  });
});

describe("[GHV-4] lỗi tạm: lùi nhịp, không dồn dập", () => {
  it("[GHV-4a] mạng lỗi ⇒ thử lại 15s → 30s → 60s → 120s → 120s (không phải mỗi giây)", async () => {
    fetchMock.mockRejectedValue(new TypeError("mất mạng"));
    const { result } = renderHook(() => useGiaHanVeScorm({ ticket: "ve-1" }));
    await tien(GIA_HAN_CHU_KY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    let tong = 1;
    for (const bac of [...GIA_HAN_LUI_BAC_MS, GIA_HAN_LUI_BAC_MS[GIA_HAN_LUI_BAC_MS.length - 1]]) {
      await tien(bac - 1);
      expect(fetchMock).toHaveBeenCalledTimes(tong); // chưa tới giờ
      await tien(1);
      tong += 1;
      expect(fetchMock).toHaveBeenCalledTimes(tong);
    }
    expect(result.current.phien).toEqual({ loai: "ok" }); // lỗi tạm KHÔNG phải hết hạn
  });

  it("[GHV-4b] 429 và 5xx cũng là lỗi tạm; thành công lại thì về nhịp 4 phút", async () => {
    fetchMock
      .mockResolvedValueOnce(json(429, { ok: false }))
      .mockResolvedValueOnce(json(502, {}))
      .mockResolvedValue(json(200, { ok: true, ticket: "ve-3", expiresInSec: 600 }));
    const { result } = renderHook(() => useGiaHanVeScorm({ ticket: "ve-1" }));
    await tien(GIA_HAN_CHU_KY_MS);
    await tien(15_000);
    await tien(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.layVe()).toBe("ve-3");
    await tien(GIA_HAN_CHU_KY_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await tien(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("[GHV-4c] thân JSON hỏng trên 200 ⇒ lỗi tạm (fail-open), vé cũ giữ nguyên", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    const { result } = renderHook(() => useGiaHanVeScorm({ ticket: "ve-1" }));
    await tien(GIA_HAN_CHU_KY_MS);
    expect(result.current.layVe()).toBe("ve-1");
    expect(result.current.phien).toEqual({ loai: "ok" });
  });
});

describe("[GHV-5] dọn dẹp + một lượt bay", () => {
  it("[GHV-5a] unmount ⇒ hẹn giờ và listener visibilitychange được gỡ (không gọi sau đó)", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true, ticket: "ve-2", expiresInSec: 600 }));
    const them = vi.spyOn(document, "addEventListener");
    const go = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useGiaHanVeScorm({ ticket: "ve-1" }));
    unmount();
    // Listener đăng ký bao nhiêu thì gỡ bấy nhiêu (rò listener ⇒ mỗi lần mở bài thêm một bộ xử lý vĩnh viễn).
    const lan = (s: typeof them) => s.mock.calls.filter(([ten]) => ten === "visibilitychange").length;
    expect(lan(them)).toBeGreaterThan(0);
    expect(lan(go)).toBe(lan(them));
    // Đếm hẹn giờ NGAY sau unmount: để trôi qua hạn rồi mới đếm thì hẹn giờ rò vẫn tự nổ và ra 0 (cấy lỗi phát hiện — M5).
    expect(vi.getTimerCount()).toBe(0);
    await tien(GIA_HAN_CHU_KY_MS * 3);
    await act(async () => {
      datHienThi("hidden");
      datHienThi("visible");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[GHV-5b] hai nơi gọi cùng lúc ⇒ chỉ MỘT request bay", async () => {
    let xong: (r: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (xong = r)));
    const { result } = renderHook(() => useGiaHanVeScorm({ ticket: "ve-1", chuDong: false }));
    let a: Promise<string> = Promise.resolve("");
    let b: Promise<string> = Promise.resolve("");
    act(() => {
      a = result.current.giaHanNgay();
      b = result.current.giaHanNgay();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      xong(json(200, { ok: true, ticket: "ve-5", expiresInSec: 600 }));
      await Promise.all([a, b]);
    });
    expect(await a).toBe("ok");
    expect(await b).toBe("ok");
  });

  it("[GHV-5c] prop ticket đổi ⇒ vé trong ref theo prop", () => {
    const { result, rerender } = renderHook(({ t }) => useGiaHanVeScorm({ ticket: t, chuDong: false }), {
      initialProps: { t: "ve-1" },
    });
    rerender({ t: "ve-7" });
    expect(result.current.layVe()).toBe("ve-7");
  });
});
