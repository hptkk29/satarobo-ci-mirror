/**
 * [HDKV-*] Hai trang (Hoá đơn / Cảnh báo & sai sót) giao thân cho `TrangBanChungTu` với ĐÚNG khu vực của mình, ĐÚNG
 * người dùng và URL gốc. Hành vi của RSC trang (gọi hàm thật, loader giả) — `[HDNAV-W3]` chỉ ghim cổng quyền bằng grep,
 * nên hai trang truyền nhầm khu vực cho nhau (tab Cảnh báo hiện ngăn của tab Hoá đơn, và ngược lại) không ca nào đỏ.
 *
 * Gọi hàm trang trả về MỘT phần tử React — đọc `type`/`props` của nó là đủ, không cần render.
 */
import { Fragment, Suspense, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  laBat: true,
  session: { user: { id: "u-an" } } as { user: { id: string } } | null,
  coQuyen: true,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => h.session }));
vi.mock("@/lib/auth/check-permission", () => ({ checkAnyPermission: async () => h.coQuyen }));
vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: async () => h.laBat }));
vi.mock("./_components/trang-ban-chung-tu", () => ({ TrangBanChungTu: function TrangBanChungTu() {} }));
vi.mock("./_components/khu-ngoai-le", () => ({ KhuNgoaiLe: function KhuNgoaiLe() {}, KhuNgoaiLeKhung: function KhuNgoaiLeKhung() {} }));

import HoaDonPage from "./page";
import CanhBaoHoaDonPage from "./canh-bao/page";
import { TrangBanChungTu } from "./_components/trang-ban-chung-tu";
import { KhuNgoaiLe } from "./_components/khu-ngoai-le";

const SP = { ngan: "cho", coSo: "cs1" };

beforeEach(() => {
  h.laBat = true;
  h.session = { user: { id: "u-an" } };
  h.coQuyen = true;
});

describe("[HDKV-01] mỗi trang truyền ĐÚNG khu vực + người dùng + tham số URL cho thân chung", () => {
  it("trang Hoá đơn ⇒ khuVuc='hoa-don'", async () => {
    const el = (await HoaDonPage({ searchParams: Promise.resolve(SP) })) as { type: unknown; props: Record<string, unknown> };
    expect(el.type).toBe(TrangBanChungTu);
    expect(el.props).toEqual({ khuVuc: "hoa-don", userId: "u-an", sp: SP });
  });

  it("trang Cảnh báo ⇒ khuVuc='canh-bao' (không phải khu vực của trang kia)", async () => {
    // Từ Invoice Hub S12 trang Cảnh báo có THÊM khu «Ngoại lệ hoá đơn» ở trên: gốc là Fragment [Suspense(KhuNgoaiLe), TrangBanChungTu].
    // Luật vẫn nguyên — thân chung nhận ĐÚNG khu vực + người dùng + tham số URL; khu ngoại lệ nhận ĐÚNG người dùng + CÙNG tham số URL.
    const el = (await CanhBaoHoaDonPage({ searchParams: Promise.resolve(SP) })) as unknown as ReactElement<{ children: ReactElement<Record<string, unknown>>[] }>;
    expect(el.type).toBe(Fragment);
    const [khuBoc, than] = el.props.children;
    expect(than!.type).toBe(TrangBanChungTu);
    expect(than!.props).toEqual({ khuVuc: "canh-bao", userId: "u-an", sp: SP });
    expect(khuBoc!.type).toBe(Suspense);
    const khu = khuBoc!.props.children as unknown as ReactElement<Record<string, unknown>>;
    expect(khu.type).toBe(KhuNgoaiLe);
    expect(khu.props).toEqual({ userId: "u-an", sp: SP });
  });
});

describe.each([
  ["Hoá đơn", HoaDonPage, "%2Fpayments%2Fhoa-don"],
  ["Cảnh báo", CanhBaoHoaDonPage, "%2Fpayments%2Fhoa-don%2Fcanh-bao"],
] as const)("[HDKV-02] cổng của trang %s chạy TRƯỚC khi giao thân (hành vi)", (_ten, Trang, callback) => {
  const goi = () => Trang({ searchParams: Promise.resolve(SP) });

  it("cờ tắt ⇒ notFound, kể cả khi chưa đăng nhập (không dò được địa chỉ)", async () => {
    h.laBat = false;
    h.session = null;
    await expect(goi()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("chưa đăng nhập ⇒ về /login kèm callbackUrl đúng trang", async () => {
    h.session = null;
    await expect(goi()).rejects.toThrow(`NEXT_REDIRECT:/login?callbackUrl=${callback}`);
  });

  it("đăng nhập nhưng thiếu quyền ⇒ /dashboard?error=unauthorized", async () => {
    h.coQuyen = false;
    await expect(goi()).rejects.toThrow("NEXT_REDIRECT:/dashboard?error=unauthorized");
  });

  it("đối chứng dương: đủ cờ + đăng nhập + quyền ⇒ trả phần tử, không ném", async () => {
    await expect(goi()).resolves.toBeTruthy();
  });
});
