// @vitest-environment node
/**
 * Ai thấy Phiếu nhu cầu nào (hotfix 26/10/2026) — phần THUẦN và lưới dây nối vào trang.
 *
 * Người chỉ ĐỀ NGHỊ đào tạo giữ chức năng gửi phiếu, nhưng chỉ theo dõi phiếu CỦA MÌNH; danh sách phiếu của người khác thuộc người
 * duyệt (`elearning:program:manage`). Phần chạm DB (scopedDb + dữ liệu thật) ở tests/elearning/phieu-nhu-cau-quyen.test.ts.
 *
 * Lưới nguồn neo vào LỜI GỌI và BIỂU THỨC (không vào chỗ đặt chữ), và chỉ đọc mã ĐÃ BỎ CHÚ THÍCH.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dieuKienPhieuXem } from "./training-need";

const chiMa = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const TRANG = chiMa(readFileSync(join(process.cwd(), "app/(elearning)/elearning/chuong-trinh/page.tsx"), "utf8"));

describe("dieuKienPhieuXem", () => {
  it("[PX-01] người quản lý: mọi phiếu chưa xoá, KHÔNG lọc theo người đề nghị", () => {
    expect(dieuKienPhieuXem({ quanLy: true, userId: "u1" })).toEqual({ deletedAt: null });
  });

  it("[PX-02] người chỉ đề nghị: chỉ phiếu do CHÍNH họ gửi", () => {
    expect(dieuKienPhieuXem({ quanLy: false, userId: "u1" })).toEqual({ deletedAt: null, requesterUserId: "u1" });
  });

  it("[PX-03] hai người đề nghị khác nhau ⇒ hai điều kiện khác nhau (không dính nhau qua tham chiếu dùng chung)", () => {
    const a = dieuKienPhieuXem({ quanLy: false, userId: "u1" });
    const b = dieuKienPhieuXem({ quanLy: false, userId: "u2" });
    expect(a.requesterUserId).toBe("u1");
    expect(b.requesterUserId).toBe("u2");
  });

  it("[PX-04] fail-closed: userId rỗng KHÔNG biến thành 'không lọc'", () => {
    // `""` vẫn là một điều kiện (khớp không phiếu nào), chứ không phải undefined làm Prisma bỏ qua vế lọc.
    expect(dieuKienPhieuXem({ quanLy: false, userId: "" })).toHaveProperty("requesterUserId", "");
  });
});

describe("trang Chương trình đào tạo dùng đúng hàm đó", () => {
  it("[PX-W1] câu truy vấn phiếu lấy điều kiện từ `dieuKienPhieuXem({ quanLy, userId })` — không tự viết `where` thứ hai", () => {
    const goi = [...TRANG.matchAll(/dieuKienPhieuXem\(\s*\{\s*quanLy\s*,\s*userId:\s*session\.user\.id\s*\}\s*\)/g)];
    expect(goi, "số lời gọi").toHaveLength(1);
    const truyVan = TRANG.slice(TRANG.indexOf("trnTrainingNeed.findMany"));
    expect(truyVan.slice(0, 200)).toContain("where: dieuKienPhieuXem(");
  });

  it("[PX-W2] hai danh sách duyệt (chờ/đã duyệt) CHỈ đi xuống client khi là người quản lý — props client nằm trong payload RSC", () => {
    expect([...TRANG.matchAll(/\(quanLy \? phieu : \[\]\)/g)]).toHaveLength(2);
    expect(TRANG).not.toMatch(/phieuDaDuyet=\{phieu\b/);
    expect(TRANG).not.toMatch(/phieuChoDuyet=\{phieu\b/);
  });

  it("[PX-W3] khối bảng phiếu nói rõ với người đề nghị rằng chỉ hiện phiếu của họ (affordance nói thật)", () => {
    expect(TRANG).toContain("Phiếu bạn đã gửi (");
    expect(TRANG).toContain("Chỉ hiện các đề nghị do chính bạn gửi");
  });
});
