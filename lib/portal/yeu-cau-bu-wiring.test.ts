// [PHW-*] — LƯỚI GHIM MÃ NGUỒN cho T11: cổng phụ huynh đọc kết quả học bù qua MỘT đường, đơn xin bù gắn đúng dòng và tự đóng.
//
// Test hành vi (`tests/hoc-bu/phu-huynh.test.ts`) chứng minh các luật chạy đúng. Thứ nó KHÔNG canh: một đường đổi trạng thái dòng cần bù MỚI quên đóng đơn (nó
// phải đi qua `chuyenTrangThaiDong` — cửa duy nhất), action tạo đơn bỏ cổng kiểm dòng, hay màn hình quay về copy cũ ("liên cơ sở", "PH tự chọn buổi").
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parentRequestHref } from "@/lib/portal/parent-request-notify";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
const ma = (p: string) => boChuThich(doc(p));
function than(src: string, ten: string): string {
  const m = new RegExp(`(?:^|\\n)(?:export )?async function ${ten}\\(`).exec(src);
  expect(m, `không thấy hàm ${ten}`).not.toBeNull();
  const dau = m!.index;
  const ke = src.slice(dau + 10).search(/\n(?:\/\*\*|export (?:async )?function|(?:async )?function|export const|const|type|interface) /);
  return src.slice(dau, ke === -1 ? undefined : dau + 10 + ke);
}
const vi = (s: string, x: string) => {
  const i = s.indexOf(x);
  expect(i, `không thấy "${x}"`).toBeGreaterThanOrEqual(0);
  return i;
};

describe("[PHW] T11 — cổng phụ huynh + đơn xin học bù", { timeout: 30_000 }, () => {
  it("[PHW-01] đơn tự đóng ở CỬA DUY NHẤT đổi trạng thái dòng (`chuyenTrangThaiDong`), SAU phép ghi, chỉ khi có dòng đổi thật; chỉ đóng đơn MAKEUP còn PENDING", () => {
    const s = ma("lib/hoc-bu/dong-service.ts");
    const cua = than(s, "chuyenTrangThaiDong");
    expect(vi(cua, "tx.makeupNeed.updateMany(")).toBeLessThan(vi(cua, "dongYeuCauPhuHuynh("));
    expect(cua).toContain("if (r.count > 0) await dongYeuCauPhuHuynh(tx, p.ids, p.sang, p.lyDo);");
    const dong = than(s, "dongYeuCauPhuHuynh");
    expect(dong).toContain('if (sang === "PENDING" || ids.length === 0) return 0;');
    expect(dong).toContain('type: "MAKEUP",');
    expect(dong).toContain('status: "PENDING",');
    expect(dong).toContain("where: { id: { in: [...ids] }, status: sang },"); // chỉ dòng THỰC SỰ đã ở trạng thái đích
    // Đơn cũ chưa có khoá dòng vẫn được đóng (cùng học viên + buổi gốc), đơn có khoá thì khớp theo khoá.
    expect(dong).toContain("{ makeupNeedId: { in: dong.map((d) => d.id) } },");
    expect(dong).toContain("sessionId: d.missedSessionId, makeupNeedId: null");
    expect(dong).toContain('status: "REJECTED" as const');
    expect(dong).toContain('status: "APPROVED" as const');
  });

  it("[PHW-02] action tạo đơn xin bù qua cổng `kiemDongChoYeuCau` TRƯỚC khi tạo, và lưu `makeupNeedId`; cổng chỉ nhận dòng còn PENDING của con mình", () => {
    const a = ma("app/(portal)/portal/yeu-cau/actions.ts");
    const t = than(a, "createParentRequest");
    expect(vi(t, "kiemDongChoYeuCau(pdb")).toBeLessThan(vi(t, "portalTx("));
    expect(t).toContain("makeupNeedId = d.makeupNeedId;");
    expect(t).toContain("        makeupNeedId,\n");
    const g = ma("lib/portal/yeu-cau-bu.ts");
    expect(g).toContain("where: { id: p.needId, studentId: p.studentId },");
    expect(g).toContain('need.status !== "PENDING" || need.waivedAt !== null');
    expect(g).toContain('status: "PENDING",');
  });

  it("[PHW-03] người xử lý đơn xin bù làm việc ở màn HỌC BÙ: thông báo và danh sách việc cần làm trỏ `/hoc-bu` (không còn hàng đợi yêu cầu chung)", () => {
    expect(parentRequestHref("MAKEUP")).toBe("/hoc-bu");
    expect(parentRequestHref("ABSENCE")).toBe("/parent-requests/bao-vang");
    expect(parentRequestHref("OTHER")).toBe("/parent-requests");
    expect(ma("lib/pending-tasks.ts")).toContain('r.type === "MAKEUP" ? "/hoc-bu"');
  });

  it("[PHW-04] cổng phụ huynh KHÔNG còn copy cũ: 'liên cơ sở', 'CS1 ↔ CS2', 'CRM/Quản lý duyệt', 'ưu tiên cơ sở của con', phụ huynh tự chọn buổi — thay bằng chính sách case dạy bù", () => {
    const c = doc("components/portal/yeu-cau-page.tsx");
    for (const cam of ["liên cơ sở", "CS1 ↔ CS2", "CRM/Quản lý duyệt", "ưu tiên cơ sở của con", "ưu tiên hiển thị lớp"]) expect(c, cam).not.toContain(cam);
    expect(c).toContain("buổi dạy bù riêng");
    expect(c).toContain("trung tâm là bên xếp lịch");
  });

  it("[PHW-05] màn phụ huynh đọc kết quả qua `docKetQuaBuoi` MỘT lần (không tự suy từ trạng thái dòng); đối tượng trả về không mang id nội bộ và ẩn lần bị gỡ", () => {
    const m = ma("lib/portal/makeup.ts");
    expect(m.split("docKetQuaBuoi(").length - 1).toBe(1);
    expect(m).toContain('lichSu: kq.lichSu.filter((l) => l.loai !== "DA_GO").map(chuyen),');
    // `ChiTietBuoiBu` / `KetQuaCong` không có trường id (giáo viên, phòng, cơ sở, bài đi ra bằng TÊN).
    const khoi = doc("lib/portal/makeup.ts");
    const ct = khoi.slice(khoi.indexOf("export type ChiTietBuoiBu"), khoi.indexOf("export type MakeupItem"));
    expect(ct).not.toMatch(/\b\w*Id\b\s*:/);
    // Màn hình chỉ HIỆN `yeuCauMo` để ẩn nút; server vẫn là cổng (`kiemDongChoYeuCau`).
    expect(doc("components/portal/yeu-cau-page.tsx")).toContain("m.yeuCauMo ? (");
  });
});
