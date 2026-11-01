// @vitest-environment node
/**
 * [TNH-*] — TÁCH vai hưởng thành «Hoa hồng nguồn (acquisition)» / «Hoa hồng giao dịch khác» (E2a, 09/10/2026). THUẦN.
 *
 *   [TNH-01] tách theo `isAcquisition`; thứ tự cố định (giao dịch → nguồn); giữ thứ tự đầu vào trong nhóm
 *   [TNH-02] nhóm rỗng bị bỏ (không tiêu đề trống); không có vai ⇒ rỗng
 *   [TNH-03] nhãn từ bảng nhãn MỘT chỗ; hai vai MỚI (Sale phụ trách PH giới thiệu · người phụ trách nguồn) rơi vào nhóm NGUỒN theo cờ master, không theo mã
 *   [TNH-04] khớp master thật: vai `isAcquisition` của `MASTER_VAI_HUONG` = đúng ba vai giới thiệu + hai vai mới
 */
import { describe, expect, it } from "vitest";

import { NHAN_NHOM_HOA_HONG } from "@/lib/nguon/nhan-hien-thi";

import { tachNhomVai } from "./nhom-hoa-hong";
import { MASTER_VAI_HUONG } from "./vai-huong";

type V = { code: string; isAcquisition: boolean };
const v = (code: string, isAcquisition: boolean): V => ({ code, isAcquisition });

describe("[TNH-01] tachNhomVai", () => {
  it("giao dịch trước, nguồn sau; trong nhóm giữ nguyên thứ tự đầu vào", () => {
    const r = tachNhomVai([v("A1", true), v("G1", false), v("A2", true), v("G2", false)]);
    expect(r.map((n) => n.khoa)).toEqual(["GIAO_DICH", "NGUON"]);
    expect(r[0]!.vai.map((x) => x.code)).toEqual(["G1", "G2"]);
    expect(r[1]!.vai.map((x) => x.code)).toEqual(["A1", "A2"]);
  });
});

describe("[TNH-02] nhóm rỗng", () => {
  it("chỉ có vai giao dịch ⇒ một nhóm; chỉ có vai nguồn ⇒ một nhóm; không vai ⇒ []", () => {
    expect(tachNhomVai([v("G1", false)]).map((n) => n.khoa)).toEqual(["GIAO_DICH"]);
    expect(tachNhomVai([v("A1", true)]).map((n) => n.khoa)).toEqual(["NGUON"]);
    expect(tachNhomVai([])).toEqual([]);
  });
});

describe("[TNH-03] nhãn một chỗ", () => {
  it("nhãn nhóm lấy từ bảng nhãn; chữ đúng theo yêu cầu", () => {
    const r = tachNhomVai([v("A1", true), v("G1", false)]);
    expect(r[0]!.nhan).toBe(NHAN_NHOM_HOA_HONG.GIAO_DICH);
    expect(r[1]!.nhan).toBe(NHAN_NHOM_HOA_HONG.NGUON);
    expect(NHAN_NHOM_HOA_HONG.NGUON).toBe("Hoa hồng nguồn (acquisition)");
    expect(NHAN_NHOM_HOA_HONG.GIAO_DICH).toBe("Hoa hồng giao dịch khác");
  });
});

describe("[TNH-04] khớp master thật", () => {
  it("vai nằm nhóm NGUỒN = đúng các vai `isAcquisition` của master (ba vai giới thiệu/đối tác + hai vai mới); còn lại là giao dịch", () => {
    const r = tachNhomVai(MASTER_VAI_HUONG);
    const nguon = r.find((n) => n.khoa === "NGUON")!.vai.map((x) => x.code).sort();
    expect(nguon).toEqual(["AFFILIATE", "REFERRER_EMPLOYEE", "REFERRER_PARENT", "REFERRER_PARENT_SALE", "SOURCE_OWNER"]);
    const gd = r.find((n) => n.khoa === "GIAO_DICH")!.vai.map((x) => x.code).sort();
    expect(gd).toEqual(["CENTER_MANAGER", "MARKETING", "SALE", "SALE_ADMIN", "TRIAL_TEACHER"]);
  });
});
