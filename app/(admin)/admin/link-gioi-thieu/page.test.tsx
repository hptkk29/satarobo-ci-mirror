/**
 * [LNS-UI-*] màn «Link giới thiệu của tôi» — luồng chủ dự án chốt 21/11/2026: quy định ⇒ «Tôi đã đọc và đồng ý» ⇒ vào luôn (KHÔNG duyệt) ⇒ MỘT trang
 * (Lấy link Aff · bốn ô số · Dòng hoa hồng).
 * Nút / form CHỈ vẽ khi máy chủ sẽ nhận (luật 12). Dữ liệu giả lập ở tầng lõi (hành vi thật: tests/hoa-hong/link-nhan-su.spec.ts).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const S = vi.hoisted(() => ({ bat: true, data: null as unknown, khach: null as unknown, hh: null as unknown, goiHh: [] as unknown[] }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); }, useRouter: () => ({ refresh: () => undefined }) }));
// MỘT mock cho module action (trang nhập bằng "./_actions", nút nhập bằng đường "@/…" — cùng một module; khai hai lần thì bản ít export hơn thắng tuỳ thứ tự nạp).
vi.mock("@/app/(admin)/admin/link-gioi-thieu/_actions", () => ({ taoLinkNhanSuAction: async () => ({ ok: false, loi: "mock" }), taoQrNhanSuAction: async () => ({ ok: false, loi: "mock" }), thamGiaLinkGioiThieuAction: async () => ({ ok: false, loi: "mock" }), thuHoiLinkNhanSuAction: async () => ({ ok: false, loi: "mock" }) }));
vi.mock("@/app/(portal)/portal/gioi-thieu/_actions", () => ({ taoLinkCuaToiAction: async () => ({ ok: false, loi: "mock" }), taoQrCuaToiAction: async () => ({ ok: false, loi: "mock" }) }));
vi.mock("@/lib/affiliate/doi-tac-nhan-su", () => ({
  linkGioiThieuBat: async () => S.bat,
  docLinkGioiThieuCuaToi: async () => S.data,
  LOI_CHUA_CAU_HINH: "CHUA_CAU_HINH",
  LOI_KHONG_NHAN_SU: "KHONG_NHAN_SU_CAU",
}));
vi.mock("@/lib/nguon/thu-nhap-them", async (goc) => ({
  ...(await goc<typeof import("@/lib/nguon/thu-nhap-them")>()),
  docKhachMangVeNhanSu: async () => S.khach,
}));
vi.mock("@/lib/nguon/hoa-hong-gioi-thieu", async (goc) => ({
  ...(await goc<typeof import("@/lib/nguon/hoa-hong-gioi-thieu")>()),
  docHoaHongGioiThieuNhanSu: async (p: unknown) => {
    S.goiHh.push(p);
    return S.hh;
  },
}));

import Page from "./page";
import PageGv from "@/app/(teacher)/teacher/link-gioi-thieu/page";

const NS = { employeeId: "e1", ten: "Nguyễn Văn A", maNv: "SR.NV.001" };
const QD = { campaignTen: "C", nhoKhachNgay: 30, baoVeNgay: 90, choTuGioiThieu: false };
const WEB = { siteId: "s1", ten: "Web", host: "test.satarobo.vn", trangDich: [{ id: "t1", host: "test.satarobo.vn", mau: "/disc", nhan: "DISC", kieu: "CHINH_XAC" as const }, { id: "t2", host: "test.satarobo.vn", mau: "/tu-sach", nhan: "Tủ sách", kieu: "CHINH_XAC" as const }] };
const daThamGia = (link: unknown[] = []) => ({
  loai: "DA_THAM_GIA",
  nhanSu: NS,
  doiTac: { ten: "A", ma: "SRNV001" },
  link,
  taoLink: { chuongTrinh: [{ membershipId: "m1", campaignMa: "C", campaignTen: "C", websites: [WEB], soLinkDangChay: 0, soLinkToiDa: 50 }], coGocLinkNgan: true },
});
const ve = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
const boSvg = (h: string) => h.replace(/<svg[\s\S]*?<\/svg>/g, "");
const coNutDongY = (h: string) => boSvg(h).includes("Tôi đã đọc và đồng ý</button>");

const HH_RONG = { daNhan: 0, dangCho: 0, soChoDuyet: 0, soChoChi: 0, soDangGiu: 0, dong: [], biCat: false };

describe("[LNS-UI] quy định ⇒ đồng ý ⇒ một trang, không duyệt", () => {
  beforeEach(() => {
    S.bat = true;
    S.goiHh = [];
    S.khach = { tongLead: 0, daChot: 0, tyLeChot: null, khach: [], biCat: false };
    S.hh = HH_RONG;
  });
  it("[LNS-UI-01] cờ tắt ⇒ chỉ câu báo, không nút, không khối nào", async () => {
    S.bat = false;
    S.data = daThamGia();
    const h = await ve();
    expect(h).toContain('data-link-gioi-thieu="tat"');
    expect(coNutDongY(h) || h.includes("data-khoi=")).toBe(false);
  });
  it("[LNS-UI-02] không có hồ sơ nhân sự ⇒ câu báo, không nút", async () => {
    S.data = { loai: "KHONG_NHAN_SU" };
    const h = await ve();
    expect(h).toContain("KHONG_NHAN_SU_CAU");
    expect(coNutDongY(h)).toBe(false);
  });
  it("[LNS-UI-03] chưa tham gia ⇒ quy định (số của CHƯƠNG TRÌNH) + chính sách + nút đồng ý; cấu hình sai ⇒ KHÔNG nút", async () => {
    S.data = { loai: "CHUA_THAM_GIA", nhanSu: NS, quyDinh: QD };
    const h = await ve();
    expect(h).toContain('data-link-gioi-thieu="quy-dinh"');
    expect(h).toContain("Chính sách hoa hồng");
    expect(h).toContain("30 ngày");
    expect(h).toContain("90 ngày");
    expect(coNutDongY(h)).toBe(true);
    expect(h).not.toMatch(/chờ duyệt|cần Marketing hoặc Quản trị duyệt/);
    S.data = { loai: "CHUA_THAM_GIA", nhanSu: NS, quyDinh: null };
    const h2 = await ve();
    expect(coNutDongY(h2)).toBe(false);
    expect(h2).toContain("CHUA_CAU_HINH");
  });
  it("[LNS-UI-04] tab «Link theo trang đích»: MỌI thứ của link nằm trên THẺ (trạng thái · link ngắn + QR · lượt bấm · lượt giới thiệu · Thu hồi); thu hồi ⇒ «Cấp link mới»; chưa có ⇒ «Lấy link»; không còn khối «Link của bạn»", async () => {
    const lk = (id: string, trangDich: string, hoatDong: boolean, bam: number, rf: number) => ({ id, campaign: "C", website: "test.satarobo.vn", trangDich, loai: "LINK", nhan: null, hoatDong, lyDoKhongDung: null, soLuotBam: bam, soLuotBamLoi: 0, soReferral: rf, lienKetNgan: hoatDong ? `https://test.satarobo.vn/r/${id}` : null, lienKetTrucTiep: null, urlCuoi: hoatDong ? "https://x/full" : null });
    S.data = daThamGia([lk("ABC", "/disc", true, 7, 3), lk("OLD", "/tu-sach", false, 2, 1)]);
    const h = boSvg(await ve());
    expect(h).toContain('data-khoi="lay-link"');
    expect(h).toContain("Lấy link Aff");
    const the = (khoa: string) => h.slice(h.indexOf(`data-the-trang-dich="${khoa}"`), h.indexOf("</li>", h.indexOf(`data-the-trang-dich="${khoa}"`)));
    const disc = the("s1|t1");
    expect(disc).toContain("Đang dùng");
    expect(disc).toContain("https://test.satarobo.vn/r/ABC");
    expect(disc).toMatch(/Mã QR|QR/);
    expect(disc).toMatch(/>7<\/span> lượt bấm/);
    expect(disc).toMatch(/>3<\/span> lượt giới thiệu/);
    expect(disc).toContain("Thu hồi</button>");
    expect(disc).not.toContain("Lấy link</button>");
    const tuSach = the("s1|t2");
    expect(tuSach).toContain("Đã thu hồi");
    expect(tuSach).toContain("Cấp link mới</button>");
    expect(tuSach).not.toContain("Thu hồi</button>");
    expect(tuSach).not.toContain("/r/OLD"); // link đã thu hồi không đưa ra để sao chép
    expect(h).not.toContain("Link của bạn");
    expect(coNutDongY(h)).toBe(false);
    expect(h).not.toContain("data-tab="); // không còn tab
    // thẻ chưa từng có link
    S.data = daThamGia([]);
    const h2 = boSvg(await ve());
    expect((h2.match(/Lấy link<\/button>/g) ?? []).length).toBe(2);
  });
  it("[LNS-UI-05] cùng trang: bốn ô số (lượt bấm cộng từ link · đã mua / lead · đã nhận · đang chờ) + «Dòng hoa hồng» (SĐT che, trạng thái, Xuất CSV); bộ lọc đi xuống máy chủ; tạm ngừng ⇒ chỉ câu báo", async () => {
    const lk = (id: string, mau: string, bam: number) => ({ id, campaign: "C", website: "test.satarobo.vn", trangDich: mau, loai: "LINK", nhan: null, hoatDong: true, lyDoKhongDung: null, soLuotBam: bam, soLuotBamLoi: 0, soReferral: 0, lienKetNgan: `https://test.satarobo.vn/r/${id}`, lienKetTrucTiep: null, urlCuoi: "x" });
    S.data = daThamGia([lk("A1", "/disc", 30), lk("A2", "/tu-sach", 11)]);
    S.khach = { tongLead: 6, daChot: 3, tyLeChot: 50, biCat: false, khach: [] };
    S.hh = {
      daNhan: 31364, dangCho: 61210, soChoDuyet: 1, soChoChi: 1, soDangGiu: 0, biCat: false,
      dong: [
        { khoa: "d0", phuHuynh: "Lê Thị Bích", sdtChe: "09** *** 220", khoaHoc: "RoboSim 2 · mua mới", daDong: 687727, muc: "5%", hoaHong: 34392, trangThai: "CHO_CHI", nhanTrangThai: "Đã duyệt · chờ chi" },
        { khoa: "d1", phuHuynh: "Phạm Văn Lộc", sdtChe: "09** *** 330", khoaHoc: "RoboSim 2 · mua mới", daDong: 809091, muc: "5%", hoaHong: -40455, trangThai: "THU_HOI", nhanTrangThai: "Thu hồi · hoàn tiền" },
      ],
    };
    const h = boSvg(await ve({ q: "Bích", tt: "CHO_CHI" }));
    expect(S.goiHh).toEqual([{ userId: "u1", q: "Bích", trangThai: "CHO_CHI" }]);
    const o = (nhan: string) => h.slice(h.indexOf(`data-o-so="${nhan}"`), h.indexOf("</div>", h.indexOf(`data-o-so="${nhan}"`) + 200));
    expect(o("Lượt bấm link")).toContain(">41<");
    expect(o("Phụ huynh đã mua")).toContain(">3<");
    expect(o("Phụ huynh đã mua")).toContain("6 lead");
    expect(o("Hoa hồng đã nhận")).toContain("31.364đ");
    expect(o("Đang chờ")).toContain("61.210đ");
    expect(o("Đang chờ")).toContain("1 chờ duyệt · 1 chờ chi");
    expect(h).toContain('data-khoi="dong-hoa-hong"');
    expect(h).not.toContain(">Đơn</th>"); // chủ dự án 22/11: màn nhân sự KHÔNG có cột mã đơn
    expect(h).toContain("Lê Thị Bích · 09** *** 220");
    expect(h).toContain("-40.455đ");
    expect(h).toContain('data-trang-thai-hh="THU_HOI"');
    expect(h).toContain("Xuất CSV</button>");
    S.data = { loai: "BI_CHAN", nhanSu: NS, doiTac: { ten: "A", ma: "SRNV001" }, lyDo: "TAM_NGUNG_CAU" };
    const h2 = await ve();
    expect(h2).toContain("TAM_NGUNG_CAU");
    expect(h2.includes("data-khoi=") || coNutDongY(h2)).toBe(false);
  });
  it("[LNS-UI-06] bộ lọc trạng thái lạ trên URL ⇒ bỏ qua (không đưa chuỗi thô xuống máy chủ)", async () => {
    S.data = daThamGia();
    await ve({ tt: "<script>", q: "x".repeat(200) });
    expect(S.goiHh).toEqual([{ userId: "u1", q: "x".repeat(60), trangThai: null }]);
  });
  it("[LNS-UI-07] SITE GIÁO VIÊN có CÙNG màn (giáo viên thuần không vào được host admin): đủ ba khối, đọc theo người của PHIÊN, form lọc trỏ về trang GV", async () => {
    S.data = daThamGia();
    const hAdmin = boSvg(await ve());
    const hGv = boSvg(renderToStaticMarkup(await PageGv({ searchParams: Promise.resolve({ q: "An" }) })));
    for (const khoi of ["lay-link", "so-lieu", "dong-hoa-hong"]) expect(hGv).toContain(`data-khoi="${khoi}"`);
    expect(S.goiHh.at(-1)).toEqual({ userId: "u1", q: "An", trangThai: null });
    expect(hGv).toContain('action="/teacher/link-gioi-thieu"');
    expect(hAdmin).toContain('action="/link-gioi-thieu"');
    S.data = { loai: "CHUA_THAM_GIA", nhanSu: NS, quyDinh: QD };
    expect(coNutDongY(renderToStaticMarkup(await PageGv({ searchParams: Promise.resolve({}) })))).toBe(true);
  });

  it("[LNS-UI-08] hàng link trên thẻ: ô link và hai nút căn ĐẦU hàng, ô link cùng chiều cao nút («Sao chép» có dòng trạng thái bên dưới — căn giữa là nó lệch lên so với «Mã QR»)", async () => {
    const lk = { id: "A1", campaign: "C", website: "test.satarobo.vn", trangDich: "/disc", loai: "LINK", nhan: null, hoatDong: true, lyDoKhongDung: null, soLuotBam: 1, soLuotBamLoi: 0, soReferral: 0, lienKetNgan: "https://test.satarobo.vn/r/A1", lienKetTrucTiep: null, urlCuoi: "x" };
    S.data = daThamGia([lk]);
    const h = await ve();
    const hang = h.slice(h.indexOf("data-hang-link"), h.indexOf("data-hang-link") + 400);
    expect(hang).toMatch(/class="[^"]*items-start/);
    expect(hang).not.toMatch(/class="[^"]*items-center[^"]*"><code/);
    expect(hang).toMatch(/<code class="[^"]*h-11[^"]*md:h-9/);
  });
});
