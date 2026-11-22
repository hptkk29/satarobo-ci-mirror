// [AK-*] Lập kế hoạch "Áp khung lịch" (GĐ4). Thuần, mốc tuyệt đối, mỗi ca xanh khi chạy một mình.
import { describe, expect, it } from "vitest";
import { chiaBuocTheoTuan, keHoachApKhung, thuCua, type DichApKhung, type MauTuan } from "./ap-khung";

// Mẫu: tuần 01/03/2027. An trực C thứ Tư (3); An đứng chính lớp L thứ Tư 14:00; Bình trợ giảng L.
const MAU: MauTuan = {
  truc: [{ userId: "an", thu: 3, ca: "C" }],
  phanCong: [
    { userId: "an", classId: "L", thu: 3, gioBatDau: "14:00", role: "MAIN_TEACHER" },
    { userId: "binh", classId: "L", thu: 3, gioBatDau: "14:00", role: "TEACHING_ASSISTANT" },
  ],
};
const dich = (p: Partial<DichApKhung> = {}): DichApKhung => ({
  ngays: ["2027-03-10", "2027-03-11"],
  buoiLop: [{ sourceId: "s10", classId: "L", ngay: "2027-03-10", gioBatDau: "14:00", mo: true, main: "chi", ta: [] }],
  truc: [],
  ...p,
});
const HOM_NAY = "2027-03-05";

describe("keHoachApKhung", () => {
  it("[AK-01] thứ trong tuần ISO: 10/03/2027 là thứ Tư (3), 14/03 là Chủ nhật (7)", () => {
    expect(thuCua("2027-03-10")).toBe(3);
    expect(thuCua("2027-03-14")).toBe(7);
  });
  it("[AK-02] chép trực + thay đứng chính + thêm trợ giảng theo khớp (lớp, thứ, giờ)", () => {
    expect(keHoachApKhung({ mau: MAU, dich: dich(), giaoVien: null, cheDo: "BO_SUNG", homNay: HOM_NAY }).buoc).toEqual([
      { loai: "GIAO_TRUC", userId: "an", ngay: "2027-03-10", ca: "C" },
      { loai: "DAT_NGUOI", sourceId: "s10", ngay: "2027-03-10", role: "MAIN_TEACHER", userId: "an", boUserId: "chi" },
      { loai: "DAT_NGUOI", sourceId: "s10", ngay: "2027-03-10", role: "TEACHING_ASSISTANT", userId: "binh", boUserId: null },
    ]);
  });
  it("[AK-03] ngày ≤ hôm nay ⇒ bỏ qua cả ngày (đối chứng: hôm qua của ngày đích thì vẫn áp)", () => {
    const r = keHoachApKhung({ mau: MAU, dich: dich(), giaoVien: null, cheDo: "BO_SUNG", homNay: "2027-03-10" });
    expect(r.buoc).toEqual([]);
    expect(r.boQuaNgay).toEqual(["2027-03-10"]);
    expect(keHoachApKhung({ mau: MAU, dich: dich(), giaoVien: null, cheDo: "BO_SUNG", homNay: "2027-03-09" }).buoc.length).toBe(3);
  });
  it("[AK-04] đã đúng như mẫu ⇒ 0 bước (chạy lại không đổi gì)", () => {
    const r = keHoachApKhung({
      mau: MAU,
      dich: dich({ buoiLop: [{ sourceId: "s10", classId: "L", ngay: "2027-03-10", gioBatDau: "14:00", mo: true, main: "an", ta: ["binh"] }], truc: [{ id: "d", userId: "an", ngay: "2027-03-10", ca: "C" }] }),
      giaoVien: null,
      cheDo: "GHI_DE",
      homNay: HOM_NAY,
    });
    expect(r.buoc).toEqual([]);
  });
  it("[AK-05] GHI_DE gỡ ca trực THỪA; BO_SUNG thì không (đối chứng)", () => {
    const thua = dich({ truc: [{ id: "dx", userId: "an", ngay: "2027-03-10", ca: "T" }] });
    expect(keHoachApKhung({ mau: MAU, dich: thua, giaoVien: null, cheDo: "GHI_DE", homNay: HOM_NAY }).buoc).toContainEqual({ loai: "GO_TRUC", dutyId: "dx", userId: "an", ngay: "2027-03-10", ca: "T" });
    expect(keHoachApKhung({ mau: MAU, dich: thua, giaoVien: null, cheDo: "BO_SUNG", homNay: HOM_NAY }).buoc.some((b) => b.loai === "GO_TRUC")).toBe(false);
  });
  it("[AK-06] chỉ áp cho giáo viên được chọn — người khác (kể cả trực thừa của họ) không bị đụng", () => {
    const r = keHoachApKhung({ mau: MAU, dich: dich({ truc: [{ id: "dy", userId: "chi", ngay: "2027-03-10", ca: "S" }] }), giaoVien: ["binh"], cheDo: "GHI_DE", homNay: HOM_NAY });
    expect(r.buoc).toEqual([{ loai: "DAT_NGUOI", sourceId: "s10", ngay: "2027-03-10", role: "TEACHING_ASSISTANT", userId: "binh", boUserId: null }]);
  });
  it("[AK-07] buổi đích đã đóng / lớp không có buổi ngày đó ⇒ không bước; người mẫu đang giữ vai kia ⇒ báo xung đột, không đổi vai", () => {
    expect(keHoachApKhung({ mau: MAU, dich: dich({ buoiLop: [{ sourceId: "s10", classId: "L", ngay: "2027-03-10", gioBatDau: "14:00", mo: false, main: "chi", ta: [] }] }), giaoVien: null, cheDo: "BO_SUNG", homNay: HOM_NAY }).buoc.filter((b) => b.loai === "DAT_NGUOI")).toEqual([]);
    const r = keHoachApKhung({ mau: MAU, dich: dich({ buoiLop: [{ sourceId: "s10", classId: "L", ngay: "2027-03-10", gioBatDau: "14:00", mo: true, main: "binh", ta: ["an"] }] }), giaoVien: null, cheDo: "BO_SUNG", homNay: HOM_NAY });
    expect(r.buoc.filter((b) => b.loai === "DAT_NGUOI")).toEqual([]);
    expect(r.xungDot.map((x) => x.userId).sort()).toEqual(["an", "binh"]);
  });
});

describe("chiaBuocTheoTuan — giao dịch theo tuần (chốt lượt 2 điểm 5)", () => {
  it("[AK-10] gom theo Thứ Hai của tuần (CN thuộc tuần TRƯỚC), tuần tăng dần, trong tuần giữ thứ tự kế hoạch", () => {
    const b = (ngay: string, ca: string) => ({ loai: "GIAO_TRUC" as const, userId: "u", ngay, ca });
    const kq = chiaBuocTheoTuan([b("2026-11-18", "C"), b("2026-11-15", "S"), b("2026-11-16", "T"), b("2026-11-11", "S"), b("2026-11-18", "S")]);
    expect(kq.map((t) => t.thuHai)).toEqual(["2026-11-09", "2026-11-16"]);
    expect(kq[0]!.buoc.map((x) => x.ngay)).toEqual(["2026-11-15", "2026-11-11"]); // 15/11 là Chủ nhật ⇒ tuần 09/11
    expect(kq[1]!.buoc.map((x) => `${x.ngay}${"ca" in x ? x.ca : ""}`)).toEqual(["2026-11-18C", "2026-11-16T", "2026-11-18S"]);
    expect(chiaBuocTheoTuan([])).toEqual([]);
  });
});
