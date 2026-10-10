/**
 * AI ĐƯỢC SỬA Ô NÀO CỦA LEAD — chốt 17/09/2026.
 *
 * Bộ này canh HAI thứ, và cả hai đều hỏng IM LẶNG nếu không có nó:
 *   · luật thuần (ô nào khoá, ghi chú nối thế nào) — `lib/lead/quyen-sua-lead.ts`;
 *   · luật ấy CÓ được nối vào cả NĂM mặt hay không (lưới ghim mã nguồn, luật 9 + 12b).
 *
 * Năm mặt, vì một quyền mà hở một mặt là thừa: không sửa được `source` ở biểu mẫu thì nhập
 * một file Excel một dòng có tick Đè, hoặc gọi thẳng Server Action. Bịt bốn cửa, để hở một
 * cửa, là chưa bịt cửa nào.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  O_KHOA_LEAD,
  O_SALE_SUA_DUOC,
  laOKhoa,
  loiOKhoa,
  noiThemGhiChu,
  oKhoaBiDung,
} from "./quyen-sua-lead";

const LUU = {
  parentName: "Chị Lan",
  phone: "84987654321",
  email: "lan@cu.vn",
  childName: "Bé An",
  childAge: 8,
  centerId: "cs1",
  orgUnitId: "ou_cs1",
  courseId: "kh_robot",
  source: "Website",
  note: "Gọi 12/09: khách bận.",
};

describe("[QUYEN-T10] ba ô KHOÁ, và chỉ ba ô đó", () => {
  it("đúng bộ SĐT · cơ sở · đơn vị · nguồn", () => {
    expect([...O_KHOA_LEAD].sort()).toEqual(["centerId", "orgUnitId", "phone", "source"]);
  });

  it("⚠️ `orgUnitId` PHẢI nằm cạnh `centerId`", () => {
    // Người dùng thấy đúng MỘT ô "Đơn vị", nhưng biểu mẫu gửi `orgUnitId` còn `centerId`
    // được suy ra từ nó (dual-write). Khoá mỗi `centerId` là khoá cái tên mà biểu mẫu
    // không gửi — nghe như đã khoá, thực tế ô vẫn đổi được.
    expect(laOKhoa("orgUnitId")).toBe(true);
    expect(laOKhoa("centerId")).toBe(true);
  });

  it("ô Sale sửa được thì KHÔNG bị khoá — hai danh sách không giẫm nhau", () => {
    for (const o of O_SALE_SUA_DUOC) expect(laOKhoa(o), o).toBe(false);
  });

  it("đủ bộ chủ dự án liệt kê: tên PH · email · tên con · tuổi con · khoá quan tâm · ghi chú", () => {
    for (const o of ["parentName", "email", "childName", "childAge", "courseId", "note"]) {
      expect((O_SALE_SUA_DUOC as readonly string[]).includes(o), o).toBe(true);
    }
  });
});

describe("[QUYEN-T11] ⚠️ chỉ chặn ô THỰC SỰ ĐỔI", () => {
  it("gửi nguyên giá trị cũ ⇒ KHÔNG coi là vi phạm", () => {
    // Biểu mẫu gửi CẢ PHIẾU, nên `source` luôn có mặt dù người dùng không sờ tới. Chặn
    // theo "có mặt" là Sale không lưu nổi một lượt sửa tên con — đúng luật mà sai việc,
    // và họ sẽ báo là màn hình hỏng chứ không báo là bị chặn.
    const gui = { ...LUU, childName: "Bé Bo" };
    expect(oKhoaBiDung({ oGui: gui, dangLuu: LUU })).toEqual([]);
  });

  it("đổi nguồn ⇒ vi phạm", () => {
    expect(oKhoaBiDung({ oGui: { source: "Facebook" }, dangLuu: LUU })).toEqual(["source"]);
  });

  it("đổi SĐT ⇒ vi phạm", () => {
    expect(oKhoaBiDung({ oGui: { phone: "84900000000" }, dangLuu: LUU })).toEqual(["phone"]);
  });

  it("đổi đơn vị ⇒ vi phạm, kể cả khi chỉ gửi `orgUnitId`", () => {
    expect(oKhoaBiDung({ oGui: { orgUnitId: "ou_cs2" }, dangLuu: LUU })).toEqual(["orgUnitId"]);
  });

  it("ô không gửi lên thì không xét", () => {
    expect(oKhoaBiDung({ oGui: { childAge: 9 }, dangLuu: LUU })).toEqual([]);
  });

  it("`undefined` là KHÔNG GỬI, không phải xoá", () => {
    expect(oKhoaBiDung({ oGui: { source: undefined }, dangLuu: LUU })).toEqual([]);
  });

  it('`null` và `""` cùng nghĩa để trống — đổi cách viết không phải là đổi giá trị', () => {
    expect(oKhoaBiDung({ oGui: { orgUnitId: "" }, dangLuu: { orgUnitId: null } })).toEqual([]);
    expect(oKhoaBiDung({ oGui: { orgUnitId: null }, dangLuu: { orgUnitId: "" } })).toEqual([]);
  });

  it("⚠️ nhưng ĐẶT giá trị vào ô đang trống VẪN là vi phạm", () => {
    // Lead chưa có đơn vị mà Sale tự gán một cơ sở thì cũng là quyết định của quản lý.
    expect(oKhoaBiDung({ oGui: { orgUnitId: "ou_cs2" }, dangLuu: { orgUnitId: null } })).toEqual([
      "orgUnitId",
    ]);
  });

  it("nhiều ô cùng lúc ⇒ liệt kê đủ, và câu lỗi nói tên tiếng Việt", () => {
    const v = oKhoaBiDung({ oGui: { phone: "0900000000", source: "X" }, dangLuu: LUU });
    expect(v.sort()).toEqual(["phone", "source"]);
    const c = loiOKhoa(v);
    expect(c).toContain("SĐT");
    expect(c).toContain("nguồn");
    expect(c).not.toContain("parentName");
    // Phải nói ai mở được — người bị chặn cần biết đi hỏi ai.
    expect(c).toContain("Quản lý cơ sở");
  });

  it("câu lỗi KHÔNG lặp tên khi cả `centerId` lẫn `orgUnitId` cùng vi phạm", () => {
    // Hai cột, một ô trên màn hình. In "đơn vị, đơn vị" là tự tố cáo bộ máy bên trong.
    const c = loiOKhoa(["centerId", "orgUnitId"]);
    expect(c.match(/đơn vị/g)?.length).toBe(1);
  });
});

describe("[QUYEN-T12] ⚠️ GHI CHÚ chỉ được NỐI THÊM", () => {
  it("gõ tiếp xuống dưới ⇒ giữ cũ, nối phần mới", () => {
    expect(noiThemGhiChu("A", "A\nB")).toBe("A\nB");
  });

  it("⚠️ XOÁ phần của người khác rồi lưu ⇒ phần cũ VẪN CÒN", () => {
    // Đây là ca sinh ra luật này. Ô nhập nạp sẵn ghi chú cũ rồi gửi lại cả chuỗi; bôi đen
    // xoá một đoạn của đồng nghiệp rồi bấm Lưu là mất vĩnh viễn, không màn hình nào cảnh
    // báo. Nối ở SERVER là cách duy nhất chắc chắn.
    const ra = noiThemGhiChu("Gọi 12/09: khách bận.", "Tôi gõ đè lên");
    expect(ra).toContain("Gọi 12/09: khách bận.");
    expect(ra).toContain("Tôi gõ đè lên");
  });

  it("chưa có ghi chú nào ⇒ lấy nguyên phần gõ", () => {
    expect(noiThemGhiChu(null, "Lần đầu")).toBe("Lần đầu");
    expect(noiThemGhiChu("", "Lần đầu")).toBe("Lần đầu");
  });

  it("không gõ gì ⇒ `null`, KHÔNG ghi gì cả", () => {
    expect(noiThemGhiChu("A", "")).toBeNull();
    expect(noiThemGhiChu("A", null)).toBeNull();
    expect(noiThemGhiChu("A", "   ")).toBeNull();
  });

  it("lưu lại y nguyên ⇒ `null`, không nhân đôi", () => {
    expect(noiThemGhiChu("A", "A")).toBeNull();
  });

  it("phần gửi đã nằm sẵn trong ghi chú cũ ⇒ không nối bản sao", () => {
    expect(noiThemGhiChu("A\nB", "B")).toBeNull();
  });

  it("nối ba lượt liên tiếp vẫn giữ đủ ba", () => {
    let n: string | null = noiThemGhiChu(null, "một");
    n = noiThemGhiChu(n, `${n}\nhai`);
    n = noiThemGhiChu(n, `${n}\nba`);
    expect(n).toBe("một\nhai\nba");
  });
});

describe("[QUYEN-T13] ⚠️ luật NÀY phải được nối vào cả NĂM mặt", () => {
  // Hàm thuần đúng không chứng minh được gì nếu đường ghi không gọi (lớp lỗi RT-1).
  // Một quyền mà hở một cửa là chưa bịt cửa nào.
  const doc = (p: string) => {
    const duong = path.join(process.cwd(), p);
    expect(fs.existsSync(duong), `${duong} không còn ở chỗ cũ`).toBe(true);
    return fs.readFileSync(duong, "utf8");
  };
  /**
   * Gỡ chú thích THEO DÒNG, không phải bằng một regex quét cả tệp.
   *
   * ⚠️ Bản đầu dùng regex `/* … *\/` như mấy bộ trước. ĐO ra: nó NUỐT 52/67 KB của
   * `seed-roles.ts` và 26/50 KB của `permissions.ts` — dòng khai quyền cần soi biến mất,
   * nên cổng ĐỎ dù mã đúng.
   *
   * Lần này nó đỏ nên lộ ra ngay. Nhưng cùng bộ gỡ ấy đứng trước một khẳng định PHỦ ĐỊNH
   * (`.not.toContain`) thì nó XANH GIẢ: vi phạm thật bị xoá khỏi chuỗi trước khi soi, và
   * không ai biết. Đúng lớp lỗi luật 11 đã ghi ba lần trong repo.
   *
   * Cách này chỉ bỏ dòng MỞ ĐẦU bằng `//`, `/*`, `*` — đúng hình dạng chú thích của repo —
   * nên không thể ăn lem sang mã.
   */
  const goChuThich = (s: string) =>
    s
      .split("\n")
      .filter((d) => {
        const t = d.trim();
        return !(t.startsWith("//") || t.startsWith("/*") || t.startsWith("*"));
      })
      .join("\n");

  const ACTIONS = goChuThich(doc("app/(admin)/admin/leads/actions.ts"));
  const ROUTE = goChuThich(doc("app/api/admin/import/leads/route.ts"));
  const TRANG_NHAP = goChuThich(doc("app/(admin)/admin/leads/import/page.tsx"));
  const TRANG_SUA = goChuThich(doc("app/(admin)/admin/leads/[id]/edit/page.tsx"));
  const V1 = goChuThich(doc("lib/auth/permissions.ts"));
  const SEED = goChuThich(doc("prisma/seed-roles.ts"));

  it("phép quét tự kiểm: đọc được cả sáu tệp, bộ gỡ chú thích hoạt động", () => {
    for (const [t, s] of Object.entries({ ACTIONS, ROUTE, TRANG_NHAP, TRANG_SUA, V1, SEED })) {
      expect(s.length, t).toBeGreaterThan(200);
    }
    const thu = ["// leads:overwrite", " * leads:overwrite", "giu lai"].join(
      String.fromCharCode(10),
    );
    expect(goChuThich(thu)).toBe("giu lai");
  });

  it("⚠️ bộ gỡ chú thích KHÔNG được ăn lem vào mã", () => {
    // Cổng này tự canh CHÍNH NÓ. Một bộ gỡ ăn quá tay biến mọi khẳng định PHỦ ĐỊNH thành
    // XANH GIẢ: vi phạm bị xoá khỏi chuỗi trước khi soi, và không ai biết.
    for (const [ten, tho] of Object.entries({
      "seed-roles.ts": doc("prisma/seed-roles.ts"),
      "permissions.ts": doc("lib/auth/permissions.ts"),
      "actions.ts": doc("app/(admin)/admin/leads/actions.ts"),
    })) {
      const con = goChuThich(tho).length / tho.length;
      expect(con, `${ten} chỉ còn ${Math.round(con * 100)}% sau khi gỡ chú thích`).toBeGreaterThan(
        0.3,
      );
    }
  });

  it("mặt 1 — sửa tay: `updateLeadFields` gọi `oKhoaBiDung`", () => {
    expect(ACTIONS).toContain("oKhoaBiDung(");
    expect(ACTIONS).toContain("loiOKhoa(");
  });

  it("⚠️ mặt 1b — phép kiểm ấy phải CHẠY THẬT, và chỉ khi THIẾU quyền", () => {
    // Ca này sinh ra từ một XANH GIẢ đo được: đổi `if (!duocDe)` thành `if (false)` — tức
    // gỡ sạch khoá, Sale sửa được cả ba ô — mà cả bộ vẫn XANH. Vì cổng chỉ tìm TÊN HÀM,
    // và một lời gọi nằm trong nhánh chết vẫn là một lời gọi có mặt trong tệp.
    //
    // Nên phải neo vào CHÍNH điều kiện: `!duocDe`, không phải `true`/`false`.
    expect(ACTIONS).toContain("if (!duocDe) {");
    expect(ACTIONS).not.toContain("if (false) {");
    // Và `duocDe` phải đến từ câu hỏi quyền thật, không phải một hằng gán tay.
    expect(ACTIONS).toContain("const duocDe = await checkPermission('leads:overwrite')");
    expect(ACTIONS).not.toMatch(/const duocDe\s*=\s*(true|false)/);
  });

  it("mặt 2 — ghi chú: cả HAI đường ghi đều nối thêm", () => {
    // `updateLeadNote` (ô ghi chú riêng) và `updateLeadFields` (biểu mẫu đầy đủ). Vá một
    // đường mà quên đường kia thì lỗ chỉ chuyển chỗ chứ không mất.
    expect((ACTIONS.match(/noiThemGhiChu\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("mặt 3 — nhập Excel: route GÁC cờ `ghiDe` bằng quyền", () => {
    // Ẩn cột ở giao diện không phải là chặn: endpoint gọi thẳng bằng `curl` kèm
    // `ghiDe: [0,1,2]` là đè được hết.
    expect(ROUTE).toContain('checkPermission("leads:overwrite")');
    expect(ROUTE).toContain("duocDe ? (body as { ghiDe?: unknown })?.ghiDe : null");
  });

  it("mặt 4 — màn nhập: hỏi quyền ở SERVER rồi mới bày cột Đè", () => {
    expect(TRANG_NHAP).toContain('checkPermission("leads:overwrite")');
    expect(TRANG_NHAP).toContain("duocDe");
  });

  it("mặt 5 — biểu mẫu sửa lead: truyền quyền xuống form", () => {
    expect(TRANG_SUA).toContain('checkPermission("leads:overwrite")');
    expect(TRANG_SUA).toContain("duocDe");
  });

  it("⚠️ khoá quyền có mặt ở CẢ HAI tầng RBAC", () => {
    // v1 chạy ở local/dev/CI, v2 (DB) enforce trên prod. Khai một tầng là hành vi lệch
    // giữa nơi mình thử và nơi người dùng chạy — đúng cái bẫy CLAUDE.md ghi sẵn.
    expect(V1).toContain('"leads:overwrite"');
    expect(SEED).toContain('action: "leads:overwrite"');
  });

  it("⚠️ Sale và Marketing KHÔNG được cấp quyền đè ở v1", () => {
    const dong = V1.split("\n").find((l) => l.includes('"leads:overwrite":'));
    expect(dong, "không thấy dòng khai leads:overwrite").toBeDefined();
    expect(dong).toContain("SUPER_ADMIN");
    expect(dong).toContain("CENTER_MANAGER");
    expect(dong).not.toContain("SALES_CSM");
    expect(dong).not.toContain("MARKETING");
  });
});
