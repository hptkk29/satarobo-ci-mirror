import { describe, expect, it } from "vitest";
import { dungThongBaoHanMuc, TIEN_TO_HAN_MUC, type NhomHanMuc } from "./bao-han-muc";

const NOW = new Date("2026-11-04T17:30:00.000Z"); // 05/11 giờ VN
const NHOM: NhomHanMuc = { phapNhanMa: "STEM_ROBOTICS_AI", phapNhanTen: "STEM ROBOTICS AI", soCho: 3, tanSuatCao: false, coSoIds: ["cs1"] };
const HO = { userId: "kt-ho", phamVi: "ALL" as const };
const CS1 = { userId: "kt-cs1", phamVi: ["cs1"] as const };
const CS2 = { userId: "kt-cs2", phamVi: ["cs2"] as const };

describe("[BHM-01] dungThongBaoHanMuc — tin gộp «chạm hạn mức ký tự động»", () => {
  it("MỘT tin CHO mỗi pháp nhân mỗi ngày (giờ VN); khoá theo ngày VN; kế toán Hội sở + đúng cơ sở nhận, kế toán cơ sở KHÁC không", () => {
    const tb = dungThongBaoHanMuc({ nhom: [NHOM], nguoiNhan: [HO, CS1, CS2], now: NOW });
    expect(tb).toHaveLength(1);
    expect(tb[0]!.dedupeKey).toBe(`${TIEN_TO_HAN_MUC}STEM_ROBOTICS_AI:2026-11-05:CHO`);
    expect(tb[0]!.userIds).toEqual(["kt-cs1", "kt-ho"]);
  });
  it("nội dung chỉ mang SỐ LƯỢNG + TÊN pháp nhân — không số tiền, không PII", () => {
    const t = dungThongBaoHanMuc({ nhom: [NHOM], nguoiNhan: [HO], now: NOW })[0]!;
    expect(t.body).toContain("3 lần thu của STEM ROBOTICS AI");
    expect(t.body + t.title).not.toMatch(/\d{1,3}(\.\d{3})+|đ\b/);
  });
  it("tần suất cao sinh tin RIÊNG (khoá TAN_SUAT) kể cả khi không có lần thu nào bị chặn; hai loại không chặn lẫn nhau", () => {
    const tb = dungThongBaoHanMuc({ nhom: [{ ...NHOM, soCho: 0, tanSuatCao: true }], nguoiNhan: [HO], now: NOW });
    expect(tb.map((t) => t.dedupeKey)).toEqual([`${TIEN_TO_HAN_MUC}STEM_ROBOTICS_AI:2026-11-05:TAN_SUAT`]);
    const ca2 = dungThongBaoHanMuc({ nhom: [{ ...NHOM, tanSuatCao: true }], nguoiNhan: [HO], now: NOW });
    expect(ca2.map((t) => t.dedupeKey.split(":").pop())).toEqual(["CHO", "TAN_SUAT"]);
  });
  it("không có việc / không ai nhận ⇒ không tin nào; sang ngày mới ⇒ khoá mới (báo lại nếu còn chờ)", () => {
    expect(dungThongBaoHanMuc({ nhom: [{ ...NHOM, soCho: 0 }], nguoiNhan: [HO], now: NOW })).toEqual([]);
    expect(dungThongBaoHanMuc({ nhom: [NHOM], nguoiNhan: [CS2], now: NOW })).toEqual([]);
    const homSau = dungThongBaoHanMuc({ nhom: [NHOM], nguoiNhan: [HO], now: new Date(NOW.getTime() + 86_400_000) });
    expect(homSau[0]!.dedupeKey).toBe(`${TIEN_TO_HAN_MUC}STEM_ROBOTICS_AI:2026-11-06:CHO`);
  });
});
