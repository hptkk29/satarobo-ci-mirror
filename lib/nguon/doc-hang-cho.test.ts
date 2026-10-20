/**
 * [NHH-FE-HC-*] phần THUẦN của hàng chờ nguồn (lib/nguon/doc-hang-cho.ts). Ca DB (Postgres thật, scopedDb thật)
 * nằm ở tests/lead-intake/nguon-hang-cho.spec.ts.
 */
import { describe, expect, it } from "vitest";
import {
  LY_DO_HANG_CHO,
  NHAN_LY_DO,
  dieuKienLyDo,
  lyDoCuaDong,
  maNvSaiCuaDong,
  nhanCanhBao,
  whereHangCho,
  xemTayHangChoCuaDong,
} from "./doc-hang-cho";
import { LY_DO_XEM_TAY_HANG_CHO, nhanLoaiMaNvSai } from "./nhan-hien-thi";

const dong = (p: Partial<Parameters<typeof lyDoCuaDong>[0]> = {}) => ({
  referrerMissing: false,
  otherSourceNote: null,
  canhBao: [] as string[],
  group: { code: "PAID_ADS", requiresNote: false },
  signals: null as unknown,
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
  it("không lý do cụ thể ⇒ OR đủ năm điều kiện, đúng thứ tự LY_DO_HANG_CHO", () => {
    const w = whereHangCho(null, null);
    expect(w.deletedAt).toBeNull();
    expect(w.centerId).toBeUndefined();
    expect(w.attribution).toEqual({ is: { OR: LY_DO_HANG_CHO.map(dieuKienLyDo) } });
    expect(LY_DO_HANG_CHO).toHaveLength(5);
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

describe("[MNR-05] XEM_TAY — hàng chờ ĐỌC `signals.xemTay[]` (trước 11/10/2026 nó không đọc: dòng OTHER + giải trình tàng hình)", () => {
  /** Giải nghĩa điều kiện Prisma `{ OR: [{ signals: { path: ["xemTay"], array_contains: [r] } }] }` trên một `signals` JS — để so với `lyDoCuaDong`. */
  function khopDieuKien(signals: unknown): boolean {
    const w = dieuKienLyDo("XEM_TAY") as { OR: { signals: { path: string[]; array_contains: string[] } }[] };
    return w.OR.some((c) => {
      expect(c.signals.path).toEqual(["xemTay"]);
      const arr = (signals as { xemTay?: unknown } | null)?.xemTay;
      return Array.isArray(arr) && c.signals.array_contains.every((x) => arr.includes(x));
    });
  }
  const MA_TRAN: { ten: string; signals: unknown; vao: boolean }[] = [
    { ten: "mã NV sai", signals: { xemTay: ["INVALID_EMPLOYEE_REFERRER_CODE"] }, vao: true },
    { ten: "nhãn chốt theo phiếu", signals: { xemTay: ["NHAN_CHOT_THEO_PHIEU"] }, vao: true },
    { ten: "mã NV không giải", signals: { xemTay: ["MA_NV_KHONG_GIAI"] }, vao: true },
    { ten: "nhãn nguồn lạ", signals: { xemTay: ["NHAN_NGUON_LA"] }, vao: true },
    { ten: "HAI lý do trong danh sách", signals: { xemTay: ["MA_NV_KHONG_GIAI", "NHAN_NGUON_LA"] }, vao: true },
    { ten: "một lý do trong danh sách + THIEU_NGUOI", signals: { xemTay: ["THIEU_NGUOI", "INVALID_EMPLOYEE_REFERRER_CODE"] }, vao: true },
    { ten: "CHỈ lý do ngoài danh sách (VAI_SUY_TU_HIEN_TAI)", signals: { xemTay: ["VAI_SUY_TU_HIEN_TAI"] }, vao: false },
    { ten: "CHỈ THIEU_NGUOI (đã có lý do riêng theo cột)", signals: { xemTay: ["THIEU_NGUOI"] }, vao: false },
    { ten: "xemTay rỗng", signals: { xemTay: [] }, vao: false },
    { ten: "coXemTay=true nhưng không có mảng", signals: { coXemTay: true }, vao: false },
    { ten: "signals null", signals: null, vao: false },
    { ten: "signals không phải object", signals: "xemTay", vao: false },
    { ten: "xemTay không phải mảng", signals: { xemTay: "INVALID_EMPLOYEE_REFERRER_CODE" }, vao: false },
  ];

  it("lyDoCuaDong ≡ dieuKienLyDo('XEM_TAY') trên cả ma trận (hai phép cùng nghĩa — một bên sai là danh sách và số đếm lệch nhau)", () => {
    for (const m of MA_TRAN) {
      expect(lyDoCuaDong(dong({ signals: m.signals })).includes("XEM_TAY"), `lyDoCuaDong: ${m.ten}`).toBe(m.vao);
      expect(khopDieuKien(m.signals), `dieuKienLyDo: ${m.ten}`).toBe(m.vao);
    }
  });

  it("danh sách hẹp có ĐÚNG bốn lý do, một chỗ; điều kiện là OR từng phần tử (array_contains Prisma = @> chứa CẢ HAI nên gộp một mảng là SAI)", () => {
    expect([...LY_DO_XEM_TAY_HANG_CHO]).toEqual(["INVALID_EMPLOYEE_REFERRER_CODE", "NHAN_CHOT_THEO_PHIEU", "MA_NV_KHONG_GIAI", "NHAN_NGUON_LA"]);
    const w = dieuKienLyDo("XEM_TAY") as { OR: { signals: { array_contains: string[] } }[] };
    expect(w.OR.map((c) => c.signals.array_contains)).toEqual(LY_DO_XEM_TAY_HANG_CHO.map((r) => [r]));
  });

  it("xemTayHangChoCuaDong chỉ trả lý do TRONG danh sách (theo thứ tự danh sách); maNvSaiCuaDong đọc signals.maNvSai, hình lạ ⇒ null", () => {
    expect(xemTayHangChoCuaDong({ xemTay: ["THIEU_NGUOI", "NHAN_NGUON_LA", "INVALID_EMPLOYEE_REFERRER_CODE"] })).toEqual(["INVALID_EMPLOYEE_REFERRER_CODE", "NHAN_NGUON_LA"]);
    expect(xemTayHangChoCuaDong(null)).toEqual([]);
    const CON = ["INVALID_EMPLOYEE_REFERRER_CODE"];
    expect(maNvSaiCuaDong({ xemTay: CON, maNvSai: { ma: "SR.NV.999", loai: "KHONG_TON_TAI", doDai: 9 } }, false)).toEqual({ ma: "SR.NV.999", loai: "KHONG_TON_TAI", doDai: 9, raw: null, coQuyenXem: false });
    for (const hong of [
      null,
      {},
      { xemTay: CON, maNvSai: null },
      { xemTay: CON, maNvSai: { ma: "", loai: "X" } },
      { xemTay: CON, maNvSai: { ma: 1, loai: "X" } },
      { xemTay: CON, maNvSai: "SR.NV.999" },
    ]) {
      expect(maNvSaiCuaDong(hong, false)).toBeNull();
      expect(maNvSaiCuaDong(hong, true)).toBeNull(); // quyền PII không làm hình lạ thành hợp lệ
    }
  });

  it("maNvSaiCuaDong: dấu xem tay đã GỠ (người duyệt đã chọn người) ⇒ vết gốc còn trong signals nhưng KHÔNG hiện như đang chờ", () => {
    const vet = { ma: "SR.NV.999", loai: "KHONG_TON_TAI" };
    expect(maNvSaiCuaDong({ maNvSai: vet }, false)).toBeNull(); // không có xemTay
    expect(maNvSaiCuaDong({ xemTay: [], maNvSai: vet }, false)).toBeNull();
    expect(maNvSaiCuaDong({ xemTay: ["NHAN_NGUON_LA"], maNvSai: vet }, false)).toBeNull(); // xem tay vì lý do KHÁC
    expect(maNvSaiCuaDong({ xemTay: ["NHAN_NGUON_LA", "INVALID_EMPLOYEE_REFERRER_CODE"], maNvSai: vet }, false)).toEqual({ ...vet, doDai: 9, raw: null, coQuyenXem: false }); // đối chứng dương (dòng cũ thiếu doDai ⇒ suy từ độ dài)
  });

  it("nhãn: mọi loại MaNvSai có câu tiếng Việt; mã lạ in nguyên, không đoán", () => {
    expect(nhanLoaiMaNvSai("KHONG_TON_TAI")).toBe("mã không có trong hệ thống");
    expect(nhanLoaiMaNvSai("LOAI_LA")).toBe("LOAI_LA");
    expect(NHAN_LY_DO.XEM_TAY).toBe("Cần xem tay");
  });
});

describe("nhanCanhBao", () => {
  it("mã đã biết ⇒ câu tiếng Việt; mã lạ ⇒ in nguyên, không đoán nghĩa", () => {
    expect(nhanCanhBao("SDT_NHAN_VIEN")).toBe("SĐT trùng nhân viên");
    expect(nhanCanhBao("MA_LA")).toBe("Cảnh báo MA_LA");
  });
});
