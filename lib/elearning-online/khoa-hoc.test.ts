// @vitest-environment node
/** [ONL-KHP-*] Khoá Online — luật thuần: slug · schema nhập · nội dung bài. */
import { describe, expect, it } from "vitest";
import { suaKhoaSchema, taoKhoaSchema, taoSlug, tienQuyetSchema, trangThaiBanSchema } from "./khoa-hoc";
import { kiemNoiDungBai } from "./noi-dung";
import { chinhSachSchema, luuCaiDatSchema, phatHanhSchema } from "./phien-ban";
import { caiDatKhoiDauChoBanNhap } from "./cai-dat-hoc-tap";

const hopLe = { code: "rb-101", name: "Robot cho bé", listPrice: 900_000, salePrice: 800_000, validityMonths: 12, renewalEnabled: false };

describe("[ONL-KHP-01] slug", () => {
  it("bỏ dấu tiếng Việt, đ→d, ký tự lạ → gạch ngang, không gạch đầu/cuối", () => {
    expect(taoSlug("Lập trình Robot cho bé")).toBe("lap-trinh-robot-cho-be");
    expect(taoSlug("  Đại số — Lớp 6!! ")).toBe("dai-so-lop-6");
    expect(taoSlug("***")).toBe("");
  });
});

describe("[ONL-KHP-02] schema tạo/sửa khoá", () => {
  it("mã khoá được chuẩn hoá HOA; ký tự lạ bị từ chối", () => {
    expect(taoKhoaSchema.parse(hopLe).code).toBe("RB-101");
    expect(taoKhoaSchema.safeParse({ ...hopLe, code: "rb 101" }).success).toBe(false);
    expect(taoKhoaSchema.safeParse({ ...hopLe, code: "a" }).success).toBe(false);
  });

  it("🔴 giá bán > giá niêm yết bị từ chối; giá âm bị từ chối", () => {
    expect(taoKhoaSchema.safeParse({ ...hopLe, salePrice: 900_001 }).success).toBe(false);
    expect(taoKhoaSchema.safeParse({ ...hopLe, salePrice: -1 }).success).toBe(false);
    expect(taoKhoaSchema.safeParse({ ...hopLe, salePrice: 900_000 }).success).toBe(true); // bằng là được
  });

  it("🔴 thời hạn: 1..120 tháng hoặc null (trọn đời); 0 và 121 bị từ chối", () => {
    for (const v of [0, 121, 1.5]) expect(taoKhoaSchema.safeParse({ ...hopLe, validityMonths: v }).success, String(v)).toBe(false);
    for (const v of [1, 12, 120, null]) expect(taoKhoaSchema.safeParse({ ...hopLe, validityMonths: v }).success, String(v)).toBe(true);
  });

  it("🔴 gia hạn: khoá trọn đời không có gia hạn; bật gia hạn phải có giá gia hạn", () => {
    expect(taoKhoaSchema.safeParse({ ...hopLe, validityMonths: null, renewalEnabled: true, renewalPrice: 1 }).success).toBe(false);
    expect(taoKhoaSchema.safeParse({ ...hopLe, renewalEnabled: true }).success).toBe(false);
    expect(taoKhoaSchema.safeParse({ ...hopLe, renewalEnabled: true, renewalPrice: 500_000 }).success).toBe(true);
  });

  it("lớp từ ≤ lớp đến; sửa khoá không nhận `code` (strict: mã không đổi sau khi tạo)", () => {
    expect(taoKhoaSchema.safeParse({ ...hopLe, gradeFrom: 5, gradeTo: 3 }).success).toBe(false);
    const { code: _c, ...khongMa } = hopLe;
    expect(suaKhoaSchema.safeParse({ ...khongMa, courseId: "c1" }).success).toBe(true);
    expect(suaKhoaSchema.safeParse({ ...hopLe, courseId: "c1" }).success).toBe(false);
  });

  it("trạng thái bán: hẹn giờ phải có ngày mở bán; tiên quyết khác 'Không' phải chọn khoá", () => {
    expect(trangThaiBanSchema.safeParse({ courseId: "c", saleStatus: "SCHEDULED" }).success).toBe(false);
    expect(trangThaiBanSchema.safeParse({ courseId: "c", saleStatus: "SCHEDULED", saleOpensAt: "2026-12-01T00:00:00Z" }).success).toBe(true);
    expect(tienQuyetSchema.safeParse({ courseId: "c", mode: "REQUIRED", prerequisiteCourseId: null }).success).toBe(false);
    expect(tienQuyetSchema.safeParse({ courseId: "c", mode: "NONE", prerequisiteCourseId: "x" }).success).toBe(false);
    expect(tienQuyetSchema.safeParse({ courseId: "c", mode: "NONE", prerequisiteCourseId: null }).success).toBe(true);
  });
});

describe("[ONL-KHP-03] nội dung bài theo loại", () => {
  it("🔴 URL công khai KHÔNG được làm nguồn video (mọi dạng scheme)", () => {
    for (const u of ["https://cdn.x/v.mp4", "http://x", "HTTPS://x", "ftp://x", "s3://bucket/key", "//cdn.x/v.mp4".replace("//", "x://")]) {
      expect(kiemNoiDungBai("VIDEO", { mediaRef: u }).ok, u).toBe(false);
    }
    expect(kiemNoiDungBai("VIDEO", { mediaRef: "online/video/c1/b1/abc123.mp4" }).ok).toBe(true);
    expect(kiemNoiDungBai("VIDEO", {}).ok).toBe(true); // nháp chưa gắn video
  });

  it("🔴 bài MỚI tạo chưa có nội dung vẫn hợp lệ ở MỌI loại (thêm bài rồi mới soạn) — bài đọc mặc định thân rỗng", () => {
    for (const k of ["VIDEO", "READ", "ASSIGNMENT", "QUIZ", "FINAL_EXAM"] as const) {
      expect(kiemNoiDungBai(k, undefined).ok, k).toBe(true);
      expect(kiemNoiDungBai(k, {}).ok, k).toBe(true);
    }
    expect(kiemNoiDungBai("READ", undefined)).toEqual({ ok: true, value: { body: "" } });
  });

  it("mỗi loại chỉ nhận đúng khoá của nó (strict)", () => {
    expect(kiemNoiDungBai("READ", { body: "xin chào" }).ok).toBe(true);
    expect(kiemNoiDungBai("READ", { mediaRef: "m" }).ok).toBe(false);
    expect(kiemNoiDungBai("QUIZ", { assessmentId: "a1" }).ok).toBe(true);
    expect(kiemNoiDungBai("QUIZ", { body: "x" }).ok).toBe(false);
  });
});

describe("[ONL-KHP-04] phát hành — đầu vào", () => {
  it("🔴 xác nhận phải đúng chuỗi 'PHAT HANH'; dấu vết bắt buộc", () => {
    expect(phatHanhSchema.safeParse({ courseId: "c", dauVet: "abcdefgh12", xacNhan: "phat hanh" }).success).toBe(false);
    expect(phatHanhSchema.safeParse({ courseId: "c", dauVet: "", xacNhan: "PHAT HANH" }).success).toBe(false);
    expect(phatHanhSchema.safeParse({ courseId: "c", dauVet: "abcdefgh12", xacNhan: "PHAT HANH" }).success).toBe(true);
  });

  it("chính sách tiến độ: không có loại 'mặc định'; RESET phải có ít nhất một chương", () => {
    expect(chinhSachSchema.safeParse({ loai: "MAC_DINH" }).success).toBe(false);
    expect(chinhSachSchema.safeParse({ loai: "RESET_BY_SCOPE", chuongStableIds: [] }).success).toBe(false);
    expect(chinhSachSchema.safeParse({ loai: "KEEP_PROGRESS" }).success).toBe(true);
  });

  it("cài đặt học tập: lưu phải đủ mọi khoá (strict)", () => {
    expect(luuCaiDatSchema.safeParse({ versionId: "v", caiDat: caiDatKhoiDauChoBanNhap() }).success).toBe(true);
    const { khongChoXemLaiBaiDaQua: _x, ...thieu } = caiDatKhoiDauChoBanNhap();
    expect(luuCaiDatSchema.safeParse({ versionId: "v", caiDat: thieu }).success).toBe(false);
  });
});
