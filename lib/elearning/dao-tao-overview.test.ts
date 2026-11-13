import { describe, it, expect } from "vitest";
import type { ScopedDb } from "@/lib/actions/factory";
import { napTongQuanDaoTao, type QuyenTongQuan } from "./dao-tao-overview";

const NOW = new Date("2026-10-25T03:00:00.000Z");

/** DB giả: ghi lại từng lời gọi `count` (bảng + where) và trả số cố định theo bảng/where. */
function dbGia() {
  const goi: { bang: string; where: unknown }[] = [];
  const dem = (bang: string, tra: (w: Record<string, unknown>) => number) => ({
    count: async ({ where }: { where: Record<string, unknown> }) => {
      goi.push({ bang, where });
      return tra(where);
    },
  });
  const db = {
    trnSubmission: dem("trnSubmission", (w) => ("dueGradeAt" in w ? 2 : 5)),
    trnExamAttempt: dem("trnExamAttempt", () => 3),
    trnAssignment: dem("trnAssignment", () => 4),
    trnCourse: dem("trnCourse", (w) => (w.status === "DRAFT" ? 6 : 7)),
    trnEnrollment: dem("trnEnrollment", (w) => (w.status === "OVERDUE" ? 8 : 9)),
  } as unknown as ScopedDb;
  return { db, goi };
}

const KHONG: QuyenTongQuan = { cham: false, giao: false, soan: false, baoCao: false };

describe("[DT-OV-01] mỗi khối chỉ chạy khi có đúng quyền — không lộ số liệu", () => {
  it("không quyền nào ⇒ KHÔNG truy vấn nào, kết quả rỗng", async () => {
    const { db, goi } = dbGia();
    expect(await napTongQuanDaoTao(db, KHONG, NOW)).toEqual({});
    expect(goi).toEqual([]);
  });

  it("chỉ `exam:grade` ⇒ chỉ khối chấm; KHÔNG chạm lượt giao/khoá/lượt học", async () => {
    const { db, goi } = dbGia();
    const r = await napTongQuanDaoTao(db, { ...KHONG, cham: true }, NOW);
    expect(r).toEqual({ cham: { taoChoCham: 5, taoQuaHanCham: 2, thiChoCham: 3 } });
    expect(new Set(goi.map((g) => g.bang))).toEqual(new Set(["trnSubmission", "trnExamAttempt"]));
  });

  it("chỉ `content:author` ⇒ khoá nháp/đã xuất bản, KHÔNG có số lượt quá hạn toàn hệ", async () => {
    const { db, goi } = dbGia();
    const r = await napTongQuanDaoTao(db, { ...KHONG, soan: true }, NOW);
    expect(r).toEqual({ soan: { khoaNhap: 6, khoaDaXuatBan: 7 } });
    expect(r.tienDo).toBeUndefined();
    expect(goi.some((g) => g.bang === "trnEnrollment")).toBe(false);
  });

  it("`progress:view-all` mới có số lượt quá hạn", async () => {
    const { db } = dbGia();
    expect(await napTongQuanDaoTao(db, { ...KHONG, baoCao: true }, NOW)).toEqual({
      tienDo: { luotQuaHan: 8, luotDangHoc: 9 },
    });
  });

  it("`assignment:create` ⇒ số lượt giao đang mở (kể cả 0 vẫn có khối)", async () => {
    const { db } = dbGia();
    expect(await napTongQuanDaoTao(db, { ...KHONG, giao: true }, NOW)).toEqual({ giao: { luotGiaoDangMo: 4 } });
  });

  it("'quá hạn chấm' dùng đúng mốc `now` truyền vào (không đọc đồng hồ thật)", async () => {
    const { db, goi } = dbGia();
    await napTongQuanDaoTao(db, { ...KHONG, cham: true }, NOW);
    const qua = goi.find((g) => "dueGradeAt" in (g.where as object));
    expect(qua?.where).toEqual({ status: "SUBMITTED", dueGradeAt: { lt: NOW } });
  });

  it("đủ quyền ⇒ đúng 8 lời gọi count, cố định", async () => {
    const { db, goi } = dbGia();
    await napTongQuanDaoTao(db, { cham: true, giao: true, soan: true, baoCao: true }, NOW);
    expect(goi).toHaveLength(8);
  });
});
