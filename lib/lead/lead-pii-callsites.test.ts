// lib/lead/lead-pii-callsites.test.ts — S-1 (26/08/2026). Test viết TRƯỚC hiện
// thực (luật cứng #5).
//
// VÌ SAO CÓ FILE NÀY. `lib/auth/lead-pii-policy.test.ts` đã khoá *chính sách*
// (ai có `leads:view-pii`), `lib/lead/pii.test.ts` đã khoá *hàm che*. Cả hai
// vẫn xanh trong khi số điện thoại thật chảy ra bốn màn hình — vì không ai khoá
// **chỗ gọi**. Q9 (22/08) gỡ quyền xem SĐT của Quản lý cơ sở, nhưng gỡ quyền chỉ
// có tác dụng ở những màn CHỊU HỎI quyền đó.
//
// ⚠️ 28/08/2026 — quyền của Quản lý cơ sở ĐÃ TRẢ LẠI, nên phần (a)/(b)/(c) dưới đây
// KHÔNG còn kiểm "che cho QLCS" nữa. Chúng vẫn đáng giữ nguyên: cái chúng khoá là
// *mọi màn phải đi qua `maskLeadPiiFields` thay vì in thẳng `lead.phone`* — đúng hay
// sai với từng vai là chuyện của bảng VAI ngay dưới, đổi ở đó một chỗ là xong.
//
// Ba loại rò được khoá ở đây:
//   (a) màn in thẳng `lead.phone` ra JSX, hoặc tự chế mặt nạ riêng;
//   (b) vai không có quyền lead vẫn rơi vào bảng "Leads mới nhất" của dashboard;
//   (c) ô TÌM theo SĐT không gác quyền — không hiện số nhưng cho DÒ: gõ đủ số là
//       biết khách đó của ai. Rò gián tiếp, và là loại dễ bỏ sót nhất.
//
// Cách khoá: phần THUẦN (hàm dựng `where`, hàm che) test bằng gọi hàm; phần nằm
// trong Server Component (không dựng được trong vitest vì kéo theo next-auth +
// Prisma) khoá bằng **chốt chặn nguồn** — đọc file, bỏ chú thích, soi mẫu. Cùng
// kiểu đã dùng ở `lib/lead/sale-leads.test.ts`.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../prisma/seed-roles";
import { maskLeadPiiFields } from "@/lib/lead/pii";
import { buildBookingListWhere } from "@/app/(admin)/admin/lop-trial/_lib/filters";

const v2Perms = (code: string) =>
  new Set((ROLE_SEED.find((r) => r.code === code)?.perms ?? []).map((p) => p.action));

/** Đọc mã nguồn, BỎ chú thích — chú thích nhắc tới `phone` rất nhiều, soi cả
 *  chú thích thì test đỏ/xanh theo văn phong chứ không theo hành vi.
 *
 *  ⚠️ THỨ TỰ QUAN TRỌNG: bỏ chú thích DÒNG trước, chú thích KHỐI sau. Ngược lại
 *  thì một dòng `//` có chứa `/*` (rất hay gặp: `@/components/charts/*`) sẽ mở
 *  một khối giả, và mọi thứ cho tới dấu `*` `/` kế tiếp — có thể là hàng trăm dòng
 *  mã thật — biến mất im lặng. Bản đầu của chính test này dính đúng bẫy đó và
 *  báo "chưa che" cho một trang đã che. */
function nguon(duongDan: string): string {
  return fs
    .readFileSync(duongDan, "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) VAI NÀO THẤY GÌ — bảng sự thật, cả hai tầng RBAC
// ─────────────────────────────────────────────────────────────────────────────
// v1 chạy local/dev/CI, v2 chạy PROD. Sửa một tầng quên tầng kia = local xanh mà
// prod rò. `null` ở cột v1 = vai chỉ tồn tại ở RBAC v2 (gán tay), không có dòng
// tương ứng trong matrix tĩnh — đó là đúng, không phải sót.
const VAI = [
  { ten: "SUPER_ADMIN", v1: "SUPER_ADMIN", v2: "SUPER_ADMIN", thayySdt: true },
  // 28/08/2026 — ĐẢO LẦN HAI: Quản lý cơ sở XEM LẠI ĐƯỢC SĐT (chủ dự án chốt; bản này
  // đã chạy trên `main` từ 30/08). Ba mốc của cùng một câu hỏi: 10/07 CÓ → 22/08 GỠ →
  // 28/08 TRẢ LẠI. Quyết định ký sau thắng. Đổi dòng này PHẢI đổi cùng lúc
  // `lib/auth/permissions.ts` + `prisma/seed-roles.ts`, nếu không hai tầng RBAC nói
  // hai câu khác nhau và local xanh trong khi prod che.
  { ten: "Quản lý cơ sở", v1: "CENTER_MANAGER", v2: "CENTER_MANAGER", thayySdt: true },
  { ten: "Sale cơ sở", v1: "SALES_CSM", v2: "CENTER_SALES_CSM", thayySdt: true },
  { ten: "Sale Hội sở", v1: null, v2: "HO_SALE", thayySdt: true },
  { ten: "Đào tạo", v1: "TRAINING", v2: "TRAINING", thayySdt: false },
  { ten: "Marketing", v1: "MARKETING", v2: "HO_MARKETING", thayySdt: true },
] as const;

describe("[S-1] ai được thấy SĐT lead — 6 vai, hai tầng RBAC", () => {
  it.each(VAI)("$ten: quyền leads:view-pii = $thayySdt ở CẢ v1 lẫn v2", (vai) => {
    if (vai.v1) {
      const coV1 = (PERMISSIONS["leads:view-pii"] as readonly string[]).includes(vai.v1);
      expect(coV1, `${vai.ten}: v1 matrix`).toBe(vai.thayySdt);
    }
    // SUPER_ADMIN bypass toàn cục ở can() v2 → seed không liệt kê từng action.
    const coV2 = vai.v2 === "SUPER_ADMIN" ? true : v2Perms(vai.v2).has("leads:view-pii");
    expect(coV2, `${vai.ten}: seed RoleDef v2`).toBe(vai.thayySdt);
  });

  it.each(VAI)("$ten: một phiếu đi qua tầng che ra đúng thứ vai đó được thấy", (vai) => {
    const phieu = {
      parentName: "Nguyễn Thị Lan",
      phone: "0905123456",
      email: "lan@gmail.com",
      childName: "Nguyễn Minh Khôi",
      note: "Hẹn gọi lại chiều thứ 5",
    };
    const ra = maskLeadPiiFields(phieu, vai.thayySdt);
    if (vai.thayySdt) {
      expect(ra.phone).toBe("0905123456");
      expect(ra.parentName).toBe("Nguyễn Thị Lan");
    } else {
      expect(ra.phone).not.toBe("0905123456");
      // Không đủ 4 số đầu: mặt nạ chuẩn giữ 3 đầu + 3 cuối. Ca này khoá đúng lỗi
      // đã có thật ở dashboard (mặt nạ tự chế giữ 4 số đầu ⇒ lộ cả đầu số + 1).
      expect(ra.phone).not.toContain("0905");
      expect(ra.parentName).not.toBe("Nguyễn Thị Lan");
      expect(ra.note).not.toContain("thứ 5");
    }
  });

  it("Đào tạo không có quyền xem lead nào — nên không được rơi vào bảng lead của dashboard", () => {
    for (const key of ["leads:view-all", "leads:view-own"] as const) {
      expect((PERMISSIONS[key] as readonly string[]).includes("TRAINING")).toBe(false);
      expect(v2Perms("TRAINING").has(key)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) (a) MÀN ADMIN IN SĐT — chốt chặn nguồn
// ─────────────────────────────────────────────────────────────────────────────
const MAN_ADMIN: { ten: string; file: string }[] = [
  {
    ten: "Dashboard — bảng Leads mới nhất",
    file: "app/(admin)/admin/dashboard/_components/manager-dashboard.tsx",
  },
  {
    ten: "Báo cáo chuyển lead liên cơ sở",
    file: "app/(admin)/admin/leads/bao-cao-chuyen/page.tsx",
  },
  {
    ten: "Chốt hàng loạt (bulk-convert)",
    file: "app/(admin)/admin/leads/bulk-convert/page.tsx",
  },
  {
    ten: "Lớp trải nghiệm — tầng truy vấn",
    file: "app/(admin)/admin/lop-trial/_lib/queries.ts",
  },
  {
    ten: "Chuyển đổi lead (convert v2)",
    file: "app/(admin)/admin/leads/[id]/convert/page.tsx",
  },
  {
    // `orders:create` = SUPER_ADMIN + QL cơ sở + **Kế toán** + Sale. Kế toán chưa
    // bao giờ có `leads:view-pii`, mà `/orders/new?leadId=…` in tên + SĐT phiếu.
    ten: "Tạo đơn hàng gắn lead",
    file: "app/(admin)/admin/orders/new/page.tsx",
  },
  {
    // 25/09/2026 — khối "Lead nguồn" trên hồ sơ học viên (`/students/[id]/edit`) in tên +
    // SĐT + ghi chú của phiếu. Vai sửa hồ sơ học viên KHÔNG trùng khít vai xem PII lead,
    // và dữ liệu lead tới đây bằng đường vòng (học viên → lead) nên dễ quên che. Tầng che
    // là hàm dựng THUẦN — trang và action chỉ nhận chuỗi đã che.
    ten: "Hồ sơ học viên — khối Lead nguồn",
    file: "lib/students/lead-nguon-view.ts",
  },
];

describe("[S-1] màn admin in SĐT lead phải đi qua tầng che duy nhất", () => {
  it.each(MAN_ADMIN)("$ten: dùng maskLeadPiiFields", ({ file }) => {
    // ⚠️ NEO THEO LỜI GỌI, KHÔNG THEO TÊN TRẦN (siết 18/09/2026, luật 11).
    // Bản cũ hỏi `toContain("maskLeadPiiFields")` — dòng `import` cũng chứa đúng chuỗi
    // đó, nên gỡ HẲN lời gọi mà quên gỡ import thì lưới VẪN XANH. Đo được trong lượt rà
    // sau hợp nhất: cấy `const piiLead = lead;` ⇒ 42/42 ca vẫn xanh. Một lưới xanh trên
    // mã đã hỏng là thứ tệ hơn không có lưới.
    const soLoiGoi = (nguon(file).match(/maskLeadPiiFields\(/g) ?? []).length;
    expect(soLoiGoi, `${file}: không thấy LỜI GỌI maskLeadPiiFields(`).toBeGreaterThan(0);
  });

  it.each(MAN_ADMIN)("$ten: quyết định che bằng canViewLeadPii, không suy từ vai", ({ file }) => {
    const s = nguon(file);
    // Hoặc tự hỏi quyền, hoặc nhận `canViewPii` từ chỗ gọi — cả hai đều là một
    // nguồn. Cái bị cấm là tự so vai/centerId tại chỗ (lint no-inline-authz).
    expect(s).toMatch(/canViewLeadPii|canViewPii/);
  });

  it("dashboard: KHÔNG còn mặt nạ tự chế (mặt nạ riêng lộ 4 số đầu, nhiều hơn mặt nạ chuẩn)", () => {
    const s = nguon("app/(admin)/admin/dashboard/_components/manager-dashboard.tsx");
    expect(s).not.toContain("$1xxx$3");
    expect(s).not.toMatch(/phone\.replace\(/);
  });

  it("dashboard: bảng lead chỉ hiện cho người có quyền xem lead (Đào tạo rơi vào panel này)", () => {
    const s = nguon("app/(admin)/admin/dashboard/_components/manager-dashboard.tsx");
    expect(s).toMatch(/leads:view-all/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2b) KHÔNG BAO GIỜ ĐIỀN SẴN BẢN CHE VÀO Ô GHI
// ─────────────────────────────────────────────────────────────────────────────
// Che rồi vẫn hỏng được, theo hướng ngược lại: hai màn chốt đơn đẩy
// `defaultParentName`/`defaultParentPhone` vào `<ConvertForm>`, và
// `submitConvertV2` nhận thẳng giá trị đó từ trình duyệt. SĐT có lưới đỡ (schema
// `phoneVn` từ chối chuỗi đã đục); TÊN thì KHÔNG — bấm Lưu là đẻ ra một phụ huynh
// tên "Nguyễn T. L." trong hồ sơ thật. Nên khi thiếu quyền thì ô phải TRỐNG.
const MAN_CHOT = [
  {
    ten: "Chuyển đổi (admin)",
    file: "app/(admin)/admin/leads/[id]/convert/page.tsx",
    tienTo: "defaultParent",
  },
  {
    ten: "Tạo đơn (admin)",
    file: "app/(admin)/admin/orders/new/page.tsx",
    tienTo: "defaultCustomer",
  },
];

describe("[S-1] màn chốt đơn: thiếu quyền ⇒ ô nhập TRỐNG, không phải bản che", () => {
  it.each(MAN_CHOT)("$ten: prefill rẽ nhánh theo canViewPii", ({ file, tienTo }) => {
    const s = nguon(file);
    const dong = s.split("\n").filter((l) => l.includes(tienTo));
    expect(dong.length).toBeGreaterThan(0);
    for (const l of dong) {
      // Mỗi dòng prefill hoặc tự rẽ nhánh theo quyền, hoặc lấy từ một biến đã rẽ
      // nhánh sẵn (`dienSan` / `khachDienSan`). Cái bị cấm là lấy thẳng từ đối
      // tượng ĐÃ CHE — chuỗi đục sẽ được ghi xuống hồ sơ thật.
      expect(l, l.trim()).toMatch(/canViewPii|DienSan|dienSan/);
      expect(l, l.trim()).not.toMatch(/piiLead|masked/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) (c) Ô TÌM THEO SĐT — rò GIÁN TIẾP, phải gác bằng chính quyền xem SĐT
// ─────────────────────────────────────────────────────────────────────────────
describe("[S-1] buildBookingListWhere — ô tìm buổi hẹn học thử", () => {
  const layOr = (w: ReturnType<typeof buildBookingListWhere>) =>
    ((w.lead as { OR?: unknown[] } | undefined)?.OR ?? []) as Record<string, unknown>[];

  it("có quyền xem SĐT → tìm được theo SĐT", () => {
    const or = layOr(buildBookingListWhere("all", { q: "0905123456", canSearchPhone: true }));
    expect(or.some((c) => "phone" in c)).toBe(true);
  });

  it("KHÔNG có quyền xem SĐT → mệnh đề SĐT biến mất (không dò được số)", () => {
    const or = layOr(buildBookingListWhere("all", { q: "0905123456", canSearchPhone: false }));
    expect(or.some((c) => "phone" in c)).toBe(false);
    // Vẫn tìm được theo tên — che SĐT không được biến ô tìm thành vô dụng.
    expect(or.some((c) => "parentName" in c)).toBe(true);
  });

  it("mặc định (không truyền cờ) là ĐÓNG — quên truyền phải fail-closed", () => {
    const or = layOr(buildBookingListWhere("all", { q: "0905123456" }));
    expect(or.some((c) => "phone" in c)).toBe(false);
  });
});

// 22/09/2026 — site Sale GỠ. Hai ca dưới đây trước trỏ vào `app/(sale)/…`; giữ
// nguyên BẤT BIẾN, chỉ đổi sang màn đã thay thế trong admin. Bỏ hẳn hai ca này là
// mất lưới đúng lúc màn đổi chủ — chính là lúc dễ rơi nhất.
describe("[S-1] ô tìm khách gác bằng quyền xem SĐT", () => {
  it("getMyLeads nhận cờ và chỉ thêm mệnh đề phone khi cờ bật", () => {
    const s = nguon("lib/lead/sale-leads.ts");
    expect(s).toMatch(/canSearchPhone/);
  });

  it("trang Danh sách khách TRUYỀN cờ xuống — tính rồi bỏ quên là y như không gác", () => {
    const s = nguon("app/(admin)/admin/leads/page.tsx");
    expect(s).toMatch(/canSearchPhone/);
  });

  it("hàng đợi trên bảng điều khiển Sale che tên khách theo cùng một tầng", () => {
    // Trước ở `app/(sale)/sale/page.tsx` ("Bảng việc hôm nay"). Màn đó nay là khối
    // "Hàng đợi hôm nay" + "Khách cần chạm" trong bảng điều khiển của admin — cả hai
    // in tên phụ huynh, nên cả hai phải che ở SERVER qua cùng một cổng.
    const s = nguon("app/(admin)/admin/dashboard/_components/sales-dashboard.tsx");
    expect(s).toMatch(/tenKhach: canViewPii \? [\w.]+ : maskPersonName\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) Ô tìm ứng viên xếp lớp trải nghiệm (Server Action)
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ NỢ ĐÃ BIẾT — 22/09/2026, gỡ site Sale.
//
// Ở đây từng có ca khoá màn `/sale/trial`: cột Phụ huynh phải gác bằng phép VÀ của
// `canViewParentContact` VÀ `canViewLeadPii`, vì `canViewParentContact` một mình
// vẫn cho Quản lý cơ sở + Kế toán đi qua — hai vai KHÔNG có `leads:view-pii`.
//
// Màn đó gỡ cùng site. Màn trải nghiệm của admin (`/admin/lop-trial`) gác bằng
// `canViewPii` truyền xuống `buildBookingListWhere`, tức KHÁC hình dạng — không
// dán lại ca cũ vào đó được, và bịa một ca khớp hình dạng mới mà chưa đọc kỹ màn
// ấy thì chỉ là một dòng xanh giả. Ghi lại để người rà màn trải nghiệm admin lần
// tới dựng lưới cho đúng chỗ, thay vì im lặng bỏ đi.

describe("[S-1] searchLopTrialCandidatesAction — ô tìm ứng viên", () => {
  it("mệnh đề phone gác bằng quyền xem SĐT, không đứng trần", () => {
    const s = nguon("app/(admin)/admin/lop-trial/_actions.ts");
    expect(s).toMatch(/canViewLeadPii|canSearchPhone/);
    expect(s).not.toMatch(/^\s*\{ phone: \{ contains: qPhone \} \},\s*$/m);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5) S2 — nút "Nhắn Zalo" trên phiếu lead: SỐ THẬT đi vào URL, và chỉ khi được xem
// ─────────────────────────────────────────────────────────────────────────────
// Trang chi tiết lead KHÔNG nằm trong `MAN_ADMIN` ở trên (nó vốn đã che đúng), nên
// phần thêm mới ở đó không có lưới nào. Nút này đưa SĐT vào QUERY STRING — thứ nằm
// lại trong lịch sử trình duyệt, trong Referer, và trong log của mọi proxy ở giữa —
// nên đáng một chốt chặn riêng, đúng hai chiều:
//   • lấy nhầm bản CHE (`piiLead.phone`) ⇒ ZaloCRM tra ra rỗng, hỏng CÂM;
//   • lấy số thật mà QUÊN rẽ nhánh `canViewPii` ⇒ rò SĐT cho vai không được xem.
const TRANG_PHIEU_LEAD = "app/(admin)/admin/leads/[id]/page.tsx";

describe("[S-1b] nút Nhắn Zalo — số thật, và chỉ trong nhánh được xem SĐT", () => {
  it("dựng URL qua hàm thuần duongDanNhanZalo, không tự ghép chuỗi ?compose=", () => {
    const s = nguon(TRANG_PHIEU_LEAD);
    expect(s).toContain("duongDanNhanZalo");
    // Tự ghép tại chỗ là mất phần chuẩn hoá `84…`; ZaloCRM lọc `/^84\d{8,10}$/` và
    // BỎ HẲN tham số sai khuôn ⇒ hộp soạn tin mở trống mà không báo lỗi.
    expect(s).not.toMatch(/\?compose=/);
  });

  it("KHÔNG truyền bản đã che vào URL", () => {
    const s = nguon(TRANG_PHIEU_LEAD);
    const dong = s.split("\n").filter((l) => l.includes("duongDanNhanZalo("));
    expect(dong.length).toBeGreaterThan(0);
    for (const l of dong) expect(l, l.trim()).not.toMatch(/piiLead|masked/);
  });

  it("chỉ dựng URL trong nhánh canViewPii — SĐT là PII, và nó nằm trên query string", () => {
    const s = nguon(TRANG_PHIEU_LEAD);
    const tatCa = s.split("\n");
    const viTri = tatCa
      .map((l, i) => [l, i] as const)
      .filter(([l]) => l.includes("duongDanNhanZalo("));
    // Không có dòng nào thì mọi `for` dưới đây xanh giả — chốt lại số lượng trước.
    expect(viTri.length).toBeGreaterThan(0);
    // Soi CÂU LỆNH (dòng gọi + 2 dòng ngay trên) chứ không soi riêng dòng vật lý: từ
    // 13/09/2026 lời gọi có thêm tham số `?org=` nên nó xuống dòng, còn điều kiện
    // `canViewPii && …` nằm ở dòng `const` phía trên. Cửa sổ 2 dòng GIỮ NGUYÊN răng của
    // ca này — gỡ hẳn cổng PII thì không dòng nào trong cửa sổ có `canViewPii`, vẫn đỏ.
    for (const [l, i] of viTri) {
      const cuaSo = tatCa.slice(Math.max(0, i - 2), i + 1).join("\n");
      expect(cuaSo, l.trim()).toMatch(/canViewPii/);
    }
  });
});
