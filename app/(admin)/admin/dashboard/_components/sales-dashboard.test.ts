// Bảng điều khiển Sale — CHỐT 27/08/2026: giữ nguyên cách lọc "được giao cho tôi",
// chỉ đổi nhãn cho rõ. Test viết TRƯỚC hiện thực (luật cứng #5).
//
// Đây là bộ test canh một QUYẾT ĐỊNH, không canh một thuật toán. Lý do chủ dự án đưa
// ra: bảng điều khiển là để biết HÔM NAY GỌI AI, không phải để đếm thành tích; muốn
// xem "khách của tôi" thì đã có màn danh sách riêng.
//
// Vì sao phải có test cho một việc "chỉ đổi chữ": cái dễ mất là LÝ DO. Người sau nhìn
// thấy "Lead của tôi" trên bảng của Sale sẽ rất tự nhiên nghĩ đây là thiếu sót và
// "sửa cho đúng" thành số của cả cơ sở — lúc đó bảng đổi nghĩa mà không ai nhận ra,
// vì con số vẫn hiện ra bình thường. Bộ này bắt đúng lần sửa đó.
//
// Không dùng render: quét mã nguồn là đủ và không phải dựng cả cây RSC + Prisma.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const FILE = path.join(
  process.cwd(),
  "app/(admin)/admin/dashboard/_components/sales-dashboard.tsx",
);
const src = fs.readFileSync(FILE, "utf8");

/** Bỏ comment: chú thích giải thích quyết định không được tính là mã thật. */
const chiMa = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("bảng điều khiển Sale · CÁCH LỌC giữ nguyên (đây là phần không được đổi)", () => {
  it("bốn ô số vẫn lọc theo người được giao — KHÔNG mở ra cả cơ sở", () => {
    // 4 truy vấn trong getSalesStats + 1 cho việc cần làm, tất cả bám assignedToId.
    const soLan = chiMa.split("assignedToId: userId").length - 1;
    expect(soLan).toBeGreaterThanOrEqual(5);
  });

  it("không có truy vấn nào lọc theo cơ sở thay cho theo người", () => {
    // Nếu ai đó đổi `assignedToId: userId` thành `centerId: …` thì đây là chỗ đỏ.
    expect(chiMa).not.toMatch(/where:\s*\{\s*centerId/);
  });
});

describe("bảng điều khiển Sale · NHÃN nói rõ đây là việc của riêng mình", () => {
  it("có khối đầu đề nói thẳng phạm vi, không để người đọc tự đoán", () => {
    expect(src).toContain("Việc của tôi");
  });

  it("cả bốn ô số đều mang chữ 'của tôi' — không ô nào để trống nghĩa", () => {
    const nhan = [...src.matchAll(/<DashStat\s+label="([^"]+)"/g)].map((m) => m[1]);
    expect(nhan).toHaveLength(4);
    for (const l of nhan) {
      expect(l, `nhãn "${l}" không nói rõ là của riêng người đang xem`).toMatch(/tôi/i);
    }
  });

  it("có chỉ đường sang màn danh sách khách — chỗ ĐỂ xem khách của mình", () => {
    expect(src).toMatch(/[Dd]anh sách khách/);
  });
});

describe("bảng điều khiển Sale · ô 'sắp hết khoá' KHÔNG được gộp vào khối của tôi", () => {
  // Chỗ này là phát hiện khi làm ticket, ghi lại để không mất: `getNearingEndEnrollments()`
  // gọi KHÔNG tham số ⇒ nó đếm học viên sắp hết khoá của MỌI cơ sở, không lọc theo
  // người được giao và cũng không lọc theo cơ sở của người đang xem. Nó KHÁC bản chất
  // với bốn ô kia. Gán cho nó nhãn "của tôi" là nói dối; vì vậy nó nằm NGOÀI khối.
  it("vẫn gọi không tham số (chưa sửa cách lọc — ngoài phạm vi đợt này)", () => {
    expect(chiMa).toContain("getNearingEndEnrollments()");
  });

  it("dải nhắc tái tục KHÔNG mang chữ 'của tôi'", () => {
    const dau = src.indexOf("sap-het-khoa");
    const dai = src.slice(dau, src.indexOf("</Link>", dau));
    expect(dai).not.toMatch(/của tôi/i);
  });
});
