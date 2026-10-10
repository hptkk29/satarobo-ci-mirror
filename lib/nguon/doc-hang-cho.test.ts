/**
 * [NHH-FE-HC-*] phần THUẦN của hàng chờ nguồn (lib/nguon/doc-hang-cho.ts). Ca DB (Postgres thật, scopedDb thật)
 * nằm ở tests/lead-intake/nguon-hang-cho.spec.ts.
 */
import { describe, expect, it } from "vitest";
import {
  LY_DO_HANG_CHO,
  dieuKienLyDo,
  lyDoCuaDong,
  nhanCanhBao,
  whereHangCho,
} from "./doc-hang-cho";

const dong = (p: Partial<Parameters<typeof lyDoCuaDong>[0]> = {}) => ({
  referrerMissing: false,
  otherSourceNote: null,
  canhBao: [] as string[],
  group: { code: "PAID_ADS", requiresNote: false },
  ...p,
});

describe("[NHH-FE-HC-01] lyDoCuaDong — mỗi lý do đúng một điều kiện", () => {
  it("dòng sạch ⇒ không lý do nào (đối chứng: hàng chờ KHÔNG nuốt lead bình thường)", () => {
    expect(lyDoCuaDong(dong())).toEqual([]);
  });

  it("UNKNOWN chỉ so MÃ 'UNKNOWN' — nguồn 11 (OTHER) có giải trình KHÔNG phải UNKNOWN (D7)", () => {
    expect(lyDoCuaDong(dong({ group: { code: "UNKNOWN", requiresNote: false } }))).toEqual(["UNKNOWN"]);
    expect(lyDoCuaDong(dong({ group: { code: "OTHER", requiresNote: true }, otherSourceNote: "Khách quen của chị Lan, giới thiệu qua Zalo" }))).toEqual([]);
  });

  it("nhóm cần giải trình: null HOẶC rỗng ⇒ thiếu; có chữ ⇒ đủ", () => {
    const g = { code: "OTHER", requiresNote: true };
    expect(lyDoCuaDong(dong({ group: g, otherSourceNote: null }))).toEqual(["THIEU_GIAI_TRINH"]);
    expect(lyDoCuaDong(dong({ group: g, otherSourceNote: "" }))).toEqual(["THIEU_GIAI_TRINH"]);
    expect(lyDoCuaDong(dong({ group: g, otherSourceNote: "đã giải trình đầy đủ" }))).toEqual([]);
    // nhóm KHÔNG yêu cầu giải trình thì thiếu giải trình không phải việc
    expect(lyDoCuaDong(dong({ otherSourceNote: null }))).toEqual([]);
  });

  it("một dòng có thể vướng NHIỀU lý do, giữ thứ tự cố định", () => {
    expect(
      lyDoCuaDong(
        dong({ group: { code: "UNKNOWN", requiresNote: false }, referrerMissing: true, canhBao: ["SDT_NHAN_VIEN"] }),
      ),
    ).toEqual(["UNKNOWN", "THIEU_NGUOI", "CANH_BAO"]);
  });
});

describe("[NHH-FE-HC-02] whereHangCho — MỘT hàm dựng điều kiện cho đếm lẫn liệt kê", () => {
  it("không lý do cụ thể ⇒ OR đủ bốn điều kiện, đúng thứ tự LY_DO_HANG_CHO", () => {
    const w = whereHangCho(null, null);
    expect(w.deletedAt).toBeNull();
    expect(w.centerId).toBeUndefined();
    expect(w.attribution).toEqual({ is: { OR: LY_DO_HANG_CHO.map(dieuKienLyDo) } });
    expect(LY_DO_HANG_CHO).toHaveLength(4);
  });

  it("một lý do + một cơ sở ⇒ đúng điều kiện đó, centerId đặt cứng", () => {
    const w = whereHangCho("THIEU_NGUOI", "cs1");
    expect(w.centerId).toBe("cs1");
    expect(w.attribution).toEqual({ is: { referrerMissing: true } });
  });

  it("điều kiện UNKNOWN so mã duy nhất 'UNKNOWN' (03 T3), không so tên hay documentNo", () => {
    expect(dieuKienLyDo("UNKNOWN")).toEqual({ group: { code: "UNKNOWN" } });
  });
});

describe("[NHH-FE-HC-02b] dieuKienLyDo — từng điều kiện đúng như lyDoCuaDong nói (hai phép phải cùng nghĩa)", () => {
  it("THIEU_GIAI_TRINH: nhóm yêu cầu giải trình ∧ (note NULL ∨ note RỖNG) — thiếu nhánh '' là bỏ sót lead đã lưu chuỗi rỗng", () => {
    // Đợt cấy 08/10 (D09b): gỡ nhánh `{ otherSourceNote: "" }` ra XANH ở cả pure lẫn DB vì mọi fixture dùng NULL.
    expect(dieuKienLyDo("THIEU_GIAI_TRINH")).toEqual({
      group: { requiresNote: true },
      OR: [{ otherSourceNote: null }, { otherSourceNote: "" }],
    });
  });

  it("THIEU_NGUOI = cờ referrerMissing; CANH_BAO = mảng cảnh báo KHÔNG rỗng", () => {
    expect(dieuKienLyDo("THIEU_NGUOI")).toEqual({ referrerMissing: true });
    expect(dieuKienLyDo("CANH_BAO")).toEqual({ canhBao: { isEmpty: false } });
  });

  it("whereHangCho một lý do + KHÔNG cơ sở: không đặt centerId (cơ sở do scopedDb cắt)", () => {
    const w = whereHangCho("CANH_BAO", null);
    expect("centerId" in w).toBe(false);
    expect(w.deletedAt).toBeNull();
  });
});

describe("nhanCanhBao", () => {
  it("mã đã biết ⇒ câu tiếng Việt; mã lạ ⇒ in nguyên, không đoán nghĩa", () => {
    expect(nhanCanhBao("SDT_NHAN_VIEN")).toBe("SĐT trùng nhân viên");
    expect(nhanCanhBao("MA_LA")).toBe("Cảnh báo MA_LA");
  });
});
