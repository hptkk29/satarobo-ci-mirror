import { describe, expect, it } from "vitest";
import { dungThongBaoChoKy, HREF_NHAC_KY, NHAC_LAI_PHUT, nhipNhac, TIEN_TO_NHAC_KY, type NhomChoKy } from "./nhac-ky-usb";

const NOW = new Date("2026-11-04T05:00:00.000Z");
const truoc = (phut: number) => new Date(NOW.getTime() - phut * 60_000);
const nhom = (o: Partial<NhomChoKy> = {}): NhomChoKy => ({ phapNhanMa: "NEW_VISION", phapNhanTen: "NEW VISION", soLenh: 3, cuNhatLuc: truoc(5), coSoIds: ["cs2"], ...o });
const HO = { userId: "ketoan-ho", phamVi: "ALL" as const };
const CS2 = { userId: "ketoan-cs2", phamVi: ["cs2"] as readonly string[] };
const CS1 = { userId: "ketoan-cs1", phamVi: ["cs1"] as readonly string[] };

describe("[NKU] thông báo gộp «hoá đơn chờ ký USB token»", () => {
  it("[NKU-01] MỘT thông báo cho MỘT pháp nhân (tin gộp), người nhận = kế toán có quyền ở cơ sở của lệnh + kế toán Hội sở; kế toán cơ sở KHÁC không nhận", () => {
    const tb = dungThongBaoChoKy({ nhom: [nhom({ soLenh: 7 })], nguoiNhan: [HO, CS2, CS1], now: NOW });
    expect(tb).toHaveLength(1);
    expect(tb[0]!.userIds).toEqual(["ketoan-cs2", "ketoan-ho"]);
    expect(tb[0]!.body).toContain("7 hoá đơn");
    expect(tb[0]!.href).toBe(HREF_NHAC_KY);
  });
  it("[NKU-02] nội dung chỉ mang SỐ LƯỢNG + tên pháp nhân: không số tiền, không dấu hiệu tên người mua", () => {
    const [t] = dungThongBaoChoKy({ nhom: [nhom()], nguoiNhan: [HO], now: NOW });
    expect(`${t!.title} ${t!.body}`).not.toMatch(/\d[\d.,]{4,}\s*(đ|vnd)/i);
  });
  it("[NKU-03] khoá chống trùng theo pháp nhân + ngày + nhịp: cùng nhịp ⇒ cùng khoá (cron 10 phút không rung lại), qua một chu kỳ ⇒ khoá MỚI (nhắc lại)", () => {
    const k = (cuNhat: Date, now: Date) => dungThongBaoChoKy({ nhom: [nhom({ cuNhatLuc: cuNhat })], nguoiNhan: [HO], now })[0]!.dedupeKey;
    expect(k(truoc(5), NOW)).toBe(k(truoc(5), new Date(NOW.getTime() + 9 * 60_000))); // 10 phút sau, vẫn nhịp 0
    expect(k(truoc(5), NOW)).toMatch(new RegExp(`^${TIEN_TO_NHAC_KY}NEW_VISION:2026-11-04:0$`));
    const sau = k(truoc(NHAC_LAI_PHUT + 1), NOW);
    expect(sau).toMatch(/:1$/);
    expect(sau).not.toBe(k(truoc(5), NOW));
  });
  it("[NKU-04] nhắc lại có tiêu đề «Nhắc» và nói số giờ đã chờ; lần đầu thì không", () => {
    const dau = dungThongBaoChoKy({ nhom: [nhom()], nguoiNhan: [HO], now: NOW })[0]!;
    const nhac = dungThongBaoChoKy({ nhom: [nhom({ cuNhatLuc: truoc(NHAC_LAI_PHUT * 2 + 3) })], nguoiNhan: [HO], now: NOW })[0]!;
    expect(dau.title).not.toMatch(/Nhắc/);
    expect(nhac.title).toMatch(/Nhắc/);
    expect(nhac.body).toContain("4 giờ");
  });
  it("[NKU-05] không ai đủ quyền / nhóm rỗng ⇒ KHÔNG tạo thông báo rỗng; nhiều pháp nhân ⇒ mỗi pháp nhân một bản, sắp ổn định", () => {
    expect(dungThongBaoChoKy({ nhom: [nhom()], nguoiNhan: [CS1], now: NOW })).toEqual([]);
    expect(dungThongBaoChoKy({ nhom: [nhom({ soLenh: 0 })], nguoiNhan: [HO], now: NOW })).toEqual([]);
    expect(dungThongBaoChoKy({ nhom: [nhom()], nguoiNhan: [], now: NOW })).toEqual([]);
    const hai = dungThongBaoChoKy({ nhom: [nhom({ phapNhanMa: "STEM", phapNhanTen: "STEM" }), nhom()], nguoiNhan: [HO], now: NOW });
    expect(hai.map((t) => t.dedupeKey.split(":")[1])).toEqual(["NEW_VISION", "STEM"]);
  });
  it("[NKU-06] nhịp không âm kể cả khi đồng hồ lệch (lệnh 'trong tương lai')", () => {
    expect(nhipNhac(new Date(NOW.getTime() + 60_000), NOW)).toBe(0);
  });
});
