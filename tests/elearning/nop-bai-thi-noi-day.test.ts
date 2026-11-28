// @vitest-environment node
/**
 * [NBT-W] Ghim dây nối của hộp xác nhận nộp bài: nút "Nộp bài" của trình làm bài chỉ MỞ hộp (không gọi `nop` thẳng), hộp được vẽ, và mỗi
 * câu có `id` để "Mở câu N" cuộn tới. Gỡ một mắt xích thì lưới đỏ — test hành vi của hộp (jsdom) không thấy được dây nối này.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RUNNER = readFileSync(join(process.cwd(), "app/(elearning)/elearning/hoc/_components/exam-runner.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const dem = (s: string, t: string) => s.split(t).length - 1;

describe("[NBT-W] dây nối trình làm bài ↔ hộp xác nhận", () => {
  it("nút 'Nộp bài' chỉ mở hộp; không còn nút nào gọi `nop` trực tiếp", () => {
    expect(dem(RUNNER, "onClick={() => setHopNop(true)}")).toBe(1);
    expect(dem(RUNNER, "onClick={nop}")).toBe(0);
  });
  it("hộp được vẽ đúng một lần và là chỗ DUY NHẤT gọi `nop()`", () => {
    expect(dem(RUNNER, "<HopXacNhanNop")).toBe(1);
    expect(dem(RUNNER, "await nop();")).toBe(1);
  });
  it("mỗi câu có id `cau-thi-N` để 'Mở câu N' cuộn tới", () => {
    expect(RUNNER).toContain("id={`cau-thi-${i + 1}`}");
    expect(RUNNER).toContain("getElementById(`cau-thi-${n}`)");
  });
});
