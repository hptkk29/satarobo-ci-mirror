// @vitest-environment jsdom
/**
 * [LUI-*] Tab «Link / QR / Mã» (AFF-P1) — trên PHẦN TỬ THẬT (jsdom). Server Action được mock (bảng) hoặc hàm gọi máy chủ được TIÊM (Sheet).
 *
 *   [LUI-01] BangLink: cột (Đối tác · Campaign · Website · Trang đích · URL cuối · Loại · Trạng thái · Lượt bấm · Referral) + giá trị; không `coTheGhi` ⇒ KHÔNG cột Thao tác, KHÔNG nút nào (kèm ĐỐI CHỨNG DƯƠNG: có quyền ⇒ thấy)
 *   [LUI-02] nút theo TRẠNG THÁI THẬT: link dùng được ⇒ đủ nút; ACTIVE nhưng chuỗi hỏng ⇒ chỉ «Thu hồi» + lý do; đã thu hồi ⇒ không nút
 *   [LUI-03] sao chép: đúng hai địa chỉ; clipboard hỏng ⇒ toast lỗi kèm địa chỉ để chép tay
 *   [LUI-04] thu hồi: lý do ngắn ⇒ lỗi cạnh ô, KHÔNG gọi; đủ ⇒ gọi đúng (id, mốc khoá lạc quan, lý do); «vừa đổi» ⇒ banner + Tải lại
 *   [LUI-05] xoay mã: gọi đúng; nói rõ hệ quả
 *   [LUI-06] QR: gọi taoQr khi BẤM (không tự gọi); hiện <img> data-URI + «Tải về» download; lỗi ⇒ role=alert; không nhúng SVG thô
 *   [LUI-07] PhatLinkSheet: rỗng ⇒ NÓI vì sao (3 tầng) + khoá nút; chọn tự điền khi chỉ có một lựa chọn; payload đúng; mẫu tiền tố kiểm khopDuongDan ngay trong ô; lỗi máy chủ cạnh ô
 *   [LUI-08] TrangThaiLinkPill + BoLocLink
 *
 * Mỗi ca "KHÔNG thấy X" đi kèm đối chứng dương "ca kia THẤY X" (CLAUDE.md luật 11).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const ROUTER = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ROUTER }));
const TOAST = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: TOAST }));
vi.mock("@/app/(admin)/admin/nguon-hoa-hong/link/_actions", () => ({
  phatLinkAction: vi.fn(),
  thuHoiLinkAction: vi.fn(),
  xoayLinkAction: vi.fn(),
  taoQrAction: vi.fn(),
}));

import type { DongLink, TuyChonLoc, TuyChonPhatLink } from "@/lib/affiliate/doc-link";
import type { KetQuaPhatLink } from "@/lib/affiliate/ghi-link";
import { BangLink } from "./bang-link";
import { BoLocLink } from "./bo-loc-link";
import { PhatLinkSheet, lyDoRongPhatLink } from "./phat-link-sheet";
import { TrangThaiLinkPill } from "./trang-thai-link-pill";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
});

const MOC = "2026-10-13T02:00:00.123Z";
const nhapChu = (el: HTMLElement, v: string) => fireEvent.change(el, { target: { value: v } });

const link = (p: Partial<DongLink> = {}): DongLink => ({
  id: "l1",
  doiTac: { id: "p1", ten: "Cô Lan", ma: "COLAN" },
  campaign: { id: "c1", ma: "TET_2027", ten: "Tết 2027" },
  website: { ten: "Quà tặng", host: "quatang.edu.vn" },
  landingPath: "/khoa-hoc/robot",
  landingHost: "quatang.edu.vn",
  landingNhan: null,
  loai: "LINK",
  nhan: "Poster hội chợ",
  trangThai: "ACTIVE",
  lyDoKhongDung: null,
  soLuotBam: 1234,
  soLuotBamLoi: 0,
  taoLuc: "2026-10-01T05:00:00.000Z",
  capNhatLuc: MOC,
  thuHoiLuc: null,
  lyDoThuHoi: null,
  laBanXoay: false,
  soReferral: 12,
  token: "K8F29XQ47M",
  lienKetNgan: "https://test.satarobo.vn/r/K8F29XQ47M",
  lienKetTrucTiep: "https://quatang.edu.vn/khoa-hoc/robot?aff=K8F29XQ47M&cmp=TET_2027",
  urlCuoi: "https://quatang.edu.vn/khoa-hoc/robot?aff=K8F29XQ47M&cmp=TET_2027",
  ...p,
});

const L_TOT = link();
const L_HONG = link({ id: "l2", doiTac: { id: "p2", ten: "Thầy Minh", ma: "MINH" }, token: "AB12CD34EF", lyDoKhongDung: "Campaign không ở trạng thái đang chạy.", lienKetNgan: null, lienKetTrucTiep: null, urlCuoi: null });
const L_THU_HOI = link({ id: "l3", doiTac: { id: "p3", ten: "Chị Hoa", ma: "HOA" }, token: "ZZ99YY88XX", trangThai: "REVOKED", thuHoiLuc: MOC, lyDoThuHoi: "Poster đã gỡ", lienKetNgan: null, lienKetTrucTiep: null, urlCuoi: null, soLuotBamLoi: 3, soReferral: 0 });

function bang(coTheGhi: boolean, dong: DongLink[] = [L_TOT, L_HONG, L_THU_HOI], extra: Partial<React.ComponentProps<typeof BangLink>> = {}) {
  return render(<BangLink dong={dong} coTheGhi={coTheGhi} {...extra} />);
}
const hangCua = (ten: string) => screen.getByText(ten).closest("tr")!;

// ═══ BangLink ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("[LUI-01] BangLink — cột & quyền", () => {
  it("cột + giá trị: đối tác, campaign, website · đường dẫn, loại, token, nhãn, trạng thái, lượt bấm (có dấu phân nghìn), +không hợp lệ", () => {
    bang(false);
    const th = screen.getAllByRole("columnheader").map((c) => c.textContent);
    expect(th).toEqual(["Đối tác", "Campaign", "Website", "Trang đích · URL cuối", "Loại", "Trạng thái", "Lượt bấm", "Referral", "Tạo lúc"]);
    const h = hangCua("Cô Lan");
    expect(h.textContent).toContain("COLAN");
    expect(h.textContent).toContain("Tết 2027");
    expect(h.textContent).toContain("quatang.edu.vn"); // website (tên miền)
    expect(h.textContent).toContain("/khoa-hoc/robot"); // trang đích
    expect(h.querySelector("[data-url-cuoi]")?.textContent).toBe("https://quatang.edu.vn/khoa-hoc/robot?aff=K8F29XQ47M&cmp=TET_2027"); // URL cuối
    expect(h.querySelector("[data-so-referral]")?.textContent).toBe("12"); // referral hợp lệ
    expect(h.textContent).toContain("Link");
    expect(h.textContent).toContain("K8F29XQ47M");
    expect(h.textContent).toContain("Poster hội chợ");
    expect(h.textContent).toContain("Đang hoạt động");
    expect(h.textContent).toMatch(/1\.234|1,234/);
    expect(h.textContent).toContain("01/10/2026");
    expect(hangCua("Chị Hoa").textContent).toContain("+3 không hợp lệ");
    // link đã thu hồi: không có URL cuối (khách bấm vào cũng không còn gắn người giới thiệu) — dấu «—», và 0 referral vẫn là số 0 (không để trống)
    expect(hangCua("Chị Hoa").querySelector("[data-url-cuoi]")?.textContent).toBe("—");
    expect(hangCua("Chị Hoa").querySelector("[data-so-referral]")?.textContent).toBe("0");
  });

  it("người chỉ XEM nhận URL cuối SẠCH (không token) — bảng in đúng thứ tầng đọc đưa, không tự thêm ?aff=", () => {
    bang(false, [link({ token: "K8F2…", lienKetNgan: null, lienKetTrucTiep: null, urlCuoi: "https://quatang.edu.vn/khoa-hoc/robot" })]);
    expect(document.querySelector("[data-url-cuoi]")?.textContent).toBe("https://quatang.edu.vn/khoa-hoc/robot");
    expect(document.body.textContent).not.toContain("aff=");
  });

  it("KHÔNG `coTheGhi` ⇒ không cột «Thao tác», không nút nào; ĐỐI CHỨNG DƯƠNG: có quyền ⇒ thấy cột và nút", () => {
    const { unmount } = bang(false);
    expect(screen.queryByRole("columnheader", { name: "Thao tác" })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    unmount();
    bang(true);
    expect(screen.getByRole("columnheader", { name: "Thao tác" })).toBeTruthy();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("người chỉ xem: token hiển thị đúng như tầng đọc đã che (không bịa lại), và không có nút sao chép/QR để lộ thêm", () => {
    bang(false, [link({ token: "K8F2…", lienKetNgan: null, lienKetTrucTiep: null })]);
    expect(screen.getByText("K8F2…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sao chép|QR/ })).toBeNull();
  });
});

describe("[LUI-02] nút theo trạng thái THẬT", () => {
  it("link dùng được ⇒ sao chép (2 dạng) · QR · xoay · thu hồi", () => {
    bang(true);
    const h = within(hangCua("Cô Lan"));
    for (const ten of [/Sao chép link ngắn/, /Sao chép link trực tiếp/, /Xem mã QR/, /Xoay mã link/, /Thu hồi link/]) expect(h.getByRole("button", { name: ten })).toBeTruthy();
  });
  it("ACTIVE nhưng chuỗi hỏng ⇒ chỉ «Thu hồi»; pill «Tạm không dùng được» + lý do hiện ra", () => {
    bang(true);
    const hang = hangCua("Thầy Minh");
    const h = within(hang);
    expect(h.getByRole("button", { name: /Thu hồi link/ })).toBeTruthy();
    for (const ten of [/Sao chép/, /QR/, /Xoay/]) expect(h.queryByRole("button", { name: ten })).toBeNull();
    expect(hang.textContent).toContain("Tạm không dùng được");
    expect(hang.textContent).toContain("Campaign không ở trạng thái đang chạy.");
    expect(hang.textContent).not.toContain("Đang hoạt động");
  });
  it("đã thu hồi ⇒ KHÔNG nút nào, hiện lý do thu hồi", () => {
    bang(true);
    const hang = hangCua("Chị Hoa");
    expect(within(hang).queryAllByRole("button")).toHaveLength(0);
    expect(hang.textContent).toContain("Đã thu hồi");
    expect(hang.textContent).toContain("Poster đã gỡ");
  });
});

describe("[LUI-03] sao chép", () => {
  it("link ngắn và link trực tiếp ghi đúng địa chỉ vào clipboard", async () => {
    bang(true, [L_TOT]);
    fireEvent.click(screen.getByRole("button", { name: /Sao chép link ngắn/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://test.satarobo.vn/r/K8F29XQ47M"));
    fireEvent.click(screen.getByRole("button", { name: /Sao chép link trực tiếp/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith("https://quatang.edu.vn/khoa-hoc/robot?aff=K8F29XQ47M&cmp=TET_2027"));
    expect(TOAST.success).toHaveBeenCalledTimes(2);
  });
  it("clipboard hỏng ⇒ toast lỗi KÈM địa chỉ để chép tay", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("chặn"))) } });
    bang(true, [L_TOT]);
    fireEvent.click(screen.getByRole("button", { name: /Sao chép link ngắn/ }));
    await waitFor(() => expect(TOAST.error).toHaveBeenCalled());
    expect(String(TOAST.error.mock.calls[0]![0])).toContain("https://test.satarobo.vn/r/K8F29XQ47M");
  });
});

describe("[LUI-04] thu hồi", () => {
  const lyDoO = () => screen.getByLabelText(/Lý do/) as HTMLTextAreaElement;
  it("lý do ngắn ⇒ lỗi cạnh ô, KHÔNG gọi; đủ ⇒ gọi đúng (id, mốc, lý do đã cắt), toast + tải lại", async () => {
    const thuHoi = vi.fn(async () => ({ ok: true as const }));
    bang(true, [L_TOT], { thuHoi });
    fireEvent.click(screen.getByRole("button", { name: /Thu hồi link/ }));
    nhapChu(lyDoO(), "ngắn");
    fireEvent.click(screen.getByRole("button", { name: "Thu hồi link" }));
    expect(screen.getByRole("alert").textContent).toMatch(/tối thiểu 10/);
    expect(thuHoi).not.toHaveBeenCalled();
    nhapChu(lyDoO(), "  Poster đã gỡ khỏi hội chợ  ");
    fireEvent.click(screen.getByRole("button", { name: "Thu hồi link" }));
    await waitFor(() => expect(thuHoi).toHaveBeenCalledWith({ id: "l1", updatedAtDaThay: MOC, lyDo: "Poster đã gỡ khỏi hội chợ" }));
    await waitFor(() => expect(ROUTER.refresh).toHaveBeenCalled());
    expect(TOAST.success).toHaveBeenCalled();
  });
  it("«vừa được người khác đổi» ⇒ banner + nút Tải lại", async () => {
    const thuHoi = vi.fn(async () => ({ ok: false as const, loi: "Link vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" }));
    bang(true, [L_TOT], { thuHoi });
    fireEvent.click(screen.getByRole("button", { name: /Thu hồi link/ }));
    nhapChu(lyDoO(), "Một lý do đủ dài để thu hồi");
    fireEvent.click(screen.getByRole("button", { name: "Thu hồi link" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("vừa được người khác thay đổi"));
    expect(screen.getByRole("button", { name: "Tải lại" })).toBeTruthy();
  });
});

describe("[LUI-05] xoay mã", () => {
  it("gọi đúng id + mốc + lý do; hộp thoại nói rõ link/QR cũ sẽ ngừng", async () => {
    const xoay = vi.fn(async () => ({ ok: true as const }));
    bang(true, [L_TOT], { xoay });
    fireEvent.click(screen.getByRole("button", { name: /Xoay mã link/ }));
    expect(screen.getByRole("dialog").textContent).toMatch(/QR \/ link đã in .* ngừng hoạt động/);
    nhapChu(screen.getByLabelText(/Lý do/), "Poster bị lan truyền sai nơi");
    fireEvent.click(screen.getByRole("button", { name: "Xoay mã" }));
    await waitFor(() => expect(xoay).toHaveBeenCalledWith({ id: "l1", updatedAtDaThay: MOC, lyDo: "Poster bị lan truyền sai nơi" }));
  });
});

describe("[LUI-06] QR", () => {
  const DATA = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
  it("KHÔNG gọi máy chủ khi chưa bấm; bấm ⇒ gọi {id}, hiện <img> data-URI + «Tải về (SVG)» download, không nhúng <svg> thô", async () => {
    const taoQr = vi.fn(async () => ({ ok: true as const, dataUri: DATA, tenTep: "qr-K8F29XQ47M.svg", lienKetNgan: "https://satarobo.vn/r/K8F29XQ47M" }));
    bang(true, [L_TOT], { taoQr });
    expect(taoQr).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Xem mã QR/ }));
    expect(taoQr).toHaveBeenCalledWith({ id: "l1" });
    const img = (await screen.findByAltText(/Mã QR giới thiệu của Cô Lan/)) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(DATA);
    const tai = screen.getByRole("link", { name: /Tải về/ });
    expect(tai.getAttribute("href")).toBe(DATA);
    expect(tai.getAttribute("download")).toBe("qr-K8F29XQ47M.svg");
    expect(screen.getByRole("dialog").textContent).toContain("https://satarobo.vn/r/K8F29XQ47M");
    expect(screen.getByRole("dialog").querySelectorAll("svg:not([aria-hidden])")).toHaveLength(0); // mọi <svg> trong hộp thoại chỉ là icon trang trí (aria-hidden), QR là <img>
  });
  it("lúc chờ có trạng thái «đang dựng»; lỗi ⇒ role=alert, không có ảnh", async () => {
    let xong: (v: { ok: false; loi: string }) => void = () => {};
    const taoQr = vi.fn(() => new Promise<{ ok: false; loi: string }>((r) => (xong = r)));
    bang(true, [L_TOT], { taoQr });
    fireEvent.click(screen.getByRole("button", { name: /Xem mã QR/ }));
    expect(screen.getByRole("status").textContent).toContain("Đang dựng");
    xong({ ok: false, loi: "Link này đã thu hồi — không tạo QR cho link đã thu hồi." });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("đã thu hồi"));
    expect(screen.queryByRole("img", { name: /Mã QR/ })).toBeNull();
  });
  it("máy chủ ném ⇒ vẫn có thông báo lỗi tiếng Việt", async () => {
    const taoQr = vi.fn(async () => {
      throw new Error("mạng");
    });
    bang(true, [L_TOT], { taoQr });
    fireEvent.click(screen.getByRole("button", { name: /Xem mã QR/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Không dựng được QR/));
  });
});

// ═══ PhatLinkSheet ══════════════════════════════════════════════════════════════════════════════════════════
const CHAN_DOAN = { soDoiTac: 3, soDoiTacHoatDong: 2, soDoiTacCoChuongTrinh: 2, soChuongTrinhCoWebsiteDung: 1 };
const TUY_CHON: TuyChonPhatLink = {
  doiTac: [
    {
      id: "p1",
      ten: "Cô Lan",
      ma: "COLAN",
      chuongTrinh: [
        {
          membershipId: "m1",
          campaignMa: "TET_2027",
          campaignTen: "Tết 2027",
          soLinkDangChay: 3,
          soLinkToiDa: 50,
          websites: [
            {
              siteId: "s1",
              ten: "Quà tặng",
              host: "quatang.edu.vn",
              trangDich: [
                { id: "t-khoahoc", host: "quatang.edu.vn", mau: "/khoa-hoc/*", nhan: "Khoá học", kieu: "TIEN_TO" },
                { id: "t-km", host: "quatang.edu.vn", mau: "/khuyen-mai", nhan: null, kieu: "CHINH_XAC" },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "p2",
      ten: "Thầy Minh",
      ma: "MINH",
      chuongTrinh: [
        { membershipId: "m2", campaignMa: "HE_2027", campaignTen: "Hè 2027", soLinkDangChay: 0, soLinkToiDa: 50, websites: [{ siteId: "s1", ten: "Quà tặng", host: "quatang.edu.vn", trangDich: [{ id: "t-km", host: "quatang.edu.vn", mau: "/khuyen-mai", nhan: null, kieu: "CHINH_XAC" }] }] },
        { membershipId: "m3", campaignMa: "THU_2027", campaignTen: "Thu 2027", soLinkDangChay: 0, soLinkToiDa: 50, websites: [{ siteId: "s2", ten: "Khác", host: "khac.vn", trangDich: [{ id: "t-a", host: "khac.vn", mau: "/a", nhan: null, kieu: "CHINH_XAC" }] }] },
      ],
    },
  ],
  chanDoan: CHAN_DOAN,
};

describe("[LUI-07] PhatLinkSheet", () => {
  const OK = { ok: true as const, id: "n1", token: "K8F29XQ47M", updatedAt: MOC };
  function dung(tuyChon: TuyChonPhatLink = TUY_CHON, phat: Mock<(v: Record<string, unknown>) => Promise<KetQuaPhatLink>> = vi.fn(async (_v: Record<string, unknown>) => OK as KetQuaPhatLink)) {
    const dong = vi.fn();
    render(<PhatLinkSheet tuyChon={tuyChon} dong={dong} phat={phat} />);
    return { phat, dong };
  }
  const o = (ten: RegExp) => screen.getByLabelText(ten) as HTMLSelectElement | HTMLInputElement;
  const bam = () => fireEvent.click(screen.getByRole("button", { name: "Phát link" }));

  it("[LUI-07b] tới từ nút «Tạo link» ở bảng đối tác (?doitac=<mã>) ⇒ đối tác được chọn SẴN (và chương trình khi chỉ có một); mã lạ / không truyền ⇒ để trống (đối chứng)", () => {
    const { unmount } = render(<PhatLinkSheet tuyChon={TUY_CHON} dong={vi.fn()} doiTacMaMacDinh="COLAN" />);
    expect(o(/^Đối tác/).value).toBe("p1");
    expect(o(/Chương trình/).value).toBe("m1"); // Cô Lan chỉ có MỘT chương trình ⇒ tự điền
    unmount();
    const hai = render(<PhatLinkSheet tuyChon={TUY_CHON} dong={vi.fn()} doiTacMaMacDinh="MINH" />);
    expect(o(/^Đối tác/).value).toBe("p2");
    expect(o(/Chương trình/).value).toBe(""); // Thầy Minh có HAI chương trình ⇒ không đoán
    hai.unmount();
    const la = render(<PhatLinkSheet tuyChon={TUY_CHON} dong={vi.fn()} doiTacMaMacDinh="KHONGCO" />);
    expect(o(/^Đối tác/).value).toBe("");
    la.unmount();
    render(<PhatLinkSheet tuyChon={TUY_CHON} dong={vi.fn()} />);
    expect(o(/^Đối tác/).value).toBe("");
  });

  it("bấm Phát khi chưa chọn gì ⇒ lỗi CẠNH ô đối tác (aria-invalid), KHÔNG gọi máy chủ", async () => {
    const { phat } = dung();
    bam();
    await waitFor(() => expect(o(/^Đối tác$/).getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByRole("alert").textContent).toContain("Chọn đối tác");
    expect(phat).not.toHaveBeenCalled();
  });

  it("đối tác chỉ có MỘT chương trình / MỘT website / MỘT trang chính xác ⇒ tự điền; payload gửi đúng", async () => {
    const tuyChon: TuyChonPhatLink = { ...TUY_CHON, doiTac: [{ ...TUY_CHON.doiTac[0]!, chuongTrinh: [{ ...TUY_CHON.doiTac[0]!.chuongTrinh[0]!, websites: [{ ...TUY_CHON.doiTac[0]!.chuongTrinh[0]!.websites[0]!, trangDich: [{ id: "t-km", host: "quatang.edu.vn", mau: "/khuyen-mai", nhan: null, kieu: "CHINH_XAC" }] }] }] }] };
    const { phat, dong } = dung(tuyChon);
    nhapChu(o(/^Đối tác$/), "p1");
    expect(o(/^Chương trình/).value).toBe("m1");
    expect(o(/^Website$/).value).toBe("s1");
    expect(o(/^Trang đích$/).value).toBe("t-km");
    nhapChu(o(/^Nhãn/), "  Poster  ");
    fireEvent.click(screen.getByLabelText("QR"));
    bam();
    await waitFor(() => expect(phat).toHaveBeenCalledWith({ partyId: "p1", membershipId: "m1", siteId: "s1", landingPageId: "t-km", landingPath: "/khuyen-mai", type: "QR", label: "Poster" }));
    await waitFor(() => expect(dong).toHaveBeenCalled());
    expect(ROUTER.refresh).toHaveBeenCalled();
  });

  it("danh sách phụ thuộc: đổi đối tác ⇒ campaign/website/trang bị đặt lại; ô sau khoá tới khi chọn ô trước", () => {
    dung();
    expect(o(/^Chương trình/).disabled).toBe(true);
    nhapChu(o(/^Đối tác$/), "p2");
    expect(o(/^Chương trình/).disabled).toBe(false);
    expect(o(/^Chương trình/).value).toBe(""); // hai chương trình ⇒ không tự điền
    nhapChu(o(/^Chương trình/), "m3");
    expect(o(/^Website$/).value).toBe("s2");
    nhapChu(o(/^Đối tác$/), "p1");
    expect(o(/^Chương trình/).value).toBe("m1");
    expect(o(/^Trang đích$/).value).toBe("");
  });

  it("MẪU TIỀN TỐ: ô đường dẫn cụ thể tự gợi ý tiền tố; ngoài mẫu ⇒ lỗi cạnh ô bằng khopDuongDan, KHÔNG gọi; trong mẫu ⇒ gọi với đường dẫn đó", async () => {
    const { phat } = dung();
    nhapChu(o(/^Đối tác$/), "p1");
    nhapChu(o(/^Trang đích$/), "t-khoahoc");
    const cuThe = screen.getByLabelText(/Đường dẫn cụ thể/) as HTMLInputElement;
    expect(cuThe.value).toBe("/khoa-hoc/");
    nhapChu(cuThe, "/tuyen-sinh/x");
    bam();
    await waitFor(() => expect(cuThe.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByRole("alert").textContent).toContain("/khoa-hoc/*");
    expect(phat).not.toHaveBeenCalled();
    nhapChu(cuThe, "/khoa-hoc/robot-nang-cao");
    expect(cuThe.getAttribute("aria-invalid")).toBeNull();
    bam();
    await waitFor(() => expect(phat).toHaveBeenCalledTimes(1));
    expect(phat.mock.calls[0]![0]).toMatchObject({ landingPath: "/khoa-hoc/robot-nang-cao", type: "LINK", label: null });
  });

  it("đường dẫn có ? hoặc // ⇒ từ chối trước khi gọi", async () => {
    const { phat } = dung();
    nhapChu(o(/^Đối tác$/), "p1");
    nhapChu(o(/^Trang đích$/), "t-khoahoc");
    const cuThe = screen.getByLabelText(/Đường dẫn cụ thể/);
    for (const x of ["/khoa-hoc/a?x=1", "//evil.com", "/khoa-hoc/../admin"]) {
      nhapChu(cuThe, x);
      bam();
      await waitFor(() => expect(cuThe.getAttribute("aria-invalid")).toBe("true"));
    }
    expect(phat).not.toHaveBeenCalled();
  });

  it("lỗi máy chủ mang `truong` ⇒ gắn đúng ô; lỗi chung ⇒ banner; «vừa đổi» ⇒ Tải lại", async () => {
    const phat = vi.fn(async () => ({ ok: false as const, loi: "Chương trình này không thuộc đối tác đã chọn.", truong: "membershipId" }));
    dung(TUY_CHON, phat);
    nhapChu(o(/^Đối tác$/), "p1");
    nhapChu(o(/^Trang đích$/), "t-km");
    bam();
    await waitFor(() => expect(o(/^Chương trình/).getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByRole("alert").textContent).toContain("không thuộc đối tác");
  });
  it("lỗi chung (hạn mức) ⇒ banner role=alert, form vẫn mở", async () => {
    const phat = vi.fn(async () => ({ ok: false as const, loi: "Đối tác này đã có 50 link đang hoạt động trong campaign (tối đa 50).", truong: "chung" }));
    const { dong } = dung(TUY_CHON, phat);
    nhapChu(o(/^Đối tác$/), "p1");
    nhapChu(o(/^Trang đích$/), "t-km");
    bam();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("tối đa 50"));
    expect(dong).not.toHaveBeenCalled();
  });
  it("máy chủ ném ⇒ thông báo lỗi tiếng Việt, nút bấm lại được", async () => {
    const phat = vi.fn(async () => {
      throw new Error("mạng");
    });
    dung(TUY_CHON, phat as never);
    nhapChu(o(/^Đối tác$/), "p1");
    nhapChu(o(/^Trang đích$/), "t-km");
    bam();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Không lưu được/));
    expect((screen.getByRole("button", { name: "Phát link" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("RỖNG ⇒ NÓI vì sao + khoá nút Phát + ô đối tác khoá (không hứa suông)", () => {
    dung({ doiTac: [], chanDoan: { soDoiTac: 2, soDoiTacHoatDong: 0, soDoiTacCoChuongTrinh: 0, soChuongTrinhCoWebsiteDung: 0 } });
    expect(screen.getByRole("status").textContent).toContain("Chưa có đối tác nào đang hoạt động");
    expect((screen.getByRole("button", { name: "Phát link" }) as HTMLButtonElement).disabled).toBe(true);
    expect(o(/^Đối tác$/).disabled).toBe(true);
  });
  it("[LUI-07b] ba tầng lý do rỗng nói ba câu KHÁC nhau, mỗi câu chỉ sang đúng tab", () => {
    const a = lyDoRongPhatLink({ soDoiTac: 0, soDoiTacHoatDong: 0, soDoiTacCoChuongTrinh: 0, soChuongTrinhCoWebsiteDung: 0 });
    const b = lyDoRongPhatLink({ soDoiTac: 3, soDoiTacHoatDong: 0, soDoiTacCoChuongTrinh: 0, soChuongTrinhCoWebsiteDung: 0 });
    const c = lyDoRongPhatLink({ soDoiTac: 3, soDoiTacHoatDong: 2, soDoiTacCoChuongTrinh: 0, soChuongTrinhCoWebsiteDung: 0 });
    const d = lyDoRongPhatLink({ soDoiTac: 3, soDoiTacHoatDong: 2, soDoiTacCoChuongTrinh: 1, soChuongTrinhCoWebsiteDung: 0 });
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect(a).toContain("Tạo đối tác");
    expect(b).toContain("kích hoạt đối tác");
    expect(c).toContain("tab Campaign");
    expect(d).toContain("tab Website");
  });
  it("đối chứng dương: có lựa chọn ⇒ KHÔNG hiện khối «Chưa phát link được»", () => {
    dung();
    expect(screen.queryByText("Chưa phát link được.")).toBeNull();
  });
});

// ═══ Pill + bộ lọc ══════════════════════════════════════════════════════════════════════════════════════════
describe("[LUI-08] TrangThaiLinkPill + BoLocLink", () => {
  it("ba trạng thái nói ba chữ khác nhau; «tạm không dùng được» mang lý do ở title", () => {
    const { container } = render(
      <>
        <TrangThaiLinkPill trangThai="ACTIVE" lyDoKhongDung={null} />
        <TrangThaiLinkPill trangThai="ACTIVE" lyDoKhongDung="Campaign không ở trạng thái đang chạy." />
        <TrangThaiLinkPill trangThai="REVOKED" lyDoKhongDung={null} />
      </>,
    );
    expect(container.textContent).toContain("Đang hoạt động");
    expect(container.textContent).toContain("Tạm không dùng được");
    expect(container.textContent).toContain("Đã thu hồi");
    expect(container.querySelector("[title='Campaign không ở trạng thái đang chạy.']")).not.toBeNull();
  });
  it("BỎ QUA lý do khi link đã thu hồi (thu hồi thắng)", () => {
    const { container } = render(<TrangThaiLinkPill trangThai="REVOKED" lyDoKhongDung="x" />);
    expect(container.textContent).toBe("Đã thu hồi");
  });

  const TC: TuyChonLoc = { campaign: [{ ma: "TET_2027", ten: "Tết 2027" }], doiTac: [{ ma: "COLAN", ten: "Cô Lan" }] };
  it("chip trạng thái có số + aria-current; ô chọn giữ giá trị đang lọc; có «Bỏ lọc» khi đang lọc, và KHÔNG khi không lọc", () => {
    const { unmount } = render(<BoLocLink basePath="/nguon-hoa-hong/link" trangThai="REVOKED" campaignMa="TET_2027" doiTacMa={null} theoTrangThai={{ ACTIVE: 5, REVOKED: 2 }} tuyChon={TC} />);
    const chipDangXem = screen.getByRole("link", { name: /Đã thu hồi/ });
    expect(chipDangXem.getAttribute("aria-current")).toBe("page");
    expect(chipDangXem.textContent).toContain("(2)");
    expect(chipDangXem.getAttribute("href")).toBe("/nguon-hoa-hong/link?trangthai=REVOKED&campaign=TET_2027");
    expect(screen.getByRole("link", { name: /Mọi trạng thái/ }).getAttribute("href")).toBe("/nguon-hoa-hong/link?campaign=TET_2027");
    expect((screen.getByLabelText("Campaign") as HTMLSelectElement).value).toBe("TET_2027");
    expect(screen.getByRole("link", { name: "Bỏ lọc" })).toBeTruthy();
    unmount();
    render(<BoLocLink basePath="/nguon-hoa-hong/link" trangThai={null} campaignMa={null} doiTacMa={null} theoTrangThai={{ ACTIVE: 5, REVOKED: 0 }} tuyChon={TC} />);
    expect(screen.queryByRole("link", { name: "Bỏ lọc" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Đã thu hồi/ })).toBeNull(); // 0 link ⇒ không có chip dẫn tới danh sách rỗng
  });
});
