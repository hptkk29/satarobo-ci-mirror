// @vitest-environment jsdom
/**
 * [TLC-*] — «Tạo link giới thiệu» trên cổng đối tác (AFF-WEB) và nút «Mã QR», trên PHẦN TỬ THẬT (jsdom). Hàm gọi máy chủ được TIÊM; Server Action của cổng được mock (nó kéo next-auth/Prisma).
 *
 *   [TLC-01] chuỗi chọn Campaign → Website → Trang đích: mỗi tầng chỉ liệt kê thứ của tầng trên; đổi tầng trên làm lại tầng dưới (không giữ giá trị mồ côi)
 *   [TLC-02] chỉ một lựa chọn ở mọi tầng ⇒ tự điền; payload gửi đi là ĐÚNG bốn khoá {membershipId, siteId, landingPageId, landingPath, label} — không partyId, không type, không id nào khác
 *   [TLC-03] chọn thiếu ⇒ lỗi cạnh nút và KHÔNG gọi máy chủ
 *   [TLC-04] máy chủ từ chối ⇒ hiện nguyên câu cạnh nút; thành công ⇒ báo + làm mới danh sách
 *   [TLC-05] hạn mức: hết ⇒ khoá nút + nói; còn ⇒ nút bấm được (đối chứng dương)
 *   [TLC-06] chưa có chương trình nào ⇒ nói vì sao, KHÔNG form
 *   [TLC-07] nút QR: không tự gọi máy chủ; BẤM mới gọi với id; hiện <img> data-URI + «Tải về»; lỗi ⇒ role=alert
 *
 * Mỗi ca "KHÔNG thấy X" đi kèm đối chứng dương (CLAUDE.md luật 11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
vi.mock("@/app/(portal)/portal/gioi-thieu/_actions", () => ({ taoLinkCuaToiAction: vi.fn(), taoQrCuaToiAction: vi.fn() }));

import type { TaoLinkCuaToi } from "@/lib/affiliate/cua-toi";
import { NutQrLinkCuaToi } from "./nut-qr-link-cua-toi";
import { TaoLinkCuaToiForm } from "./tao-link-cua-toi";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const web = (siteId: string, ten: string, host: string, trang: string[]) => ({ siteId, ten, host, trangDich: trang.map((mau) => ({ id: mau, host, mau, nhan: null, kieu: "CHINH_XAC" as const })) });

const NHIEU: TaoLinkCuaToi = {
  coGocLinkNgan: true,
  chuongTrinh: [
    { membershipId: "m1", campaignMa: "TET", campaignTen: "Tết 2027", soLinkDangChay: 3, soLinkToiDa: 50, websites: [web("sA", "Quà tặng", "quatang.edu.vn", ["/khoa-robot"]), web("sB", "Test", "test.satarobo.vn", ["/b1", "/b2"])] },
    { membershipId: "m2", campaignMa: "HE", campaignTen: "Hè 2027", soLinkDangChay: 0, soLinkToiDa: 50, websites: [web("sB", "Test", "test.satarobo.vn", ["/b1"])] },
  ],
};
const MOT: TaoLinkCuaToi = { coGocLinkNgan: true, chuongTrinh: [{ ...NHIEU.chuongTrinh[0]!, websites: [web("sA", "Quà tặng", "quatang.edu.vn", ["/khoa-robot"])] }] };

const chon = (nhan: RegExp | string) => screen.getByLabelText(nhan) as HTMLSelectElement;
const dat = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });
const tuyChon = (el: HTMLSelectElement) => [...el.options].map((o) => o.value).filter((v) => v !== "");
const OK = { ok: true as const, id: "n1" };

describe("[TLC-01] chuỗi chọn", () => {
  it("Website/Trang đích bị khoá cho tới khi chọn tầng trên; mỗi tầng chỉ liệt kê thứ của tầng trên", () => {
    render(<TaoLinkCuaToiForm data={NHIEU} tao={vi.fn()} />);
    expect(chon("Website").disabled).toBe(true);
    expect(chon("Trang đích").disabled).toBe(true);
    expect(tuyChon(chon(/Chương trình/))).toEqual(["m1", "m2"]);

    dat(chon(/Chương trình/), "m1");
    expect(chon("Website").disabled).toBe(false);
    expect(tuyChon(chon("Website"))).toEqual(["sA", "sB"]);
    dat(chon("Website"), "sB");
    expect(tuyChon(chon("Trang đích"))).toEqual(["/b1", "/b2"]);

    // campaign thứ hai chỉ có website B (đối chứng: danh sách website đổi theo campaign)
    dat(chon(/Chương trình/), "m2");
    expect(tuyChon(chon("Website"))).toEqual(["sB"]);
  });

  it("đổi campaign làm LẠI các tầng dưới (không giữ website/trang đích của campaign cũ)", () => {
    render(<TaoLinkCuaToiForm data={NHIEU} tao={vi.fn()} />);
    dat(chon(/Chương trình/), "m1");
    dat(chon("Website"), "sB");
    dat(chon("Trang đích"), "/b2");
    expect(chon("Trang đích").value).toBe("/b2");
    dat(chon(/Chương trình/), "m2"); // đổi sang campaign khác ⇒ về trống
    expect(chon("Website").value).toBe("sB"); // campaign m2 chỉ có MỘT website ⇒ tự điền
    expect(chon("Trang đích").value).toBe("/b1"); // …và website đó chỉ có MỘT trang ⇒ tự điền (không giữ /b2 của campaign cũ)
  });
});

describe("[TLC-02] tự điền & payload", () => {
  it("chỉ một lựa chọn ở mọi tầng ⇒ tự điền; gửi ĐÚNG bốn khoá, không partyId / type", async () => {
    const tao = vi.fn(async () => OK);
    render(<TaoLinkCuaToiForm data={MOT} tao={tao} />);
    expect(chon(/Chương trình/).value).toBe("m1");
    expect(chon("Website").value).toBe("sA");
    expect(chon("Trang đích").value).toBe("/khoa-robot");
    dat(screen.getByLabelText(/Nhãn nhớ/), "  Nhóm Zalo 3A  ");
    fireEvent.click(screen.getByRole("button", { name: "Tạo link" }));
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
    const vao = (tao.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(vao).toEqual({ membershipId: "m1", siteId: "sA", landingPageId: "/khoa-robot", landingPath: "/khoa-robot", label: "Nhóm Zalo 3A" });
    expect(Object.keys(vao).sort()).toEqual(["label", "landingPageId", "landingPath", "membershipId", "siteId"]);
  });

  it("nhãn trống ⇒ label = null (không gửi chuỗi rỗng)", async () => {
    const tao = vi.fn(async () => OK);
    render(<TaoLinkCuaToiForm data={MOT} tao={tao} />);
    fireEvent.click(screen.getByRole("button", { name: "Tạo link" }));
    await waitFor(() => expect(tao).toHaveBeenCalled());
    expect(((tao.mock.calls[0] as unknown[])[0] as { label: unknown }).label).toBeNull();
  });
});

describe("[TLC-03] chọn thiếu", () => {
  it("chưa chọn đủ ⇒ lỗi cạnh nút, KHÔNG gọi máy chủ; đối chứng: chọn đủ thì gọi", async () => {
    const tao = vi.fn(async () => OK);
    render(<TaoLinkCuaToiForm data={NHIEU} tao={tao} />);
    fireEvent.click(screen.getByRole("button", { name: "Tạo link" }));
    expect(screen.getByRole("alert").textContent).toContain("Chọn đủ chương trình, website và trang đích.");
    expect(tao).not.toHaveBeenCalled();
    dat(chon(/Chương trình/), "m1");
    dat(chon("Website"), "sA");
    dat(chon("Trang đích"), "/khoa-robot");
    fireEvent.click(screen.getByRole("button", { name: "Tạo link" }));
    await waitFor(() => expect(tao).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("[TLC-04] kết quả từ máy chủ", () => {
  it("bị từ chối ⇒ hiện nguyên câu máy chủ, KHÔNG làm mới danh sách", async () => {
    const tao = vi.fn(async () => ({ ok: false as const, loi: "Đối tác này đã có 50 link đang hoạt động trong campaign (tối đa 50).", truong: "chung" }));
    render(<TaoLinkCuaToiForm data={MOT} tao={tao} />);
    fireEvent.click(screen.getByRole("button", { name: "Tạo link" }));
    expect((await screen.findByRole("alert")).textContent).toContain("tối đa 50");
    expect(ROUTER.refresh).not.toHaveBeenCalled();
    expect(document.querySelector("[data-da-tao-link]")).toBeNull();
  });

  it("thành công ⇒ báo + làm mới danh sách; máy chủ ném ⇒ câu chung, không văng", async () => {
    const tao = vi.fn(async () => OK);
    const { unmount } = render(<TaoLinkCuaToiForm data={MOT} tao={tao} />);
    fireEvent.click(screen.getByRole("button", { name: "Tạo link" }));
    await waitFor(() => expect(document.querySelector("[data-da-tao-link]")).not.toBeNull());
    expect(ROUTER.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();

    const hong = vi.fn(async () => {
      throw new Error("mạng");
    });
    render(<TaoLinkCuaToiForm data={MOT} tao={hong} />);
    fireEvent.click(screen.getByRole("button", { name: "Tạo link" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Không tạo được link lúc này");
  });
});

describe("[TLC-05] hạn mức", () => {
  it("hết hạn mức ⇒ nút KHOÁ + câu nói rõ; còn hạn mức ⇒ nút bấm được (đối chứng dương)", () => {
    const het: TaoLinkCuaToi = { ...MOT, chuongTrinh: [{ ...MOT.chuongTrinh[0]!, soLinkDangChay: 50, soLinkToiDa: 50 }] };
    const { unmount } = render(<TaoLinkCuaToiForm data={het} tao={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Tạo link" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector("[data-han-muc]")!.textContent).toContain("Đã dùng 50/50");
    expect(document.querySelector("[data-han-muc]")!.textContent).toContain("hết hạn mức");
    unmount();
    render(<TaoLinkCuaToiForm data={MOT} tao={vi.fn()} />);
    expect((screen.getByRole("button", { name: "Tạo link" }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector("[data-han-muc]")!.textContent).toContain("Đã dùng 3/50");
  });
});

describe("[TLC-06] chưa có chương trình", () => {
  it("nói vì sao, KHÔNG form; đối chứng: có chương trình ⇒ có form", () => {
    const { unmount } = render(<TaoLinkCuaToiForm data={{ coGocLinkNgan: true, chuongTrinh: [] }} tao={vi.fn()} />);
    expect(document.querySelector("[data-rong='tao-link']")!.textContent).toContain("chưa có chương trình nào");
    expect(document.querySelector("form")).toBeNull();
    unmount();
    render(<TaoLinkCuaToiForm data={MOT} tao={vi.fn()} />);
    expect(document.querySelector("form")).not.toBeNull();
  });
});

describe("[TLC-07] nút Mã QR", () => {
  const DATA = "data:image/svg+xml;base64,PHN2Zy8+";

  it("KHÔNG tự gọi máy chủ; BẤM mới gọi với đúng id; hiện <img> data-URI + «Tải về» + link ngắn", async () => {
    const taoQr = vi.fn(async () => ({ ok: true as const, dataUri: DATA, tenTep: "qr-ABC.svg", lienKetNgan: "https://test.satarobo.vn/r/ABCDEFGHJK" }));
    render(<NutQrLinkCuaToi id="l1" nhan="Tết 2027 — quatang.edu.vn" taoQr={taoQr} />);
    expect(taoQr).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Xem mã QR của Tết 2027 — quatang.edu.vn" }));
    await waitFor(() => expect(taoQr).toHaveBeenCalledWith({ id: "l1" }));
    const hop = await screen.findByRole("dialog");
    await waitFor(() => expect(within(hop).getByRole("img").getAttribute("src")).toBe(DATA));
    expect(within(hop).getByRole("link", { name: /Tải về/ }).getAttribute("download")).toBe("qr-ABC.svg");
    expect(hop.textContent).toContain("https://test.satarobo.vn/r/ABCDEFGHJK");
  });

  it("máy chủ báo lỗi ⇒ role=alert với đúng câu; không có ảnh, không có «Tải về»", async () => {
    const taoQr = vi.fn(async () => ({ ok: false as const, loi: "Link này đã thu hồi — không tạo QR cho link đã thu hồi." }));
    render(<NutQrLinkCuaToi id="l9" nhan="Cũ" taoQr={taoQr} />);
    fireEvent.click(screen.getByRole("button", { name: /Xem mã QR/ }));
    const hop = await screen.findByRole("dialog");
    expect((await within(hop).findByRole("alert")).textContent).toContain("đã thu hồi");
    expect(within(hop).queryByRole("img")).toBeNull();
    expect(within(hop).queryByRole("link", { name: /Tải về/ })).toBeNull();
  });
});
