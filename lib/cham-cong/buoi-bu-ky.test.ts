// [BBK-*] — luật THUẦN của công dạy bù trong kỳ (T12). Đường chạm DB: tests/hoc-bu/cong-day-bu.test.ts.
import { describe, expect, it } from "vitest";
import { buoiBuTuCase, caseCoCong, gomBuoiBuTheoNguoi, lechSoVoiBanChot, TRANG_THAI_CASE_CO_CONG, type BuoiBuTrongKy, type CaseDauVao } from "./buoi-bu-ky";

const ca = (p: Partial<CaseDauVao> & { id: string }): CaseDauVao => ({
  teacherId: "gv-1",
  date: new Date("2026-10-15T00:00:00.000Z"),
  startTime: "18:00",
  endTime: "19:30",
  status: "COMPLETED",
  ...p,
});

describe("[BBK] buổi dạy bù trong kỳ", () => {
  it("[BBK-01] chỉ COMPLETED và NO_SHOW có công; SCHEDULED / CANCELLED không", () => {
    expect([...TRANG_THAI_CASE_CO_CONG]).toEqual(["COMPLETED", "NO_SHOW"]);
    const b = buoiBuTuCase([ca({ id: "a" }), ca({ id: "b", status: "NO_SHOW" }), ca({ id: "c", status: "SCHEDULED" }), ca({ id: "d", status: "CANCELLED" })]);
    expect(b.map((x) => [x.caseId, x.status])).toEqual([["a", "COMPLETED"], ["b", "NO_SHOW"]]);
    expect(caseCoCong("CANCELLED")).toBe(false);
    expect(caseCoCong("NO_SHOW")).toBe(true);
  });

  it("[BBK-02] thời lượng = giờ kết − giờ bắt đầu của CASE; giờ hỏng ⇒ phut null (không đoán) nhưng vẫn đếm một buổi", () => {
    const b = buoiBuTuCase([ca({ id: "a", startTime: "17:00", endTime: "19:00" }), ca({ id: "b", startTime: "xx", endTime: "19:00" })]);
    expect(b.find((x) => x.caseId === "a")!.phut).toBe(120);
    expect(b.find((x) => x.caseId === "b")!.phut).toBeNull();
    expect(gomBuoiBuTheoNguoi(b).get("gv-1")).toEqual({ soBuoi: 2, phut: 120 });
  });

  it("[BBK-03] một case là một dòng dù đưa vào hai lần; xếp ổn định theo (ngày, id)", () => {
    const b = buoiBuTuCase([ca({ id: "z", date: new Date("2026-10-16T00:00:00.000Z") }), ca({ id: "b" }), ca({ id: "a" }), ca({ id: "a" })]);
    expect(b.map((x) => x.caseId)).toEqual(["a", "b", "z"]);
  });

  it("[BBK-04] gom theo giáo viên: mỗi giáo viên một tổng, không lẫn nhau", () => {
    const m = gomBuoiBuTheoNguoi(buoiBuTuCase([ca({ id: "a" }), ca({ id: "b", teacherId: "gv-2", endTime: "18:30" }), ca({ id: "c" })]));
    expect(m.get("gv-1")).toEqual({ soBuoi: 2, phut: 180 });
    expect(m.get("gv-2")).toEqual({ soBuoi: 1, phut: 30 });
  });

  describe("lệch so với bản chốt", () => {
    const goc: BuoiBuTrongKy = { caseId: "a", teacherId: "gv-1", ymd: "2026-10-15", phut: 90, status: "COMPLETED" };
    const loai = (banChot: BuoiBuTrongKy[] | undefined, nay: BuoiBuTrongKy[]) => lechSoVoiBanChot(banChot, nay).map((l) => `${l.caseId}:${l.loai}`);

    it("[BBK-05] khớp ⇒ rỗng; bản chốt rỗng nhưng hiện có case ⇒ NGOAI_BAN_CHOT", () => {
      expect(loai([goc], [goc])).toEqual([]);
      expect(loai([], [goc])).toEqual(["a:NGOAI_BAN_CHOT"]);
    });

    it("[BBK-06] bản chốt CŨ (undefined) phân biệt với bản chốt RỖNG: undefined ⇒ BAN_CHOT_TRUOC_T12, không phải NGOAI_BAN_CHOT", () => {
      expect(loai(undefined, [goc])).toEqual(["a:BAN_CHOT_TRUOC_T12"]);
      expect(loai(undefined, [])).toEqual([]);
    });

    it("[BBK-07] đổi giáo viên / trạng thái / phút sau chốt ⇒ DOI_SAU_CHOT; mất ⇒ MAT_SAU_CHOT", () => {
      expect(loai([goc], [{ ...goc, teacherId: "gv-2" }])).toEqual(["a:DOI_SAU_CHOT"]);
      expect(loai([goc], [{ ...goc, status: "NO_SHOW" }])).toEqual(["a:DOI_SAU_CHOT"]);
      expect(loai([goc], [{ ...goc, phut: 60 }])).toEqual(["a:DOI_SAU_CHOT"]);
      expect(loai([goc], [])).toEqual(["a:MAT_SAU_CHOT"]);
    });
  });
});
