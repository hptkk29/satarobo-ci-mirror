/**
 * Ca [DBL-W*] — LƯỚI GHIM DÂY NỐI của đồng bộ hai chiều HV ↔ lead + cổng mã học viên (26/09/2026).
 *
 * Vì sao phải ghim mã nguồn: các action chạm DB và auth nên test hành vi của chúng đều GIẢ LẬP
 * module đồng bộ. Gỡ lời gọi `dongBoTuLead(...)` khỏi `updateLeadFields` thì KHÔNG ca hành vi
 * nào đỏ — và hệ quả là đúng lỗi chủ dự án cấm ("đổi 1 nơi thì các nơi khác phải đổi hết"),
 * im lặng. Luật 11: bỏ chú thích TRƯỚC khi so (chú thích giải thích bản vá chứa đúng chuỗi đang
 * tìm), neo chuỗi hẹp, đếm SỐ LẦN khớp.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function docMa(tep: string): string {
  const src = readFileSync(resolve(process.cwd(), tep), "utf8");
  // Bỏ chú thích khối + dòng (giữ chuỗi "//" trong URL bằng cách chỉ bỏ khi đứng đầu dòng / sau khoảng trắng).
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

/** Thân một hàm `export async function <ten>` — tới hàm export kế tiếp. */
function thanHam(ma: string, ten: string): string {
  const dau = ma.indexOf(`export async function ${ten}(`);
  expect(dau, `không thấy hàm ${ten}`).toBeGreaterThanOrEqual(0);
  const sau = ma.indexOf("export async function ", dau + 10);
  return ma.slice(dau, sau < 0 ? undefined : sau);
}

const dem = (s: string, re: RegExp) => (s.match(new RegExp(re.source, "g")) ?? []).length;

describe("[DBL-W] đồng bộ hai chiều — mọi đường ghi đều gọi", () => {
  it("[DBL-W1] updateStudent ghi qua `ghiHoSoHocVien` (client KHÔNG scope), không tự update trong sdb", () => {
    const f = thanHam(docMa("app/(admin)/admin/students/_actions.ts"), "updateStudent");
    expect(dem(f, /ghiHoSoHocVien\(/)).toBe(1);
    expect(dem(f, /\.student\.update\(/)).toBe(0);
  });

  it("[DBL-W2] ghiHoSoHocVien: một `db.$transaction` gồm ghi + đồng bộ tên + đồng bộ ô chung", () => {
    const f = docMa("lib/students/ghi-ho-so.ts");
    expect(dem(f, /db\.\$transaction\(/)).toBe(1);
    expect(dem(f, /dongBoTuHocVien\(\{/)).toBe(1);
    expect(dem(f, /syncStudentNameToCrm\(\{/)).toBe(1);
    // Đọc qua scope là bỏ sót phiếu/anh chị em ở cơ sở khác — file này không được dùng scopedDb.
    expect(f).not.toMatch(/scopedDb/);
  });

  it("[DBL-W3] updateLeadFields dội ô phụ huynh TRONG giao dịch, SAU lượt ghi lead", () => {
    const f = thanHam(docMa("app/(admin)/admin/leads/actions.ts"), "updateLeadFields");
    expect(dem(f, /dongBoTuLead\(\{/)).toBe(1);
    const giaoDich = f.indexOf("db.$transaction(");
    const ghiLead = f.indexOf("tx.lead.update(", giaoDich);
    const dongBo = f.indexOf("dongBoTuLead({", giaoDich);
    expect(giaoDich).toBeGreaterThan(0);
    expect(ghiLead).toBeGreaterThan(giaoDich);
    expect(dongBo).toBeGreaterThan(ghiLead);
  });

  it("[DBL-W4] updateLeadChild dội ô của bé TRONG giao dịch", () => {
    const f = thanHam(docMa("app/(admin)/admin/leads/actions.ts"), "updateLeadChild");
    expect(dem(f, /dongBoTuCon\(\{/)).toBe(1);
    const giaoDich = f.indexOf("db.$transaction(");
    expect(f.indexOf("dongBoTuCon({")).toBeGreaterThan(giaoDich);
    expect(giaoDich).toBeGreaterThan(0);
  });

  it("[DBL-W5] các đường ghi phụ: nhập Excel HV · nhập Excel lead · phiếu nhập trùng điền link FB", () => {
    expect(dem(docMa("app/api/admin/import/students/route.ts"), /dongBoTuHocVien\(\{/)).toBe(1);
    expect(dem(docMa("app/api/admin/import/leads/route.ts"), /dongBoTuLead\(\{/)).toBe(1);
    expect(dem(docMa("lib/lead/intake/ingest.ts"), /dongBoTuLead\(\{/)).toBe(1);
  });

  it("[DBL-W6] đồng bộ TÊN biết liên kết trực tiếp `Student.leadChildId` (không chỉ vết ghi danh)", () => {
    const f = docMa("lib/students/sync-name.ts");
    expect(f).toMatch(/input\.leadChildId,/);
    expect(f).toMatch(/tx\.student\.findMany\(\{\s*where: \{ leadChildId: input\.leadChildId \}/);
  });
});

describe("[MHV-W] mã học viên — server gác, giao diện khớp server", () => {
  it("[MHV-W1] createStudent + updateStudent đều hỏi `students:change-code` rồi đi qua quyetDinhMaHocVien", () => {
    const ma = docMa("app/(admin)/admin/students/_actions.ts");
    for (const ten of ["createStudent", "updateStudent"]) {
      const f = thanHam(ma, ten);
      expect(dem(f, /quyetDinhMaHocVien\(\{/), ten).toBe(1);
      expect(dem(f, /checkPermission\("students:change-code"\)/), ten).toBe(1);
    }
  });

  it("[MHV-W2] hai trang có form truyền `coTheDoiMa` từ ĐÚNG quyền đó", () => {
    for (const tep of [
      "app/(admin)/admin/students/[id]/edit/page.tsx",
      "app/(admin)/admin/students/new/page.tsx",
    ]) {
      const f = docMa(tep);
      expect(dem(f, /coTheDoiMa=\{coTheDoiMa\}/), tep).toBe(1);
      expect(dem(f, /checkPermission\("students:change-code"\)/), tep).toBe(1);
    }
  });
});

describe("[NXHB-W] hồ sơ: khối năng lực robotics đã thay bằng nhận xét buổi + học bạ", () => {
  it("[NXHB-W1] trang hồ sơ vẽ NhanXetVaHocBa, không còn SkillEditor; nhận xét đọc bằng hàm của cổng PH", () => {
    const f = docMa("app/(admin)/admin/students/[id]/edit/page.tsx");
    expect(f).not.toMatch(/SkillEditor/);
    expect(dem(f, /<NhanXetVaHocBa\b/)).toBe(1);
    expect(dem(f, /getStudentFeedback\(id, 100\)/)).toBe(1);
    // Mỗi phần gác đúng quyền màn gốc.
    expect(f).toMatch(/checkAnyPermission\(\["sessions:edit", "session-feedback:view-all", "session-feedback:share"\]\)/);
    expect(f).toMatch(/checkAnyPermission\(\["report-cards:manage", "report-cards:review"\]\)/);
    expect(f).toMatch(/checkAnyPermission\(PAGE_GATES\["\/hoc-ba"\]\)/);
  });
});

describe("[DBL-W] khối «Người mua trên hoá đơn» (01/11/2026) — đường ghi thứ tám của hồ sơ", () => {
  const f = () => docMa("lib/finance/hoa-don/ghi-nguoi-mua.ts");

  it("[DBL-W7] MỘT transaction KHÔNG scope: ghi đơn → rồi hồ sơ qua đường đồng bộ sẵn có (không tự `student.update`)", () => {
    const m = f();
    // HAI transaction, cả hai KHÔNG scope: lượt ghi từ màn hoá đơn (đơn + hồ sơ) và `dongBoHocVienTuDonMoi` (01/11: đơn VỪA TẠO,
    // chỉ điền hồ sơ — xem [DBL-W9] bên dưới, nó không được ghi gì lên đơn).
    expect(dem(m, /db\.\$transaction\(/)).toBe(2);
    expect(m).not.toMatch(/scopedDb/);
    // Hồ sơ HV: ghi bằng `ghiHoSoTrongTx` (nó tự dội sang lead · con · anh chị em · đổi tên 4 bản sao).
    expect(dem(m, /ghiHoSoTrongTx\(\{/)).toBe(1);
    expect(dem(m, /\.student\.update\(/)).toBe(0);
    // Chưa có HV: phiếu lead + đứa con, kèm dội sang HV đang nối.
    expect(dem(m, /dongBoTuLead\(\{/)).toBe(1);
    expect(dem(m, /dongBoTuCon\(\{/)).toBe(1);
    expect(dem(m, /syncLeadChildNameToStudents\(\{/)).toBe(1);
    // Thứ tự: đơn (CAS) TRƯỚC, hồ sơ SAU — stale thì không đụng hồ sơ.
    expect(m.indexOf("tx.order.updateMany(")).toBeGreaterThan(0);
    expect(m.indexOf("await dayVaoHoSo(")).toBeGreaterThan(m.indexOf("tx.order.updateMany("));
  });

  it("[DBL-W9] đơn VỪA TẠO: `dongBoHocVienTuDonMoi` chỉ điền hồ sơ (không ghi đơn, không đè), và action tạo đơn gọi nó SAU commit với đủ cổng quyền", () => {
    const m = f();
    const than = thanHam(m, "dongBoHocVienTuDonMoi");
    expect(than).not.toMatch(/tx\.order\.(update|updateMany|create)\(/);
    // banDau = form ⇒ không ô nào tính là «vừa sửa» ⇒ chỉ ô hồ sơ đang TRỐNG được điền.
    expect(than).toMatch(/banDau:\s*form/);
    const a = thanHam(docMa("app/(admin)/admin/orders/_actions.ts"), "createOrderManualAction");
    expect(dem(a, /dongBoHocVienTuDonMoi\(\{/)).toBe(1);
    expect(a).toMatch(/checkPermission\("students:edit"\)/);
    expect(a).toMatch(/checkPermission\("payments:view-pii"\)/);
    expect(a).toMatch(/hocVienTrongTam:\s*\(s\)\s*=>\s*passesScope\("Student"/);
    // Sau commit: lời gọi đứng SAU giao dịch tạo đơn, và nằm trong `try` (lỗi hồ sơ không được cuộn lại đơn).
    const viTri = a.indexOf("dongBoHocVienTuDonMoi({");
    expect(viTri).toBeGreaterThan(a.indexOf("withUniqueRetry("));
    expect(a.lastIndexOf("try {", viTri)).toBeGreaterThan(a.lastIndexOf("withUniqueRetry(", viTri));
  });

  it("[DBL-W8] action chỉ gọi lõi ghi MỘT lần, và gác quyền hồ sơ + cổng cơ sở của học viên trước khi gọi", () => {
    const a = thanHam(docMa("app/(admin)/admin/orders/_actions.ts"), "luuThongTinHoaDonAction");
    expect(dem(a, /ghiNguoiMuaHoaDon\(\{/)).toBe(1);
    expect(a).toMatch(/checkPermission\("students:edit"\)/);
    expect(a).toMatch(/checkPermission\("payments:view-pii"\)/);
    expect(a).toMatch(/hocVienTrongTam:\s*\(s\)\s*=>\s*passesScope\("Student"/);
    // Không đường nào khác ngoài action được gọi lõi ghi.
    const trang = docMa("app/(admin)/admin/orders/[id]/page.tsx");
    expect(trang).not.toMatch(/ghiNguoiMuaHoaDon\(/);
  });
});
