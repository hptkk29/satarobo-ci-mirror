// @vitest-environment jsdom
// QA ĐỘC LẬP (24/10/2026) — viewer SCORM/PDF theo HỢP ĐỒNG của đợt này (không theo cách A2 hiện thực):
//   · khung có `data-scorm-state` ∈ dang-tai|san-sang|loi và `data-scorm-loi` (mã) ; `performance.mark`: scorm:open · first-content ·
//     ready · error ;  First Content Visible = iframe có document HTML đầu tiên ; Interactive Ready = window.load của iframe xong ;
//   · KHÔNG tự reload/tự thử lại ; 403 ⇒ nút tải lại TRANG (cấp vé mới) ; lỗi phân biệt được : 403 / 404 / 5xx / mạng / quá hạn ;
//   · gia hạn vé: POST /api/scorm/gia-han {ticket} định kỳ ~4 phút khi tab hiện + NGAY khi tab hiện lại ; `het-han-toi-da`/`phien`
//     ⇒ báo "phiên hết hạn, tải lại trang" mà KHÔNG phá nội dung đang chiếu ; iframe dùng cookie nên không nạp lại sau gia hạn.
//
// Bằng chứng loại "jsdom" — KHÔNG phải trình duyệt thật: jsdom không nạp iframe nên `contentDocument` phải GIẢ (đúng hình dạng mà
// component đọc), `fetch` giả theo URL, `location.reload` giả. Những gì cần Chrome thật (tải iframe thật, Range, mạng chậm, tab ẩn thật,
// 375px) nằm ở UAT — xem docs/scorm-hieu-nang/ma-tran-kiem-thu.md.
//
// Mỗi ca "KHÔNG làm X" đều có đối chứng dương ngay cạnh (luật 11: ca chỉ khẳng định SỰ VẮNG MẶT luôn đạt khi tính năng hỏng hẳn).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/admin/scorm-api", () => ({ mountScorm12Api: () => () => undefined }));
const pdfDoc = { numPages: 3, getPage: () => new Promise(() => undefined) };
let pdfThat = false;
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: pdfThat ? Promise.reject(new Error("PDF hỏng")) : Promise.resolve(pdfDoc),
    destroy: () => undefined,
  }),
}));

// ── Cổng cấy lỗi (luật 14): QA_DOT_BIEN_TRANGTHAI=<đường dẫn tuyệt đối> thay `@/components/admin/scorm-trang-thai-tai` bằng bản sao ĐỘT BIẾN do script của QA tạo ở
// thư mục tạm; bình thường biến này không có ⇒ module thật, file đột biến chưa từng được nạp.
vi.mock("@/components/admin/scorm-trang-thai-tai", async (goc) => {
  const that = await goc<typeof import("@/components/admin/scorm-trang-thai-tai")>();
  const f = process.env.QA_DOT_BIEN_TRANGTHAI;
  if (!f) return that;
  return (await import(/* @vite-ignore */ f)) as typeof that;
});
vi.mock("@/components/admin/use-gia-han-ve-scorm", async (goc) => {
  const that = await goc<typeof import("@/components/admin/use-gia-han-ve-scorm")>();
  const f = process.env.QA_DOT_BIEN_GIAHAN;
  if (!f) return that;
  return (await import(/* @vite-ignore */ f)) as typeof that;
});

import { PdfSlidePlayer } from "./pdf-slide-player";
import { ScormPlayer } from "./scorm-player";

const GOI = "cabcdefghijklmnopqrstuvwx";
const GIA_HAN_URL = "/api/scorm/gia-han";
const PHUT = 60_000;
const seed = { lessonStatus: "not attempted", lessonLocation: "", suspendData: "", scoreRaw: "" };

type Iframe = { href: string; contentType?: string; readyState?: string; text?: string } | "chet" | null;
let iframeGia: Iframe;
let thamDo: () => Promise<Response> | Response;
let giaHan: () => Promise<Response> | Response;
let fetchMock: ReturnType<typeof vi.fn>;
let marks: string[];
const reload = vi.fn();
let tabHien = true;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const HTML_XONG: Iframe = { href: "http://localhost/api/scorm/asset/x/res/index.html", contentType: "text/html", readyState: "complete" };

beforeEach(() => {
  vi.useFakeTimers();
  tabHien = true;
  iframeGia = { href: "about:blank", contentType: "text/html", readyState: "complete" };
  thamDo = () => new Response(null, { status: 206 });
  giaHan = () => json(200, { ok: true, ticket: "ve-moi", expiresInSec: 600 });
  fetchMock = vi.fn((url: string) => (String(url) === GIA_HAN_URL ? giaHan() : thamDo()));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(HTMLIFrameElement.prototype, "contentDocument", "get").mockImplementation(() => {
    if (iframeGia === "chet") throw new Error("SecurityError");
    if (!iframeGia) return null;
    return {
      location: { href: iframeGia.href },
      contentType: iframeGia.contentType ?? "text/html",
      readyState: iframeGia.readyState ?? "complete",
      body: { childElementCount: 1, textContent: iframeGia.text ?? "" },
    } as unknown as Document;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (tabHien ? "visible" : "hidden") });
  marks = [];
  vi.spyOn(performance, "mark").mockImplementation(((n: string) => {
    marks.push(n);
    return {} as PerformanceMark;
  }) as typeof performance.mark);
  reload.mockReset();
  vi.stubGlobal("location", { ...window.location, reload });
  pdfThat = false;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "visibilityState");
});

const sco = (over: Partial<Parameters<typeof ScormPlayer>[0]> = {}) => (
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
const khung = () => document.querySelector("[data-scorm-state]") as HTMLElement | null;
const trangThai = () => khung()?.getAttribute("data-scorm-state");
const maLoi = () => khung()?.getAttribute("data-scorm-loi");
const iframe = () => document.querySelector("iframe") as HTMLIFrameElement;
const tien = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const batLoadIframe = async () => {
  await act(async () => {
    fireEvent.load(iframe());
    await vi.advanceTimersByTimeAsync(0);
  });
};
const cuocGiaHan = () => fetchMock.mock.calls.filter(([u]) => String(u) === GIA_HAN_URL);
const cuocThamDo = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/scorm/asset/"));
const doiTab = async (hien: boolean) => {
  tabHien = hien;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
  });
};

describe("[QPL-A] dấu cho QA/UAT + mốc hiệu năng", () => {
  it("[QPL-01] vừa mở: khung data-scorm-state=dang-tai, KHÔNG có mã lỗi, có mark scorm:open, iframe trỏ URL mang MÃ GÓI + vé", async () => {
    render(sco());
    await tien(0);
    expect(trangThai()).toBe("dang-tai");
    expect(maLoi()).toBeNull();
    expect(marks).toContain("scorm:open");
    expect(marks).not.toContain("scorm:ready");
    expect(iframe().getAttribute("src")).toBe(`/api/scorm/asset/${GOI}/res/index.html?t=ve-1`);
  });

  it("[QPL-02] HTML đầu tiên xuất hiện (interactive) = First Content Visible: có mark first-content nhưng CHƯA ready; load xong = ready", async () => {
    render(sco());
    iframeGia = { ...HTML_XONG, readyState: "interactive" };
    await tien(400);
    expect(marks).toContain("scorm:first-content");
    expect(marks).not.toContain("scorm:ready");
    expect(trangThai()).toBe("dang-tai");
    iframeGia = HTML_XONG;
    await batLoadIframe();
    expect(trangThai()).toBe("san-sang");
    expect(marks).toContain("scorm:ready");
    const i = (m: string) => marks.indexOf(m);
    expect(i("scorm:open")).toBeLessThan(i("scorm:first-content"));
    expect(i("scorm:first-content")).toBeLessThanOrEqual(i("scorm:ready"));
    expect(marks).not.toContain("scorm:error");
  });

  it("[QPL-03] sẵn sàng thì lớp phủ biến mất (không còn role=status/alert che nội dung)", async () => {
    render(sco());
    iframeGia = HTML_XONG;
    await batLoadIframe();
    expect(trangThai()).toBe("san-sang");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("[QPL-B] lỗi phân biệt được + không tự reload / tự thử lại", () => {
  async function moVoiLoi(thamDoMoi: () => Promise<Response> | Response) {
    thamDo = thamDoMoi;
    render(sco());
    await tien(10);
  }

  it("[QPL-10] thăm dò 403 ⇒ loi + mã; có nút TẢI LẠI TRANG; bấm nút mới gọi reload (và đúng 1 lần)", async () => {
    await moVoiLoi(() => new Response("Forbidden", { status: 403 }));
    expect(trangThai()).toBe("loi");
    expect(maLoi()).toBeTruthy();
    expect(marks).toContain("scorm:error");
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /tải lại trang/i }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("[QPL-11] năm kiểu lỗi cho năm MÃ khác nhau: 403 · 404 · 500 · mất mạng · quá hạn", async () => {
    const ma: Record<string, string | null | undefined> = {};
    const chay = async (ten: string, tdo: () => Promise<Response> | Response, doiThem = 10) => {
      cleanup();
      marks.length = 0;
      thamDo = tdo;
      render(sco());
      await tien(doiThem);
      expect(trangThai(), ten).toBe("loi");
      ma[ten] = maLoi();
    };
    await chay("403", () => new Response("Forbidden", { status: 403 }));
    await chay("404", () => new Response("Not found", { status: 404 }));
    await chay("500", () => new Response("Upstream error", { status: 502 }));
    await chay("mang", () => Promise.reject(new TypeError("Failed to fetch")));
    await chay("qua-han", () => new Promise<Response>(() => undefined), 5 * PHUT); // thăm dò treo vô hạn, iframe cũng không có nội dung
    const gia = Object.values(ma);
    expect(gia.every(Boolean)).toBe(true);
    expect(new Set(gia).size, JSON.stringify(ma)).toBe(5);
  });

  it("[QPL-12] iframe 'tải thành công' nhưng thân là chữ Forbidden / Not found (kiểu text/plain của route, hoặc HTML trần) ⇒ KHÔNG ready, báo lỗi (đối chứng: HTML thật ⇒ ready)", async () => {
    const trangLoi = [
      { contentType: "text/plain", text: "Forbidden" }, // đúng thứ NextResponse("Forbidden") trả
      { contentType: "text/html", text: "Forbidden" }, // proxy/CDN trả HTML trần
      { contentType: "text/plain", text: "Not found" },
    ];
    for (const t of trangLoi) {
      cleanup();
      marks.length = 0;
      thamDo = () => new Promise<Response>(() => undefined);
      iframeGia = { href: "http://localhost/api/scorm/asset/x/res/index.html", readyState: "complete", ...t };
      render(sco());
      await batLoadIframe();
      expect(trangThai(), JSON.stringify(t)).toBe("loi");
      expect(marks, JSON.stringify(t)).not.toContain("scorm:ready");
    }
    cleanup();
    iframeGia = HTML_XONG;
    render(sco());
    await batLoadIframe();
    expect(trangThai()).toBe("san-sang");
  });

  it("[QPL-13] KHÔNG tự reload và KHÔNG tự thử lại: để nguyên 30 phút ở trạng thái lỗi ⇒ 0 lần reload, iframe không đổi, 0 lượt thăm dò thêm", async () => {
    await moVoiLoi(() => new Response("x", { status: 500 }));
    expect(trangThai()).toBe("loi");
    const srcTruoc = iframe().getAttribute("src");
    const soThamDo = cuocThamDo().length;
    await tien(30 * PHUT);
    expect(reload).not.toHaveBeenCalled();
    expect(iframe().getAttribute("src")).toBe(srcTruoc);
    expect(cuocThamDo().length).toBe(soThamDo);
    expect(trangThai()).toBe("loi");
    // đối chứng dương: bấm "Thử lại" CÓ làm điều đó (nạp lại khung = thăm dò mới), nghĩa là phép đếm ở trên đo được thật
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await tien(10);
    expect(cuocThamDo().length).toBeGreaterThan(soThamDo);
  });

  it("[QPL-14] CHẬM không phải LỖI: 30 giây không có phản hồi ⇒ vẫn dang-tai, hiện nhắc + nút; không tự reload; 'Tải lại' chỉ chạy khi bấm", async () => {
    thamDo = () => new Promise<Response>(() => undefined);
    render(sco());
    await tien(30_000);
    expect(trangThai()).toBe("dang-tai");
    expect(screen.getByRole("status").textContent ?? "").toMatch(/mạng|yếu|chậm/i);
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /tải lại/i }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("[QPL-15] bằng chứng NỘI DUNG thắng thăm dò: thăm dò 500 nhưng iframe nạp HTML thật ⇒ ready (đừng chặn người đang dạy được)", async () => {
    thamDo = () => new Response("x", { status: 500 });
    render(sco());
    iframeGia = HTML_XONG;
    await batLoadIframe();
    await tien(10);
    expect(trangThai()).toBe("san-sang");
  });

  it("[QPL-16] đã ready thì lỗi muộn KHÔNG kéo bài đang chiếu về 'lỗi' (SCO điều hướng nội bộ bắn load nhiều lần)", async () => {
    render(sco());
    iframeGia = HTML_XONG;
    await batLoadIframe();
    expect(trangThai()).toBe("san-sang");
    iframeGia = { href: "http://localhost/x", contentType: "text/plain", readyState: "complete", text: "Forbidden" };
    await batLoadIframe();
    await tien(5 * PHUT);
    expect(trangThai()).toBe("san-sang");
  });

  it("[QPL-17] 'Thử lại' nạp khung bằng vé MỚI NHẤT đã gia hạn (không phải vé gắn trong trang lúc render)", async () => {
    thamDo = () => new Response("x", { status: 500 });
    render(sco());
    await tien(4 * PHUT + 50); // một lượt gia hạn thành công → ve-moi
    expect(cuocGiaHan().length).toBe(1);
    expect(trangThai()).toBe("loi");
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    await tien(10);
    expect(iframe().getAttribute("src")).toContain("t=ve-moi");
  });
});

describe("[QPL-C] gia hạn vé chủ động theo lịch", () => {
  it("[QPL-20] chưa tới ~4 phút ⇒ 0 lượt; sau ~4 phút ⇒ đúng 1 lượt POST JSON {ticket: vé hiện có}, cùng nguồn gốc", async () => {
    render(sco());
    await tien(3 * PHUT + 20_000);
    expect(cuocGiaHan().length).toBe(0);
    await tien(60_000);
    expect(cuocGiaHan().length).toBe(1);
    const [, init] = cuocGiaHan()[0]! as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ ticket: "ve-1" });
    expect(init.credentials).toBe("same-origin");
    expect(String((init.headers as Record<string, string>)["Content-Type"] ?? "").toLowerCase()).toContain("application/json");
  });

  it("[QPL-21] lượt kế dùng vé do route TRẢ VỀ (chuỗi gia hạn), và không nạp lại iframe (cookie lo phần còn lại)", async () => {
    render(sco());
    const srcTruoc = iframe().getAttribute("src");
    await tien(4 * PHUT + 50);
    await tien(4 * PHUT + 50);
    expect(cuocGiaHan().length).toBe(2);
    expect(JSON.parse(String((cuocGiaHan()[1]![1] as RequestInit).body))).toEqual({ ticket: "ve-moi" });
    expect(iframe().getAttribute("src")).toBe(srcTruoc);
  });

  it("[QPL-22] tab ẨN lúc đến hạn ⇒ không gọi; tab HIỆN lại ⇒ gọi NGAY (đối chứng: tab hiện thì có gọi)", async () => {
    render(sco());
    await doiTab(false);
    await tien(10 * PHUT);
    expect(cuocGiaHan().length, "tab ẩn không được gọi").toBe(0);
    await doiTab(true);
    await tien(50);
    expect(cuocGiaHan().length, "hiện lại phải gọi ngay").toBe(1);
  });

  it("[QPL-23] gia hạn trả `het-han-toi-da` hoặc `phien` ⇒ biểu ngữ báo tải lại TRANG, KHÔNG phá nội dung đang chiếu, và DỪNG gọi thêm", async () => {
    for (const reason of ["het-han-toi-da", "phien"]) {
      cleanup();
      fetchMock.mockClear();
      reload.mockReset();
      giaHan = () => json(reason === "phien" ? 401 : 403, { ok: false, reason });
      render(sco());
      iframeGia = HTML_XONG;
      await batLoadIframe();
      await tien(4 * PHUT + 50);
      expect(cuocGiaHan().length, reason).toBe(1);
      expect(screen.getAllByRole("alert").length, reason).toBeGreaterThan(0);
      expect(trangThai(), `${reason}: nội dung đang chiếu phải còn`).toBe("san-sang");
      expect(iframe()).toBeTruthy();
      await tien(20 * PHUT);
      expect(cuocGiaHan().length, `${reason}: không gọi dồn`).toBe(1);
      fireEvent.click(screen.getByRole("button", { name: /tải lại trang/i }));
      expect(reload, reason).toHaveBeenCalledTimes(1);
    }
  });

  it("[QPL-24] lỗi tạm (500 · 429 · mất mạng) ⇒ KHÔNG hiện báo hết hạn oan, và thử lại KHÔNG dồn dập (cách nhau ≥ 15s)", async () => {
    const ketQua: Array<() => Promise<Response> | Response> = [
      () => json(500, { ok: false }),
      () => json(429, { ok: false, reason: "gioi-han" }),
      () => Promise.reject(new TypeError("Failed to fetch")),
    ];
    for (const kq of ketQua) {
      cleanup();
      fetchMock.mockClear();
      giaHan = kq;
      render(sco());
      iframeGia = HTML_XONG;
      await batLoadIframe();
      await tien(4 * PHUT + 50);
      expect(cuocGiaHan().length).toBe(1);
      expect(screen.queryByRole("alert")).toBeNull();
      await tien(10_000);
      expect(cuocGiaHan().length, "chưa được thử lại trong 10s").toBe(1);
      await tien(60 * PHUT);
      expect(cuocGiaHan().length, "thử lại có giới hạn tần suất (≤ 1 lượt/15s)").toBeLessThanOrEqual(1 + Math.floor((60 * PHUT) / 15_000));
      expect(cuocGiaHan().length, "đối chứng: có thử lại").toBeGreaterThan(1);
      expect(screen.queryByRole("alert")).toBeNull();
    }
  });

  it("[QPL-25] unmount ⇒ không còn lượt gia hạn nào (hẹn giờ + listener được gỡ)", async () => {
    const { unmount } = render(sco());
    await tien(PHUT);
    unmount();
    fetchMock.mockClear();
    await tien(30 * PHUT);
    await doiTab(false);
    await doiTab(true);
    await tien(PHUT);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("[QPP] giáo án PDF — hồi quy (không bị ảnh hưởng xấu bởi thay đổi viewer)", () => {
  const pdf = () => (
    <PdfSlidePlayer packageId={GOI} launchTicket="ve-1" launchUrl="source.pdf" packageName="Giáo án" name="GV A" employeeCode="NV01" />
  );
  const fetchPdf = () => cuocThamDo();

  it("[QPP-01] tải 1 request tới URL mang MÃ GÓI + vé, xong ⇒ san-sang + có canvas + mark open/first-content/ready", async () => {
    thamDo = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    render(pdf());
    await tien(10);
    expect(fetchPdf().length).toBe(1);
    expect(String(fetchPdf()[0]![0])).toBe(`/api/scorm/asset/${GOI}/source.pdf?t=ve-1`);
    expect(trangThai()).toBe("san-sang");
    expect(document.querySelector("canvas")).not.toBeNull();
    for (const m of ["scorm:open", "scorm:first-content", "scorm:ready"]) expect(marks).toContain(m);
  });

  it("[QPP-02] PDF 403 ⇒ lỗi RÕ (không 'Đang tải' vô hạn) + nút tải lại trang; 404 và 5xx cho mã khác nhau", async () => {
    const ma: Array<string | null | undefined> = [];
    for (const s of [403, 404, 502]) {
      cleanup();
      thamDo = () => new Response("x", { status: s });
      render(pdf());
      await tien(10);
      expect(trangThai(), String(s)).toBe("loi");
      expect(screen.queryByText(/Đang tải slide/)).toBeNull();
      ma.push(maLoi());
    }
    expect(new Set(ma).size, JSON.stringify(ma)).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: /tải lại trang/i }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("[QPP-03] PDF KHÔNG gia hạn định kỳ (tải nguyên tệp một lần, sau đó không còn request asset nào)", async () => {
    thamDo = () => new Response(new Uint8Array([1]), { status: 200 });
    render(pdf());
    await tien(30 * PHUT);
    expect(cuocGiaHan().length).toBe(0);
    expect(fetchPdf().length).toBe(1);
  });

  it("[QPP-04] tệp PDF hỏng (pdf.js ném lỗi) ⇒ báo lỗi, không treo ở 'Đang tải'", async () => {
    pdfThat = true;
    thamDo = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    render(pdf());
    await tien(10);
    expect(trangThai()).toBe("loi");
  });
});
