// @vitest-environment node
/**
 * [GYV-*] — GỢI Ý ở bước «Người hưởng» (E2a, 09/10/2026): vai nào cần nguồn có gì, biết SỚM thay vì gặp dòng đỏ ở bước cuối. THUẦN.
 *
 *   [GYV-01] SOURCE_OWNER ở phạm vi một nguồn: nguồn chưa có người phụ trách ⇒ gợi ý; có ⇒ không (đối chứng dương)
 *   [GYV-02] REFERRER_PARENT_SALE ở phạm vi một nguồn: chỉ nguồn kiểu PARENT; nguồn khác ⇒ gợi ý
 *   [GYV-03] phạm vi chung / cơ sở + vai SOURCE_OWNER: nêu các nguồn ĐANG HOẠT ĐỘNG thiếu người phụ trách; REFERRER_PARENT_SALE ở phạm vi chung KHÔNG gợi ý (guardrail cũng không chặn)
 *   [GYV-04] chưa chọn nguồn / vai không liên quan ⇒ không gợi ý
 *   [GYV-PAR] PARITY với `kiemKichHoat` thật: cùng đầu vào ⇒ tập mã gợi ý = tập mã ba lỗi tương ứng của guardrail (hai bên đổi điều kiện lệch nhau là đỏ)
 */
import { describe, expect, it } from "vitest";

import { THU_TU_PHAM_VI_MAC_DINH, type QuyTac } from "./chon-quy-tac";
import { goiYVaiVoiNguon, type PhamViGoiY, type VaiGoiY } from "./goi-y-nguoi-huong";
import { kiemKichHoat, type DauVaoKichHoat } from "./guardrail-kich-hoat";
import { MASTER_LOAI_GIAO_DICH } from "./loai-giao-dich";
import type { KhoaTrangThaiNguon, NguonSoan } from "./nguon-cho-soan";

const VAI_CHU: VaiGoiY = { code: "SOURCE_OWNER", name: "Người phụ trách nguồn", resolverType: "SOURCE_OWNER", resolverKey: "SOURCE_OWNER" };
const VAI_PH_SALE: VaiGoiY = { code: "REFERRER_PARENT_SALE", name: "Sale phụ trách phụ huynh giới thiệu", resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_PARENT_SALE" };
const VAI_SALE: VaiGoiY = { code: "SALE", name: "Sale", resolverType: "TRANSACTION_ROLE", resolverKey: "LEAD_CONVERTED_BY" };

const nguon = (id: string, p: Partial<NguonSoan> = {}): NguonSoan => ({
  id,
  code: `MA_${id}`,
  name: `Nguồn ${id}`,
  coHoaHong: true,
  trangThai: "HOAT_DONG",
  hieuLucTu: null,
  hieuLucDen: null,
  coNguoiPhuTrach: true,
  referrerRequirement: "NONE",
  ...p,
});
const nhomNguon = (id: string): PhamViGoiY => ({ loai: "SOURCE_GROUP", sourceGroupId: id });
const ma = (r: ReturnType<typeof goiYVaiVoiNguon>) => r.map((x) => `${x.vai}:${x.ma}`).sort();

describe("[GYV-01] SOURCE_OWNER ở phạm vi một nguồn", () => {
  it("nguồn chưa khai người phụ trách ⇒ gợi ý nêu TÊN nguồn và việc cần làm; có người ⇒ không gợi ý", () => {
    const thieu = goiYVaiVoiNguon({ vai: [VAI_CHU], phamVi: nhomNguon("a"), nguon: [nguon("a", { coNguoiPhuTrach: false })] });
    expect(ma(thieu)).toEqual(["SOURCE_OWNER:NGUON_CHUA_CO_NGUOI_PHU_TRACH"]);
    expect(thieu[0]!.noiDung).toContain("Nguồn a");
    expect(thieu[0]!.noiDung).toContain("người phụ trách");
    expect(goiYVaiVoiNguon({ vai: [VAI_CHU], phamVi: nhomNguon("a"), nguon: [nguon("a", { coNguoiPhuTrach: true })] })).toEqual([]);
  });
});

describe("[GYV-02] REFERRER_PARENT_SALE ở phạm vi một nguồn", () => {
  it("nguồn kiểu PARENT ⇒ không gợi ý (đối chứng dương); nguồn kiểu khác ⇒ gợi ý", () => {
    expect(goiYVaiVoiNguon({ vai: [VAI_PH_SALE], phamVi: nhomNguon("a"), nguon: [nguon("a", { referrerRequirement: "PARENT" })] })).toEqual([]);
    for (const req of ["NONE", "EMPLOYEE", "AFFILIATE_ORG", "EVENT"] as const) {
      const r = goiYVaiVoiNguon({ vai: [VAI_PH_SALE], phamVi: nhomNguon("a"), nguon: [nguon("a", { referrerRequirement: req })] });
      expect(ma(r), req).toEqual(["REFERRER_PARENT_SALE:NGUON_KHONG_CO_PHU_HUYNH_GIOI_THIEU"]);
      expect(r[0]!.noiDung).toContain("phụ huynh giới thiệu");
    }
  });
});

describe("[GYV-03] phạm vi chung / cơ sở", () => {
  const ds = [
    nguon("a", { coNguoiPhuTrach: false }),
    nguon("b", { coNguoiPhuTrach: true }),
    nguon("c", { coNguoiPhuTrach: false, trangThai: "NGUNG" }), // nguồn ngừng KHÔNG tính (guardrail chỉ đếm nguồn đang hoạt động)
    nguon("d", { coNguoiPhuTrach: false, trangThai: "HET_HAN" }), // ngoài khoảng hiệu lực nhưng vẫn ACTIVE ⇒ vẫn tính
  ];

  it("SOURCE_OWNER ở phạm vi chung ⇒ liệt kê đúng các nguồn ĐANG HOẠT ĐỘNG thiếu chủ (a, d), không có nguồn ngừng (c) hay nguồn có chủ (b)", () => {
    for (const phamVi of [{ loai: "GLOBAL" }, { loai: "ORG_UNIT" }] as const) {
      const r = goiYVaiVoiNguon({ vai: [VAI_CHU], phamVi, nguon: ds });
      expect(ma(r)).toEqual(["SOURCE_OWNER:NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH"]);
      expect([...r[0]!.nguonThieu].sort()).toEqual(["Nguồn a", "Nguồn d"]);
    }
  });

  it("mọi nguồn đang hoạt động đều có chủ ⇒ không gợi ý; REFERRER_PARENT_SALE ở phạm vi chung KHÔNG gợi ý (nguồn không phải PARENT chỉ treo im lặng, guardrail không chặn)", () => {
    expect(goiYVaiVoiNguon({ vai: [VAI_CHU], phamVi: { loai: "GLOBAL" }, nguon: [nguon("b")] })).toEqual([]);
    expect(goiYVaiVoiNguon({ vai: [VAI_PH_SALE], phamVi: { loai: "GLOBAL" }, nguon: ds })).toEqual([]);
  });

  it("danh sách nguồn dài ⇒ nêu tối đa 5 tên + «và N nguồn khác», `nguonThieu` vẫn đủ", () => {
    const nhieu = Array.from({ length: 8 }, (_, i) => nguon(`n${i}`, { coNguoiPhuTrach: false }));
    const r = goiYVaiVoiNguon({ vai: [VAI_CHU], phamVi: { loai: "GLOBAL" }, nguon: nhieu });
    expect(r[0]!.noiDung).toContain("và 3 nguồn khác");
    expect(r[0]!.nguonThieu).toHaveLength(8);
  });
});

describe("[GYV-04] không gợi ý khi không có gì để nói", () => {
  it("vai thường (Sale) ở mọi phạm vi ⇒ không gợi ý; phạm vi nguồn nhưng CHƯA chọn nguồn / nguồn không có trong danh sách ⇒ không gợi ý", () => {
    expect(goiYVaiVoiNguon({ vai: [VAI_SALE], phamVi: nhomNguon("a"), nguon: [nguon("a", { coNguoiPhuTrach: false })] })).toEqual([]);
    expect(goiYVaiVoiNguon({ vai: [VAI_CHU, VAI_PH_SALE], phamVi: nhomNguon(""), nguon: [nguon("a", { coNguoiPhuTrach: false })] })).toEqual([]);
    expect(goiYVaiVoiNguon({ vai: [VAI_CHU], phamVi: nhomNguon("khong-co"), nguon: [nguon("a", { coNguoiPhuTrach: false })] })).toEqual([]);
  });
});

// ── PARITY với guardrail thật ───────────────────────────────────────────────────────────────────────────────
const HIEU_LUC = new Date("2026-03-22T17:00:00.000Z");
const BA_MA = new Set(["NGUON_CHUA_CO_NGUOI_PHU_TRACH", "NGUON_KHONG_CO_PHU_HUYNH_GIOI_THIEU", "NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH"]);
let dem = 0;
function qt(p: Partial<QuyTac>): QuyTac {
  dem += 1;
  return {
    ruleId: `g${dem}`,
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
    giaTri: 0.01,
    effectiveFrom: HIEU_LUC,
    effectiveTo: null,
    trangThai: "ACTIVE",
    ...p,
  };
}
const VAI_HUONG = new Map<string, { isActive: boolean; resolverType: "TRANSACTION_ROLE" | "DIRECT_PERSON" | "SOURCE_OWNER"; resolverKey: string | null }>([
  ["SALE", { isActive: true, resolverType: "TRANSACTION_ROLE", resolverKey: "LEAD_CONVERTED_BY" }],
  ["SOURCE_OWNER", { isActive: true, resolverType: "SOURCE_OWNER", resolverKey: "SOURCE_OWNER" }],
  ["REFERRER_PARENT_SALE", { isActive: true, resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_PARENT_SALE" }],
]);

function guardrail(vai: VaiGoiY, phamVi: PhamViGoiY, nguonDs: readonly NguonSoan[]): string[] {
  const theoNhom = phamVi.loai === "SOURCE_GROUP";
  const scopeKey = theoNhom ? `SOURCE_GROUP:${phamVi.sourceGroupId}` : "GLOBAL";
  const dau: DauVaoKichHoat = {
    phienBan: { id: "v-moi", policyId: "pol-moi", scopeType: theoNhom ? "SOURCE_GROUP" : "GLOBAL", scopeKey, effectiveFrom: HIEU_LUC, effectiveTo: null, orgUnitId: null, orgUnitPath: "/" },
    vanBan: { documentCode: "SR.QD.999", title: "Quy định", issuedOn: "2026-02-20", publishedOn: "2026-03-02", effectiveOn: "2026-03-23", approvedByName: "Hồ Đắc Phúc", coTep: true, daThuHoi: false },
    quyTacDeXuat: [qt({ roleCode: vai.code, scopeType: theoNhom ? "SOURCE_GROUP" : "GLOBAL", scopeKey, scope: theoNhom ? { sourceGroupId: phamVi.sourceGroupId } : {} })],
    quyTacDangHieuLuc: [],
    phienBanKhac: [],
    loaiGiaoDich: MASTER_LOAI_GIAO_DICH,
    vaiHuong: VAI_HUONG,
    coSoThieuNguoiPhuTrach: [],
    nhomNguon: nguonDs.map((n) => ({
      id: n.id,
      code: n.code,
      dangHoatDong: n.trangThai === "HOAT_DONG" || n.trangThai === "CHUA_HIEU_LUC" || n.trangThai === "HET_HAN",
      coHoaHong: n.coHoaHong,
      ownerEmployeeId: n.coNguoiPhuTrach ? "emp-1" : null,
      referrerRequirement: n.referrerRequirement,
    })),
    nghi: [],
    coSoTrongPhamVi: new Set(["cs1"]),
    soNgayLamViec: 15,
    tranTongTiLe: 0.09,
    thuTuPhamVi: [...THU_TU_PHAM_VI_MAC_DINH],
    now: new Date("2026-03-03T03:00:00.000Z"),
  };
  return kiemKichHoat(dau)
    .loi.map((l) => l.ma)
    .filter((m) => BA_MA.has(m))
    .sort();
}

describe("[GYV-PAR] gợi ý khớp guardrail thật trên mọi tổ hợp", () => {
  const trangThai: KhoaTrangThaiNguon[] = ["HOAT_DONG", "HET_HAN", "NGUNG", "NHAP"];
  const yeuCau = ["NONE", "PARENT", "EMPLOYEE"] as const;
  const phamVis: PhamViGoiY[] = [{ loai: "GLOBAL" }, nhomNguon("a")];

  it("vai {SOURCE_OWNER, REFERRER_PARENT_SALE, SALE} × phạm vi {chung, nguồn a} × trạng thái × có/không chủ × kiểu người giới thiệu: tập mã của hai bên GIỐNG HỆT", () => {
    let soTohop = 0;
    let soCoGoiY = 0;
    for (const vai of [VAI_CHU, VAI_PH_SALE, VAI_SALE]) {
      for (const phamVi of phamVis) {
        for (const tt of trangThai) {
          for (const coChu of [true, false]) {
            for (const req of yeuCau) {
              const ds = [nguon("a", { trangThai: tt, coNguoiPhuTrach: coChu, referrerRequirement: req }), nguon("b", { coNguoiPhuTrach: false })];
              const gy = [...new Set(goiYVaiVoiNguon({ vai: [vai], phamVi, nguon: ds }).map((x) => x.ma))].sort();
              const gr = [...new Set(guardrail(vai, phamVi, ds))].sort();
              expect(gy, `${vai.code} · ${phamVi.loai} · ${tt} · chủ=${coChu} · ${req}`).toEqual(gr);
              soTohop += 1;
              if (gy.length > 0) soCoGoiY += 1;
            }
          }
        }
      }
    }
    // Lưới không được rỗng: có tổ hợp CÓ gợi ý lẫn KHÔNG gợi ý, nên so hai tập rỗng không thể là lý do xanh.
    expect(soTohop).toBe(3 * 2 * 4 * 2 * 3);
    expect(soCoGoiY).toBeGreaterThan(20);
    expect(soCoGoiY).toBeLessThan(soTohop);
  });
});
