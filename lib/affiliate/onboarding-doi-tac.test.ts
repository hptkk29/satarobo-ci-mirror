// [OBD-*] — AFF-L3a: CHECKLIST «đủ để phát link chưa». Điều cần chứng minh KHÔNG phải checklist "đẹp" mà là nó nói CÙNG MỘT ĐIỀU với cổng thật: nút «Phát link» (`kiemPhatLink` → `kiemChuoiLink`).
// Hai nơi hỏi bằng hai điều kiện viết tay là có ngày checklist báo «đủ» mà nút từ chối (luật 12b) — ca [OBD-03] quét một LƯỚI trạng thái và đòi hai bên khớp từng ô.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { chuoiTuDong, type HangChuoi } from "./doc-link";
import { kiemPhatLink, NHAN_CHUOI_LINK_KHONG_HOP_LE, type NguonCuaLink } from "./ghi-link-dau-vao";
import { cacBuocOnboarding, danhGiaPhatLink, duongDanUngVien, LY_DO_CAMPAIGN_CHUA_GAN_WEBSITE, type DauVaoBuoc, type UngVienPhatLink } from "./onboarding-doi-tac";

const NOW = new Date("2026-11-05T03:00:00.000Z");
const TRUOC = new Date("2026-01-01T00:00:00.000Z");

type TT = HangChuoi["party"]["status"];
type Lai = {
  doiTac: TT;
  thanhVien: HangChuoi["membership"]["status"];
  campaign: HangChuoi["campaign"]["status"];
  website: "ACTIVE" | "INACTIVE";
  theoDoi: boolean;
  trangDich: { pathPattern: string; isActive: boolean }[];
};
const MAC_DINH: Lai = { doiTac: "ACTIVE", thanhVien: "ACTIVE", campaign: "ACTIVE", website: "ACTIVE", theoDoi: true, trangDich: [{ pathPattern: "/khoa-robot", isActive: true }] };

function hang(l: Lai): HangChuoi {
  return {
    status: "ACTIVE",
    landingPath: duongDanUngVien(l.trangDich),
    landingHost: null,
    siteId: "s1",
    party: { status: l.doiTac },
    membership: { status: l.thanhVien, effectiveFrom: TRUOC, effectiveTo: null },
    campaign: { code: "C1", status: l.campaign, effectiveFrom: TRUOC, effectiveTo: null, cookieWindowDays: 30, sites: [{ siteId: "s1" }], landings: [] },
    // Trang đích dạng DB: host riêng NULL = tên miền của baseUrl (a.test).
    site: { baseUrl: "https://a.test", allowedDomains: ["a.test"], status: l.website, trackingEnabled: l.theoDoi, landingPages: l.trangDich.map((t, i) => ({ id: `lp${i}`, host: null, label: null, trackingEnabled: true, ...t })) },
  };
}
const NGUON_TOT: NguonCuaLink = { loai: "NGUON", canhBao: null };
const NGUON_XEM_TAY: NguonCuaLink = { loai: "XEM_TAY", lyDo: "Chưa cấu hình nguồn cho loại/nhãn của đối tác này trong campaign." };
const NGUON_KHONG_DUNG: NguonCuaLink = { loai: "NGUON", canhBao: "Nguồn «Zalo» đang ở trạng thái «Ngừng» — kích hoạt lại nguồn đó." };
const ungVien = (l: Lai, nguon: NguonCuaLink = NGUON_TOT): UngVienPhatLink => ({ membershipId: "m1", campaignMa: "C1", campaignTen: "Camp 1", nguon, websites: [{ tenWebsite: "Web A", chuoi: chuoiTuDong(hang(l)) }] });

describe("[OBD-01] đường dẫn ứng viên: mẫu chính xác dùng nguyên văn; mẫu tiền tố lấy phần gốc (dấu * không phải đường dẫn); không có trang bật ⇒ «/»", () => {
  it("bảng", () => {
    expect(duongDanUngVien([{ pathPattern: "/khoa-robot", isActive: true }])).toBe("/khoa-robot");
    expect(duongDanUngVien([{ pathPattern: "/khoa-hoc/*", isActive: true }])).toBe("/khoa-hoc");
    expect(duongDanUngVien([{ pathPattern: "/*", isActive: true }])).toBe("/");
    expect(duongDanUngVien([])).toBe("/");
  });
  it("bỏ qua trang đang tắt và mẫu hỏng; lấy trang BẬT đầu tiên", () => {
    expect(duongDanUngVien([{ pathPattern: "/tat", isActive: false }, { pathPattern: "khong-bat-dau-bang-gach", isActive: true }, { pathPattern: "/bat", isActive: true }])).toBe("/bat");
    expect(duongDanUngVien([{ pathPattern: "/tat", isActive: false }])).toBe("/");
  });
});

describe("[OBD-02] đánh giá sẵn sàng: đối chứng dương rồi từng lý do chặn, câu chữ là nhãn của CHÍNH cổng", () => {
  it("đủ điều kiện ⇒ sẵn sàng, liệt kê website dùng được, không lý do", () => {
    const r = danhGiaPhatLink([ungVien(MAC_DINH)], NOW);
    expect(r.sanSang).toBe(true);
    expect(r.theoChuongTrinh[0]).toMatchObject({ sanSang: true, websiteDungDuoc: ["Web A"], lyDo: [] });
  });
  const chan: { ten: string; lai: Partial<Lai>; ma: keyof typeof NHAN_CHUOI_LINK_KHONG_HOP_LE }[] = [
    { ten: "đối tác chưa hoạt động", lai: { doiTac: "PENDING" }, ma: "DOI_TAC_KHONG_HOAT_DONG" },
    { ten: "thành viên chờ duyệt", lai: { thanhVien: "PENDING" }, ma: "THANH_VIEN_KHONG_HOAT_DONG" },
    { ten: "campaign nháp", lai: { campaign: "DRAFT" }, ma: "CAMPAIGN_KHONG_HOAT_DONG" },
    { ten: "campaign tạm dừng", lai: { campaign: "PAUSED" }, ma: "CAMPAIGN_KHONG_HOAT_DONG" },
    { ten: "website tắt", lai: { website: "INACTIVE" }, ma: "WEBSITE_KHONG_HOAT_DONG" },
    { ten: "website tắt theo dõi", lai: { theoDoi: false }, ma: "THEO_DOI_DANG_TAT" },
    { ten: "không có trang đích bật", lai: { trangDich: [{ pathPattern: "/x", isActive: false }] }, ma: "TRANG_DICH_KHONG_CON" },
  ];
  for (const c of chan) {
    it(`chặn: ${c.ten} ⇒ lý do = nhãn «${c.ma}» của cổng`, () => {
      const r = danhGiaPhatLink([ungVien({ ...MAC_DINH, ...c.lai })], NOW);
      expect(r.sanSang).toBe(false);
      expect(r.theoChuongTrinh[0]!.websiteDungDuoc).toEqual([]);
      expect(r.theoChuongTrinh[0]!.lyDo).toContain(NHAN_CHUOI_LINK_KHONG_HOP_LE[c.ma]);
    });
  }
  it("[SRC-INT-01e] nguồn khách chặn: XEM_TAY hoặc nguồn không dùng được ⇒ chưa sẵn sàng dù chuỗi link khoẻ; lý do nói đúng nguyên nhân của nguồn", () => {
    const xemTay = danhGiaPhatLink([ungVien(MAC_DINH, NGUON_XEM_TAY)], NOW);
    expect(xemTay.sanSang).toBe(false);
    expect(xemTay.theoChuongTrinh[0]).toMatchObject({ sanSang: false, websiteDungDuoc: [] });
    expect(xemTay.theoChuongTrinh[0]!.lyDo).toEqual([`Chưa có nguồn khách dùng được trong campaign: ${NGUON_XEM_TAY.lyDo}`]);
    const ngung = danhGiaPhatLink([ungVien(MAC_DINH, NGUON_KHONG_DUNG)], NOW);
    expect(ngung.theoChuongTrinh[0]!.lyDo).toEqual([`Chưa có nguồn khách dùng được trong campaign: ${NGUON_KHONG_DUNG.canhBao}`]);
    // đối chứng dương: cùng chuỗi, nguồn tốt ⇒ sẵn sàng
    expect(danhGiaPhatLink([ungVien(MAC_DINH, NGUON_TOT)], NOW).sanSang).toBe(true);
    // chuỗi hỏng VÀ nguồn hỏng ⇒ nêu cả hai, lý do chuỗi đứng trước
    const ca = danhGiaPhatLink([ungVien({ ...MAC_DINH, campaign: "PAUSED" }, NGUON_XEM_TAY)], NOW);
    expect(ca.theoChuongTrinh[0]!.lyDo).toEqual([NHAN_CHUOI_LINK_KHONG_HOP_LE.CAMPAIGN_KHONG_HOAT_DONG, `Chưa có nguồn khách dùng được trong campaign: ${NGUON_XEM_TAY.lyDo}`]);
  });
  it("MỌI lý do cùng lúc đều được nêu (không dừng ở lý do đầu)", () => {
    const r = danhGiaPhatLink([ungVien({ ...MAC_DINH, doiTac: "SUSPENDED", campaign: "PAUSED", website: "INACTIVE" })], NOW);
    expect(r.theoChuongTrinh[0]!.lyDo).toEqual([
      NHAN_CHUOI_LINK_KHONG_HOP_LE.DOI_TAC_KHONG_HOAT_DONG,
      NHAN_CHUOI_LINK_KHONG_HOP_LE.CAMPAIGN_KHONG_HOAT_DONG,
      NHAN_CHUOI_LINK_KHONG_HOP_LE.WEBSITE_KHONG_HOAT_DONG,
    ]);
  });
  it("campaign chưa gắn website nào ⇒ chặn bằng câu riêng; đối tác sẵn sàng khi CÓ ÍT NHẤT MỘT chương trình sẵn sàng", () => {
    const khongSite: UngVienPhatLink = { membershipId: "m0", campaignMa: "C0", campaignTen: "Camp 0", nguon: NGUON_TOT, websites: [] };
    const r = danhGiaPhatLink([khongSite, ungVien(MAC_DINH)], NOW);
    expect(r.theoChuongTrinh[0]).toMatchObject({ sanSang: false, lyDo: [LY_DO_CAMPAIGN_CHUA_GAN_WEBSITE] });
    expect(r.theoChuongTrinh[1]).toMatchObject({ sanSang: true });
    expect(r.sanSang).toBe(true);
    expect(danhGiaPhatLink([khongSite], NOW).sanSang).toBe(false);
    expect(danhGiaPhatLink([], NOW)).toEqual({ sanSang: false, theoChuongTrinh: [] });
  });
  it("nhiều website: chỉ cần MỘT dùng được; lý do riêng của website kèm tên website", () => {
    const tat = chuoiTuDong(hang({ ...MAC_DINH, website: "INACTIVE" }));
    const tot = chuoiTuDong(hang(MAC_DINH));
    const mot = danhGiaPhatLink([{ membershipId: "m1", campaignMa: "C1", campaignTen: "Camp 1", nguon: NGUON_TOT, websites: [{ tenWebsite: "Web tắt", chuoi: tat }, { tenWebsite: "Web tốt", chuoi: tot }] }], NOW);
    expect(mot.theoChuongTrinh[0]).toMatchObject({ sanSang: true, websiteDungDuoc: ["Web tốt"], lyDo: [] });
    const hai = danhGiaPhatLink([{ membershipId: "m1", campaignMa: "C1", campaignTen: "Camp 1", nguon: NGUON_TOT, websites: [{ tenWebsite: "Web tắt", chuoi: tat }, { tenWebsite: "Web tắt 2", chuoi: tat }] }], NOW);
    expect(hai.theoChuongTrinh[0]!.lyDo).toEqual([`${NHAN_CHUOI_LINK_KHONG_HOP_LE.WEBSITE_KHONG_HOAT_DONG} (Web tắt)`, `${NHAN_CHUOI_LINK_KHONG_HOP_LE.WEBSITE_KHONG_HOAT_DONG} (Web tắt 2)`]);
  });
});

describe("[OBD-03] KHỚP TỪNG Ô với nút «Phát link»: checklist sẵn sàng ⇔ `kiemPhatLink` cho phép (quét lưới trạng thái)", () => {
  const dt: TT[] = ["DRAFT", "PENDING", "ACTIVE", "SUSPENDED", "ENDED"];
  const tv: Lai["thanhVien"][] = ["PENDING", "ACTIVE", "SUSPENDED", "ENDED"];
  const cp: Lai["campaign"][] = ["DRAFT", "ACTIVE", "PAUSED", "ENDED"];
  const ws: Lai["website"][] = ["ACTIVE", "INACTIVE"];
  const td: Lai["trangDich"][] = [[{ pathPattern: "/khoa-robot", isActive: true }], [{ pathPattern: "/khoa-hoc/*", isActive: true }], [{ pathPattern: "/x", isActive: false }], []];
  it("không ô nào lệch", () => {
    let soO = 0;
    let soSan = 0;
    const lech: string[] = [];
    for (const a of dt) for (const b of tv) for (const c of cp) for (const d of ws) for (const e of [true, false]) for (const f of td) for (const ng of [NGUON_TOT, NGUON_XEM_TAY, NGUON_KHONG_DUNG]) {
      const l: Lai = { doiTac: a, thanhVien: b, campaign: c, website: d, theoDoi: e, trangDich: f };
      const h = hang(l);
      const chuoi = chuoiTuDong(h);
      const checklist = danhGiaPhatLink([ungVien(l, ng)], NOW).sanSang;
      const { taiSan: _bo, ...conLai } = chuoi;
      void _bo;
      const nut = kiemPhatLink({ partyId: "p", membershipPartyId: "p", chuoi: conLai, duongDan: duongDanUngVien(f), landingPageId: null, soLinkDangChay: 0, laXoay: false, nguon: ng }, NOW).ok;
      soO += 1;
      if (nut) soSan += 1;
      if (checklist !== nut) lech.push(JSON.stringify(l));
    }
    expect(soO).toBe(5 * 4 * 4 * 2 * 2 * 4 * 3);
    expect(lech).toEqual([]);
    // đối chứng dương của chính phép quét: lưới có cả ô sẵn sàng lẫn ô chặn (không phải "khớp vì ai cũng false")
    expect(soSan).toBeGreaterThan(0);
    expect(soSan).toBeLessThan(soO);
  });
});

describe("[OBD-04] các bước onboarding: trình tự THẬT (kích hoạt TRƯỚC ghi danh vì cổng ghi danh đòi đối tác ACTIVE)", () => {
  const dauVao = (p: Partial<DauVaoBuoc> = {}): DauVaoBuoc => ({
    doiTac: { status: "ACTIVE", coLoai: true },
    thanhVien: { PENDING: 0, ACTIVE: 1, SUSPENDED: 0, ENDED: 0 },
    soChuongTrinhThieuNguon: 0,
    soTaiKhoanHoatDong: 1,
    sanSangPhatLink: true,
    ...p,
  });
  const tt = (d: DauVaoBuoc) => Object.fromEntries(cacBuocOnboarding(d).map((b) => [b.ma, b.trangThai]));
  it("thứ tự bước cố định", () => {
    expect(cacBuocOnboarding(dauVao()).map((b) => b.ma)).toEqual(["HO_SO", "KICH_HOAT", "GHI_DANH", "NGUON", "TAI_KHOAN", "PHAT_LINK"]);
  });
  it("đối chứng dương: mọi thứ đủ ⇒ XONG hết", () => {
    expect(tt(dauVao())).toEqual({ HO_SO: "XONG", KICH_HOAT: "XONG", GHI_DANH: "XONG", NGUON: "XONG", TAI_KHOAN: "XONG", PHAT_LINK: "XONG" });
  });
  it("đối tác mới ở PENDING: kích hoạt CHƯA, ghi danh bị CHẶN (không phải «chưa làm») và nói vì sao", () => {
    const b = cacBuocOnboarding(dauVao({ doiTac: { status: "PENDING", coLoai: true }, thanhVien: { PENDING: 0, ACTIVE: 0, SUSPENDED: 0, ENDED: 0 }, soChuongTrinhThieuNguon: 0, soTaiKhoanHoatDong: 0, sanSangPhatLink: false }));
    const m = Object.fromEntries(b.map((x) => [x.ma, x]));
    expect(m.KICH_HOAT!.trangThai).toBe("CHUA");
    expect(m.GHI_DANH!.trangThai).toBe("CHAN");
    expect(m.GHI_DANH!.ghiChu).toContain("đang hoạt động"); // câu của CHÍNH cổng kiemThemMembership
    expect(m.TAI_KHOAN!.trangThai).toBe("TUY_CHON");
    expect(m.PHAT_LINK!.trangThai).toBe("CHUA");
  });
  it("đã hoạt động nhưng thành viên chờ duyệt ⇒ ghi danh CHƯA (không chặn), ghi chú nêu số chờ duyệt", () => {
    const b = cacBuocOnboarding(dauVao({ thanhVien: { PENDING: 2, ACTIVE: 0, SUSPENDED: 0, ENDED: 0 } }));
    const gd = b.find((x) => x.ma === "GHI_DANH")!;
    expect(gd.trangThai).toBe("CHUA");
    expect(gd.ghiChu).toContain("2 campaign đang chờ duyệt");
  });
  it("thiếu loại ⇒ HO_SO CHƯA; thiếu nguồn ⇒ NGUON CHƯA và nêu số campaign; chưa có campaign nào ⇒ NGUON CHƯA (không «xong» cho tập rỗng)", () => {
    expect(tt(dauVao({ doiTac: { status: "ACTIVE", coLoai: false } })).HO_SO).toBe("CHUA");
    const thieu = cacBuocOnboarding(dauVao({ soChuongTrinhThieuNguon: 2 })).find((x) => x.ma === "NGUON")!;
    expect(thieu.trangThai).toBe("CHUA");
    expect(thieu.ghiChu).toContain("2 campaign");
    expect(tt(dauVao({ thanhVien: { PENDING: 0, ACTIVE: 0, SUSPENDED: 0, ENDED: 0 } })).NGUON).toBe("CHUA");
  });
  it("đối tác SUSPENDED / ENDED ⇒ KICH_HOAT bị CHẶN", () => {
    expect(tt(dauVao({ doiTac: { status: "SUSPENDED", coLoai: true } })).KICH_HOAT).toBe("CHAN");
    expect(tt(dauVao({ doiTac: { status: "ENDED", coLoai: true } })).KICH_HOAT).toBe("CHAN");
  });
});

describe("[OBD-05] lưới ghim mã nguồn: checklist KHÔNG tự viết điều kiện — mọi lý do đi qua `kiemChuoiLink`/nhãn của cổng", () => {
  const src = readFileSync(resolve(process.cwd(), "lib/affiliate/onboarding-doi-tac.ts"), "utf8")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const dem = (re: RegExp) => [...src.matchAll(re)].length;
  it("gọi `kiemChuoiLink` đúng một lần và dùng NHAN_CHUOI_LINK_KHONG_HOP_LE; không so sánh trạng thái đối tác / campaign tại chỗ", () => {
    expect(dem(/\bkiemChuoiLink\(w\.chuoi, now\)/g)).toBe(1);
    expect(dem(/NHAN_CHUOI_LINK_KHONG_HOP_LE\[ma\]/g)).toBe(1);
    expect(dem(/\.status\s*(===|!==)\s*"(ACTIVE|PAUSED|DRAFT|ENDED)"/g)).toBe(0);
    expect(dem(/\bkiemLienKet\(/g)).toBe(0); // không đi vòng qua cổng cấp thấp: một cổng, một đường vào
    expect(dem(/\bkiemThemMembership\(/g)).toBe(1); // «ghi danh được không» cũng hỏi cổng thật
  });
});
