// @vitest-environment jsdom
/**
 * [N13-*] Thiết bị dùng chung: mã nhận có HẠN; bản nháp có hạn (ban-nhap, ca khác); nút "Xoá dữ liệu DISC trên máy này".
 * Dữ liệu BỊA; mốc thời gian TUYỆT ĐỐI truyền vào (luật 19), không đọc đồng hồ thật.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KHOA_LOCAL_MA_NHAN, KHOA_LOCAL_MA_NHAN_LUC, HAN_MA_NHAN_LOCAL_MS, docMaNhanLocal, ghiMaNhanLocal, xoaMaNhanLocal } from "@/lib/disc/nhan-ma-local";
import { KHOA_BAN_NHAP, KHOA_BAN_NHAP_CU_V1, ghiBanNhap } from "./ban-nhap";
import { NutXoaTrenMay, xoaDuLieuDiscTrenMay } from "./xoa-tren-may";

const T0 = Date.UTC(2026, 10, 1, 3, 0, 0);
const NHAP = {
  buoc: "phuHuynh" as const,
  idempotencyKey: "khoa-gia-0123456789abcdef",  // gitleaks:allow
  hoSo: { phuHuynh: { hoTen: "Mẹ Giả", vaiTro: "ME", namSinh: "1988" }, hocSinh: { hoTen: "Bé Giả", namSinh: "2017", bacHoc: "3" }, xacNhanLech: false },
  traLoi: { PH: { "GIA-1": 3 }, HS: {} },
  cau: { PH: 0, HS: 0 },
};

/** localStorage giả CÓ THẬT trong bộ nhớ (Node mới làm hỏng bản của jsdom — xem man-thanh-cong.test.tsx). */
let map = new Map<string, string>();
let mapPhien = new Map<string, string>();
beforeEach(() => {
  map = new Map<string, string>();
  mapPhien = new Map<string, string>();
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: { getItem: (k: string) => mapPhien.get(k) ?? null, setItem: (k: string, v: string) => void mapPhien.set(k, v), removeItem: (k: string) => void mapPhien.delete(k), clear: () => mapPhien.clear() },
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k), clear: () => map.clear() },
  });
});
afterEach(cleanup);

describe("[N13-01] mã nhận có hạn", () => {
  it("trong hạn ⇒ đọc được; qua hạn ⇒ null VÀ bị xoá khỏi máy", () => {
    ghiMaNhanLocal("ABCDEFGHJK", KHOA_LOCAL_MA_NHAN, T0);
    expect(docMaNhanLocal(KHOA_LOCAL_MA_NHAN, T0 + HAN_MA_NHAN_LOCAL_MS)).toBe("ABCDEFGHJK");
    expect(docMaNhanLocal(KHOA_LOCAL_MA_NHAN, T0 + HAN_MA_NHAN_LOCAL_MS + 1)).toBeNull();
    expect(window.localStorage.getItem(KHOA_LOCAL_MA_NHAN)).toBeNull();
    expect(window.localStorage.getItem(KHOA_LOCAL_MA_NHAN_LUC)).toBeNull();
  });
  it("bản ghi cũ không có mốc thời gian ⇒ coi như hết hạn và xoá", () => {
    window.localStorage.setItem(KHOA_LOCAL_MA_NHAN, "ABCDEFGHJK");
    expect(docMaNhanLocal(KHOA_LOCAL_MA_NHAN, T0)).toBeNull();
    expect(window.localStorage.getItem(KHOA_LOCAL_MA_NHAN)).toBeNull();
  });
  it("mốc ở TƯƠNG LAI xa (đồng hồ lệch/giả mạo) ⇒ không tin", () => {
    ghiMaNhanLocal("ABCDEFGHJK", KHOA_LOCAL_MA_NHAN, T0 + 10 * 86_400_000);
    expect(docMaNhanLocal(KHOA_LOCAL_MA_NHAN, T0)).toBeNull();
  });
  it("xoaMaNhanLocal xoá cả giá trị lẫn mốc", () => {
    ghiMaNhanLocal("ABCDEFGHJK", KHOA_LOCAL_MA_NHAN, T0);
    xoaMaNhanLocal();
    expect(map.size).toBe(0);
  });
});

describe("[N13-02] xoá dữ liệu DISC trên máy này", () => {
  it("xoá bản nháp + mã nhận + mốc; KHÔNG đụng khoá của module khác (đối chứng dương)", () => {
    ghiBanNhap(window.sessionStorage, NHAP, T0);
    window.localStorage.setItem(KHOA_BAN_NHAP_CU_V1, '{"hoTen":"Bé Giả"}'); // nháp v1 cũ còn sót
    ghiMaNhanLocal("ABCDEFGHJK", KHOA_LOCAL_MA_NHAN, T0);
    window.localStorage.setItem("khoa-khac-gia", "giu-lai");
    expect(window.sessionStorage.getItem(KHOA_BAN_NHAP)).not.toBeNull();
    expect(xoaDuLieuDiscTrenMay()).toBe(true);
    expect(window.sessionStorage.getItem(KHOA_BAN_NHAP)).toBeNull();
    expect(window.localStorage.getItem(KHOA_BAN_NHAP_CU_V1)).toBeNull();
    expect(window.localStorage.getItem(KHOA_LOCAL_MA_NHAN)).toBeNull();
    expect(window.localStorage.getItem(KHOA_LOCAL_MA_NHAN_LUC)).toBeNull();
    expect(window.localStorage.getItem("khoa-khac-gia")).toBe("giu-lai");
  });
  it("nút: bấm ⇒ xoá, báo thật, gọi onDaXoa", () => {
    ghiBanNhap(window.sessionStorage, NHAP, T0);
    let goi = 0;
    render(<NutXoaTrenMay onDaXoa={() => goi++} />);
    expect(screen.getByTestId("disc-xoa-tren-may-tb").textContent).toBe("");
    fireEvent.click(screen.getByTestId("disc-xoa-tren-may"));
    expect(window.sessionStorage.getItem(KHOA_BAN_NHAP)).toBeNull();
    expect(screen.getByTestId("disc-xoa-tren-may-tb").textContent).toMatch(/Đã xoá/);
    expect(goi).toBe(1);
  });
  it("localStorage ném lỗi ⇒ không văng, không nói 'Không xoá được' oan khi không có gì để xoá", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { getItem: () => { throw new Error("chặn"); }, setItem: () => { throw new Error("chặn"); }, removeItem: () => { throw new Error("chặn"); } },
    });
    expect(() => xoaDuLieuDiscTrenMay()).not.toThrow();
  });
});
