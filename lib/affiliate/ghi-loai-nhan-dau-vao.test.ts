/**
 * [GLV-*] — LUẬT GHI LOẠI ĐỐI TÁC + NHÃN, phần thuần (`ghi-loai-nhan-dau-vao.ts`). Không DB.
 *
 *   [GLV-01] mã: qua chuanHoaMa rồi phải khớp MA_DANH_MUC_RE (cùng CHECK của migration); lỗi nói rõ vì sao
 *   [GLV-02] mã BẤT BIẾN: schema SỬA từ chối ô `code` (strict), tạo thì nhận
 *   [GLV-03] `requiresApproval` / `sortOrder` KHÔNG có mặc định (luật 7) — quên khai là lỗi, không phải "false"
 *   [GLV-04] tên 2..80, mô tả ≤ 500, ô lạ bị từ chối
 *   [GLV-05] ngừng đòi lý do ≥ 10 ký tự; bật lại không; đang ở trạng thái đích ⇒ từ chối
 */
import { describe, expect, it } from "vitest";
import { MA_DANH_MUC_RE } from "./chung";
import { LY_DO_TOI_THIEU_LOAI_NHAN, kiemBatTatDanhMuc, kiemMaDanhMuc, suaLoaiSchema, suaNhanSchema, taoLoaiSchema, taoNhanSchema } from "./ghi-loai-nhan-dau-vao";

const LOAI = { code: "kol", name: "KOL", description: null, defaultSourceGroupId: null, requiresApproval: true, sortOrder: 100 };

describe("[GLV-01] mã danh mục", () => {
  it("chuẩn hoá: bỏ dấu, HOA, ký tự lạ thành gạch dưới", () => {
    expect(taoLoaiSchema.parse(LOAI).code).toBe("KOL");
    expect(taoLoaiSchema.parse({ ...LOAI, code: "phụ huynh cũ" }).code).toBe("PHU_HUYNH_CU");
    expect(taoNhanSchema.parse({ code: "Giáo-viên", name: "Giáo viên", description: null }).code).toBe("GIAO_VIEN");
  });
  it("kết quả luôn khớp MA_DANH_MUC_RE khi hợp lệ; ngắn/dài/rỗng bị từ chối với câu nói rõ lý do", () => {
    expect(MA_DANH_MUC_RE.test(taoLoaiSchema.parse(LOAI).code)).toBe(true);
    for (const code of ["ab", "", "!!", "A".repeat(41)]) {
      const r = taoLoaiSchema.safeParse({ ...LOAI, code });
      expect(r.success, code).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.path[0]).toBe("code");
    }
    expect(kiemMaDanhMuc("AB")).toMatch(/3–40/);
    expect(kiemMaDanhMuc("ABC")).toBeNull();
    expect(kiemMaDanhMuc("A".repeat(40))).toBeNull();
    expect(kiemMaDanhMuc("a-b")).toMatch(/chữ HOA/);
  });
});

describe("[GLV-02] mã bất biến", () => {
  it("tạo nhận `code`; sửa loại / sửa nhãn TỪ CHỐI `code` (không lặng lẽ bỏ qua)", () => {
    expect(taoLoaiSchema.safeParse(LOAI).success).toBe(true);
    const { code: _c, ...khongMa } = LOAI;
    expect(suaLoaiSchema.safeParse(khongMa).success).toBe(true); // đối chứng dương
    expect(suaLoaiSchema.safeParse(LOAI).success).toBe(false);
    expect(suaNhanSchema.safeParse({ name: "Nhãn", description: null }).success).toBe(true);
    expect(suaNhanSchema.safeParse({ code: "NHAN", name: "Nhãn", description: null }).success).toBe(false);
  });
});

describe("[GLV-03] không mặc định cho tham số quyết định hành vi", () => {
  it("thiếu requiresApproval hoặc sortOrder ⇒ lỗi (không rơi về false / 0)", () => {
    const { requiresApproval: _r, ...thieuDuyet } = LOAI;
    const { sortOrder: _s, ...thieuThuTu } = LOAI;
    expect(taoLoaiSchema.safeParse(thieuDuyet).success).toBe(false);
    expect(taoLoaiSchema.safeParse(thieuThuTu).success).toBe(false);
    expect(taoLoaiSchema.safeParse({ ...LOAI, requiresApproval: false }).success).toBe(true);
  });
  it("sortOrder: số nguyên 0..9999", () => {
    for (const x of [0, 9999, 100]) expect(taoLoaiSchema.safeParse({ ...LOAI, sortOrder: x }).success, String(x)).toBe(true);
    for (const x of [-1, 10000, 1.5, "100"]) expect(taoLoaiSchema.safeParse({ ...LOAI, sortOrder: x }).success, String(x)).toBe(false);
  });
});

describe("[GLV-04] tên · mô tả · ô lạ", () => {
  it("tên 2..80; mô tả ≤ 500, rỗng ⇒ null; defaultSourceGroupId rỗng ⇒ null", () => {
    expect(taoLoaiSchema.safeParse({ ...LOAI, name: "A" }).success).toBe(false);
    expect(taoLoaiSchema.safeParse({ ...LOAI, name: "A".repeat(81) }).success).toBe(false);
    expect(taoLoaiSchema.safeParse({ ...LOAI, description: "x".repeat(501) }).success).toBe(false);
    const r = taoLoaiSchema.parse({ ...LOAI, description: "  ", defaultSourceGroupId: "  " });
    expect(r.description).toBeNull();
    expect(r.defaultSourceGroupId).toBeNull();
  });
  it("ô lạ (isActive, createdById…) bị từ chối", () => {
    expect(taoLoaiSchema.safeParse({ ...LOAI, isActive: false }).success).toBe(false);
    expect(taoNhanSchema.safeParse({ code: "NHAN", name: "Nhãn", description: null, createdById: "x" }).success).toBe(false);
  });
});

describe("[GLV-05] ngừng / bật lại", () => {
  it("ngừng đòi lý do ≥ 10 ký tự sau trim", () => {
    for (const lyDo of [null, "", "ngắn", "123456789", "  123456789  "]) {
      expect(kiemBatTatDanhMuc({ dangBat: true, batLai: false, lyDo }).ok, String(lyDo)).toBe(false);
    }
    expect(kiemBatTatDanhMuc({ dangBat: true, batLai: false, lyDo: "  đúng mười ký tự  " }).ok).toBe(true);
    expect(LY_DO_TOI_THIEU_LOAI_NHAN).toBe(10);
  });
  it("bật lại KHÔNG đòi lý do (đối chứng)", () => {
    expect(kiemBatTatDanhMuc({ dangBat: false, batLai: true, lyDo: null }).ok).toBe(true);
  });
  it("đang ở trạng thái đích ⇒ từ chối, câu nói đúng chiều", () => {
    const a = kiemBatTatDanhMuc({ dangBat: true, batLai: true, lyDo: null });
    const b = kiemBatTatDanhMuc({ dangBat: false, batLai: false, lyDo: "Lý do đủ dài để qua cổng" });
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok) expect(a.loi).toMatch(/đang hoạt động/);
    if (!b.ok) expect(b.loi).toMatch(/đã ngừng/);
  });
});
