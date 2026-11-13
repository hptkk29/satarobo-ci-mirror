// @vitest-environment jsdom
/**
 * [DISC-TH-*] Thang trả lời THEO BỘ ĐỀ (phát hiện khi chạy engine thật: bộ Tiểu học chỉ có 3 mức, giao diện cứng 1–5 ⇒ chọn 4/5 bị server từ chối cả bài)
 * (nút "Tải kết quả (PDF)" đã gỡ 04/11/2026). Dữ liệu BỊA. Không mạng thật.
 *   [DISC-TH-01] bộ có `thang` 3 mức ⇒ đúng 3 lựa chọn, giá trị 1..3, hiện mặt cười + câu dẫn
 *   [DISC-TH-02] bộ KHÔNG có `thang` (engine cũ) ⇒ rơi về 5 mức mặc định
 *   [DISC-TH-03] laBoDeHopLe: thang/cauDan tuỳ chọn nhưng nếu có thì phải đúng hình
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { BoDeDisc } from "@/lib/disc/engine";
import { laBoDeHopLe } from "./api-client";
import { ManLamBai } from "./man-lam-bai";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cau = [
  { id: "A1", noiDung: "Câu giả một" },
  { id: "A2", noiDung: "Câu giả hai" },
];
const bo = (o: Partial<BoDeDisc> = {}): BoDeDisc => ({ ma: "TH", phienBan: "1", doiTuong: "TH", nguoiLonTraLoiHo: false, cauHoi: cau, ...o });
const lam = (b: BoDeDisc) => render(<ManLamBai boDe={b} tenNguoi="Bé Giả" traLoi={{}} cau={0} onTraLoi={() => {}} onCau={() => {}} onXong={() => {}} onQuayLai={() => {}} />);

describe("[DISC-TH-01..02] thang theo bộ đề", () => {
  it("[DISC-TH-01] 3 mức ⇒ đúng 3 lựa chọn, giá trị 1..3, mặt cười, câu dẫn", () => {
    lam(bo({ cauDan: "Đọc từng câu và chọn cái giống em nhất.", thang: [{ gia: 1, nhan: "Không phải", mat: "🙁" }, { gia: 2, nhan: "Đôi khi", mat: "😐" }, { gia: 3, nhan: "Đúng rồi", mat: "😀" }] }));
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(["1", "2", "3"]);
    expect(screen.getByText("Đúng rồi")).toBeTruthy();
    expect(screen.getByTestId("disc-cau-dan").textContent).toMatch(/giống em nhất/);
  });
  it("[DISC-TH-02] không có thang ⇒ 5 mức mặc định, không có câu dẫn", () => {
    lam(bo());
    expect((screen.getAllByRole("radio") as HTMLInputElement[]).map((r) => r.value)).toEqual(["1", "2", "3", "4", "5"]);
    expect(screen.queryByTestId("disc-cau-dan")).toBeNull();
  });
});

describe("[DISC-TH-03] laBoDeHopLe", () => {
  const goc = { ma: "TH", phienBan: "1", doiTuong: "TH", nguoiLonTraLoiHo: false, cauHoi: cau };
  it("thiếu thang/cauDan vẫn hợp lệ; đúng hình thì hợp lệ", () => {
    expect(laBoDeHopLe(goc)).toBe(true);
    expect(laBoDeHopLe({ ...goc, cauDan: "x", thang: [{ gia: 1, nhan: "a" }, { gia: 2, nhan: "b", mat: "🙂" }] })).toBe(true);
  });
  it.each([
    ["thang không phải mảng", { thang: "x" }],
    ["thang 1 mức", { thang: [{ gia: 1, nhan: "a" }] }],
    ["giá trị trùng", { thang: [{ gia: 1, nhan: "a" }, { gia: 1, nhan: "b" }] }],
    ["giá trị 0", { thang: [{ gia: 0, nhan: "a" }, { gia: 1, nhan: "b" }] }],
    ["giá trị lẻ", { thang: [{ gia: 1.5, nhan: "a" }, { gia: 2, nhan: "b" }] }],
    ["nhãn rỗng", { thang: [{ gia: 1, nhan: "" }, { gia: 2, nhan: "b" }] }],
    ["cauDan không phải chuỗi", { cauDan: 5 }],
  ])("sai hình: %s ⇒ không dựng bài", (_t, them) => {
    expect(laBoDeHopLe({ ...goc, ...them })).toBe(false);
  });
});
