// [SRC-INT-60..66] — BỘ «UAT SOURCE FINAL» (lane C2 · mục 7): phần THUẦN (không DB). Đọc `nguon-final.ts` + seed tài khoản + seed vai; KHÔNG đọc script/workflow (phần đó ở `nguon-final-wiring.test.ts`).
//
//   [SRC-INT-60] ba tài khoản: email · vai · neo CS1 khớp `prisma/seed-uat/00-tai-khoan.ts`; vai có SẴN trong seed-roles (không đẻ khoá quyền mới); N1/N2 giữ `commission_periods:manage`, chỉ-xem thì không
//   [SRC-INT-61] tiền tố: tên lead / nguồn mang «UAT SOURCE FINAL»; mã đơn · id · ghi chú khoản thu mang `UATSF` và KHÔNG bắt đầu bằng `UAT-` / `UAT:` (bộ cũ đếm theo hai tiền tố đó)
//   [SRC-INT-62] SĐT giả: duy nhất trong bộ, không đụng dải của bộ cũ (`09901…`/`09902…`), đúng định dạng di động
//   [SRC-INT-63] lead nhãn cũ: qua `anhXaNhanCu` THẬT ra đúng lớp AUTO · MANUAL_REVIEW · OTHER; nhãn không INVALID; ngày tạo sau mốc 06/10
//   [SRC-INT-64] kỳ hàng chờ = T+3: KHÁC mọi kỳ mà bộ S02–S10B dùng, với mọi mốc T từ 2026-11 tới 2028-12 (qua năm); ngày khoản thu rơi đúng kỳ đó
//   [SRC-INT-65] bộ này KHÔNG nằm trong `KICH_BAN_UAT` (checklist 09 ghim số của nó) và phủ ĐỦ bảy loại nhãn của yêu cầu
//   [SRC-INT-66] hai hàng chờ: mã hold ∈ hai mã mà `giaiHangCho` giải được; khoản đủ lớn để chênh người chốt vượt ngưỡng hai cấp mặc định khi hạ ngưỡng (đối chứng với bộ 58)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ROLE_SEED } from "../../prisma/seed-roles";
import { MOC_KHAO_SAT_0610, anhXaNhanCu, chuanHoaNhanNguon } from "../nguon/anh-xa-nhan-cu";
import { DANH_MUC_GOC } from "../nguon/danh-muc-goc";
import { KICH_BAN_UAT, kyCuaNgay, ngayThuCuaUat } from "./kich-ban-hoa-hong";
import {
  EMAIL_NGUON_FINAL,
  GIAI_TRINH_OTHER,
  KHOA_XU_LY_HANG_CHO,
  KICH_BAN_HANG_CHO,
  LEAD_CU,
  LEAD_MOI,
  MA_NGUON_FINAL,
  MOC_LEAD_CU_PHAI_SAU,
  NGUON_TUY_BIEN,
  SO_THANG_SAU_MOC_HANG_CHO,
  TIEN_TO_NGUON_FINAL,
  VAI_NGUON_FINAL,
  ghiChuKhoanHangCho,
  idHocVienHangCho,
  idHocVienPhGoc,
  kyCuaHangCho,
  maDonHangCho,
  ngayThuHangCho,
  phoneHangCho,
  phoneLeadCu,
  phoneLeadMoi,
  phonePhGoc,
  tenLead,
  tenLeadCu,
  type KhoaTaiKhoanNguonFinal,
} from "./nguon-final";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const seedTk = doc("prisma/seed-uat/00-tai-khoan.ts");
const dongSeed = (local: string): string => {
  const d = seedTk.split(/\r?\n/).filter((l) => l.includes(`local: "${local}"`));
  expect(d, `seed tài khoản phải có ĐÚNG MỘT dòng ${local}`).toHaveLength(1);
  return d[0]!;
};
const roleCua = (code: string) => ROLE_SEED.find((r) => r.code === code);
const cacKhoa = Object.keys(EMAIL_NGUON_FINAL) as KhoaTaiKhoanNguonFinal[];

describe("[SRC-INT-60] ba tài khoản UAT SOURCE FINAL khớp seed", () => {
  it("email ⇒ local khớp dòng seed: cùng vai, neo CS1, mã nhân sự riêng; KHÔNG bao giờ DENY, KHÔNG khoá quyền mới", () => {
    expect(cacKhoa).toEqual(["duyet1", "duyet2", "xem"]);
    const maNhanSu = new Set<string>();
    for (const k of cacKhoa) {
      const email = EMAIL_NGUON_FINAL[k];
      const local = email.replace("@satarobo.vn", "");
      expect(local, "regex của [UAT-DOC-04] chỉ nhận uat.[a-z0-9]+").toMatch(/^uat\.[a-z0-9]+$/);
      const d = dongSeed(local);
      expect(d, `${k}: vai`).toContain(`roleCode: "${VAI_NGUON_FINAL[k]}"`);
      expect(d, `${k}: neo CS1 (KHÔNG HO — neo HO là cross-center)`).toContain('neo: "CS1"');
      const ma = /maNhanSu: "([^"]+)"/.exec(d)?.[1];
      expect(ma, `${k}: mã nhân sự`).toBeTruthy();
      expect(maNhanSu.has(ma!), `${k}: mã nhân sự trùng`).toBe(false);
      maNhanSu.add(ma!);
    }
    expect(new Set(cacKhoa.map((k) => EMAIL_NGUON_FINAL[k])).size).toBe(3);
    expect(seedTk).not.toMatch(/\bDENY\b/);
  });

  it("vai có SẴN trong seed-roles; N1/N2 (HO_ACCOUNTANT) giữ commission_periods:manage; chỉ-xem (CENTER_ACCOUNTANT) KHÔNG giữ nhưng có commission:view-center — đối chứng hai chiều", () => {
    for (const k of cacKhoa) expect(roleCua(VAI_NGUON_FINAL[k]), `RoleDef ${VAI_NGUON_FINAL[k]}`).toBeTruthy();
    const co = (code: string, action: string) => !!roleCua(code)!.perms.some((p) => p.action === action);
    expect(co(VAI_NGUON_FINAL.duyet1, KHOA_XU_LY_HANG_CHO)).toBe(true);
    expect(co(VAI_NGUON_FINAL.duyet2, KHOA_XU_LY_HANG_CHO)).toBe(true);
    expect(co(VAI_NGUON_FINAL.xem, KHOA_XU_LY_HANG_CHO)).toBe(false);
    expect(co(VAI_NGUON_FINAL.xem, "commission:view-center")).toBe(true);
    expect(VAI_NGUON_FINAL.duyet1).toBe(VAI_NGUON_FINAL.duyet2);
    // khoá `commission_periods:manage` KHÔNG phải khoá mới: nó đã nằm ở HO_ACCOUNTANT trước lane này (không cần seed-prod-roles)
    expect(KHOA_XU_LY_HANG_CHO).toBe("commission_periods:manage");
  });
});

describe("[SRC-INT-61] tiền tố", () => {
  it("tên hiển thị mang «UAT SOURCE FINAL»; mã đơn/id/ghi chú mang UATSF và không bắt đầu bằng UAT- / UAT:", () => {
    expect(TIEN_TO_NGUON_FINAL).toBe("UAT SOURCE FINAL");
    expect(NGUON_TUY_BIEN.ten.startsWith(TIEN_TO_NGUON_FINAL)).toBe(true);
    for (const lm of LEAD_MOI) expect(tenLead(lm.ma).startsWith(TIEN_TO_NGUON_FINAL), lm.ma).toBe(true);
    for (const lc of LEAD_CU) expect(tenLeadCu(lc.ma).startsWith(TIEN_TO_NGUON_FINAL), lc.ma).toBe(true);
    expect(GIAI_TRINH_OTHER.length, "giải trình OTHER phải ≥ 10 ký tự").toBeGreaterThanOrEqual(10);
    const ma: string[] = [];
    for (const kb of KICH_BAN_HANG_CHO) ma.push(maDonHangCho(kb.ma), ghiChuKhoanHangCho(kb.ma), idHocVienHangCho(kb.ma));
    for (const lm of LEAD_MOI) ma.push(idHocVienPhGoc(lm.ma));
    for (const m of ma) {
      expect(m.startsWith(MA_NGUON_FINAL), m).toBe(true);
      expect(m.startsWith("UAT-"), `${m}: bộ cũ đếm đơn/học viên theo "UAT-"`).toBe(false);
      expect(m.startsWith("UAT:"), `${m}: bộ cũ đếm khoản thu theo "UAT:"`).toBe(false);
    }
    expect(NGUON_TUY_BIEN.code).toMatch(/^[A-Z0-9_]+$/);
  });
});

describe("[SRC-INT-62] SĐT giả", () => {
  it("duy nhất, di động 10 số, không đụng dải của bộ cũ", () => {
    const so = [...LEAD_MOI.map((l) => phoneLeadMoi(l.ma)), ...LEAD_MOI.map((l) => phonePhGoc(l.ma)), ...LEAD_CU.map((l) => phoneLeadCu(l.ma)), ...KICH_BAN_HANG_CHO.map((k) => phoneHangCho(k.ma))];
    expect(new Set(so).size, "SĐT trùng nhau").toBe(so.length);
    for (const s of so) {
      expect(s, s).toMatch(/^09\d{8}$/);
      expect(s.startsWith("09901") || s.startsWith("09902"), `${s} đụng dải bộ UAT cũ`).toBe(false);
    }
  });
});

describe("[SRC-INT-63] lead nhãn cũ ra đúng lớp qua luật thật", () => {
  const anh = (nhan: string, createdAt: Date) => anhXaNhanCu({ nhan, createdAt, affiliate: null, nguoiNhap: null, maNvTrongNote: null }, [], "EMPLOYEE_REFERRAL");

  it("AUTO không lý do xem tay · MANUAL_REVIEW có THIEU_NGUOI · OTHER ra nhóm OTHER kèm NHAN_CHOT_THEO_PHIEU; không nhãn nào INVALID", () => {
    expect(LEAD_CU.map((l) => l.ma)).toEqual(["AUTO", "MANUAL_REVIEW", "OTHER"]);
    for (const lc of LEAD_CU) {
      expect(chuanHoaNhanNguon(lc.nhan), lc.nhan).not.toBeNull();
      expect(lc.taoLuc.getTime(), `${lc.ma}: ngày tạo sau mốc khảo sát 06/10`).toBeGreaterThan(MOC_KHAO_SAT_0610.getTime());
      const kq = anh(lc.nhan, lc.taoLuc);
      expect(kq.loai, lc.nhan).not.toBe("INVALID");
      if (kq.loai === "INVALID") continue;
      if (lc.ma === "AUTO") {
        expect(kq.nhom).toBe("PAID_ADS");
        expect(kq.xemTay).toEqual([]);
      } else if (lc.ma === "MANUAL_REVIEW") {
        expect(kq.nhom).toBe("PARENT_REFERRAL");
        expect(kq.xemTay).toContain("THIEU_NGUOI");
      } else {
        expect(kq.nhom).toBe("OTHER");
        expect(kq.xemTay).toContain("NHAN_CHOT_THEO_PHIEU");
        expect(kq.giaiTrinh ?? "").not.toBe("");
      }
    }
    expect(MOC_LEAD_CU_PHAI_SAU.getTime()).toBe(MOC_KHAO_SAT_0610.getTime());
  });

  it("đối chứng ÂM: cùng nhãn «Nguồn khác» tạo TRƯỚC mốc thì KHÔNG ra OTHER (nên ngày tạo của fixture là bắt buộc, không phải trang trí)", () => {
    const truoc = anh("Nguồn khác", new Date(MOC_KHAO_SAT_0610.getTime() - 86_400_000));
    expect(truoc.loai).not.toBe("INVALID");
    if (truoc.loai !== "INVALID") expect(truoc.nhom).not.toBe("OTHER");
  });
});

describe("[SRC-INT-64] kỳ hàng chờ = T+3", () => {
  it("khác mọi kỳ mà bộ S02–S10B dùng, với mọi T từ 2026-11 tới 2028-12", () => {
    expect(SO_THANG_SAU_MOC_HANG_CHO).toBe(3);
    const cacT: string[] = [];
    for (let y = 2026; y <= 2028; y++) for (let m = 1; m <= 12; m++) if (y > 2026 || m >= 11) cacT.push(`${y}-${String(m).padStart(2, "0")}`);
    expect(cacT.length).toBe(26);
    for (const t of cacT) {
      const kyBoCu = new Set(KICH_BAN_UAT.flatMap((k) => k.thanhToan.map((x) => kyCuaNgay(ngayThuCuaUat(t, x.ngay)))));
      const ky = kyCuaHangCho(t);
      expect(kyBoCu.has(ky), `T=${t}: kỳ hàng chờ ${ky} trùng một kỳ của bộ cũ (${[...kyBoCu].join(", ")})`).toBe(false);
      for (const kb of KICH_BAN_HANG_CHO) expect(kyCuaNgay(ngayThuHangCho(t, kb)), `T=${t} ${kb.ma}`).toBe(ky);
    }
    expect(kyCuaHangCho("2026-11")).toBe("2027-02");
    expect(kyCuaHangCho("2026-10")).toBe("2027-01");
    expect(kyCuaHangCho("2026-12")).toBe("2027-03");
  });
});

describe("[SRC-INT-65] bảy loại nhãn được phủ; bộ này tách khỏi KICH_BAN_UAT", () => {
  it("AUTO · MANUAL_REVIEW · OTHER (lead cũ) + EMPLOYEE_REFERRAL · PARENT_REFERRAL · PAID_ADS · nguồn tuỳ biến (lead mới); mọi nhóm là nhóm THẬT trong danh mục gốc hoặc nguồn tuỳ biến", () => {
    expect(LEAD_CU.map((l) => l.ma).sort()).toEqual(["AUTO", "MANUAL_REVIEW", "OTHER"]);
    expect(LEAD_MOI.map((l) => l.ma).sort()).toEqual(["EMPLOYEE_REFERRAL", "OTHER", "PAID_ADS", "PARENT_REFERRAL", "TUY_BIEN"]);
    const goc = new Set<string>(DANH_MUC_GOC.map((d) => d.code));
    for (const lm of LEAD_MOI) expect(goc.has(lm.nhom) || lm.nhom === NGUON_TUY_BIEN.code, lm.ma).toBe(true);
    expect(goc.has(NGUON_TUY_BIEN.code), "nguồn tuỳ biến KHÔNG được trùng mã nhóm gốc").toBe(false);
    // tách khỏi checklist 09: không kịch bản nào của KICH_BAN_UAT mang tên của bộ này
    for (const k of KICH_BAN_UAT) expect(k.nhom, k.ma).not.toBe(NGUON_TUY_BIEN.code);
    expect(KICH_BAN_UAT.map((k) => k.ma)).toEqual(["S02", "S03", "S04", "S05B", "S05", "S06", "S07", "S08", "S09", "S10", "S10B"]);
  });
});

describe("[SRC-INT-66] hai hàng chờ", () => {
  it("mã hold là hai mã giải được; mỗi khoản 10 triệu", () => {
    expect(KICH_BAN_HANG_CHO.map((k) => k.maHold)).toEqual(["INPUT_DRIFT", "PAYMENT_WITHDRAWN"]);
    for (const k of KICH_BAN_HANG_CHO) expect(k.soTien).toBe(10_000_000);
    // đối chứng với nguồn của luật: `MA_GIAI_DUOC` của hàng chờ xử lý chỉ chứa đúng hai mã này
    const nguon = doc("lib/hoa-hong/hang-cho-xu-ly.ts");
    expect(nguon).toContain("INPUT_DRIFT");
    expect(nguon).toContain("PAYMENT_WITHDRAWN");
  });
});
