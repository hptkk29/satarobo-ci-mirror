// @vitest-environment jsdom
/**
 * [HDNAV-P4] `khoTrinhDuyet()` — truy cập CHÍNH `window.localStorage` có thể ném (SecurityError: cửa sổ riêng tư, chặn
 * dữ liệu trang, thumbnail). Hàm phải nuốt lỗi và trả null để thanh phạm vi vẫn dựng. `[HDNAV-P3]` chỉ tiêm kho giả vào
 * `docGoiYCoSo`/`ghiGoiYCoSo`; nó không bao giờ gọi `khoTrinhDuyet` nên không canh được khối try/catch ở đây.
 */
import { afterEach, describe, expect, it } from "vitest";
import { khoTrinhDuyet } from "./pham-vi-hoa-don";

const GOC = Object.getOwnPropertyDescriptor(window, "localStorage");

function datLocalStorage(mo: PropertyDescriptor) {
  Object.defineProperty(window, "localStorage", { configurable: true, ...mo });
}

afterEach(() => {
  if (GOC) Object.defineProperty(window, "localStorage", GOC);
  else delete (window as unknown as Record<string, unknown>).localStorage;
});

describe("[HDNAV-P4] khoTrinhDuyet — kho bị chặn thì trả null, không ném", () => {
  it("truy cập window.localStorage ném SecurityError ⇒ null (không ném ra ngoài)", () => {
    datLocalStorage({
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    expect(() => khoTrinhDuyet()).not.toThrow();
    expect(khoTrinhDuyet()).toBeNull();
  });

  it("đối chứng dương: kho bình thường ⇒ trả đúng đối tượng kho đó", () => {
    const kho = { getItem: () => null, setItem: () => {} };
    datLocalStorage({ get: () => kho });
    expect(khoTrinhDuyet()).toBe(kho);
  });
});
