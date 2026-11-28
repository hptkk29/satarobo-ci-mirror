/**
 * [CV-*] Xem chứng nhận: MỘT mô hình cho trang xem và bản PDF; nhãn sắp hết hạn; liên kết học lại. Ngày TUYỆT ĐỐI (luật 19).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ScopedDb } from "@/lib/actions/factory";
import { moHinhChungNhan, napChungNhanXem, napDanhSachChungNhanCuaToi, nhanSapHetHan, type ChungNhanDoc } from "./certificate-view";

const NOW = new Date("2026-11-17T03:00:00.000Z");
const ngay = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const CN: ChungNhanDoc = {
  id: "c1",
  userId: "u1",
  certCode: "SR.CN.2026.00001",
  verifyToken: "tok",
  snapFullName: "Nguyễn Văn A",
  snapEmployeeCode: "NV001",
  issuedAt: new Date("2026-10-01T03:00:00.000Z"),
  validUntil: ngay(20),
  revokedAt: null,
  status: "VALID",
  courseId: "k1",
};

describe("[CV-01] moHinhChungNhan — nguồn chung của trang xem và PDF", () => {
  it("các trường in ra lấy từ ảnh chụp lúc cấp (snap*), không join sống", () => {
    const m = moHinhChungNhan(CN, "An toàn điện", NOW);
    expect(m).toMatchObject({
      studentName: "Nguyễn Văn A",
      studentCode: "NV001",
      courseName: "An toàn điện",
      certificateCode: "SR.CN.2026.00001",
      trangThai: "VALID",
    });
    expect(m.completedAt).toBe(CN.issuedAt.toLocaleDateString("vi-VN"));
  });
  it("khoá đã gỡ ⇒ nói đúng điều đó, không để trống", () => {
    expect(moHinhChungNhan(CN, null, NOW).courseName).toContain("đã bị gỡ");
  });
  it("tờ in ghi cả hết hạn / thu hồi (không im lặng)", () => {
    expect(moHinhChungNhan({ ...CN, validUntil: ngay(-1) }, "K", NOW).validityLine).toContain("Đã hết hiệu lực");
    expect(moHinhChungNhan({ ...CN, status: "REVOKED", revokedAt: ngay(-2) }, "K", NOW).trangThai).toBe("REVOKED");
  });
});

describe("[CV-02] nhanSapHetHan", () => {
  const v = (n: number | null, trangThai: "VALID" | "EXPIRED" | "REVOKED" = "VALID") => ({
    trangThai,
    validUntil: n === null ? null : ngay(n),
  });
  it("trong ngưỡng 30 ngày ⇒ 'Hết hạn sau N ngày'", () => {
    expect(nhanSapHetHan(v(15), NOW)).toBe("Hết hạn sau 15 ngày");
    expect(nhanSapHetHan(v(30), NOW)).toBe("Hết hạn sau 30 ngày");
  });
  it("ngoài ngưỡng, vô thời hạn, đã hết hạn, thu hồi ⇒ null", () => {
    expect(nhanSapHetHan(v(31), NOW)).toBeNull();
    expect(nhanSapHetHan(v(null), NOW)).toBeNull();
    expect(nhanSapHetHan(v(-3, "EXPIRED"), NOW)).toBeNull();
    expect(nhanSapHetHan(v(10, "REVOKED"), NOW)).toBeNull();
  });
});

describe("[CV-03] napChungNhanXem — userId nằm trong where", () => {
  it("truyền cả certCode và userId vào MỘT câu tra (không đọc rồi so sau)", async () => {
    let where: unknown = null;
    const db = {
      trnCertificate: {
        findFirst: async (a: { where: unknown }) => {
          where = a.where;
          return null;
        },
      },
    } as unknown as ScopedDb;
    expect(await napChungNhanXem(db, { certCode: "X", userId: "u9" })).toBeNull();
    expect(where).toEqual({ certCode: "X", userId: "u9" });
  });
});

describe("[CV-04] napDanhSachChungNhanCuaToi — số truy vấn cố định + học lại", () => {
  function dbGia(so: number) {
    let goi = 0;
    const dem = <T,>(kq: T) => async () => {
      goi += 1;
      return kq;
    };
    const cn = Array.from({ length: so }, (_, i) => ({
      id: `c${i}`, certCode: `S${i}`, courseId: `k${i}`, issuedAt: NOW, validUntil: null, revokedAt: null, status: "VALID", enrollmentId: `e${i}`,
    }));
    const db = {
      trnCertificate: { findMany: dem(cn) },
      trnCourse: { findMany: dem(cn.map((c) => ({ id: c.courseId, title: c.courseId }))) },
      trnEnrollment: { findMany: dem([{ id: "moi", courseId: "k0" }]) },
    } as unknown as ScopedDb;
    return { db, so: () => goi };
  }
  it("1 và 100 chứng nhận cùng số lời gọi; chỉ khoá k0 có lượt học lại", async () => {
    const a = dbGia(1);
    const b = dbGia(100);
    const ra = await napDanhSachChungNhanCuaToi(a.db, "u", NOW);
    const rb = await napDanhSachChungNhanCuaToi(b.db, "u", NOW);
    expect(a.so()).toBe(b.so());
    expect(ra[0]!.luotHocLaiId).toBe("moi");
    expect(rb[1]!.luotHocLaiId).toBeNull();
  });
  it("lượt đang mở CHÍNH LÀ lượt sinh ra chứng nhận ⇒ không tính là học lại", async () => {
    const { db } = dbGia(1);
    (db as unknown as { trnEnrollment: { findMany: () => Promise<unknown> } }).trnEnrollment.findMany = async () => [{ id: "e0", courseId: "k0" }];
    expect((await napDanhSachChungNhanCuaToi(db, "u", NOW))[0]!.luotHocLaiId).toBeNull();
  });
  it("không chứng nhận ⇒ rỗng, không truy vấn gì thêm", async () => {
    const { db, so } = dbGia(0);
    expect(await napDanhSachChungNhanCuaToi(db, "u", NOW)).toEqual([]);
    expect(so()).toBe(1);
  });
});

describe("[CV-W1] ghim dây nối: trang xem VÀ bản PDF cùng đi qua moHinhChungNhan", () => {
  // Bỏ chú thích trước khi tìm LỜI GỌI (chú thích giải thích bản vá thường chứa đúng chuỗi đang tìm) — luật 11.
  const doc = (f: string) =>
    readFileSync(resolve(process.cwd(), f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  it("route PDF gọi moHinhChungNhan( đúng 1 lần và không tự dựng cauTrangThai", () => {
    const t = doc("app/api/elearning/chung-nhan/route.ts");
    expect(t.match(/moHinhChungNhan\(/g)?.length).toBe(1);
    expect(t).not.toMatch(/cauTrangThai\(/);
  });
  it("trang xem gọi moHinhChungNhan( đúng 1 lần", () => {
    const t = doc("app/(elearning)/elearning/chung-nhan-cua-toi/[certCode]/page.tsx");
    expect(t.match(/moHinhChungNhan\(/g)?.length).toBe(1);
  });
});
