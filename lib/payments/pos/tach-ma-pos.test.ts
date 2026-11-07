// Tách mã phiếu 5 ký tự khỏi "Diễn giải đơn hàng" của giao dịch thẻ — theo TOKEN, không cửa sổ trượt.
import { describe, it, expect } from "vitest";
import { tachMaPos } from "./tach-ma-pos";
import { maHopLe, sinhMa, BANG_CHU } from "@/lib/payments/ma-phieu";

// Mã HỢP LỆ thật lấy từ bộ sinh — đừng tin một chuỗi gõ tay là hợp lệ.
const MA = sinhMa(4242);
const MA2 = sinhMa(313_131);

/** Đổi ký tự checksum sang một ký tự khác của bảng ⇒ mã sai checksum. */
function saiChecksum(ma: string): string {
  const cuoi = ma[4]!;
  const khac = [...BANG_CHU].find((c) => c !== cuoi)!;
  return ma.slice(0, 4) + khac;
}

// 300 ký tự rác CỐ ĐỊNH: chữ, số, dấu câu, có cả khối 5 ký tự và dãy số dài.
const RAC =
  "MBVCB.1234567890.0328545229.thanh toan hoc phi khoa hoc lap trinh robot cho be " +
  "NGUYEN PHUONG QUYNH ANH lop 4A truong tieu hoc HOANG DIEU ref TT260929 " +
  "ABCDE KQXYZ 12345 HOCPHI PHUONG TRAN- THI; MAI, (NGOC) [QUAN] {HAI} <BA> " +
  "so tien 1.500.000 VND ngay 29/09/2026 luc 17:31:35 tai quay Q01 may TCBPOS0001 xyz";
const RAC_300 = RAC.padEnd(300, " x").slice(0, 300);

describe("tachMaPos", () => {
  it("[POS-T00] điều kiện của bộ test: MA/MA2 hợp lệ, bản sai checksum thì không", () => {
    expect(maHopLe(MA)).toBe(true);
    expect(maHopLe(MA2)).toBe(true);
    expect(maHopLe(saiChecksum(MA))).toBe(false);
    expect(RAC_300).toHaveLength(300);
  });

  it("[POS-T01] 'Kiet 0328545229 <MA> <300 ký tự rác>' ⇒ [MA]", () => {
    expect(tachMaPos(`Kiet 0328545229 ${MA} ${RAC_300}`)).toEqual([MA]);
  });

  it("[POS-T02] viết thường vẫn ra (in hoa kết quả)", () => {
    expect(tachMaPos(`kiet ${MA.toLowerCase()}`)).toEqual([MA]);
  });

  it("[POS-T03] mã dính liền chữ khác ('abc<MA>xyz') ⇒ [] — không cửa sổ trượt", () => {
    expect(tachMaPos(`abc${MA}xyz`)).toEqual([]);
    expect(tachMaPos(`0328545229${MA}`)).toEqual([]);
    expect(tachMaPos(`${RAC_300.replace(/\s/g, "")}${MA}`)).toEqual([]);
  });

  it("[POS-T04] dấu câu ở HAI ĐẦU token bị bỏ: '<MA>,' '(<MA>)' ⇒ [MA]", () => {
    expect(tachMaPos(`${MA},`)).toEqual([MA]);
    expect(tachMaPos(`(${MA})`)).toEqual([MA]);
    expect(tachMaPos(`ma: "${MA}".`)).toEqual([MA]);
    // Dấu câu Ở GIỮA token thì không bị bỏ ⇒ token dài hơn 5 ⇒ không lấy.
    expect(tachMaPos(`${MA.slice(0, 2)}-${MA.slice(2)}`)).toEqual([]);
  });

  it("[POS-T05] hai mã ⇒ 2, giữ thứ tự; trùng ⇒ khử trùng", () => {
    expect(tachMaPos(`${MA} va ${MA2}`)).toEqual([MA, MA2]);
    expect(tachMaPos(`${MA2}\t${MA}\n${MA2.toLowerCase()}`)).toEqual([MA2, MA]);
    expect(tachMaPos(`${MA} ${MA}`)).toEqual([MA]);
  });

  it("[POS-T06] mã sai checksum ⇒ []", () => {
    expect(tachMaPos(`Kiet ${saiChecksum(MA)}`)).toEqual([]);
  });

  it("[POS-T07] token 5 ký tự ngẫu nhiên trong 300 ký tự rác cố định KHÔNG lọt", () => {
    expect(tachMaPos(RAC_300)).toEqual([]);
  });

  it("[POS-T08] null / chuỗi rỗng ⇒ []", () => {
    expect(tachMaPos(null)).toEqual([]);
    expect(tachMaPos("")).toEqual([]);
    expect(tachMaPos("   ")).toEqual([]);
  });

  it("[POS-T10] tên người gõ nguyên chữ (KHANG / HUYNH / CHANH) KHÔNG phải mã dù qua checksum", () => {
    // Điều kiện của ca: ba chữ này THẬT SỰ qua `maHopLe` — không thì ca này xanh vô nghĩa.
    for (const ten of ["KHANG", "HUYNH", "CHANH"]) expect(maHopLe(ten), ten).toBe(true);
    expect(tachMaPos("Hoc phi be Khang")).toEqual([]);
    expect(tachMaPos(`Huynh Khang 0905123456 ${MA}`)).toEqual([MA]);
    expect(tachMaPos(`Tran Chanh ${MA}`)).toEqual([MA]);
  });
});
