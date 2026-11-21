// @vitest-environment jsdom
// [PSP-nn] PdfSlidePlayer dùng chung máy trạng thái tải với ScormPlayer: lỗi phân loại, thử lại do người dùng, vé gia hạn trước khi nạp lại.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const destroy = vi.fn();
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 3, getPage: () => new Promise(() => undefined) }),
    destroy,
  }),
}));

import { PdfSlidePlayer } from "./pdf-slide-player";
import { GIA_HAN_CHU_KY_MS } from "./use-gia-han-ve-scorm";
import { HEN_CHAM_MS, HEN_QUA_HAN_PDF_MS } from "./scorm-trang-thai-tai";

const GOI = "cabcdefghijklmnopqrstuvwx";
let fetchMock: ReturnType<typeof vi.fn>;
let pdf: () => Promise<Response> | Response;
let giaHan: () => Promise<Response> | Response;
let marks: string[];
const reload = vi.fn();
const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  pdf = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  giaHan = () => jsonRes(200, { ok: true, ticket: "ve-moi", expiresInSec: 600 });
  fetchMock = vi.fn((url: string) => (String(url) === "/api/scorm/gia-han" ? giaHan() : pdf()));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
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

const pl = () => (
  <PdfSlidePlayer
    packageId={GOI}
    launchTicket="ve-1"
    launchUrl="source.pdf"
    packageName="Giáo án"
    name="GV A"
    employeeCode="NV01"
  />
);
const khung = () => document.querySelector("[data-scorm-state]") as HTMLElement;
const tien = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const goiPdf = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/scorm/asset/"));

describe("[PSP] PdfSlidePlayer", () => {
  it("[PSP-1] tải xong ⇒ san-sang, có canvas, dấu mốc open/first-content/ready; PDF KHÔNG gia hạn định kỳ", async () => {
    render(pl());
    expect(khung().dataset.scormState).toBe("dang-tai");
    expect(screen.getByRole("status")).toHaveTextContent("Đang tải slide…");
    await tien(0);
    expect(khung().dataset.scormState).toBe("san-sang");
    expect(document.querySelector("canvas")).not.toBeNull();
    expect(marks).toEqual(expect.arrayContaining(["scorm:open", "scorm:first-content", "scorm:ready"]));
    expect(goiPdf()[0][0]).toBe(`/api/scorm/asset/${GOI}/source.pdf?t=ve-1`);
    await tien(GIA_HAN_CHU_KY_MS * 3);
    expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/scorm/gia-han")).toBe(false);
  });

  it("[PSP-2] 403 ⇒ loi/ve-het-han chỉ có 'Tải lại trang' (reload); 404 ⇒ khong-thay; mạng ⇒ mang", async () => {
    pdf = () => new Response("Forbidden", { status: 403 });
    render(pl());
    await tien(0);
    expect(khung().dataset.scormLoi).toBe("ve-het-han");
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại trang" }));
    expect(reload).toHaveBeenCalledTimes(1);
    cleanup();

    pdf = () => new Response("Not found", { status: 404 });
    render(pl());
    await tien(0);
    expect(khung().dataset.scormLoi).toBe("khong-thay");
    cleanup();

    pdf = () => Promise.reject(new TypeError("Failed to fetch"));
    render(pl());
    await tien(0);
    expect(khung().dataset.scormLoi).toBe("mang");
  });

  it("[PSP-3] chậm sau 12s chỉ NHẮC; quá hạn PDF (90s) ⇒ loi/qua-han và HUỶ request đang bay", async () => {
    let tin: AbortSignal | undefined;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("/api/scorm/asset/")) tin = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    render(pl());
    await tien(HEN_CHAM_MS);
    expect(khung().dataset.scormState).toBe("dang-tai");
    expect(screen.getByText(/Mạng đang yếu/)).toBeInTheDocument();
    await tien(HEN_QUA_HAN_PDF_MS - HEN_CHAM_MS);
    expect(khung().dataset.scormLoi).toBe("qua-han");
    expect(tin?.aborted).toBe(true);
  });

  it("[PSP-4] KHÔNG tự thử lại; bấm Thử lại ⇒ gia hạn vé trước rồi tải lại bằng vé MỚI", async () => {
    pdf = () => new Response("x", { status: 502 });
    render(pl());
    await tien(0);
    expect(khung().dataset.scormLoi).toBe("may-chu");
    await tien(30 * 60 * 1000);
    expect(goiPdf()).toHaveLength(1); // không tự thử lại

    pdf = () => new Response(new Uint8Array([1]), { status: 200 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(goiPdf()).toHaveLength(2);
    expect(goiPdf()[1][0]).toBe(`/api/scorm/asset/${GOI}/source.pdf?t=ve-moi`);
    expect(khung().dataset.scormState).toBe("san-sang");
  });

  it("[PSP-5] Thử lại mà vé hết hạn thật (gia hạn 403) ⇒ chuyển sang ve-het-han (phải tải lại trang), không nạp lại bằng vé chết", async () => {
    pdf = () => new Response("x", { status: 502 });
    giaHan = () => jsonRes(403, { ok: false, reason: "het-han-toi-da" });
    render(pl());
    await tien(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(khung().dataset.scormLoi).toBe("ve-het-han");
    expect(goiPdf()).toHaveLength(1);
  });

  it("[PSP-6] unmount ⇒ không còn hẹn giờ và request bị huỷ", async () => {
    let tin: AbortSignal | undefined;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("/api/scorm/asset/")) tin = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const { unmount } = render(pl());
    await tien(500);
    unmount();
    expect(tin?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
