import { describe, it, expect } from "vitest";
import { conConChuyenDoiDuoc, type ConXetChuyenDoi } from "./con-chua-chuyen-doi";

const MOC = new Date("2026-09-17T04:00:00Z");
const sau = new Date("2026-09-20T10:00:00Z");
const truoc = new Date("2026-09-10T05:00:00Z");
const con = (o: Partial<ConXetChuyenDoi> & { id: string }): ConXetChuyenDoi => ({
  closedAt: null,
  createdAt: sau,
  soGhiDanh: 0,
  soHocVien: 0,
  ...o,
});

describe("conConChuyenDoiDuoc — bé nào của lead ĐÃ chuyển đổi còn chốt được", () => {
  it("[CCD-01] bé thêm SAU lần chốt, chưa mốc, chưa ghi danh ⇒ chốt được (ca Tuấn Khang)", () => {
    expect(conConChuyenDoiDuoc(MOC, [con({ id: "khang" })])).toEqual(["khang"]);
  });

  it("[CCD-02] bé đã có mốc chốt ⇒ không", () => {
    expect(conConChuyenDoiDuoc(MOC, [con({ id: "a", closedAt: sau })])).toEqual([]);
  });

  it("[CCD-03] bé đã có ghi danh hoặc học viên trỏ về ⇒ không", () => {
    expect(conConChuyenDoiDuoc(MOC, [con({ id: "a", soGhiDanh: 1 })])).toEqual([]);
    expect(conConChuyenDoiDuoc(MOC, [con({ id: "b", soHocVien: 1 })])).toEqual([]);
  });

  it("[CCD-04] bé có TRƯỚC lần chốt mà mốc trống (dữ liệu trước 26/08) ⇒ không — chống học viên trùng", () => {
    expect(conConChuyenDoiDuoc(MOC, [con({ id: "cu", createdAt: truoc })])).toEqual([]);
  });

  it("[CCD-05] trộn: chỉ trả đúng bé đủ cả ba điều kiện", () => {
    expect(
      conConChuyenDoiDuoc(MOC, [
        con({ id: "hung", createdAt: truoc, closedAt: MOC, soGhiDanh: 1, soHocVien: 1 }),
        con({ id: "khang" }),
        con({ id: "cu", createdAt: truoc }),
      ]),
    ).toEqual(["khang"]);
  });
});
