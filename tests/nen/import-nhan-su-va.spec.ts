// @vitest-environment node
/**
 * Nhập nhân sự: đường CẬP NHẬT là VÁ, không phải THAY THẾ (08/09/2026) — trên Postgres thật.
 *
 * Bộ thuần `lib/hr/import-patch.test.ts` chứng minh PATCH chỉ chứa cột có trong file.
 * Bộ này chứng minh nốt vế còn lại: áp patch đó lên một hồ sơ ĐỦ DỮ LIỆU thì mọi trường
 * khác GIỮ NGUYÊN trong DB — tức Prisma `update` thật sự không đụng cột vắng mặt.
 *
 * Vì sao đáng chạy chạm DB: lỗi cũ (`update: base`) trông hoàn toàn bình thường khi đọc
 * mã. Chỉ khi so hàng TRƯỚC/SAU mới thấy phone, email, ngày vào làm, môn dạy biến mất.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`, không TRUNCATE. Dọn theo tiền tố `CI_IMP_`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { db } from "../../lib/db";
import { assertTestDb, disconnectDb } from "../e2e/_helpers/seed";
import { dungPatchNhanSu } from "../../lib/hr/import-patch";

const TAG = "CI_IMP_";
const MA = `${TAG}NV001`;

const isLocal = (() => {
  try {
    assertTestDb();
    return true;
  } catch {
    return false;
  }
})();
const d = isLocal ? describe : describe.skip;

d("nhập nhân sự — cập nhật là VÁ", () => {
  let centerA = "";
  let centerB = "";

  async function don() {
    await db.employee.deleteMany({
      where: { employeeCode: { startsWith: TAG } },
    });
    await db.center.deleteMany({ where: { code: { startsWith: TAG } } });
  }

  beforeAll(async () => {
    await don();
    centerA = (
      await db.center.create({
        data: {
          slug: `${TAG.toLowerCase()}a`,
          name: "CS A",
          address: "x",
          code: `${TAG}A`,
        },
        select: { id: true },
      })
    ).id;
    centerB = (
      await db.center.create({
        data: {
          slug: `${TAG.toLowerCase()}b`,
          name: "CS B",
          address: "x",
          code: `${TAG}B`,
        },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await don();
    await disconnectDb();
  });

  it("file 2 cột lên hồ sơ ĐỦ DỮ LIỆU: chỉ cơ sở đổi, mọi trường khác nguyên vẹn", async () => {
    const truoc = await db.employee.create({
      data: {
        employeeCode: MA,
        fullName: "Nguyễn Văn A",
        jobTitle: "Giáo viên",
        department: "DAO_TAO",
        status: "ACTIVE",
        isActive: true,
        phone: "0900000001",
        email: `${TAG.toLowerCase()}a@x.test`,
        nationalId: "0123456789",
        address: "Đà Nẵng",
        bio: "tiểu sử",
        notes: "ghi chú",
        emergencyContact: "0911111111",
        joinedAt: new Date("2024-01-02T00:00:00Z"),
        dateOfBirth: new Date("1995-05-05T00:00:00Z"),
        subjects: ["Robotics", "Scratch"],
        certifications: ["ABC"],
        centerId: centerA,
      },
    });

    // ⚠️ FIXTURE PHẢI MANG HÌNH DẠNG THẬT (luật 4). Bản đầu của test này dựng `giaTri`
    // từ CHÍNH hàng cũ (`{ ...truoc }`), nên ghi lại đúng giá trị cũ và test XANH kể cả
    // khi cấy lại lỗi `update: base` — nó không kiểm được gì.
    //
    // Route KHÔNG dựng `base` từ hàng trong DB; nó dựng từ HÀNG TRONG FILE. Với file 2
    // cột thì Zod trả `undefined` cho ba trường bắt buộc và `null` cho phần còn lại —
    // đó mới là thứ suýt được ghi đè.
    const giaTri = {
      fullName: undefined,
      jobTitle: undefined,
      department: undefined,
      status: undefined,
      isActive: false,
      phone: null,
      email: null,
      dateOfBirth: null,
      gender: null,
      nationalId: null,
      contractType: null,
      joinedAt: null,
      endDate: null,
      address: null,
      subjects: [],
      certifications: [],
      bio: null,
      emergencyContact: null,
      notes: null,
      managerId: null,
      centerId: centerB,
      orgUnitId: null,
    } as Record<string, unknown>;
    const patch = dungPatchNhanSu(
      giaTri,
      new Set(["employeeCode", "centerSlug"]),
    );
    await db.employee.update({ where: { employeeCode: MA }, data: patch });

    const sau = await db.employee.findUniqueOrThrow({
      where: { employeeCode: MA },
    });

    expect(sau.centerId).toBe(centerB); // thứ DUY NHẤT được phép đổi

    expect(sau.fullName).toBe(truoc.fullName);
    expect(sau.jobTitle).toBe(truoc.jobTitle);
    expect(sau.department).toBe(truoc.department);
    expect(sau.phone).toBe(truoc.phone);
    expect(sau.email).toBe(truoc.email);
    expect(sau.nationalId).toBe(truoc.nationalId);
    expect(sau.address).toBe(truoc.address);
    expect(sau.bio).toBe(truoc.bio);
    expect(sau.notes).toBe(truoc.notes);
    expect(sau.emergencyContact).toBe(truoc.emergencyContact);
    expect(sau.joinedAt?.toISOString()).toBe(truoc.joinedAt?.toISOString());
    expect(sau.dateOfBirth?.toISOString()).toBe(
      truoc.dateOfBirth?.toISOString(),
    );
    expect(sau.subjects).toEqual(["Robotics", "Scratch"]);
    expect(sau.certifications).toEqual(["ABC"]);
  });

  it("hồ sơ ĐÃ NGHỈ + file thiếu cột status ⇒ VẪN nghỉ, không bị hồi sinh", async () => {
    await db.employee.update({
      where: { employeeCode: MA },
      data: { status: "RESIGNED", isActive: false },
    });

    const giaTri = {
      // `status`/`isActive` mà route dựng khi file THIẾU cột status: Zod trả undefined.
      status: undefined,
      isActive: false,
      centerId: centerA,
      orgUnitId: null,
    } as Record<string, unknown>;
    const patch = dungPatchNhanSu(
      giaTri,
      new Set(["employeeCode", "centerSlug"]),
    );
    await db.employee.update({ where: { employeeCode: MA }, data: patch });

    const sau = await db.employee.findUniqueOrThrow({
      where: { employeeCode: MA },
    });
    expect(sau.status).toBe("RESIGNED");
    expect(sau.isActive).toBe(false);
    expect(sau.centerId).toBe(centerA);
  });
});
