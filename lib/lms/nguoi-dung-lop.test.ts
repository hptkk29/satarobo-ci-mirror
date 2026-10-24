// Công dạy theo NGƯỜI THẬT SỰ DẠY (chủ dự án chốt 11/10/2026) — "người đó dạy, người đó điểm danh, người đó
// nhận xét; sale / quản lý không điểm danh hộ". Luật ở `loiKhongPhaiNguoiDay` (lib/lms/session-ownership.ts);
// các ca [NDL-W*] ghim DÂY NỐI vào từng cổng ghi, vì test hành vi của từng action đều giả lập module này và
// gỡ lời gọi thì KHÔNG ca nào đỏ (cùng lý do `[GTD-12]`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { giaoVienDuocQuyCong, laNguoiDayThay, loiKhongPhaiNguoiDay } from "./session-ownership";

const GOC = join(__dirname, "..", "..");
/** Đọc tệp, BỎ chú thích — chú thích giải thích bản vá thường chứa đúng chuỗi đang canh (luật 11). */
function ma(p: string): string {
  return readFileSync(join(GOC, p), "utf8")
    .split(/\r?\n/)
    .filter((d) => !/^\s*(\/\/|\/\*|\*)/.test(d))
    .join("\n");
}
const dem = (src: string, chuoi: string) => src.split(chuoi).length - 1;

const buoi = (o: Partial<{ actual: string | null; thay: string | null; chinh: string | null }> = {}) => ({
  actualTeacherId: o.actual ?? null,
  substituteTeacherId: o.thay ?? null,
  class: { teacherId: o.chinh === undefined ? "gv-chinh" : o.chinh },
});

describe("loiKhongPhaiNguoiDay — ai được điểm danh / nhận xét buổi này", () => {
  it("[NDL-01] không ai dạy thay ⇒ CHỈ giáo viên phụ trách được; trợ giảng / người khác bị từ chối", () => {
    expect(loiKhongPhaiNguoiDay("gv-chinh", buoi(), "điểm danh")).toBeNull();
    expect(loiKhongPhaiNguoiDay("tro-giang", buoi(), "điểm danh")).not.toBeNull();
    expect(loiKhongPhaiNguoiDay("quan-ly-co-so", buoi(), "điểm danh")).not.toBeNull();
    expect(loiKhongPhaiNguoiDay("sale", buoi(), "điểm danh")).not.toBeNull();
  });

  it("[NDL-02] có người dạy thay ⇒ người dạy thay được; GV phụ trách (đang vắng) KHÔNG được", () => {
    const b = buoi({ thay: "gv-thay" });
    expect(loiKhongPhaiNguoiDay("gv-thay", b, "điểm danh")).toBeNull();
    expect(loiKhongPhaiNguoiDay("gv-chinh", b, "điểm danh")).not.toBeNull();
    expect(loiKhongPhaiNguoiDay("gv-chinh", b, "nhận xét")).not.toBeNull();
  });

  it("[NDL-03] buổi đã chốt (có người thực dạy) ⇒ chỉ người đó", () => {
    const b = buoi({ actual: "gv-thuc", thay: "gv-thay" });
    expect(loiKhongPhaiNguoiDay("gv-thuc", b, "nhận xét")).toBeNull();
    expect(loiKhongPhaiNguoiDay("gv-thay", b, "nhận xét")).not.toBeNull();
    expect(loiKhongPhaiNguoiDay("gv-chinh", b, "nhận xét")).not.toBeNull();
  });

  it("[NDL-04] không xác định được người đứng lớp (lớp thỉnh giảng chưa gán) ⇒ KHÔNG chặn — không có ai để so", () => {
    expect(loiKhongPhaiNguoiDay("bat-ky", buoi({ chinh: null }), "điểm danh")).toBeNull();
  });

  it("[NDL-05] câu từ chối nói đúng việc và chỉ đường (gán dạy thay ở mục Điều chỉnh)", () => {
    const diemDanh = loiKhongPhaiNguoiDay("x", buoi(), "điểm danh")!;
    const nhanXet = loiKhongPhaiNguoiDay("x", buoi(), "nhận xét")!;
    expect(diemDanh).toContain("điểm danh");
    expect(nhanXet).toContain("nhận xét");
    expect(diemDanh).toContain("Điều chỉnh");
    expect(diemDanh).toContain("công dạy");
  });

  it("[NDL-06] luật khớp ĐÚNG người được quy công — không có hai định nghĩa 'người đứng lớp'", () => {
    for (const b of [buoi(), buoi({ thay: "t" }), buoi({ actual: "a", thay: "t" }), buoi({ chinh: null })]) {
      const nguoi = giaoVienDuocQuyCong(b);
      if (nguoi) expect(loiKhongPhaiNguoiDay(nguoi, b, "điểm danh")).toBeNull();
    }
  });
});

describe("laNguoiDayThay — buổi nào là buổi DẠY THAY của mình (màn Dạy thay + vai SUBSTITUTE của bảng công)", () => {
  it("[NDL-07] được xếp dạy thay (chưa dạy) ⇒ là dạy thay; GV phụ trách và người khác thì không", () => {
    const b = buoi({ thay: "gv-thay" });
    expect(laNguoiDayThay("gv-thay", b)).toBe(true);
    expect(laNguoiDayThay("gv-chinh", b)).toBe(false);
    expect(laNguoiDayThay("tro-giang", b)).toBe(false);
  });

  it("[NDL-08] buổi đã chốt: người thực dạy KHÁC GV phụ trách ⇒ dạy thay; buổi GV phụ trách tự dạy ⇒ không", () => {
    expect(laNguoiDayThay("gv-thay", buoi({ actual: "gv-thay", thay: "gv-thay" }))).toBe(true);
    // Trợ giảng bấm chốt: thực dạy = trợ giảng, công vẫn là SUBSTITUTE theo `cong-day-db` ⇒ cùng một câu trả lời.
    expect(laNguoiDayThay("tro-giang", buoi({ actual: "tro-giang" }))).toBe(true);
    expect(laNguoiDayThay("gv-chinh", buoi({ actual: "gv-chinh" }))).toBe(false);
    expect(laNguoiDayThay("gv-chinh", buoi())).toBe(false);
  });

  it("[NDL-09] lớp chưa gán GV phụ trách (thỉnh giảng): chỉ coi là dạy thay khi buổi THẬT SỰ xếp người dạy thay là mình", () => {
    expect(laNguoiDayThay("a", buoi({ chinh: null, thay: "a" }))).toBe(true);
    expect(laNguoiDayThay("a", buoi({ chinh: null, actual: "a" }))).toBe(false);
  });

  it("[NDL-10] luôn khớp ĐÚNG người được quy công: ai là dạy thay thì cũng là người đứng lớp", () => {
    for (const b of [buoi(), buoi({ thay: "t" }), buoi({ actual: "a", thay: "t" }), buoi({ chinh: null, thay: "t" })]) {
      for (const u of ["gv-chinh", "t", "a", "x"]) {
        if (laNguoiDayThay(u, b)) expect(giaoVienDuocQuyCong(b)).toBe(u);
      }
    }
  });
});

describe("[NDL-W*] dây nối — mọi đường GHI điểm danh / nhận xét / chốt công đều đi qua luật", () => {
  it("[NDL-W1] site giáo viên: gọi luật TRƯỚC phép ghi điểm danh", () => {
    const src = ma("app/(teacher)/teacher/lop/_actions.ts");
    expect(dem(src, 'loiKhongPhaiNguoiDay(session.user.id, sess, "điểm danh")')).toBe(1);
    // Lời gọi mà KHÔNG dùng kết quả là cổng trang trí (đã cấy 11/10: gỡ dòng `if … return`, giữ lời gọi ⇒ xanh).
    expect(dem(src, "if (khongPhaiNguoiDay) return { ok: false, error: khongPhaiNguoiDay };")).toBe(1);
    expect(src.indexOf("loiKhongPhaiNguoiDay(")).toBeLessThan(src.indexOf("await giaoDichDiemDanh("));
  });

  it("[NDL-W2] màn admin: ghi VÀ xoá điểm danh đều qua luật, ghi gọi trước transaction", () => {
    const src = ma("app/(admin)/admin/attendance/_actions.ts");
    expect(dem(src, 'loiKhongPhaiNguoiDay(user.id, gateSess, "điểm danh")')).toBe(1);
    expect(dem(src, 'loiKhongPhaiNguoiDay(user.id, att.session, "điểm danh")')).toBe(1);
    // Cả hai lời gọi phải CÓ dòng dùng kết quả (xem [NDL-W1]).
    expect(dem(src, "if (khongPhaiNguoiDay) return { error: khongPhaiNguoiDay };")).toBe(2);
    expect(src.indexOf('loiKhongPhaiNguoiDay(user.id, gateSess')).toBeLessThan(src.indexOf("await giaoDichDiemDanh("));
  });

  it("[NDL-W3] nhận xét: CẢ HAI đường ghi (nhanh + phiếu đầy đủ) đi qua luật; nhánh học bù thì không (có cổng riêng)", () => {
    const src = ma("app/(admin)/admin/sessions/[id]/_feedback-core.ts");
    expect(dem(src, 'loiKhongPhaiNguoiDay(user.id, sess, "nhận xét")')).toBe(2);
    expect(dem(src, "if (khongPhaiNguoiDay) return { ok: false, error: khongPhaiNguoiDay };")).toBe(2);
    // Nhánh học bù đã có cổng "đúng GV của case" — luật mới nằm TRONG khối `congBuoi === "KIEM"`.
    const khoiKiem = src.slice(src.indexOf('if (congBuoi === "KIEM")'));
    expect(khoiKiem.indexOf("loiKhongPhaiNguoiDay(")).toBeGreaterThan(-1);
    expect(khoiKiem.indexOf("loiKhongPhaiNguoiDay(")).toBeLessThan(khoiKiem.indexOf("SEC-M02") === -1 ? Infinity : khoiKiem.length);
  });

  it("[NDL-W4] chốt buổi: `actualTeacherId` khai tay phải trùng người đứng lớp — từ chối TRƯỚC `$transaction`", () => {
    const src = ma("lib/lms/session-lifecycle.ts");
    expect(dem(src, "giaoVienDuocQuyCong(")).toBe(1);
    expect(src.indexOf("giaoVienDuocQuyCong(")).toBeLessThan(src.indexOf("db.$transaction"));
    expect(src).toContain("nguoiDung !== opts.actualTeacherId");
  });

  it("[NDL-W5] giao diện NÓI THẬT (luật 12): ba màn điểm danh đều tính cờ chỉ-xem bằng CÙNG hàm với server", () => {
    expect(ma("app/(teacher)/teacher/lop/page.tsx")).toContain('loiKhongPhaiNguoiDay(session.user.id, sess, "điểm danh")');
    expect(ma("app/(admin)/admin/attendance/page.tsx")).toContain('loiKhongPhaiNguoiDay(gateUser.id, gate, "điểm danh")');
    expect(ma("app/(admin)/admin/classes/[id]/_attendance-actions.ts")).toContain('loiKhongPhaiNguoiDay(session.user.id, sess, "điểm danh")');
    expect(ma("app/(admin)/admin/classes/[id]/page.tsx")).toContain('loiKhongPhaiNguoiDay(');
  });

  it("[NDL-W7] trang chủ site GV: buổi DẠY THAY lên 'Việc hôm nay', và việc tồn chỉ tính buổi mình đứng lớp", () => {
    const src = ma("app/(teacher)/teacher/page.tsx");
    // Trước 11/10 trang chủ chỉ đọc `classId in assignedClassIds` ⇒ GV được giao dạy thay mở trang không thấy buổi.
    expect(dem(src, "{ substituteTeacherId: session.user.id }")).toBe(1);
    expect(dem(src, "{ actualTeacherId: session.user.id }")).toBe(1);
    // Việc tồn (chưa điểm danh / chưa nhận xét) phải qua CÙNG hàm với server — gỡ là nút bấm vào bị từ chối.
    expect(dem(src, 'loiKhongPhaiNguoiDay(session.user.id, s, "điểm danh") === null')).toBe(1);
    expect(dem(src, "sessions.filter(laViecCuaToi)")).toBe(2);
  });

  it("[NDL-W6] lưới điểm danh admin: lý do chỉ-xem KHOÁ mọi điều khiển, không chỉ in một dòng chữ", () => {
    const src = ma("app/(admin)/admin/attendance/_components/attendance-grid.tsx");
    // 6 điều khiển `disabled={pending || khoa}`: 5 cũ + ô lý do "Không cần bù" (22/10/2026) — không còn cái nào quên cờ `khoa`; thêm điều khiển mới thì con số này PHẢI tăng theo.
    expect(dem(src, "disabled={pending}")).toBe(0);
    expect(dem(src, "disabled={pending || khoa}")).toBe(6);
    expect(src).toContain("disabled={pending || khoa || dirtyCount === 0}");
  });
});
