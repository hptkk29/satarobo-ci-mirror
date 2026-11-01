// @vitest-environment node
/**
 * [NHT-*] — NHÃN tiếng Việt của nguồn / nhóm hoa hồng / cách một vai tìm người nhận, ở MỘT bảng nhãn (`lib/nguon/nhan-hien-thi.ts`) (E2a, 09/10/2026). THUẦN.
 *
 *   [NHT-01] mọi vai master có câu mô tả KHÔNG phải mã thô; hai vai MỚI nói đúng nghĩa (đặc biệt: «Sale phụ trách PH giới thiệu» KHÔNG bị nói là «người giới thiệu»)
 *   [NHT-02] kiểu/khoá lạ in nguyên (không đoán một nhãn sai nghĩa)
 *   [NHT-03] mọi `SourceStatus` của Prisma đổi được sang một khoá trạng thái CÓ nhãn
 */
import { SourceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { khoaTrangThaiNguon } from "@/lib/hoa-hong/nguon-cho-soan";
import { MASTER_VAI_HUONG } from "@/lib/hoa-hong/vai-huong";

import { moTaCachXacDinhVai, NHAN_TRANG_THAI_NGUON } from "./nhan-hien-thi";

describe("[NHT-01] moTaCachXacDinhVai", () => {
  it("mọi vai master có mô tả riêng, không phải mã kỹ thuật thô", () => {
    for (const v of MASTER_VAI_HUONG) {
      const t = moTaCachXacDinhVai(v);
      expect(t, v.code).not.toBe(v.resolverType);
      expect(t, v.code).not.toBe(v.resolverKey);
      expect(t, v.code).toMatch(/[a-zà-ỹ]/i);
    }
  });

  it("hai vai mới: Sale phụ trách PH giới thiệu ⇒ nói «Sale» và «chốt tại lúc ghi nhận» (khác người chốt đơn); người phụ trách nguồn ⇒ «khai ở cấu hình nguồn»", () => {
    const ph = moTaCachXacDinhVai({ resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_PARENT_SALE" });
    expect(ph).toContain("Sale phụ trách phụ huynh giới thiệu");
    expect(ph).toContain("chốt tại lúc ghi nhận nguồn");
    expect(ph).not.toBe(moTaCachXacDinhVai({ resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_PARENT" }));
    expect(moTaCachXacDinhVai({ resolverType: "SOURCE_OWNER", resolverKey: "SOURCE_OWNER" })).toContain("khai ở cấu hình nguồn");
  });
});

describe("[NHT-02] mã lạ in nguyên", () => {
  it("kiểu lạ ⇒ chính kiểu đó; DIRECT_PERSON khoá lạ/null ⇒ câu theo kiểu", () => {
    expect(moTaCachXacDinhVai({ resolverType: "KIEU_MOI", resolverKey: null })).toBe("KIEU_MOI");
    expect(moTaCachXacDinhVai({ resolverType: "DIRECT_PERSON", resolverKey: "KHOA_MOI" })).toBe("Người giới thiệu — theo nguồn lead");
    expect(moTaCachXacDinhVai({ resolverType: "DIRECT_PERSON", resolverKey: null })).toBe("Người giới thiệu — theo nguồn lead");
  });
});

describe("[NHT-03] trạng thái nguồn", () => {
  it("mọi SourceStatus (bốn giá trị hiện có) ⇒ một khoá trạng thái có nhãn khác rỗng; thêm giá trị enum mới mà quên map ⇒ đỏ", () => {
    const now = new Date("2026-10-09T03:00:00.000Z");
    const vals = Object.values(SourceStatus);
    expect(vals.length).toBe(4);
    const khoa = new Set<string>();
    for (const status of vals) {
      const k = khoaTrangThaiNguon({ status, effectiveFrom: null, effectiveTo: null }, now);
      expect(NHAN_TRANG_THAI_NGUON[k].length, status).toBeGreaterThan(3);
      khoa.add(k);
    }
    expect(khoa.size).toBe(4);
  });
});
