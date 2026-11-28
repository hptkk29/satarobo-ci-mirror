// @vitest-environment node
/**
 * [SKL-*] `napDanhSachSoanKhoa` — các cột của thiết kế `QtKhoaHoc.html`: Chương · bài, Đang giao, người soạn, Cập nhật.
 * DB giả CHỈ để chứng minh phép GỘP (số bài từ các chương, lượt đang mở gộp theo khoá, tên người) và số truy vấn cố định.
 */
import { describe, expect, it } from "vitest";
import type { ScopedDb } from "@/lib/actions/factory";
import { napDanhSachSoanKhoa } from "./soan-khoa-view";

const T = new Date("2026-11-15T03:00:00.000Z");

function dbGia(khoa: unknown[], dang: { courseId: string; _count: { _all: number } }[] = [], nguoi: { id: string; name: string }[] = []) {
  const goi: string[] = [];
  const dem = <R,>(ten: string, kq: R) => async (arg?: unknown) => {
    goi.push(ten);
    last[ten] = arg;
    return kq;
  };
  const last: Record<string, unknown> = {};
  const db = {
    trnCourse: { findMany: dem("khoa", khoa) },
    trnEnrollment: { groupBy: dem("luot", dang) },
    user: { findMany: dem("nguoi", nguoi) },
  } as unknown as ScopedDb;
  return { db, goi, last };
}

const khoa = (id: string, o: Record<string, unknown> = {}) => ({
  id,
  code: `K-${id}`,
  title: `Khoá ${id}`,
  status: "PUBLISHED",
  updatedAt: T,
  ownerUserId: null,
  createdById: null,
  program: { code: "CT", title: "Chương trình A" },
  _count: { modules: 2 },
  modules: [{ _count: { lessons: 3 } }, { _count: { lessons: 4 } }],
  versions: [{ status: "PUBLISHED" }],
  ...o,
});

describe("[SKL-01] gộp cột của danh sách khoá", () => {
  it("số bài = cộng bài (chưa xoá) của mọi chương; số chương từ đếm module; chương trình lấy TÊN", async () => {
    const { db } = dbGia([khoa("a")]);
    const [k] = await napDanhSachSoanKhoa(db);
    expect(k).toMatchObject({ soChuong: 2, soBai: 7, chuongTrinh: "Chương trình A", capNhatLuc: T });
  });
  it("🔴 'Đang giao' lấy ĐÚNG số của từng khoá từ truy vấn gộp (khoá không có lượt ⇒ 0, không lẫn khoá khác)", async () => {
    const { db } = dbGia([khoa("a"), khoa("b")], [{ courseId: "a", _count: { _all: 6 } }]);
    const ds = await napDanhSachSoanKhoa(db);
    expect(ds.find((k) => k.id === "a")?.dangGiao).toBe(6);
    expect(ds.find((k) => k.id === "b")?.dangGiao).toBe(0);
  });
  it("🔴 chỉ đếm lượt ĐANG MỞ: truy vấn gộp lọc đúng ba trạng thái (không có hoàn thành / thu hồi)", async () => {
    const { db, last } = dbGia([khoa("a")]);
    await napDanhSachSoanKhoa(db);
    const arg = last.luot as { where: { courseId: { in: string[] }; status: { in: string[] } } };
    expect(arg.where.status.in.sort()).toEqual(["IN_PROGRESS", "NOT_STARTED", "OVERDUE"]);
    expect(arg.where.courseId.in).toEqual(["a"]);
  });
  it("người soạn: ưu tiên chủ sở hữu, rơi về người tạo; không có ai ⇒ null", async () => {
    const { db } = dbGia(
      [khoa("a", { ownerUserId: "u1", createdById: "u2" }), khoa("b", { createdById: "u2" }), khoa("c")],
      [],
      [{ id: "u1", name: "Chủ" }, { id: "u2", name: "Người tạo" }],
    );
    const ds = await napDanhSachSoanKhoa(db);
    expect(ds.map((k) => k.nguoiSoan)).toEqual(["Chủ", "Người tạo", null]);
  });
});

describe("[SKL-02] số truy vấn cố định", () => {
  it("1 khoá và 100 khoá: cùng 3 truy vấn", async () => {
    const a = dbGia([khoa("a")]);
    const b = dbGia(Array.from({ length: 100 }, (_, i) => khoa(`k${i}`, { createdById: "u1" })), [], [{ id: "u1", name: "X" }]);
    await napDanhSachSoanKhoa(a.db);
    await napDanhSachSoanKhoa(b.db);
    expect(b.goi.length).toBe(3);
    expect(a.goi.filter((g) => g !== "nguoi").length).toBe(2); // không có người nào để tra ⇒ bỏ truy vấn tên
  });
  it("không khoá ⇒ một truy vấn, trả rỗng", async () => {
    const { db, goi } = dbGia([]);
    expect(await napDanhSachSoanKhoa(db)).toEqual([]);
    expect(goi).toEqual(["khoa"]);
  });
});
