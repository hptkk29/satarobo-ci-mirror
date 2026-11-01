// @vitest-environment node
/**
 * `seq` của trình phát — hai hàm thuần mà trang học và trình phát cùng dùng.
 *
 * Bản Postgres thật của cùng hành vi (đi qua `ghiNhipXem`): `[VNX-N3*]` ở `tests/elearning/video-nhip-xem-db.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { seqKhoiDau, seqSauPhanHoi } from "@/lib/elearning/video-seq";

describe("[VSQ-01] seqKhoiDau — bộ đếm đi TIẾP từ số đã lưu", () => {
  it("chưa có tiến độ (null/undefined) ⇒ 0", () => {
    expect(seqKhoiDau(null)).toBe(0);
    expect(seqKhoiDau(undefined)).toBe(0);
  });
  it("có số đã lưu ⇒ giữ nguyên (nhịp đầu của lượt mới sẽ là số + 1)", () => {
    expect(seqKhoiDau(20)).toBe(20);
  });
  it("giá trị hỏng (âm, NaN, vô hạn, không phải số) ⇒ 0, không ném", () => {
    expect(seqKhoiDau(-3)).toBe(0);
    expect(seqKhoiDau(Number.NaN)).toBe(0);
    expect(seqKhoiDau(Number.POSITIVE_INFINITY)).toBe(0);
    expect(seqKhoiDau("7" as unknown as number)).toBe(0);
  });
  it("số lẻ bị làm tròn xuống (schema nhịp đòi số nguyên)", () => {
    expect(seqKhoiDau(4.9)).toBe(4);
  });
});

describe("[VSQ-02] seqSauPhanHoi — không bao giờ thấp hơn số server đang giữ", () => {
  it("server giữ số lớn hơn (tab khác đã đi trước) ⇒ nhảy lên số đó", () => {
    expect(seqSauPhanHoi(3, 9)).toBe(9);
  });
  it("server giữ số nhỏ hơn hoặc bằng ⇒ giữ số hiện có (không lùi)", () => {
    expect(seqSauPhanHoi(9, 3)).toBe(9);
    expect(seqSauPhanHoi(9, 9)).toBe(9);
  });
  it("phản hồi không có số ⇒ giữ nguyên", () => {
    expect(seqSauPhanHoi(5, undefined)).toBe(5);
    expect(seqSauPhanHoi(5, null)).toBe(5);
  });
});
