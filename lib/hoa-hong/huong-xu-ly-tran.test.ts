// @vitest-environment node
/**
 * [HXT-*] — HƯỚNG XỬ LÝ khi guardrail chặn VỀ TRẦN HOA HỒNG (chủ dự án chốt 09/10/2026): nâng trần 9% hay không là THAO TÁC CỦA ADMIN (sửa
 * `crm.commissionMaxTotalRate` ở Cấu hình vận hành), không phải «quyết định kinh doanh còn mở» để hệ thống chờ — hệ thống KHÔNG tự nâng, KHÔNG tự cắt, nhưng khi chặn
 * thì phải chỉ ĐƯỜNG: tổng hiện tại, trần hiện tại, chênh lệch, và việc cần làm (nâng trần tại màn nào, hoặc chỉnh tỉ lệ rồi kích hoạt lại). THUẦN.
 *
 *   [HXT-01] dựng hướng xử lý: ba con số theo PHẦN TRĂM (không float trôi), cờ «nâng trần có đủ không», đường dẫn
 *   [HXT-02] tổng vượt cả giới hạn của ô cấu hình ⇒ KHÔNG chỉ nâng trần (đường dẫn null) — chỉ còn chỉnh tỉ lệ
 *   [HXT-03] đường dẫn / khoá / giới hạn KHÔNG gõ tay thành bản thứ hai: khớp registry · nhãn vận hành · tab thật của màn Cấu hình vận hành
 *   [HXT-04] guardrail: VUOT_TRAN mang `huongXuLy` đo trên TỔNG LỚN NHẤT trong lưới (không phải ngữ cảnh đầu tiên)
 *   [HXT-05] ba nơi nói cùng một hướng xử lý: hàng rào UI · bật lại «tham gia hoa hồng» · Thử tính
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { NHAN_VAN_HANH, TAB_CAU_HINH } from "@/lib/settings/nhan-van-hanh";
import { SETTINGS } from "@/lib/settings/registry";
import { TRAN_HOA_HONG_TOI_DA } from "@/lib/settings/gioi-han-tran-hoa-hong";

import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "./chon-quy-tac";
import { kiemKichHoat, type DauVaoKichHoat } from "./guardrail-kich-hoat";
import { DUONG_CAU_HINH_TRAN, KHOA_TRAN_HOA_HONG, dungHuongXuLyTran } from "./huong-xu-ly-tran";
import { MASTER_LOAI_GIAO_DICH } from "./loai-giao-dich";

describe("[HXT-01] dungHuongXuLyTran", () => {
  it("tổng 11% so với trần 9% ⇒ nói đúng ba số theo phần trăm, vượt 2 điểm, nâng trần ĐỦ để qua, có đường dẫn", () => {
    const h = dungHuongXuLyTran({ tongToiDa: 0.11, tran: 0.09 });
    expect(h).toMatchObject({ tongPhanTram: "11", tranPhanTram: "9", chenhLechPhanTram: "2", coTheNangTran: true });
    expect(h.duongDan).toEqual({ href: DUONG_CAU_HINH_TRAN.href, nhan: DUONG_CAU_HINH_TRAN.nhan });
    expect(h.loiKhuyen).toContain("Quản trị hệ thống");
    expect(h.loiKhuyen).toContain("Cấu hình vận hành");
    expect(h.loiKhuyen).toContain("tối thiểu 11%");
    expect(h.loiKhuyen).toContain("kích hoạt lại");
    expect(h.loiKhuyen).toMatch(/không tự nâng/i);
  });

  it("số lẻ không trôi: 9,5% so với 9% ⇒ «9,5» và «0,5» (dấu phẩy kiểu Việt), không 0.0999999", () => {
    const h = dungHuongXuLyTran({ tongToiDa: 0.095, tran: 0.09 });
    expect(h).toMatchObject({ tongPhanTram: "9,5", tranPhanTram: "9", chenhLechPhanTram: "0,5" });
  });

  it("tổng do kiểu cố định đẻ ra số thập phân vô hạn ⇒ LÀM TRÒN LÊN tới micro (nâng trần tới đúng số ấy thì kiểm trần qua, không kẹt vì làm tròn xuống)", () => {
    const h = dungHuongXuLyTran({ tongToiDa: 0.1 + 1 / 3_000_000, tran: 0.09 });
    expect(Number(h.tongPhanTram.replace(",", "."))).toBeGreaterThanOrEqual(10);
  });
});

describe("[HXT-02] tổng vượt cả giới hạn của ô «Trần tổng hoa hồng»", () => {
  it("đúng bằng giới hạn trên ⇒ nâng trần vẫn đủ; hơn một micro ⇒ KHÔNG: không đường dẫn, không câu «nâng trần lên», chỉ còn chỉnh tỉ lệ", () => {
    const vua = dungHuongXuLyTran({ tongToiDa: TRAN_HOA_HONG_TOI_DA, tran: 0.09 });
    expect(vua.coTheNangTran).toBe(true);
    expect(vua.duongDan).not.toBeNull();
    const qua = dungHuongXuLyTran({ tongToiDa: TRAN_HOA_HONG_TOI_DA + 0.000001, tran: 0.09 });
    expect(qua.coTheNangTran).toBe(false);
    expect(qua.duongDan).toBeNull();
    expect(qua.loiKhuyen).not.toContain("tối thiểu");
    expect(qua.loiKhuyen).toMatch(/chỉnh lại tỉ lệ/);
    expect(qua.loiKhuyen).toContain("20%");
  });
});

describe("[HXT-03] không có bản thứ hai của khoá / đường dẫn / giới hạn", () => {
  it("khoá là khoá THẬT của registry và nhãn vận hành; giới hạn trên = max của chính schema của ô cấu hình (và hơn một micro thì schema từ chối)", () => {
    expect(KHOA_TRAN_HOA_HONG).toBe("crm.commissionMaxTotalRate");
    expect(SETTINGS[KHOA_TRAN_HOA_HONG]).toBeDefined();
    expect(NHAN_VAN_HANH[KHOA_TRAN_HOA_HONG]).toBeDefined();
    expect(SETTINGS[KHOA_TRAN_HOA_HONG].schema.safeParse(TRAN_HOA_HONG_TOI_DA).success).toBe(true);
    expect(SETTINGS[KHOA_TRAN_HOA_HONG].schema.safeParse(TRAN_HOA_HONG_TOI_DA + 0.000001).success).toBe(false);
  });

  it("đường dẫn trỏ ĐÚNG tab chứa ô này (đọc từ nhãn vận hành, không gõ tay) và tab ấy có thật; màn Cấu hình vận hành có thật", () => {
    const tab = NHAN_VAN_HANH[KHOA_TRAN_HOA_HONG].tab;
    expect(TAB_CAU_HINH.map((t) => t.id)).toContain(tab);
    expect(DUONG_CAU_HINH_TRAN.href).toBe(`/cau-hinh-van-hanh?tab=${tab}`);
    expect(existsSync(resolve(process.cwd(), "app/(admin)/admin/cau-hinh-van-hanh/page.tsx"))).toBe(true);
    // cùng quy ước với các nơi khác trong repo: không tiền tố /admin (proxy gắn host)
    expect(DUONG_CAU_HINH_TRAN.href.startsWith("/admin")).toBe(false);
    expect(DUONG_CAU_HINH_TRAN.nhan).toBe("Cấu hình vận hành");
  });
});

// ── guardrail ─────────────────────────────────────────────────────────────────
const HIEU_LUC = new Date("2026-03-22T17:00:00.000Z");
let dem = 0;
function qt(p: Partial<QuyTac> = {}): QuyTac {
  dem += 1;
  return {
    ruleId: `h${dem}`,
    policyId: "pol-moi",
    policyCode: "POL-MOI",
    versionId: "v-moi",
    version: 2,
    documentNumber: "SR.QD.999",
    scopeType: "GLOBAL",
    scopeKey: "GLOBAL",
    scope: {},
    orgUnitId: null,
    orgUnitPath: "/",
    orgUnitDepth: -1,
    transactionType: "NEW",
    roleCode: "SALE",
    revenueComponent: "TUITION",
    kieuTinh: "PERCENT",
    giaTri: 0.04,
    effectiveFrom: HIEU_LUC,
    effectiveTo: null,
    trangThai: "ACTIVE",
    ...p,
  };
}
const VAI = new Map<string, { isActive: boolean; resolverType: "TRANSACTION_ROLE" | "ORG_UNIT_ROLE" | "DIRECT_PERSON"; resolverKey: string | null }>([
  ["SALE", { isActive: true, resolverType: "TRANSACTION_ROLE", resolverKey: null }],
  ["SALE_ADMIN", { isActive: true, resolverType: "TRANSACTION_ROLE", resolverKey: null }],
  ["CENTER_MANAGER", { isActive: true, resolverType: "ORG_UNIT_ROLE", resolverKey: null }],
  ["MARKETING", { isActive: true, resolverType: "ORG_UNIT_ROLE", resolverKey: null }],
]);
function dau(p: Partial<DauVaoKichHoat> = {}): DauVaoKichHoat {
  return {
    phienBan: { id: "v-moi", policyId: "pol-moi", scopeType: "GLOBAL", scopeKey: "GLOBAL", effectiveFrom: HIEU_LUC, effectiveTo: null, orgUnitId: null, orgUnitPath: "/" },
    vanBan: { documentCode: "SR.QD.999", title: "Quy định hoa hồng", issuedOn: "2026-02-20", publishedOn: "2026-03-02", effectiveOn: "2026-03-23", approvedByName: "Hồ Đắc Phúc", coTep: true, daThuHoi: false },
    quyTacDeXuat: [qt()],
    quyTacDangHieuLuc: [],
    phienBanKhac: [],
    loaiGiaoDich: MASTER_LOAI_GIAO_DICH,
    vaiHuong: VAI,
    coSoThieuNguoiPhuTrach: [],
    nhomNguon: [],
    nghi: [],
    coSoTrongPhamVi: new Set(["cs1"]),
    soNgayLamViec: 15,
    tranTongTiLe: 0.09,
    thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
    now: new Date("2026-03-03T03:00:00.000Z"),
    ...p,
  };
}

describe("[HXT-04] guardrail VUOT_TRAN mang hướng xử lý, đo trên TỔNG LỚN NHẤT", () => {
  // Chung: Sale 4 + Admin 1 + QLCS 2 + Marketing 1 = 8% (qua). Thêm 3% cho vai thứ năm ⇒ 11%.
  const chung = [qt({ roleCode: "SALE", giaTri: 0.04 }), qt({ roleCode: "SALE_ADMIN", giaTri: 0.01 }), qt({ roleCode: "CENTER_MANAGER", giaTri: 0.02 }), qt({ roleCode: "MARKETING", giaTri: 0.01 })];

  it("[HXT-04a] 11% > trần 9% ⇒ VUOT_TRAN có `huongXuLy` (11 · 9 · 2 · đường dẫn) và thongBao nói đủ ba số + việc cần làm; trần 12% ⇒ KHÔNG chặn (đối chứng dương: nâng trần thật sự mở đường)", () => {
    const them = qt({ roleCode: "SALE_ADMIN", giaTri: 0.04 }); // SALE_ADMIN 4% thay 1% ⇒ 4+4+2+1 = 11%
    const r = kiemKichHoat(dau({ quyTacDeXuat: [chung[0]!, them, chung[2]!, chung[3]!] }));
    const l = r.loi.find((x) => x.ma === "VUOT_TRAN");
    expect(l, JSON.stringify(r.loi)).toBeDefined();
    expect(l!.huongXuLy).toMatchObject({ tongPhanTram: "11", tranPhanTram: "9", chenhLechPhanTram: "2", coTheNangTran: true });
    expect(l!.huongXuLy!.duongDan?.href).toBe(DUONG_CAU_HINH_TRAN.href);
    expect(l!.thongBao).toContain("11%");
    expect(l!.thongBao).toContain("trần hiện tại 9%");
    expect(l!.thongBao).toContain("vượt 2 điểm");
    expect(l!.thongBao).toContain("Quản trị hệ thống");
    expect(l!.thongBao).toContain("Cấu hình vận hành");
    expect(l!.thongBao).toContain("Σ 11.0000% > trần 9.0000%"); // chi tiết từng ngữ cảnh GIỮ NGUYÊN (ca cũ [NHH-POL-04j] đọc đúng chuỗi này)
    // đối chứng dương: nâng trần lên 12% (việc của admin) ⇒ cùng bộ rule qua
    expect(kiemKichHoat(dau({ quyTacDeXuat: [chung[0]!, them, chung[2]!, chung[3]!], tranTongTiLe: 0.12 })).loi.map((x) => x.ma)).not.toContain("VUOT_TRAN");
  });

  it("[HXT-04b] nhiều ngữ cảnh vượt ở các mức KHÁC nhau ⇒ `tongPhanTram` là mức LỚN NHẤT (không phải ngữ cảnh gặp đầu tiên, cũng không phải một trong năm dòng liệt kê)", () => {
    // Rule A hiệu lực từ đầu = 10%; rule B bắt đầu muộn cộng thêm 3% ⇒ mốc muộn 13% (ngữ cảnh đến SAU mốc đầu — cấy «lấy ngữ cảnh đầu tiên» thì ra 10%).
    const A = [qt({ roleCode: "SALE", giaTri: 0.04 }), qt({ roleCode: "SALE_ADMIN", giaTri: 0.04 }), qt({ roleCode: "CENTER_MANAGER", giaTri: 0.02 })];
    const sau = new Date(HIEU_LUC.getTime() + 30 * 86_400_000);
    const muon = qt({ roleCode: "MARKETING", giaTri: 0.03, policyId: "pol-khac", versionId: "v-khac", effectiveFrom: sau });
    const r = kiemKichHoat(dau({ quyTacDeXuat: A, quyTacDangHieuLuc: [muon] }));
    const l = r.loi.find((x) => x.ma === "VUOT_TRAN")!;
    expect(l.huongXuLy).toMatchObject({ tongPhanTram: "13", tranPhanTram: "9", chenhLechPhanTram: "4" });
    expect(l.thongBao).toContain("13%");
  });

  it("[HXT-04c] tổng vượt cả giới hạn ô cấu hình (25%) ⇒ `coTheNangTran = false`, không đường dẫn, thongBao KHÔNG bảo «nâng trần lên 25%»", () => {
    const toDa = [qt({ roleCode: "SALE", giaTri: 0.1 }), qt({ roleCode: "SALE_ADMIN", giaTri: 0.1 }), qt({ roleCode: "CENTER_MANAGER", giaTri: 0.05 })];
    const l = kiemKichHoat(dau({ quyTacDeXuat: toDa })).loi.find((x) => x.ma === "VUOT_TRAN")!;
    expect(l.huongXuLy).toMatchObject({ tongPhanTram: "25", coTheNangTran: false, duongDan: null });
    expect(l.thongBao).not.toContain("tối thiểu 25%");
    expect(l.thongBao).toMatch(/chỉnh lại tỉ lệ/);
  });
});

describe("[HXT-05] ba nơi cùng dùng MỘT nguồn hướng xử lý (lưới ghim dây nối)", () => {
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const doc = (t: string) => boChuThich(readFileSync(resolve(process.cwd(), t), "utf8"));
  const dem = (s: string, m: string | RegExp) => (typeof m === "string" ? s.split(m).length - 1 : (s.match(new RegExp(m.source, "g")) ?? []).length);

  it("guardrail dựng từ `dungHuongXuLyTran(` (1 lời gọi) và theo dõi mức LỚN NHẤT; hàng rào UI chuyển nguyên sang dòng «tran»; Thử tính nói cùng hướng; bật-lại-cờ dùng CHÍNH thongBao của guardrail (không câu riêng)", () => {
    const g = doc("lib/hoa-hong/guardrail-kich-hoat.ts");
    expect(dem(g, "dungHuongXuLyTran(")).toBe(1);
    expect(dem(g, /huongXuLy:\s*h\b/)).toBe(1);
    expect(dem(g, /k\.tiLeTuongDuong\s*>\s*tongToiDa/)).toBe(1);
    const s = doc("lib/hoa-hong/chinh-sach-service.ts");
    expect(dem(s, /thongBao:\s*`Chính sách \$\{v\.policy\.policyCode\} \(bản \$\{v\.versionNo\}\): \$\{l\.thongBao\}`/)).toBe(1);
    const u = doc("lib/hoa-hong/hang-rao-ui.ts");
    expect(dem(u, "huongXuLy")).toBeGreaterThanOrEqual(3);
    const m = doc("lib/hoa-hong/mo-phong-ui.ts");
    expect(dem(m, "loiKhuyenNangTran(")).toBe(1);
  });
});
