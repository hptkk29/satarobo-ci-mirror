// @vitest-environment node
/**
 * XOÁ TRỐNG MỘT Ô PHẢI LƯU LÀ NULL, KHÔNG PHẢI 1970-01-01.
 *
 * Bug thật, đo được trên `lib/validators/employee.ts` trước khi vá: form nhân sự
 * gửi `joinedAt: data.joinedAt || null` khi người dùng xoá ô, và
 * `z.union([z.coerce.date(), z.literal(""), z.null()])` nhận `null` ở nhánh ĐẦU
 * — vì `new Date(null)` = 1970-01-01, một Date hoàn toàn hợp lệ. Nhánh `z.null()`
 * không bao giờ tới lượt. Kết quả: xoá "Ngày vào làm" ghi thành 1970-01-01, lưu
 * báo thành công, không ai biết cho tới khi có người đọc báo cáo thâm niên.
 *
 * Cùng cơ chế với số: `Number(null)` = 0 ⇒ xoá ô số ghi thành 0. Chỗ dùng
 * `.min(1)` may mắn thoát vì 0 bị chặn rồi rơi xuống nhánh `z.null()` — nhưng đó
 * là AN TOÀN NHỜ MAY, không phải nhờ thiết kế, và nó vỡ ngay khi ai đó đặt min 0.
 *
 * Hai tầng test: một tầng đo HÀNH VI qua schema thật, một tầng quét NGUỒN để
 * khuôn sai không quay lại ở file validator mới.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { employeeCreateSchema } from "@/lib/validators/employee";

describe("hành vi — schema nhân sự", () => {
  const NEN = {
    employeeCode: "NV-TEST-1",
    fullName: "Nguyễn Văn A",
    department: "DAO_TAO",
    jobTitle: "Giáo viên",
    displayOrder: 0,
    status: "ACTIVE",
    subjects: [],
    certifications: [],
  };

  it("joinedAt = null ⇒ lưu null, KHÔNG phải 1970-01-01", () => {
    const r = employeeCreateSchema.safeParse({ ...NEN, joinedAt: null });
    expect(r.success).toBe(true);
    expect(r.data?.joinedAt).toBeNull();
  });

  it("dateOfBirth = null ⇒ lưu null", () => {
    const r = employeeCreateSchema.safeParse({ ...NEN, dateOfBirth: null });
    expect(r.success).toBe(true);
    expect(r.data?.dateOfBirth).toBeNull();
  });

  it("chuỗi rỗng vẫn ra null (hành vi cũ, không được đổi)", () => {
    const r = employeeCreateSchema.safeParse({ ...NEN, joinedAt: "" });
    expect(r.success).toBe(true);
    expect(r.data?.joinedAt).toBeNull();
  });

  it("ngày THẬT vẫn được nhận và ép kiểu đúng", () => {
    const r = employeeCreateSchema.safeParse({ ...NEN, joinedAt: "2026-03-15" });
    expect(r.success).toBe(true);
    expect(r.data?.joinedAt).toBeInstanceOf(Date);
    expect((r.data?.joinedAt as Date).getUTCFullYear()).toBe(2026);
  });
});

describe("nguồn — khuôn sai không được quay lại", () => {
  const DIR = join(process.cwd(), "lib/validators");
  const files = readdirSync(DIR).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );

  it.each(files)("%s không đặt nhánh coerce trước z.null()", (f) => {
    const src = readFileSync(join(DIR, f), "utf8");
    // Bắt đúng hình dạng sai: union mở đầu bằng z.coerce.* rồi mới tới z.null().
    // Không bắt union chỉ có coerce (không nhận null) — đó là chuyện khác.
    const sai = [
      ...src.matchAll(/\.union\(\[\s*z\.coerce\.[^\]]*z\.null\(\)\s*\]\)/g),
    ].map((m) => m[0].slice(0, 60));
    expect(sai, `${f}: đặt z.null() lên đầu union`).toEqual([]);
  });

  it("có ít nhất một file thật sự dùng khuôn này — test không rỗng nghĩa", () => {
    // Chống ca test "xanh vì không tìm thấy gì": nếu ai đó đổi cách viết helper,
    // vòng lặp trên vẫn xanh dù không còn kiểm được gì. Neo bằng một mẫu dương.
    const co = files.filter((f) =>
      readFileSync(join(DIR, f), "utf8").includes("z.null(), z.literal("),
    );
    expect(co.length).toBeGreaterThan(0);
  });
});
