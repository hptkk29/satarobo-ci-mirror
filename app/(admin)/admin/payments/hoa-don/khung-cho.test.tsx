// @vitest-environment jsdom
/**
 * [HDKC-*] Khung chờ (loading.tsx) của hai tab vẽ ĐÚNG số ô ngăn của khu vực mình (`NGAN_THEO_KHU_VUC`) — khung cũ vẽ
 * sáu ô trong khi thật có tám, rồi "nhảy" khi dữ liệu về. Đọc số ô từ chính bảng phân hoạch, không gõ tay con số.
 *
 * Hình khung: [mô tả] · [dải ngăn] · [lưới bảng + ngăn xử lý]. Dải ngăn là con THỨ HAI của gốc.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import LoadingHoaDon from "./loading";
import LoadingCanhBao from "./canh-bao/loading";
import { NGAN_THEO_KHU_VUC } from "./_components/dieu-huong-hoa-don";

afterEach(cleanup);

function daiNgan(Khung: () => React.ReactElement) {
  const { container } = render(<Khung />);
  const goc = container.querySelector('[aria-busy="true"]')!;
  expect(goc).toBeTruthy();
  expect(goc.children.length).toBe(3); // mô tả · dải ngăn · lưới — đổi hình khung thì ca này đỏ trước, đừng đếm nhầm con
  return goc.children[1]!;
}

describe("[HDKC-01] số ô ngăn của khung chờ = số ngăn của khu vực", () => {
  it("tab Hoá đơn", () => {
    expect(daiNgan(LoadingHoaDon).children.length).toBe(NGAN_THEO_KHU_VUC["hoa-don"].length);
  });

  it("tab Cảnh báo & sai sót", () => {
    expect(daiNgan(LoadingCanhBao).children.length).toBe(NGAN_THEO_KHU_VUC["canh-bao"].length);
  });

  it("đối chứng: hai khu vực có số ngăn KHÁC nhau (nếu bằng nhau, ca này không phân biệt được hai khung)", () => {
    expect(NGAN_THEO_KHU_VUC["hoa-don"].length).not.toBe(NGAN_THEO_KHU_VUC["canh-bao"].length);
  });
});
