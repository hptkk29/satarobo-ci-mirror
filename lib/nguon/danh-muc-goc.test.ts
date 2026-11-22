/**
 * Ca [NHH-SRC-01b] · [NHH-SRC-01c] · [NHH-SRC-04a] — danh mục MẶC ĐỊNH 8 nguồn + UNKNOWN (SPEC nguồn động 09/10/2026 §1.3;
 * trước đó 11 nguồn của văn bản 06/10 — 07 §2.6.1, §3.2).
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DANH_MUC_GOC,
  VAI_SANG_NGUON_MAC_DINH,
  canNguoi,
  suyVaiNguon,
  type DongDanhMucGoc,
} from "./danh-muc-goc";

describe("[NHH-SRC-01b] DANH_MUC_GOC — hình dạng 9 dòng gốc (8 nguồn mặc định + UNKNOWN)", () => {
  it("9 mã khác nhau; chỉ UNKNOWN không chọn được; chỉ OTHER bắt giải trình", () => {
    expect(DANH_MUC_GOC).toHaveLength(9);
    expect(new Set(DANH_MUC_GOC.map((d) => d.code)).size).toBe(9);
    expect(DANH_MUC_GOC.map((d) => d.code)).toEqual([
      "PARENT_REFERRAL",
      "PAID_ADS",
      "CENTER_ORGANIC",
      "WALK_IN",
      "EMPLOYEE_REFERRAL",
      "EVENT",
      "PARTNER",
      "OTHER",
      "UNKNOWN",
    ]);
    expect(DANH_MUC_GOC.filter((d) => !d.selectable).map((d) => d.code)).toEqual(["UNKNOWN"]);
    expect(DANH_MUC_GOC.filter((d) => d.requiresNote).map((d) => d.code)).toEqual(["OTHER"]);
  });

  it('"MANUAL_REVIEW" KHÔNG phải một nguồn: nó là trạng thái xem tay, không bao giờ có dòng master (SPEC §0)', () => {
    expect(DANH_MUC_GOC.some((d) => /MANUAL/.test(d.code))).toBe(false);
  });

  it("documentNo 1..8 liên tục, UNKNOWN là null", () => {
    const so = DANH_MUC_GOC.filter((d) => d.code !== "UNKNOWN").map((d) => d.documentNo);
    expect(so).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(DANH_MUC_GOC.find((d) => d.code === "UNKNOWN")?.documentNo).toBeNull();
  });

  it("mọi dòng isSystem = true, status = ACTIVE (khai tường minh — PB-2)", () => {
    for (const d of DANH_MUC_GOC) {
      expect(d.isSystem, d.code).toBe(true);
      expect(d.status, d.code).toBe("ACTIVE");
    }
  });

  it("sourceType: nhóm cấp cao đọc từ CỘT (thay hằng NHOM_BAO_CAO) — SYSTEM chỉ UNKNOWN", () => {
    expect(Object.fromEntries(DANH_MUC_GOC.map((d) => [d.code, d.sourceType]))).toEqual({
      PARENT_REFERRAL: "REFERRAL",
      PAID_ADS: "MARKETING",
      CENTER_ORGANIC: "ORGANIC",
      WALK_IN: "OFFLINE",
      EMPLOYEE_REFERRAL: "REFERRAL",
      EVENT: "EVENT",
      PARTNER: "PARTNER",
      OTHER: "OTHER",
      UNKNOWN: "SYSTEM",
    });
  });

  it("commissionEnabled: chỉ ba nguồn có hoa hồng theo nguồn (ads · PH giới thiệu · nhân sự giới thiệu)", () => {
    expect(DANH_MUC_GOC.filter((d) => d.commissionEnabled).map((d) => d.code)).toEqual([
      "PARENT_REFERRAL",
      "PAID_ADS",
      "EMPLOYEE_REFERRAL",
    ]);
  });

  it("canNguoi theo THUỘC TÍNH referrerRequirement, không so mã", () => {
    const can = DANH_MUC_GOC.filter((d) => canNguoi(d.code)).map((d) => d.code);
    expect(can).toEqual(["PARENT_REFERRAL", "EMPLOYEE_REFERRAL", "PARTNER"]);
    // Đối chứng: nhóm EVENT chỉ TUỲ CHỌN chọn sự kiện — không bắt người.
    expect(canNguoi("EVENT")).toBe(false);
    expect(canNguoi("UNKNOWN")).toBe(false);
  });

  it("[tự kiểm] canNguoi trả false với mã không có trong danh mục (nguồn admin thêm chưa nằm trong hằng)", () => {
    expect(canNguoi("NGUON_TU_ADMIN" as never)).toBe(false);
  });
});

// ── [NHH-SRC-01c] lưới: khối seed của migration.sql ⇔ DANH_MUC_GOC ─────────────────────────────

/** Tách các phần tử mức đỉnh của một hàng VALUES (tôn trọng nháy đơn và ngoặc). */
function tachPhanTu(hang: string): string[] {
  const ra: string[] = [];
  let sau = 0;
  let trongChuoi = false;
  let hienTai = "";
  for (let i = 0; i < hang.length; i++) {
    const c = hang[i]!;
    if (trongChuoi) {
      hienTai += c;
      if (c === "'") {
        if (hang[i + 1] === "'") {
          hienTai += "'";
          i++;
        } else trongChuoi = false;
      }
      continue;
    }
    if (c === "'") {
      trongChuoi = true;
      hienTai += c;
    } else if (c === "(") {
      sau++;
      hienTai += c;
    } else if (c === ")") {
      sau--;
      hienTai += c;
    } else if (c === "," && sau === 0) {
      ra.push(hienTai.trim());
      hienTai = "";
    } else hienTai += c;
  }
  if (hienTai.trim() !== "") ra.push(hienTai.trim());
  return ra;
}

const chuoi = (s: string): string | null =>
  s === "NULL" ? null : s.replace(/::"[^"]+"$/, "").replace(/^'|'$/g, "").replace(/''/g, "'");

const CAC_COT_SEED = [
  "id",
  "code",
  "documentNo",
  "name",
  "description",
  "referrerRequirement",
  "requiresNote",
  "selectable",
  "isSystem",
  "sortOrder",
  "status",
  "sourceType",
  "commissionEnabled",
  "createdAt",
  "updatedAt",
];

function docKhoiSeed(): DongDanhMucGoc[] {
  const goc = resolve(process.cwd(), "prisma/migrations");
  const thuMuc = readdirSync(goc).filter((d) => d.endsWith("_nguon_lead_attribution"));
  expect(thuMuc, "phải có đúng MỘT thư mục *_nguon_lead_attribution").toHaveLength(1);
  const sql = readFileSync(resolve(goc, thuMuc[0]!, "migration.sql"), "utf8");
  const a = sql.indexOf("-- >>> SEED LeadSourceGroup");
  const b = sql.indexOf("-- <<< SEED LeadSourceGroup");
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  const khoi = sql.slice(a, b);
  // Danh sách cột của câu INSERT phải ĐÚNG thứ tự mà bộ tách dưới đây giả định — lệch là đỏ ngay, không lặng lẽ đọc nhầm cột.
  const dau = khoi.slice(khoi.indexOf('INSERT INTO "LeadSourceGroup"'), khoi.indexOf("VALUES"));
  expect([...dau.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]).slice(1)).toEqual(CAC_COT_SEED);
  const values = khoi.slice(khoi.indexOf("VALUES") + "VALUES".length);
  const hangs = [...values.matchAll(/^\s*\((gen_random_uuid[\s\S]*?)\),?\s*$/gm)].map((m) => m[1]!);
  return hangs.map((h) => {
    const p = tachPhanTu(h);
    // [id, code, documentNo, name, description, requirement, requiresNote, selectable, isSystem,
    //  sortOrder, status, sourceType, commissionEnabled, createdAt, updatedAt]
    expect(p, h).toHaveLength(CAC_COT_SEED.length);
    return {
      code: chuoi(p[1]!) as DongDanhMucGoc["code"],
      documentNo: p[2] === "NULL" ? null : Number(p[2]),
      name: chuoi(p[3]!)!,
      description: chuoi(p[4]!),
      referrerRequirement: chuoi(p[5]!) as DongDanhMucGoc["referrerRequirement"],
      requiresNote: p[6] === "true",
      selectable: p[7] === "true",
      isSystem: (p[8] === "true") as true,
      sortOrder: Number(p[9]),
      status: chuoi(p[10]!) as "ACTIVE",
      sourceType: chuoi(p[11]!) as DongDanhMucGoc["sourceType"],
      commissionEnabled: p[12] === "true",
    };
  });
}

describe("[NHH-SRC-01c] lưới — khối seed của migration.sql BẰNG DANH_MUC_GOC", () => {
  it("9 dòng, mọi cột khớp (đổi một chữ ở SQL ⇒ đỏ)", () => {
    const sql = docKhoiSeed();
    expect(sql).toHaveLength(9);
    // HAI CHIỀU: tập mã của SQL = tập mã của hằng TS. Bản đầu chỉ lặp trên DANH_MUC_GOC nên gỡ một dòng khỏi hằng TS mà SQL còn
    // nguyên thì lưới 01c VẪN XANH (lượt cấy 09/10: A3) — chỉ nhờ ca đếm `toHaveLength(9)` ở 01b mà không lọt.
    expect(DANH_MUC_GOC.map((d) => d.code).sort()).toEqual(sql.map((d) => d.code).sort());
    const theoMa = new Map(sql.map((d) => [d.code, d]));
    for (const g of DANH_MUC_GOC) {
      expect(theoMa.get(g.code), g.code).toEqual(g);
    }
  });
});

describe("[NHH-SRC-04a] suyVaiNguon — vai chỉ là SNAPSHOT (không chọn nhóm)", () => {
  const b = VAI_SANG_NGUON_MAC_DINH;
  it("vai → vai ngữ nghĩa vẫn phân biệt (ghi `referrerRoleCode`)", () => {
    expect(suyVaiNguon(["CENTER_SALES_CSM"], b)).toBe("SALE");
    expect(suyVaiNguon(["HO_SALE"], b)).toBe("SALE");
    expect(suyVaiNguon(["GIAM_DOC"], b)).toBe("MANAGER");
    expect(suyVaiNguon(["TEACHER"], b)).toBe("TEACHER");
    expect(suyVaiNguon(["HO_ACCOUNTANT"], b)).toBe("OTHER_EMPLOYEE");
  });

  it("người giữ nhiều vai: bậc đầu của BẢNG thắng, không phải vai đầu của người", () => {
    // TEACHER đứng trước CENTER_MANAGER trong mảng của người, nhưng bảng xét MANAGER trước.
    expect(suyVaiNguon(["TEACHER", "CENTER_MANAGER"], b)).toBe("MANAGER");
  });

  it("không vai nào ⇒ bậc 'còn lại' = OTHER_EMPLOYEE (không bao giờ null)", () => {
    expect(suyVaiNguon([], b)).toBe("OTHER_EMPLOYEE");
  });
});
