// @vitest-environment node
/**
 * EL-20 — ảnh chụp chỉ số + ngưỡng ẩn danh + báo cáo hiệu quả R7.
 *
 * Ba bất biến, và cả ba là về việc KHÔNG NÓI QUÁ:
 *  · nhóm dưới ngưỡng bị chặn Ở TẦNG DỮ LIỆU, không ở tầng hiển thị;
 *  · chưa khai ngân sách thì KHÔNG in số 0;
 *  · không một ngôn ngữ so sánh nhóm nào trên R7 — ở n = 15 nó tạo ra một con số nghe
 *    như bằng chứng mà không phải bằng chứng.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  apNguong,
  chiPhiMoiLuot,
  CHU_THICH_CHI_PHI,
  CUM_TU_CAM_R7,
  dimensionKeyCua,
  NGUONG_N_ANH_CHUP,
  quetCumTuCam,
  tiLeAnhChup,
} from "@/lib/elearning/metrics/snapshot";
import { kyThang } from "@/lib/elearning/metrics/snapshot-run";

const dong = (groupN: number, chieu: Record<string, string> = {}) => ({
  metricKey: "M2",
  chieu,
  numerator: 3,
  denominator: 4,
  groupN,
});

describe("khoá chiều — một nhóm chỉ có MỘT khoá", () => {
  it("thứ tự khoá KHÔNG làm đổi kết quả", () => {
    // `{a:1,b:2}` và `{b:2,a:1}` là cùng một chiều, nhưng `JSON.stringify` cho ra hai
    // chuỗi khác nhau — và hai dòng ảnh chụp cho cùng một nhóm là mất luôn ý nghĩa
    // của khoá duy nhất.
    expect(dimensionKeyCua({ a: "1", b: "2" })).toBe(dimensionKeyCua({ b: "2", a: "1" }));
  });

  it("không tách chiều ⇒ khoá 'TONG'", () => {
    expect(dimensionKeyCua({})).toBe("TONG");
  });
});

describe("🔴 ngưỡng ẩn danh đặt ở TẦNG DỮ LIỆU", () => {
  it("nhóm dưới ngưỡng bị đánh `suppressed`", () => {
    const r = apNguong([dong(3, { phongBan: "IT" })]);
    expect(r[0]!.suppressed).toBe(true);
  });

  it("nhóm đủ ngưỡng thì không", () => {
    expect(apNguong([dong(5, { phongBan: "DAO_TAO" })])[0]!.suppressed).toBe(false);
  });

  it("🔴 dòng TỔNG không bao giờ bị chặn, dù cả công ty dưới ngưỡng", () => {
    // Dòng tổng không nói về ai cụ thể. Chặn nó là làm cả báo cáo trống ở một công ty
    // 4 người — và người đọc sẽ nghĩ hệ thống hỏng.
    expect(apNguong([dong(2, {})])[0]!.suppressed).toBe(false);
  });

  it("`suppressed` vẫn GIỮ số liệu — chặn công bố, không xoá", () => {
    // Số còn đó để cộng dồn; chỉ đường đọc phải tôn trọng cờ.
    const r = apNguong([dong(1, { phongBan: "IT" })]);
    expect(r[0]!.numerator).toBe(3);
    expect(r[0]!.denominator).toBe(4);
  });

  it("ngưỡng là 5, cùng con số với R4", () => {
    expect(NGUONG_N_ANH_CHUP).toBe(5);
  });
});

describe("tỉ lệ", () => {
  it("mẫu số 0 ⇒ null, không phải 0%", () => {
    expect(tiLeAnhChup({ numerator: 0, denominator: 0 })).toBeNull();
    expect(tiLeAnhChup({ numerator: 3, denominator: 4 })).toBe(75);
  });
});

describe("🔴 chi phí — chưa khai ngân sách thì KHÔNG in 0", () => {
  it("ngân sách null ⇒ null", () => {
    // "0đ/người" bị đọc thành "đào tạo không tốn gì", và đó là câu sẽ được trích
    // trong một cuộc họp về ngân sách.
    expect(chiPhiMoiLuot({ nganSach: null, soLuotHoanThanh: 10 })).toBeNull();
  });

  it("chưa có lượt nào ⇒ null, không chia cho 0", () => {
    expect(chiPhiMoiLuot({ nganSach: 1_000_000, soLuotHoanThanh: 0 })).toBeNull();
  });

  it("đủ dữ liệu ⇒ số", () => {
    expect(chiPhiMoiLuot({ nganSach: 1_000_000, soLuotHoanThanh: 4 })).toBe(250_000);
  });

  it("có ĐÚNG HAI dòng chú thích bắt buộc", () => {
    // Không có chúng thì con số bị đọc là TỔNG chi phí đào tạo, trong khi nó chỉ là
    // phần ngân sách khai tay.
    expect(CHU_THICH_CHI_PHI).toHaveLength(2);
    expect(CHU_THICH_CHI_PHI[0]).toContain("giờ công người học");
    expect(CHU_THICH_CHI_PHI[1]).toContain("sản xuất nội dung");
  });
});

describe("🔴 R7 KHÔNG được chứa ngôn ngữ so sánh nhóm (TS-37, case bắt buộc)", () => {
  it("bộ quét bắt được các cụm cấm", () => {
    expect(quetCumTuCam("Chúng tôi so sánh nhóm đã học với nhóm chưa học")).toHaveLength(
      3,
    );
    expect(quetCumTuCam("Mỗi ca một dòng, quản lý trực tiếp nhận xét")).toHaveLength(0);
  });

  it("🔴 trang R7 THẬT SỰ không chứa cụm nào trong số đó", () => {
    // ⚠️ Đây là bước kiểm tĩnh mà TS-37 đòi. Ở n = 15, Kirkpatrick L3/L4 VĨNH VIỄN
    // không đủ cỡ mẫu — không phải "chờ thêm dữ liệu". Một phép so sánh ở cỡ này tạo
    // ra một con số nghe như bằng chứng mà không phải bằng chứng, và nó sẽ được dùng
    // để quyết định về con người.
    const p = join(process.cwd(), "app/(elearning)/elearning/bao-cao-r7/page.tsx");
    const src = readFileSync(p, "utf8");
    // Bỏ khối chú thích: chính chú thích giải thích vì sao KHÔNG so sánh nhóm lại
    // chứa đúng những cụm ấy — đó là bẫy đã làm một test khác của kho đỏ oan.
    const chiMa = src
      .split("\n")
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    const thay = quetCumTuCam(chiMa);
    expect(thay, `R7 chứa cụm cấm: ${thay.join(", ")}`).toEqual([]);
  });

  it("danh sách cụm cấm không rỗng — nếu rỗng thì bước kiểm trên vô nghĩa", () => {
    expect(CUM_TU_CAM_R7.length).toBeGreaterThanOrEqual(5);
  });
});

describe("kỳ tháng", () => {
  it("bao trọn tháng chứa mốc, theo UTC", () => {
    const k = kyThang(new Date("2026-03-17T10:00:00Z"));
    expect(k.batDau.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(k.ketThuc.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("tháng 12 sang năm sau", () => {
    const k = kyThang(new Date("2026-12-20T00:00:00Z"));
    expect(k.ketThuc.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});
