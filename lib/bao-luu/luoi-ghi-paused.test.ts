// lib/bao-luu/luoi-ghi-paused.test.ts — LƯỚI CANH MỌI ĐƯỜNG GHI `PAUSED` / `isActive` của bảo lưu. PHIÊN 2.
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT (chốt 08/10/2026, mục C(a)): chỉ HÀM CHUYỂN TRẠNG THÁI của StudentReserve được đặt/gỡ
// `Enrollment.PAUSED` và `Student.PAUSED`, và được ghi cột `StudentReserve.isActive`.
//
// Hôm nay hàm đó CHƯA tồn tại (Phiên 3) — logic còn nằm trong `reserveStudentAction`,
// `resumeStudentReserveAction`, `withdrawStudentAction`, `reactivateStudentAction` và
// `approveReserveRequest`. Nên lưới này là DANH SÁCH CHO PHÉP **chỉ được co lại**: mỗi mục là một
// nơi sẽ bị gom vào hàm chuyển trạng thái ở Phiên 3. Thêm một nơi MỚI ghi PAUSED/isActive là đỏ.
//
// ⚠️ Lưới đếm theo LỜI GỌI Prisma (trích đủ đối số bằng đếm ngoặc), không theo chuỗi `"PAUSED"` trơn:
// `"PAUSED"` xuất hiện ở hàng chục nơi chỉ để HIỂN THỊ nhãn / lọc đọc, và một lưới chặn chúng là
// một lưới bị tắt đi trong tuần đầu. Bài học Phiên 1: bản lưới đầu chỉ đếm TÊN đường và cấy lỗi vào
// vẫn xanh — nên mỗi mục dưới đây khẳng định cả MẪU thật sự có mặt (`[BL2-PAUSED-02]`).
//
// ⚠️ GIỚI HẠN ĐÃ BIẾT: đường ghi mà trạng thái là BIẾN (`data: { status: bienNao }`) không lộ ra qua đọc
// văn bản. Năm đường như vậy đã được chặn bằng `chanDatBaoLuuNgoaiHoSo` (lưới `[BL1-CD-W*]`); thêm
// đường dynamic mới thì lưới đó mới là chỗ bắt, không phải đây.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const GOC = process.cwd();
const THU_MUC = ["app", "lib", "components"];
const BO_QUA = new Set(["node_modules", ".next", "__tests__"]);

function duyet(dir: string, ra: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    if (BO_QUA.has(ten)) continue;
    const p = join(dir, ten);
    const st = statSync(p);
    if (st.isDirectory()) duyet(p, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.(test|spec)\.(ts|tsx)$/.test(ten)) ra.push(p);
  }
  return ra;
}

/** Bỏ chú thích — chú thích giải thích bản vá luôn chứa đúng chuỗi bộ so khớp đang tìm (luật 11). */
function boChuThich(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1")).join("\n");
}

/** Trích đối số đầy đủ của một lời gọi (đếm ngoặc, bỏ qua nội dung chuỗi). */
function traDoiSo(src: string, viTriMoNgoac: number): string {
  let sau = 0;
  let q: string | null = null;
  for (let i = viTriMoNgoac; i < src.length; i++) {
    const c = src[i]!;
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "(") sau++;
    else if (c === ")") {
      sau--;
      if (sau === 0) return src.slice(viTriMoNgoac, i + 1);
    }
  }
  return src.slice(viTriMoNgoac);
}

type LoiGoi = { file: string; mo: string; doiSo: string };
function cacLoiGoi(model: string): LoiGoi[] {
  const re = new RegExp(`\\b${model}\\.(update|updateMany|create|createMany|upsert)\\(`, "g");
  const ra: LoiGoi[] = [];
  for (const d of THU_MUC) {
    for (const f of duyet(resolve(GOC, d))) {
      const src = boChuThich(readFileSync(f, "utf8"));
      for (const m of src.matchAll(re)) {
        const viTri = m.index! + m[0].length - 1;
        ra.push({ file: relative(GOC, f).split("\\").join("/"), mo: m[1]!, doiSo: traDoiSo(src, viTri) });
      }
    }
  }
  return ra;
}

/**
 * Nơi được ghi `isActive` / PAUSED HÔM NAY. ⚠️ CHỈ ĐƯỢC CO LẠI. Phiên 3 gom hết về
 * `lib/bao-luu/chuyen-trang-thai.ts` rồi xoá các dòng này.
 */
const CHO_PHEP_ISACTIVE = new Set([
  // PHIÊN 3: hàm chuyển trạng thái là nơi DUY NHẤT ghi `status`/`isActive`. Ba đường cũ (`reserveStudentAction`,
  // `resumeStudentReserveAction`, `withdrawStudentAction`) và `approveReserveRequest` đã GỠ khỏi danh sách: tạo thì dùng
  // mặc định của schema, đóng thì đi qua `chuyenTrangThai`. Danh sách này giờ chỉ còn MỘT mục — thêm mục là thụt lùi.
  "lib/bao-luu/chuyen-trang-thai.ts",
]);
const CHO_PHEP_PAUSED = new Set([
  "lib/bao-luu/chuyen-trang-thai.ts", // phản chiếu PAUSED xuống ghi danh/học viên (Phiên 3)
  "app/(admin)/admin/students/_actions.ts",
  "lib/students/reserve-service.ts",
]);

describe("[BL2-ISACTIVE] cột StudentReserve.isActive chỉ ghi ở nơi được phép", () => {
  const goi = cacLoiGoi("studentReserve");

  it("[BL2-ISACTIVE-01] có tìm thấy lời gọi ghi StudentReserve (lưới không rỗng — một lưới rỗng luôn xanh)", () => {
    expect(goi.length).toBeGreaterThanOrEqual(4);
  });

  it("[BL2-ISACTIVE-02] mọi lời gọi ghi `isActive` đều nằm trong danh sách cho phép", () => {
    const vi = goi.filter((g) => /\bisActive\s*:/.test(g.doiSo) && !CHO_PHEP_ISACTIVE.has(g.file));
    expect(
      vi.map((g) => `${g.file}: studentReserve.${g.mo}`),
      "Chỉ hàm chuyển trạng thái được ghi isActive (lấy giá trị từ `suyRaIsActive`). Gọi hàm đó thay vì ghi tay.",
    ).toEqual([]);
  });

  it("[BL2-ISACTIVE-03] danh sách cho phép KHÔNG có mục thừa — mỗi mục vẫn thật sự ghi isActive (co lại khi Phiên 3 gom)", () => {
    for (const f of CHO_PHEP_ISACTIVE) {
      expect(
        goi.some((g) => g.file === f && /\bisActive\s*:/.test(g.doiSo)),
        `${f} không còn ghi isActive — xoá khỏi CHO_PHEP_ISACTIVE`,
      ).toBe(true);
    }
  });
});

describe("[BL2-PAUSED] đặt `PAUSED` cho học viên/ghi danh chỉ ở nơi được phép", () => {
  const goi = [...cacLoiGoi("student"), ...cacLoiGoi("enrollment")];

  it("[BL2-PAUSED-01] có tìm thấy lời gọi ghi student/enrollment (lưới không rỗng)", () => {
    expect(goi.length).toBeGreaterThanOrEqual(10);
  });

  it("[BL2-PAUSED-02] mọi lời gọi ghi mang LITERAL \"PAUSED\" đều nằm trong danh sách cho phép", () => {
    const vi = goi.filter((g) => /["']PAUSED["']/.test(g.doiSo) && !CHO_PHEP_PAUSED.has(g.file));
    expect(
      vi.map((g) => `${g.file}: .${g.mo}(…"PAUSED"…)`),
      "PAUSED chỉ sinh ra từ hồ sơ bảo lưu (StudentReserve). Gọi hàm chuyển trạng thái thay vì ghi tay.",
    ).toEqual([]);
  });

  it("[BL2-PAUSED-03] danh sách cho phép KHÔNG có mục thừa", () => {
    for (const f of CHO_PHEP_PAUSED) {
      expect(
        goi.some((g) => g.file === f && /["']PAUSED["']/.test(g.doiSo)),
        `${f} không còn ghi PAUSED — xoá khỏi CHO_PHEP_PAUSED`,
      ).toBe(true);
    }
  });
});
