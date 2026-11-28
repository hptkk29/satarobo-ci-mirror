/**
 * [DTC-01..DTC-04] — `dau-vao-tai-chinh.ts`: «lead đã có đầu vào tài chính» = thực thu HOẶC sổ hoa hồng. THUẦN (client giả, không DB); ca Postgres thật ở `tests/hoa-hong/source-so-doi-nguon-tam-rut.spec.ts` `[SDN-*]`.
 *
 * Hai CÁNH của vế «sổ» đều phải đứng riêng được: ô tính theo đơn HIỆN CÓ của lead (gộp lead dời đơn nên phải theo `order.leadId` hiện tại) và dòng sổ mang `leadId` LÚC TÍNH
 * (dòng không có ô như LEGACY_REVERSAL). Gỡ một cánh mà ca Postgres vẫn xanh vì fixture của chúng thoả cả hai — nên ca này tách từng cánh.
 */
import { describe, expect, it } from "vitest";

import { coDauVaoTaiChinh, coSoHoaHongCuaLead, docDauVaoTaiChinh } from "./dau-vao-tai-chinh";

type Khach = Parameters<typeof coSoHoaHongCuaLead>[0];
const khach = (o: { slot: boolean; dong: boolean; thu?: number }): Khach =>
  ({
    payment: { count: async () => o.thu ?? 0 },
    commissionCalcSlot: { findFirst: async () => (o.slot ? { id: "o1" } : null) },
    commissionTransaction: { findFirst: async () => (o.dong ? { id: "d1" } : null) },
  }) as unknown as Khach;

describe("[DTC] đầu vào tài chính của lead", () => {
  it("[DTC-01] chỉ có Ô TÍNH (đơn hiện có của lead) ⇒ có sổ", async () => {
    expect(await coSoHoaHongCuaLead(khach({ slot: true, dong: false }), "L")).toBe(true);
  });
  it("[DTC-02] chỉ có DÒNG SỔ mang leadId (không ô, vd LEGACY_REVERSAL) ⇒ có sổ", async () => {
    expect(await coSoHoaHongCuaLead(khach({ slot: false, dong: true }), "L")).toBe(true);
  });
  it("[DTC-03] không ô, không dòng ⇒ chưa có sổ; thực thu độc lập với sổ", async () => {
    expect(await coSoHoaHongCuaLead(khach({ slot: false, dong: false }), "L")).toBe(false);
    expect(await docDauVaoTaiChinh(khach({ slot: false, dong: false, thu: 2 }), "L")).toEqual({ thucThu: true, soHoaHong: false });
    expect(await docDauVaoTaiChinh(khach({ slot: true, dong: false, thu: 0 }), "L")).toEqual({ thucThu: false, soHoaHong: true });
  });
  it("[DTC-04] «có đầu vào» = HỢP của hai vế (một trong hai đủ; cả hai vắng ⇒ không)", () => {
    expect(coDauVaoTaiChinh({ thucThu: true, soHoaHong: false })).toBe(true);
    expect(coDauVaoTaiChinh({ thucThu: false, soHoaHong: true })).toBe(true);
    expect(coDauVaoTaiChinh({ thucThu: true, soHoaHong: true })).toBe(true);
    expect(coDauVaoTaiChinh({ thucThu: false, soHoaHong: false })).toBe(false);
  });
});
