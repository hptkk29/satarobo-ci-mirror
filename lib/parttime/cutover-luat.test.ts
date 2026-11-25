// [GRACE-*] [HAN-*] [XNT-*] luật thuần của cutover (`cutover-luat.ts`) + vị từ việc hợp lệ khi grace.
import { describe, expect, it } from "vitest";
import { tietHopLe } from "./cong-viec-hop-le";
import { congXacNhanThang, hanNhanLop, trongGraceCutover } from "./cutover-luat";

describe("[GRACE] Q5 — LEGACY_ACTIVE_PENDING_ACCEPTANCE", () => {
  const g = (p: Partial<Parameters<typeof trongGraceCutover>[0]> = {}) =>
    trongGraceCutover({ assignmentType: "CUTOVER", status: "WAITING_ACCEPTANCE", ngay: "2026-11-05", graceDen: "2026-11-15", ...p });

  it("[GRACE-01] đủ CẢ BA vế ⇒ grace; thiếu bất kỳ vế nào ⇒ không", () => {
    expect(g()).toBe(true);
    expect(g({ ngay: "2026-11-15" })).toBe(true);
    for (const kieu of ["REGULAR", "SYSTEM", "MANUAL", "SUBSTITUTE"]) expect(g({ assignmentType: kieu }), kieu).toBe(false);
    for (const tt of ["ACCEPTED", "DECLINED", "REPLACED", "CANCELLED", "PROPOSED", "COMPLETED"]) expect(g({ status: tt }), tt).toBe(false);
    expect(g({ ngay: "2026-11-16" })).toBe(false);
  });

  it("[GRACE-02] mặc định KHÔNG grace (mốc rỗng / sai dạng) — phân công thường chưa nhận vẫn KHÔNG phải việc hợp lệ (H1 giữ nguyên)", () => {
    expect(g({ graceDen: "" })).toBe(false);
    expect(g({ graceDen: "15/11/2026" })).toBe(false);
    const tiet = { requiredFrom: new Date(), requiredTo: new Date(), trangThai: "CHUA_DEN_GIO" as never, dongDoi: { tinhTrangBuoi: "MO" } as never };
    expect(tietHopLe({ ...tiet, daNhan: false, graceCutover: false })).toBe(false);
    expect(tietHopLe({ ...tiet, daNhan: false, graceCutover: true })).toBe(true);
    expect(tietHopLe({ ...tiet, daNhan: true, graceCutover: false })).toBe(true);
  });
});

describe("[HAN] Q6 — hạn nhận phân công (chỉ hiển thị, KHÔNG leo thang)", () => {
  const giao = new Date("2026-11-01T02:00:00Z");
  const h = (p: Partial<Parameters<typeof hanNhanLop>[0]>) =>
    hanNhanLop({ kieu: "KHONG", moc: "", soGio: 0, graceDen: "", assignedAt: giao, assignmentType: "REGULAR", ...p });
  it("[HAN-01] mặc định KHONG ⇒ không hạn", () => {
    expect(h({})).toBeNull();
    expect(h({ moc: "2026-11-02T00:00:00+07:00", soGio: 48, graceDen: "2026-11-15" })).toBeNull();
  });
  it("[HAN-02] ba kiểu có hạn; thiếu tham số ⇒ null (không đoán 24h / 48h)", () => {
    expect(h({ kieu: "MOC_CO_DINH", moc: "2026-11-03T23:59:00+07:00" })?.toISOString()).toBe("2026-11-03T16:59:00.000Z");
    expect(h({ kieu: "MOC_CO_DINH", moc: "" })).toBeNull();
    expect(h({ kieu: "SAU_PHAN_CONG", soGio: 24 })?.toISOString()).toBe("2026-11-02T02:00:00.000Z");
    expect(h({ kieu: "SAU_PHAN_CONG", soGio: 0 })).toBeNull();
    expect(h({ kieu: "THEO_GRACE_CUTOVER", graceDen: "2026-11-15", assignmentType: "CUTOVER" })?.toISOString()).toBe("2026-11-15T16:59:59.000Z");
    expect(h({ kieu: "THEO_GRACE_CUTOVER", graceDen: "2026-11-15", assignmentType: "REGULAR" })).toBeNull();
  });
});

describe("[XNT] Q8 — cổng nhân viên xác nhận tháng", () => {
  it("[XNT-01] mặc định (không bắt buộc) ⇒ chỉ cảnh báo EMPLOYEE_NOT_CONFIRMED, KHÔNG chặn; bắt buộc ⇒ chặn khi còn người chưa xác nhận", () => {
    expect(congXacNhanThang({ batBuoc: false, chuaXacNhan: ["u1"] })).toEqual({ chan: false, canhBao: [{ ma: "EMPLOYEE_NOT_CONFIRMED", userId: "u1" }] });
    expect(congXacNhanThang({ batBuoc: true, chuaXacNhan: ["u1"] }).chan).toBe(true);
    expect(congXacNhanThang({ batBuoc: true, chuaXacNhan: [] })).toEqual({ chan: false, canhBao: [] });
  });
});
