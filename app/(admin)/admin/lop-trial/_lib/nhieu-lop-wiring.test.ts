import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Lưới ghim DÂY NỐI của luật "bé học thử nhiều lớp" (`lib/trial/nhieu-lop.ts`). Các action chạm DB
// nên test hành vi không phủ được việc "cửa nào gọi cổng nào" — quên gọi là KHÔNG ca nào đỏ.
// Bỏ chú thích TRƯỚC khi đếm: các khối giải thích bản vá chứa đúng những chuỗi đang canh.

const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const actions = bo(
  readFileSync(resolve(process.cwd(), "app/(admin)/admin/lop-trial/_actions.ts"), "utf8"),
);
const dem = (re: RegExp) => (actions.match(re) ?? []).length;

describe("[NLW] dây nối bé học thử nhiều lớp", () => {
  it("[NLW-1] cổng 'lớp thứ hai' được hỏi ở CẢ cửa thêm và ô tìm (hai cửa một luật)", () => {
    expect(dem(/kiemThemLopTrialThuHai\(/g)).toBe(2);
  });

  it("[NLW-2] cổng 'khoá chưa trial' được hỏi ở cả cửa thêm-thẳng-vào-case và cửa đổi khoá", () => {
    expect(dem(/kiemKhoaTrialMoi\(/g)).toBe(2);
  });

  it("[NLW-3] xếp vào case đòi khoá RIÊNG của lượt khi bé có lượt trial khác", () => {
    expect(dem(/khoaChoLuotXepCase\(/g)).toBe(1);
  });

  it("[NLW-4] trial lại CÙNG khoá chỉ mở cho quyền `trials:enroll-multi-any`", () => {
    expect(dem(/checkPermission\("trials:enroll-multi-any"\)/g)).toBe(2);
  });

  it("[NLW-5] ô tìm: bộ lọc 'lead của tôi' và từ khoá đi qua AND — không hai `OR` cạnh nhau", () => {
    expect(actions).toMatch(/AND:\s*dieuKien/);
    expect(dem(/dieuKien\.push\(\{\s*OR:\s*leadCuaToiOrClause/g)).toBe(1);
  });

  it("[NLW-6] ô tìm KHÔNG còn lọc trạng thái lead và KHÔNG còn loại bé đang ở lớp khác", () => {
    expect(actions).not.toMatch(/status:\s*\{\s*notIn:\s*\["DA_DANG_KY",\s*"DA_MAT"\]/);
    expect(actions).not.toMatch(/childFree/);
  });
});
