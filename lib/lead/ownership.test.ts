// Test cho MỘT định nghĩa duy nhất của "khách của tôi".
//
// ─────────────────────────────────────────────────────────────────────────────
// S-8 (27/08/2026) — vì sao có file này, và vì sao nó phần lớn là test QUÉT NGUỒN.
//
// "Khách của tôi" từng có BA bản chép tay, và cả ba đã trôi lệch nhau thật:
//
//   · `lib/lead/sale-leads.ts`        — 3 vế (giao / mình nhập / dùng chung)
//   · `app/(admin)/admin/leads/page.tsx`   — 3 vế, gõ tay
//   · `app/(admin)/admin/search/page.tsx`  — **2 vế**, thiếu hẳn vế "mình nhập"
//
// Bản thiếu ở màn tìm kiếm là hậu quả TRỰC TIẾP: 23/08 người ta thêm vế
// `createdById` vào `/admin/leads`, 27/08 (S-4) thêm tiếp vào site Sale — không
// ai nhớ tới màn tìm kiếm. Hệ quả người dùng thấy: Sale Hội sở nhập một phiếu,
// phiếu tự chia về Sale cơ sở (chốt 04/08 "lead không bao giờ về Hội sở"), rồi
// gõ đúng tên phụ huynh vào ô tìm toàn hệ thống thì **không ra gì** — trong khi
// cũng phiếu đó mở được từ danh sách. Không có lỗi, không có thông báo.
//
// Cách chữa gốc không phải "thêm vế thứ ba vào bản thứ ba" — đó chính là cách
// đẻ ra bản thứ tư. Mệnh đề nay chỉ được định nghĩa ở `lib/lead/ownership.ts`,
// và test dưới đây khoá điều đó bằng cách quét nguồn: `leadSharedOrClause()` là
// DẤU VÂN TAY của một mệnh đề sở hữu gõ tay, nên hễ nó xuất hiện ngoài file
// nguồn duy nhất thì có nghĩa ai đó vừa mở bản sao thứ hai.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { leadOwnershipWhere, leadPhuTrachWhere } from "./ownership";

const cuEnv = process.env.LEAD_SHARING_ENABLED;
afterEach(() => {
  if (cuEnv === undefined) delete process.env.LEAD_SHARING_ENABLED;
  else process.env.LEAD_SHARING_ENABLED = cuEnv;
});

/** Nơi DUY NHẤT được phép định nghĩa mệnh đề "khách của tôi". */
const NGUON_DUY_NHAT = path.join("lib", "lead", "ownership.ts");

const doc = (p: string) => fs.readFileSync(p, "utf8");
const boChuThich = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Mọi file nguồn của repo (bỏ test, bỏ thư mục sinh ra). */
function nguonRepo(): string[] {
  const bo = new Set([
    "node_modules",
    ".next",
    ".git",
    "Document",
    "docs",
    "prisma",
    "tests",
    "public",
    "scripts",
  ]);
  const ra: string[] = [];
  const di = (thuMuc: string) => {
    for (const m of fs.readdirSync(thuMuc, { withFileTypes: true })) {
      if (m.name.startsWith(".") || bo.has(m.name)) continue;
      const p = path.join(thuMuc, m.name);
      if (m.isDirectory()) di(p);
      else if (/\.tsx?$/.test(m.name) && !/\.test\.tsx?$/.test(m.name)) ra.push(p);
    }
  };
  for (const goc of ["app", "lib", "components"]) di(goc);
  return ra;
}

// ─────────────────────────────────────────────────────────────────────────────
describe("[S-8] 'khách của tôi' — hình dạng mệnh đề", () => {
  it("mặc định (lead độc quyền): phiếu được GIAO cho tôi HOẶC phiếu chính tôi NHẬP", () => {
    delete process.env.LEAD_SHARING_ENABLED;
    expect(leadOwnershipWhere("u1")).toEqual({
      OR: [{ assignedToId: "u1" }, { createdById: "u1" }],
    });
  });

  it("bật lại chia sẻ bằng env → nhánh dùng chung quay lại, không phải sửa file nào", () => {
    process.env.LEAD_SHARING_ENABLED = "true";
    expect(leadOwnershipWhere("u1")).toEqual({
      OR: [{ assignedToId: "u1" }, { createdById: "u1" }, { isSharedWithTeam: true }],
    });
  });

  it("mọi vế đều neo vào chính người đang xem — không vế nào mở toang danh sách", () => {
    delete process.env.LEAD_SHARING_ENABLED;
    const or = leadOwnershipWhere("u1").OR as Record<string, unknown>[];
    for (const ve of or) expect(Object.values(ve)).toContain("u1");
  });

  it("mệnh đề TRÁCH NHIỆM (bảng việc SLA) vẫn HẸP — không có vế người nhập", () => {
    delete process.env.LEAD_SHARING_ENABLED;
    expect(leadPhuTrachWhere("u1")).toEqual({ OR: [{ assignedToId: "u1" }] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Đây là phần đắt nhất của file: khoá "chỉ có MỘT bản".
// ─────────────────────────────────────────────────────────────────────────────
describe("[S-8] chỉ MỘT nơi định nghĩa 'khách của tôi'", () => {
  it("chỉ `lib/lead/ownership.ts` được dựng mệnh đề dùng-chung — dấu vân tay của bản chép tay", () => {
    // `leadSharedOrClause()` chỉ có một công dụng: ghép vào mảng OR của mệnh đề
    // sở hữu. File nào gọi nó = file đó đang tự dựng lấy mệnh đề "của tôi".
    const pham = nguonRepo().filter(
      (f) =>
        path.normalize(f) !== NGUON_DUY_NHAT &&
        path.normalize(f) !== path.join("lib", "lead", "sharing.ts") &&
        boChuThich(doc(f)).includes("leadSharedOrClause"),
    );
    expect(pham).toEqual([]);
  });

  it("hàm chỉ được KHAI BÁO một lần trong toàn repo", () => {
    const khai = nguonRepo().filter((f) =>
      /export\s+function\s+leadOwnershipWhere/.test(doc(f)),
    );
    expect(khai.map((f) => path.normalize(f))).toEqual([NGUON_DUY_NHAT]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mỗi màn "chỉ xem khách của mình" phải HỎI hàm chung, không tự trả lời.
// ─────────────────────────────────────────────────────────────────────────────
describe("[S-8] mọi màn thu hẹp về 'của tôi' đều đi qua hàm chung", () => {
  const MAN = [
    ["danh sách lead khu quản trị", path.join("app", "(admin)", "admin", "leads", "page.tsx")],
    ["ô tìm toàn hệ thống", path.join("app", "(admin)", "admin", "search", "page.tsx")],
    ["danh sách khách site Sale", path.join("lib", "lead", "sale-leads.ts")],
    ["bảng việc site Sale", path.join("lib", "crm", "sale-board.ts")],
    ["đơn hàng site Sale", path.join("lib", "orders", "sale-orders.ts")],
  ] as const;

  for (const [ten, tep] of MAN) {
    it(`${ten} (${tep}) gọi leadOwnershipWhere/leadPhuTrachWhere`, () => {
      const s = boChuThich(doc(tep));
      expect(s).toMatch(/lead(OwnershipWhere|PhuTrachWhere)\(/);
    });
  }

  it("KHÔNG màn nào còn gõ tay cặp assignedToId+createdById để suy 'của tôi'", () => {
    // Chữ ký của bản chép tay: hai vế đứng KỀ NHAU trong cùng một mảng OR và
    // cùng neo vào MỘT biến người dùng. Neo vào `\1` để không bắt nhầm những chỗ
    // dùng hợp lệ (`select: { assignedToId: true, createdById: true }`,
    // `oldValues: { assignedToId: userId }` của audit…).
    const chuKy = /assignedToId:\s*([A-Za-z0-9_.]+)\s*\}\s*,\s*\{\s*createdById:\s*\1\b/;
    // `lib/lead/sharing.ts` cũng được miễn trừ — ca ngay trên đã miễn từ trước, và
    // lý do giống hệt: nó là THƯ VIỆN dùng chung, không phải một màn tự suy lấy.
    //
    // 🔴 NỢ-12 (18/09/2026): sau hợp nhất, repo có HAI thư viện cho cùng một khái niệm
    // "lead của tôi" — `ownership.ts` (dựng bên `test`) và `leadCuaToiOrClause`/
    // `laLeadCuaToi` trong `sharing.ts` (dựng bên `main`). Lưới này giữ đúng điều nó
    // sinh ra để giữ (KHÔNG màn nào tự suy), nhưng "một nguồn duy nhất" thì đã mất.
    // Gộp hai thư viện là đợt riêng: phải đo từng nơi gọi, vì hai bản KHÔNG cùng luật
    // (`sharing.ts` còn vế `isSharedWithTeam` sau cờ `LEAD_SHARING_ENABLED`).
    const MIEN_TRU = [NGUON_DUY_NHAT, path.join("lib", "lead", "sharing.ts")];
    const pham = nguonRepo()
      .filter((f) => !MIEN_TRU.includes(path.normalize(f)))
      .filter((f) => chuKy.test(boChuThich(doc(f))));
    expect(pham.map((f) => path.normalize(f))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ca người dùng thật, viết bằng lời của người dùng.
// ─────────────────────────────────────────────────────────────────────────────
describe("[S-8] Sale Hội sở tìm được phiếu chính mình nhập", () => {
  it("ô tìm toàn hệ thống dùng CÙNG mệnh đề với danh sách — không còn bản 2 vế", () => {
    const s = boChuThich(doc(path.join("app", "(admin)", "admin", "search", "page.tsx")));
    // Neo vào CHỖ DÙNG trong `where` (`...(scopeToSelf ? …`), không phải dòng
    // khai báo biến ở đầu trang.
    const i = s.indexOf("...(scopeToSelf");
    expect(i).toBeGreaterThan(-1);
    // Khối thu hẹp phải gọi hàm chung, và tuyệt đối không còn mảng OR gõ tay.
    const khoi = s.slice(i, i + 600);
    expect(khoi).toContain("leadOwnershipWhere(session.user.id)");
    expect(khoi).not.toContain("assignedToId: session.user.id");
  });

  it("phiếu mình nhập nhưng người khác phụ trách VẪN khớp mệnh đề", () => {
    delete process.env.LEAD_SHARING_ENABLED;
    const w = leadOwnershipWhere("u-ho");
    const phieuHoiSoNhap = { assignedToId: "u-sale-cs1", createdById: "u-ho" };
    const khop = (w.OR as Record<string, string>[]).some((ve) =>
      Object.entries(ve).every(
        ([k, v]) => phieuHoiSoNhap[k as keyof typeof phieuHoiSoNhap] === v,
      ),
    );
    expect(khop).toBe(true);
  });

  it("…nhưng phiếu của người lạ thì KHÔNG khớp vế nào", () => {
    delete process.env.LEAD_SHARING_ENABLED;
    const w = leadOwnershipWhere("u-ho");
    const phieuNguoiLa = { assignedToId: "u-sale-cs2", createdById: "u-sale-cs2" };
    const khop = (w.OR as Record<string, string>[]).some((ve) =>
      Object.entries(ve).every(
        ([k, v]) => phieuNguoiLa[k as keyof typeof phieuNguoiLa] === v,
      ),
    );
    expect(khop).toBe(false);
  });
});
