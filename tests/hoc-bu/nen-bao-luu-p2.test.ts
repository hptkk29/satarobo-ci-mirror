// tests/hoc-bu/nen-bao-luu-p2.test.ts — NỀN DỮ LIỆU BẢO LƯU P2 trong bản release Học bù lên main, trên Postgres THẬT.
//
// Chạy:  pnpm test:hoc-bu-db
// Main chưa có mã ứng dụng Bảo lưu, nên nền P2 (cột/bảng/chỉ mục mới) phải TRƠ với mã bảo lưu CŨ: tạo hồ sơ bằng đúng hình dạng dữ liệu cũ vẫn chạy,
// và đóng hồ sơ theo đúng cách mã cũ đóng (CÓ `status: "ENDED"` sau bản vá 11/10) không làm bảo lưu lại cùng ghi danh ném P2002.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "@/tests/_helpers/db-gate";
import { HV, don, dung, id } from "./_case-nhieu-bai-fixture";

if (!RUN_DB_TESTS) console.warn(`[NBL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const GHI_DANH = id("gd-A");
// Hình dạng dữ liệu của mã bảo lưu CŨ (students/_actions.ts · lib/students/reserve-service.ts): KHÔNG khai cột nào của nền P2.
const moLuotCu = () =>
  db.studentReserve.create({
    data: { studentId: HV.A, enrollmentId: GHI_DANH, reason: "nền P2", createdByName: "test", isActive: true },
    select: { id: true, status: true, type: true, approvedAt: true, extendCount: true },
  });

describe.skipIf(!RUN_DB_TESTS)("[NBL] nền Bảo lưu P2 trơ với mã bảo lưu cũ", () => {
  beforeEach(() => dung());
  afterAll(don);

  it("[NBL-01] mở hồ sơ bằng hình dạng dữ liệu CŨ vẫn chạy: status ACTIVE, type PARENT, approvedAt NULL (⇒ cổng BR-09 của Học bù KHÔNG kích hoạt)", async () => {
    const r = await moLuotCu();
    expect(r).toMatchObject({ status: "ACTIVE", type: "PARENT", approvedAt: null, extendCount: 0 });
    // Đối chứng dương: một hồ sơ đời MỚI (approvedAt có giá trị) thì mới thoả điều kiện BR-09 — để chắc ca trên không xanh vì lý do sai.
    const { dieuKienBaoLuuTaiNgay } = await import("@/lib/bao-luu/dieu-kien-bao-luu");
    const ngay = new Date();
    expect(await db.studentReserve.count({ where: { id: r.id, ...dieuKienBaoLuuTaiNgay(ngay) } })).toBe(0);
    await db.studentReserve.update({ where: { id: r.id }, data: { approvedAt: new Date(Date.now() - 86_400_000), startedAt: new Date(Date.now() - 86_400_000) } });
    expect(await db.studentReserve.count({ where: { id: r.id, ...dieuKienBaoLuuTaiNgay(ngay) } })).toBe(1);
  });

  it("[NBL-02] đóng hồ sơ NHƯ MÃ CŨ ĐÃ VÁ (isActive=false + endedAt + status ENDED) ⇒ bảo lưu lại cùng ghi danh được", async () => {
    const r = await moLuotCu();
    await db.studentReserve.update({ where: { id: r.id }, data: { isActive: false, status: "ENDED", endedAt: new Date() } });
    const lai = await moLuotCu();
    expect(lai.id).not.toBe(r.id);
  });

  it("[NBL-03] ĐỐI CHỨNG — lý do mọi chỗ đóng phải đặt ENDED: đóng KHÔNG đặt status ⇒ hồ sơ vẫn 'mở' trong chỉ mục duy nhất từng phần ⇒ P2002", async () => {
    const r = await moLuotCu();
    await db.studentReserve.update({ where: { id: r.id }, data: { isActive: false, endedAt: new Date() } }); // thiếu status
    const loi = await moLuotCu().then(
      () => null,
      (e: unknown) => e,
    );
    expect(loi).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((loi as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
  });
});
