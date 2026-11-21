/**
 * [SRC-INT-01*] — CỔNG NGUỒN CỦA PHÁT LINK (lane C2, mục 1 của closeout tích hợp Nguồn).
 *
 * Luật: nguồn lead đi từ cấu hình `Affiliate → Membership → Campaign → LeadSourceGroup` (`giaiNguonCuaDoiTac`), KHÔNG bao giờ từ mã/token. Đối tác mà campaign không quy được nguồn ⇒ MỌI lượt
 * gửi biểu mẫu từ link của họ rơi vào hàng chờ xem tay. Phát cho họ một link «ghi công» như vậy là affordance nói dối (luật 12) ⇒ CHẶN lúc phát (`kiemPhatLink`), kèm đường sửa.
 * Xoay mã KHÔNG bị chặn (đóng cửa một mã đang lộ không được phụ thuộc vào cấu hình nguồn).
 *
 *   [SRC-INT-01a] nguồn XEM_TAY (chưa quy được) ⇒ chặn, câu lỗi nói đúng lý do + chỉ đường sửa; ô lỗi `chung`
 *   [SRC-INT-01b] nguồn có nhưng KHÔNG DÙNG ĐƯỢC (`canhBao`: ngừng / không chọn được / hết hiệu lực) ⇒ chặn kèm nguyên nhân
 *   [SRC-INT-01c] ĐỐI CHỨNG DƯƠNG: nguồn tốt ⇒ qua; xoay mã (`laXoay: true`) với nguồn hỏng ⇒ vẫn qua
 *   [SRC-INT-01d] thứ tự cổng: chuỗi link hỏng được nêu TRƯỚC (lý do cấu hình nguồn không che lý do chuỗi); nguồn hỏng không che giới hạn số link (cổng nguồn đứng SAU chuỗi, TRƯỚC hạn mức)
 *   [SRC-INT-01w] lưới dây nối: phát + xoay cùng hỏi `nguon: c.nguon` từ MỘT lần giải (`xemTruocNguon`), không bản giải thứ hai; cổng đối tác `tu-tao-link` đi qua `phatLink`; checklist hồ sơ đối tác
 *                 nạp `nguon` cho từng chương trình
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { kiemPhatLink, lyDoNguonChanLink, SO_LINK_HOAT_DONG_TOI_DA, type ChuoiLink, type NguonCuaLink } from "./ghi-link-dau-vao";
import type { TrangDichChuoi } from "./trang-dich-hieu-luc";

const NOW = new Date("2026-10-13T03:00:00.000Z");
const td = (pathPattern: string): TrangDichChuoi => ({ id: `lp:quatang.edu.vn:${pathPattern}`, label: null, pathPattern, isActive: true, host: "quatang.edu.vn", trackingEnabled: true });
const TOT: ChuoiLink = {
  taiSan: { status: "ACTIVE", landingPath: "/khoa-hoc/robot", landingHost: "quatang.edu.vn" },
  doiTac: { status: "ACTIVE" },
  thanhVien: { status: "ACTIVE", effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), effectiveTo: null },
  campaign: { code: "TET_2027", status: "ACTIVE", effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), effectiveTo: new Date("2027-03-01T00:00:00.000Z"), cookieWindowDays: 30 },
  campaignGanSite: true,
  site: { baseUrl: "https://quatang.edu.vn", allowedDomains: ["quatang.edu.vn", "covua.quatang.edu.vn"], status: "ACTIVE", trackingEnabled: true },
  trangDich: [td("/khoa-hoc/*")],
};
const { taiSan: _bo, ...CHUOI } = TOT;
void _bo;
const NGUON_TOT: NguonCuaLink = { loai: "NGUON", canhBao: null };
const XEM_TAY: NguonCuaLink = { loai: "XEM_TAY", lyDo: "Chưa cấu hình nguồn cho loại/nhãn của đối tác này trong campaign, và campaign lẫn loại đối tác đều không có nguồn mặc định." };
const NGUON_NGUNG: NguonCuaLink = { loai: "NGUON", canhBao: "Nguồn «Zalo» đang ở trạng thái «Ngừng» — kích hoạt lại nguồn đó (tab Nguồn)." };
const PHAT = { partyId: "p1", membershipPartyId: "p1", chuoi: CHUOI, duongDan: "/khoa-hoc/robot", landingPageId: null, soLinkDangChay: 0, laXoay: false, nguon: NGUON_TOT } as const;

describe("[SRC-INT-01a] nguồn XEM_TAY ⇒ không phát link", () => {
  it("chặn, nói đúng lý do của resolver và chỉ đường sửa (tab Campaign); ô lỗi `chung`", () => {
    const kq = kiemPhatLink({ ...PHAT, nguon: XEM_TAY }, NOW);
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.truong).toBe("chung");
    expect(kq.loi).toContain(XEM_TAY.lyDo);
    expect(kq.loi).toMatch(/hàng chờ xem tay/);
    expect(kq.loi).toMatch(/tab Campaign/);
  });
});

describe("[SRC-INT-01b] nguồn không dùng được ⇒ không phát link", () => {
  it("chặn kèm CHÍNH nguyên nhân của nguồn (không câu chung chung)", () => {
    const kq = kiemPhatLink({ ...PHAT, nguon: NGUON_NGUNG }, NOW);
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.loi).toContain(NGUON_NGUNG.canhBao!);
    expect(kq.loi).not.toMatch(/hàng chờ xem tay/); // đây là nguồn CÓ nhưng hỏng, không phải «chưa quy nguồn»
  });
  it("lyDoNguonChanLink: XEM_TAY ⇒ lý do; có cảnh báo ⇒ cảnh báo; nguồn tốt ⇒ null (MỘT hàm cho cổng + checklist)", () => {
    expect(lyDoNguonChanLink(XEM_TAY)).toBe(XEM_TAY.lyDo);
    expect(lyDoNguonChanLink(NGUON_NGUNG)).toBe(NGUON_NGUNG.canhBao);
    expect(lyDoNguonChanLink(NGUON_TOT)).toBeNull();
  });
});

describe("[SRC-INT-01c] đối chứng dương", () => {
  it("nguồn tốt ⇒ phát được (cùng chuỗi, chỉ khác nguồn)", () => {
    expect(kiemPhatLink(PHAT, NOW)).toMatchObject({ ok: true, landingHost: "quatang.edu.vn" });
  });
  it("XOAY MÃ không bị chặn bởi nguồn hỏng — đóng cửa một mã đang lộ không phụ thuộc cấu hình nguồn", () => {
    expect(kiemPhatLink({ ...PHAT, nguon: XEM_TAY, laXoay: true }, NOW).ok).toBe(true);
    expect(kiemPhatLink({ ...PHAT, nguon: NGUON_NGUNG, laXoay: true }, NOW).ok).toBe(true);
  });
});

describe("[SRC-INT-01d] thứ tự cổng", () => {
  it("chuỗi link hỏng (campaign tạm dừng) + nguồn hỏng ⇒ nêu lý do CHUỖI trước", () => {
    const kq = kiemPhatLink({ ...PHAT, chuoi: { ...CHUOI, campaign: { ...CHUOI.campaign, status: "PAUSED" } }, nguon: XEM_TAY }, NOW);
    expect(kq.ok).toBe(false);
    if (kq.ok) return;
    expect(kq.loi).not.toContain(XEM_TAY.lyDo);
  });
  it("nguồn hỏng + đủ số link ⇒ nêu lý do NGUỒN (cổng nguồn đứng trước hạn mức); nguồn tốt + đủ số link ⇒ chặn bằng hạn mức", () => {
    const hetHan = { ...PHAT, soLinkDangChay: SO_LINK_HOAT_DONG_TOI_DA };
    const a = kiemPhatLink({ ...hetHan, nguon: XEM_TAY }, NOW);
    expect(a.ok === false && a.loi.includes(XEM_TAY.lyDo)).toBe(true);
    const b = kiemPhatLink(hetHan, NOW);
    expect(b.ok === false && /tối đa/.test(b.loi)).toBe(true);
  });
});

const boChuThich = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const doc = (p: string): string => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));
const dem = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

describe("[SRC-INT-01w] lưới dây nối của cổng nguồn", () => {
  const GHI_LINK = doc("lib/affiliate/ghi-link.ts");
  it("phát + xoay: MỖI lời gọi kiemPhatLink truyền `nguon: c.nguon` (đúng 2 lời gọi, đúng 2 chỗ truyền)", () => {
    expect(dem(GHI_LINK, /kiemPhatLink\(/g)).toBe(2);
    expect(dem(GHI_LINK, /nguon: c\.nguon/g)).toBe(2);
  });
  it("MỘT lần giải nguồn trong tệp ghi link: xemTruocNguon + dungDauVaoXemTruoc đúng một lần; không gọi thẳng giaiNguonCuaDoiTac (không bản giải thứ hai)", () => {
    expect(dem(GHI_LINK, /xemTruocNguon\(/g)).toBe(1);
    expect(dem(GHI_LINK, /dungDauVaoXemTruoc\(/g)).toBe(1);
    expect(dem(GHI_LINK, /giaiNguonCuaDoiTac\(/g)).toBe(0);
  });
  it("đầu vào của resolver đọc ĐỦ bốn nguồn cấu hình: quy tắc campaign · nguồn mặc định campaign · loại + nhãn của đối tác · nguồn mặc định của loại", () => {
    expect(GHI_LINK).toMatch(/rules: \{ select: \{ typeId: true, tagId: true, sourceGroupId: true \} \}/);
    expect(GHI_LINK).toMatch(/defaultSourceGroupId: true/);
    expect(GHI_LINK).toMatch(/tags: \{ select: \{ tagId: true \} \}/);
    expect(GHI_LINK).toMatch(/type: \{ select: \{ defaultSourceGroupId: true \} \}/);
  });
  it("cổng đối tác `tu-tao-link` đi qua `phatLink` (cùng cổng), không tự dựng kiemPhatLink", () => {
    const tu = doc("lib/affiliate/tu-tao-link.ts");
    expect(dem(tu, /phatLink\(/g)).toBe(1);
    expect(dem(tu, /TIEN_TO_CHAN_NGUON_LINK/g)).toBe(2); // import + một lần nhận ra câu của cổng nguồn để thay bằng câu cho đối tác
    expect(dem(tu, /kiemPhatLink/g)).toBe(0);
  });
  it("checklist hồ sơ đối tác nạp `nguon` cho từng chương trình ứng viên từ CÙNG kết quả xem trước", () => {
    const hs = doc("lib/affiliate/doc-ho-so-doi-tac.ts");
    expect(dem(hs, /nguon: nguonCuaLink\(xemTruoc\(m\.campaign\)\)/g)).toBe(1);
    const ob = doc("lib/affiliate/onboarding-doi-tac.ts");
    expect(dem(ob, /lyDoNguonChanLink\(u\.nguon\)/g)).toBe(2); // nhánh «chưa gắn website» + nhánh thường
  });
});
