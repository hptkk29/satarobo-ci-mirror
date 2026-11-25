// @vitest-environment jsdom
// [SPL-nn] ScormPlayer: các nhánh trạng thái tải, hẹn giờ, thử lại do người dùng, gia hạn vé, dọn khi unmount.
// jsdom không nạp iframe thật ⇒ `contentDocument` được giả bằng spy trên prototype; fetch giả theo URL.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

vi.mock("@/components/admin/scorm-api", () => ({ mountScorm12Api: () => () => undefined }));

import { ScormPlayer } from "./scorm-player";
import { GIA_HAN_CHU_KY_MS } from "./use-gia-han-ve-scorm";
import { HEN_CHAM_MS, HEN_QUA_HAN_MS } from "./scorm-trang-thai-tai";

const GOI = "cabcdefghijklmnopqrstuvwx";
const seed = { lessonStatus: "not attempted", lessonLocation: "", suspendData: "", scoreRaw: "" };

type TaiLieuGia = { href: string; contentType?: string; readyState?: string; text?: string } | "chet" | null;
let taiLieu: TaiLieuGia = null;
let probe: (url: string) => Promise<Response> | Response;
let giaHan: () => Promise<Response> | Response;
let fetchMock: ReturnType<typeof vi.fn>;
let marks: string[];
const reload = vi.fn();

const res = (status: number, body = "") => new Response(body, { status });
const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  taiLieu = { href: "about:blank", contentType: "text/html", readyState: "complete" };
  probe = () => res(206);
  giaHan = () => jsonRes(200, { ok: true, ticket: "ve-moi", expiresInSec: 600 });
  fetchMock = vi.fn((url: string) => (String(url).startsWith("/api/scorm/gia-han") ? giaHan() : probe(String(url))));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(HTMLIFrameElement.prototype, "contentDocument", "get").mockImplementation(() => {
    if (taiLieu === "chet") throw new Error("SecurityError");
    if (!taiLieu) return null;
    return {
      location: { href: taiLieu.href },
      contentType: taiLieu.contentType ?? "text/html",
      readyState: taiLieu.readyState ?? "complete",
      body: { childElementCount: 1, textContent: taiLieu.text ?? "" },
    } as unknown as Document;
  });
  marks = [];
  vi.spyOn(performance, "mark").mockImplementation(((n: string) => {
    marks.push(n);
    return {} as PerformanceMark;
  }) as typeof performance.mark);
  reload.mockReset();
  vi.stubGlobal("location", { ...window.location, reload });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ve = (over: Partial<Parameters<typeof ScormPlayer>[0]> = {}) => (
  <ScormPlayer
    launchTicket="ve-1"
    launchUrl="res/index.html"
    packageName="Bài 1"
    name="GV A"
    employeeCode="NV01"
    packageId={GOI}
    classSessionId={null}
    seed={seed}
    {...over}
  />
);
const khung = () => document.querySelector("[data-scorm-state]") as HTMLElement;
const iframe = () => document.querySelector("iframe") as HTMLIFrameElement;
const tien = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const demThamDo = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/scorm/asset/")).length;

describe("[SPL-1] khởi đầu + dấu cho QA", () => {
  it("[SPL-1a] dang-tai, lớp phủ role=status, mark scorm:open, URL mang mã gói + vé", async () => {
    render(ve());
    await tien(0);
    expect(khung().dataset.scormState).toBe("dang-tai");
    expect(khung().dataset.scormLoi).toBeUndefined();
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải bài giảng…");
    expect(marks).toContain("scorm:open");
    expect(iframe().getAttribute("src")).toBe(`/api/scorm/asset/${GOI}/res/index.html?t=ve-1`);
  });

  it("[SPL-1c] HTML SSR KHÔNG chứa <iframe> (iframe SSR + Suspense bị chuyển chỗ ⇒ trình duyệt nạp bài HAI lần); sau mount có đúng MỘT iframe", async () => {
    // Đo 24/10/2026 trên bản production: mọi tệp của bài bị xin hai lần khi iframe nằm sẵn trong HTML SSR. Phía dương ngay dưới: sau mount iframe PHẢI có.
    const html = renderToString(ve());
    expect(html).not.toMatch(/<iframe/i);
    expect(html).toContain('data-scorm-state="dang-tai"'); // khung + lớp phủ vẫn có trong HTML đầu (người dùng thấy "đang tải" ngay)
    render(ve());
    await tien(0);
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(iframe().getAttribute("src")).toBe(`/api/scorm/asset/${GOI}/res/index.html?t=ve-1`);
  });

  it("[SPL-1d] ssrTiming ⇒ thuộc tính data-scorm-ssr trên khung (ngay trong HTML SSR); không truyền ⇒ không có thuộc tính", () => {
    // Trang play đo thời gian dựng trang phía máy chủ; RSC không đặt được header nên số đo đi qua thuộc tính này để Playwright/QA đọc.
    const ssr = "auth=12;actor=30;batch=45;gate=4;total=92;n=1;up=18124";
    expect(renderToString(ve({ ssrTiming: ssr }))).toContain(`data-scorm-ssr="${ssr}"`);
    expect(renderToString(ve())).not.toContain("data-scorm-ssr");
    render(ve({ ssrTiming: ssr }));
    expect(khung().dataset.scormSsr).toBe(ssr);
  });

  it("[SPL-1b] thăm dò launch URL: Range 0-0, same-origin, no-store", async () => {
    render(ve());
    await tien(0);
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/scorm/asset/")) as [string, RequestInit];
    expect(url).toBe(`/api/scorm/asset/${GOI}/res/index.html?t=ve-1`);
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-0");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
  });
});

describe("[SPL-2] chậm là nhắc, không phải lỗi", () => {
  it("[SPL-2a] sau 12s: có nhắc + 2 nút ≥44px, VẪN dang-tai, KHÔNG role=alert", async () => {
    probe = () => new Promise<Response>(() => undefined); // mạng treo
    render(ve());
    await tien(HEN_CHAM_MS);
    expect(khung().dataset.scormState).toBe("dang-tai");
    expect(screen.getByText(/Mạng đang yếu/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    for (const ten of ["Tải lại", "Ẩn thông báo"]) expect(screen.getByRole("button", { name: ten }).className).toContain("h-11");
  });

  it("[SPL-2b] 'Ẩn thông báo' tắt lớp phủ và hạn chót KHÔNG bật lại nó (người dùng đã chọn tiếp tục)", async () => {
    probe = () => new Promise<Response>(() => undefined);
    render(ve());
    await tien(HEN_CHAM_MS);
    fireEvent.click(screen.getByRole("button", { name: "Ẩn thông báo" }));
    expect(screen.queryByRole("status")).toBeNull();
    await tien(HEN_QUA_HAN_MS);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(khung().dataset.scormState).toBe("dang-tai");
  });

  it("[SPL-2c] 'Tải lại' ở lớp phủ chậm reload CẢ TRANG", async () => {
    probe = () => new Promise<Response>(() => undefined);
    render(ve());
    await tien(HEN_CHAM_MS);
    fireEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("[SPL-3] lỗi theo bằng chứng", () => {
  const ca: Array<[string, () => Promise<Response> | Response, string]> = [
    ["403", () => res(403, "Forbidden"), "ve-het-han"],
    ["404", () => res(404, "Not found"), "khong-thay"],
    ["502", () => res(502, "Upstream error"), "may-chu"],
    ["mạng", () => Promise.reject(new TypeError("Failed to fetch")), "mang"],
  ];
  for (const [ten, p, ma] of ca) {
    it(`[SPL-3] thăm dò ${ten} ⇒ loi/${ma} + role=alert + dấu`, async () => {
      probe = p;
      render(ve());
      await tien(0);
      expect(khung().dataset.scormState).toBe("loi");
      expect(khung().dataset.scormLoi).toBe(ma);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(marks).toContain("scorm:error");
    });
  }

  it("[SPL-3a] 403 chỉ có 'Tải lại trang' (cấp vé mới), bấm ⇒ reload; KHÔNG có 'Thử lại' vô dụng", async () => {
    probe = () => res(403, "Forbidden");
    render(ve());
    await tien(0);
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại trang" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("[SPL-3b] lỗi khác có cả 'Thử lại' lẫn 'Tải lại trang', cả hai ≥44px", async () => {
    probe = () => res(502);
    render(ve());
    await tien(0);
    for (const ten of ["Thử lại", "Tải lại trang"]) expect(screen.getByRole("button", { name: ten }).className).toContain("h-11");
  });

  it("[SPL-3c] iframe nạp trang chữ 'Forbidden' (load 'thành công') ⇒ loi/ve-het-han dù thăm dò chưa về", async () => {
    probe = () => new Promise<Response>(() => undefined);
    render(ve());
    taiLieu = { href: "http://x/api/scorm/asset/c/res/index.html", contentType: "text/plain", readyState: "complete", text: "Forbidden" };
    fireEvent.load(iframe());
    expect(khung().dataset.scormState).toBe("loi");
    expect(khung().dataset.scormLoi).toBe("ve-het-han");
  });

  it("[SPL-3e] iframe nạp tài liệu KHÔNG phải HTML với chữ lạ (vd JSON) ⇒ loi/may-chu, không coi là bài giảng", async () => {
    probe = () => new Promise<Response>(() => undefined);
    render(ve());
    taiLieu = { href: "http://x/a", contentType: "application/json", readyState: "complete", text: '{"ok":false}' };
    fireEvent.load(iframe());
    expect(khung().dataset.scormLoi).toBe("may-chu");
  });

  it("[SPL-3d] quá 45s mà chưa có gì ⇒ loi/qua-han, có Thử lại", async () => {
    probe = () => new Promise<Response>(() => undefined);
    render(ve());
    await tien(HEN_QUA_HAN_MS);
    expect(khung().dataset.scormLoi).toBe("qua-han");
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });
});

describe("[SPL-4] sẵn sàng", () => {
  it("[SPL-4a] iframe nạp HTML xong ⇒ san-sang, lớp phủ biến mất, mark first-content + ready", async () => {
    render(ve());
    taiLieu = { href: "http://x/api/scorm/asset/c/res/index.html", contentType: "text/html", readyState: "complete" };
    fireEvent.load(iframe());
    expect(khung().dataset.scormState).toBe("san-sang");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    await tien(0);
    expect(marks).toEqual(expect.arrayContaining(["scorm:open", "scorm:first-content", "scorm:ready"]));
  });

  it("[SPL-4b] soi định kỳ bắt được 'xong' dù onLoad đã chạy TRƯỚC khi React gắn handler (SSR)", async () => {
    probe = () => new Promise<Response>(() => undefined);
    render(ve());
    taiLieu = { href: "http://x/api/scorm/asset/c/res/index.html", readyState: "interactive" };
    await tien(400);
    expect(khung().dataset.scormState).toBe("dang-tai");
    expect(marks).toContain("scorm:first-content"); // First Content Visible sớm hơn load
    taiLieu = { href: "http://x/api/scorm/asset/c/res/index.html", readyState: "complete" };
    await tien(400);
    expect(khung().dataset.scormState).toBe("san-sang");
  });

  it("[SPL-4c] san-sang rồi thăm dò/hạn chót muộn KHÔNG kéo về lỗi", async () => {
    probe = () => new Promise<Response>(() => undefined);
    render(ve());
    taiLieu = { href: "http://x/api/scorm/asset/c/res/index.html", readyState: "complete" };
    fireEvent.load(iframe());
    await tien(HEN_QUA_HAN_MS * 2);
    expect(khung().dataset.scormState).toBe("san-sang");
    // Gói SCORM điều hướng NỘI BỘ ⇒ iframe bắn `load` thêm lần nữa; dù tài liệu lần sau là trang chữ lỗi, bài đang chiếu không bị kéo về lỗi.
    taiLieu = { href: "http://x/y", contentType: "text/plain", readyState: "complete", text: "Forbidden" };
    fireEvent.load(iframe());
    await tien(HEN_QUA_HAN_MS);
    expect(khung().dataset.scormState).toBe("san-sang");
    expect(khung().dataset.scormLoi).toBeUndefined();
  });

  it("[SPL-4d] FAIL-OPEN: không đọc được iframe + thăm dò báo tốt ⇒ vẫn san-sang (không chặn việc dạy)", async () => {
    render(ve());
    taiLieu = "chet";
    fireEvent.load(iframe());
    await tien(0);
    expect(khung().dataset.scormState).toBe("san-sang");
  });

  it("[SPL-4e] FAIL-OPEN: lỗi KHÔNG phải mạng của bộ thăm dò (abort, trình duyệt từ chối) bị bỏ qua", async () => {
    probe = () => Promise.reject(new DOMException("aborted", "AbortError"));
    render(ve());
    await tien(0);
    expect(khung().dataset.scormState).toBe("dang-tai");
    taiLieu = { href: "http://x/a", readyState: "complete" };
    fireEvent.load(iframe());
    expect(khung().dataset.scormState).toBe("san-sang");
  });
});

describe("[SPL-5] thử lại: chỉ do người dùng bấm", () => {
  it("[SPL-5a] KHÔNG tự thử lại: sau lỗi chờ 30 phút, số request thăm dò và iframe không đổi", async () => {
    probe = () => res(502);
    render(ve());
    await tien(0);
    const truoc = iframe();
    const dem = demThamDo();
    await tien(30 * 60 * 1000);
    expect(demThamDo()).toBe(dem);
    expect(iframe()).toBe(truoc);
    expect(reload).not.toHaveBeenCalled();
  });

  it("[SPL-5b] bấm Thử lại ⇒ iframe NẠP LẠI (phần tử mới), thăm dò chạy lại, trạng thái về dang-tai", async () => {
    probe = () => res(502);
    render(ve());
    await tien(0);
    const cu = iframe();
    probe = () => res(206);
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await tien(0);
    expect(iframe()).not.toBe(cu);
    expect(demThamDo()).toBe(2);
    expect(khung().dataset.scormState).toBe("dang-tai");
    expect(khung().dataset.scormLoi).toBeUndefined();
  });

  it("[SPL-5c] Thử lại dùng vé MỚI NHẤT đã gia hạn, không dùng vé gắn lúc render trang", async () => {
    probe = () => new Promise<Response>(() => undefined);
    render(ve());
    await tien(GIA_HAN_CHU_KY_MS); // qua-han lúc 45s ⇒ loi; gia hạn lúc 4 phút ⇒ ve-moi
    expect(khung().dataset.scormLoi).toBe("qua-han");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(iframe().getAttribute("src")).toBe(`/api/scorm/asset/${GOI}/res/index.html?t=ve-moi`);
  });
});

describe("[SPL-6] gia hạn vé + phiên hết hạn", () => {
  it("[SPL-6a] gia hạn chủ động mỗi 4 phút khi đang chiếu — không cần nạp lại iframe", async () => {
    render(ve());
    taiLieu = { href: "http://x/a", readyState: "complete" };
    fireEvent.load(iframe());
    const truoc = iframe();
    await tien(GIA_HAN_CHU_KY_MS);
    expect(fetchMock.mock.calls.filter(([u]) => String(u) === "/api/scorm/gia-han")).toHaveLength(1);
    expect(iframe()).toBe(truoc);
  });

  it("[SPL-6b] gia hạn bị từ chối (403) ⇒ biểu ngữ 'phiên hết hạn' + Tải lại trang, nhưng iframe và trạng thái san-sang GIỮ NGUYÊN", async () => {
    giaHan = () => jsonRes(403, { ok: false, reason: "het-han-toi-da" });
    render(ve());
    taiLieu = { href: "http://x/a", readyState: "complete" };
    fireEvent.load(iframe());
    await tien(GIA_HAN_CHU_KY_MS);
    const bieuNgu = document.querySelector("[data-scorm-phien='het-han']") as HTMLElement;
    expect(bieuNgu).not.toBeNull();
    expect(bieuNgu.getAttribute("role")).toBe("alert");
    expect(iframe()).not.toBeNull();
    expect(khung().dataset.scormState).toBe("san-sang");
    fireEvent.click(screen.getByRole("button", { name: "Tải lại trang" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("[SPL-7] dọn dẹp", () => {
  it("[SPL-7a] unmount ⇒ không còn hẹn giờ nào (hẹn chậm, hạn chót, soi iframe, gia hạn, đồng hồ watermark)", async () => {
    probe = () => new Promise<Response>(() => undefined);
    const { unmount } = render(ve());
    await tien(1000);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[SPL-7b] unmount ⇒ request thăm dò đang bay bị huỷ (AbortSignal)", async () => {
    let tin: AbortSignal | undefined;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("/api/scorm/asset/")) tin = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const { unmount } = render(ve());
    await tien(0);
    expect(tin?.aborted).toBe(false);
    unmount();
    expect(tin?.aborted).toBe(true);
  });
});
