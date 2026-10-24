/**
 * [KSO-01..KSO-04] — `refEventTheoTheHe`: THẾ HỆ MỞ LẠI trong khoá idempotency của dòng điều chỉnh sinh từ hàng chờ. THUẦN.
 * Ca Postgres thật (mở lại → áp dụng lại ghi dòng mới; HOÀN vẫn bị khoá cũ chặn) ở `tests/hoa-hong/hang-cho-mo-lai-ap-dung-lai.spec.ts` `[RAL-*]`.
 */
import { describe, expect, it } from "vitest";

import { khoaDieuChinh, refEventTheoTheHe } from "./khoa-so";

const khoa = (refEventId: string) => khoaDieuChinh({ loai: "INPUT_CORRECTION", refEventId, calcSlotId: "slot1", roleCode: "SALE", kind: "USER", beneficiaryId: "u1" });

describe("[KSO] refEventTheoTheHe", () => {
  it("[KSO-01] chưa từng mở lại (null) ⇒ trả NGUYÊN id hàng chờ ⇒ khoá y hệt khoá đã ghi trong sổ (tương thích ngược)", () => {
    expect(refEventTheoTheHe("hold1", null)).toBe("hold1");
    expect(khoa(refEventTheoTheHe("hold1", null))).toBe("INPUT_CORRECTION|hold1|slot1|SALE|USER|u1");
  });
  it("[KSO-02] cùng thế hệ ⇒ cùng khoá (idempotent); thế hệ khác ⇒ khoá khác", () => {
    expect(khoa(refEventTheoTheHe("hold1", "rop1"))).toBe(khoa(refEventTheoTheHe("hold1", "rop1")));
    expect(khoa(refEventTheoTheHe("hold1", "rop1"))).not.toBe(khoa(refEventTheoTheHe("hold1", "rop2")));
    expect(khoa(refEventTheoTheHe("hold1", "rop1"))).not.toBe(khoa(refEventTheoTheHe("hold1", null)));
  });
  it("[KSO-03] hậu tố mang đúng id dòng REOPEN; hai hàng chờ khác nhau cùng thế hệ không đụng khoá nhau", () => {
    expect(refEventTheoTheHe("hold1", "rop1")).toBe("hold1@rop1");
    expect(khoa(refEventTheoTheHe("hold1", "rop1"))).not.toBe(khoa(refEventTheoTheHe("hold2", "rop1")));
  });
  it("[KSO-04] thế hệ không làm lẫn khoá giữa hai KIND điều chỉnh (khoá vẫn bắt đầu bằng kind)", () => {
    const k = khoaDieuChinh({ loai: "SOURCE_CORRECTION", refEventId: refEventTheoTheHe("hold1", "rop1"), calcSlotId: "slot1", roleCode: "SALE", kind: "USER", beneficiaryId: "u1" });
    expect(k.startsWith("SOURCE_CORRECTION|")).toBe(true);
    expect(k).not.toBe(khoa(refEventTheoTheHe("hold1", "rop1")));
  });
});
