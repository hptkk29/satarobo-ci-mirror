/**
 * "Lần nhập gần nhất" trên danh sách lead — cột mới + sắp xếp (bước 7).
 *
 * Vì sao phải mở trình duyệt thật cho một cột: hai thứ đắt nhất ở đây KHÔNG thấy
 * được bằng typecheck.
 *   1. `nulls: "last"` — lead chưa có mốc phải nằm CUỐI. Thiếu khai thì Postgres xếp
 *      NULL lên đầu ở chiều `desc`, tức đúng nhóm cũ nhất lại chiếm đầu bảng;
 *   2. trang có render nổi không sau khi đổi chữ ký props của bảng.
 *
 * CHẠY: cần Postgres LOCAL (pnpm db:test:up) — không chạy trên Supabase.
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { login } from "../_helpers/auth";
import { testEmail } from "../_helpers/fixtures";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { LEAD_COLUMNS_STORAGE_KEY, cotMacDinh } from "../../../lib/tables/lead-columns";

/**
 * Bật cột "Lần nhập gần nhất" TRƯỚC khi mở trang.
 *
 * 30/08 — cột này nay MẶC ĐỊNH ẨN (chủ dự án chốt), lựa chọn lưu ở `localStorage`.
 * Không bật trước thì spec đi tìm một đầu cột không tồn tại — đúng lỗi CI bắt được
 * ngay lượt đầu sau khi đổi mặc định.
 */
async function batCotNhapLai(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(
    ([khoa, cot]) => {
      try {
        window.localStorage.setItem(khoa as string, JSON.stringify(cot));
      } catch {
        /* trình duyệt chặn site data — ca này sẽ đỏ, và đỏ đúng */
      }
    },
    [LEAD_COLUMNS_STORAGE_KEY, [...cotMacDinh(), "lastInboundAt"]] as const,
  );
}

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };

/**
 * Quản trị THẬT: phải có `UserOrgRole`, không chỉ `User.role`.
 *
 * `resolveActor` suy `isSuperAdmin` từ vai neo trên cây tổ chức; thiếu nó thì
 * `visibleCenterIds` rỗng và `scopedDb` lọc sạch bảng lead — trang vẫn mở, chỉ hiện
 * "Chưa có lead nào". Bản đầu của spec này dính đúng bẫy đó.
 */
async function adminThat(slug: string): Promise<string> {
  const u = await seedUser({ email: testEmail(slug), role: "SUPER_ADMIN" });
  const ou = (await db.orgUnit.findUnique({ where: { code: "CS1" }, select: { id: true } }))!;
  const role = (await db.roleDef.findUnique({ where: { code: "SUPER_ADMIN" }, select: { id: true } }))!;
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: ou.id,
    roleId: role.id,
    reason: "seed spec lần nhập gần nhất",
  });
  return u.id;
}

test.describe("[LNGN] Lần nhập gần nhất", () => {
  let cs1 = "";

  test.beforeEach(async () => {
    await resetDb();
    await db.center.create({
      data: { code: "CS1", name: "CS1", slug: "cs1-lngn", address: "a", city: "" },
    });
    await seedOrg(["HO", "CS1", "CS2"]);
    await seedRoles();
    cs1 = (await db.orgUnit.findUnique({ where: { code: "CS1" }, select: { centerId: true } }))!
      .centerId!;
  });

  test("[LNGN-01] cột hiện ra, sắp theo lần nhập gần nhất, lead chưa có mốc nằm CUỐI", async ({
    page,
  }) => {
    const cu = new Date("2026-01-01T03:00:00Z");
    const moi = new Date("2026-08-29T03:00:00Z");

    // A: tạo lâu rồi nhưng khách VỪA quay lại  → phải đứng đầu khi sắp theo lần nhập.
    await db.lead.create({
      data: { parentName: "PH A quay lai", phone: "84900000001", centerId: cs1, createdAt: cu, lastInboundAt: moi },
    });
    // B: tạo gần đây, không ai nhập lại.
    await db.lead.create({
      data: { parentName: "PH B moi tao", phone: "84900000002", centerId: cs1, createdAt: moi, lastInboundAt: moi },
    });
    // C: lead cũ CHƯA CÓ MỐC (đường ghi SQL thô) → phải nằm cuối, không phải đầu.
    await db.lead.create({
      data: { parentName: "PH C khong moc", phone: "84900000003", centerId: cs1, createdAt: cu, lastInboundAt: null },
    });

    await adminThat("lngn-admin");
    await batCotNhapLai(page);
    await login(page, { email: testEmail("lngn-admin"), callbackUrl: "/admin/leads" });

    await page.goto("/admin/leads?view=table&sort=nhap_lai");
    await expect(page.getByRole("link", { name: /Lần nhập gần nhất/ })).toBeVisible({
      timeout: 30_000,
    });

    // Đọc cột tên phụ huynh theo đúng thứ tự bảng đang hiển thị.
    const ten = await page.locator("tbody tr td:first-child").allInnerTexts();
    const chiSo = (s: string) => ten.findIndex((t) => t.includes(s));
    expect(chiSo("PH C khong moc"), "lead chưa có mốc phải nằm CUỐI").toBe(ten.length - 1);
    expect(chiSo("PH A quay lai")).toBeLessThan(chiSo("PH C khong moc"));
    expect(chiSo("PH B moi tao")).toBeLessThan(chiSo("PH C khong moc"));
  });

  /**
   * ⚠️ ĐẢO CHỐT 29/08 — chủ dự án quyết 07/09/2026.
   *
   * Bản trước của ca này khoá luật NGƯỢC LẠI: "mặc định vẫn sắp theo NGÀY TẠO — không
   * lặng lẽ đổi thứ tự quen thuộc", với lý do người dùng cũ mở bảng ra thấy thứ tự lạ.
   * Lý do đó vẫn đúng, nhưng chủ dự án cân nhắc và chọn đánh đổi: Sale phải THẤY được
   * phiếu khách quay lại thì mới gọi lại được, mà nằm dưới đáy thì không ai thấy.
   *
   * Ca này ĐỎ đúng lúc bản vá 07/09 lần đầu chạy CI — nó làm đúng việc của nó, nên được
   * SỬA sang khoá luật mới chứ không bị xoá. Ai đảo lại lần nữa thì cũng phải đi qua đây.
   *
   * Kèm khoá luôn phần HIỂN THỊ: hai thứ đó phải đi cùng nhau. In ngày mới mà sắp theo
   * ngày tạo là phiếu hiện ngày hôm nay nằm ở vị trí ba tháng trước, ngay dưới một cột
   * đang có mũi tên sắp xếp.
   */
  test("[LNGN-02] mặc định sắp theo LẦN NHẬP GẦN NHẤT — phiếu khách quay lại lên đầu", async ({
    page,
  }) => {
    const cu = new Date("2026-01-01T03:00:00Z");
    const moi = new Date("2026-08-29T03:00:00Z");
    await db.lead.create({
      // Tạo lâu rồi nhưng VỪA NHẬP LẠI ⇒ phải lên TRÊN.
      data: { parentName: "PH cu quay lai", phone: "84900000004", centerId: cs1, createdAt: cu, lastInboundAt: moi },
    });
    await db.lead.create({
      // Tạo sau nhưng KHÔNG quay lại ⇒ nằm dưới.
      data: { parentName: "PH tao sau", phone: "84900000005", centerId: cs1, createdAt: moi, lastInboundAt: cu },
    });

    await adminThat("lngn-admin2");
    await batCotNhapLai(page);
    await login(page, { email: testEmail("lngn-admin2"), callbackUrl: "/admin/leads" });
    await page.goto("/admin/leads?view=table");
    await expect(page.getByRole("link", { name: /Lần nhập gần nhất/ })).toBeVisible({
      timeout: 30_000,
    });

    const ten = await page.locator("tbody tr td:first-child").allInnerTexts();
    expect(ten.findIndex((t) => t.includes("PH cu quay lai"))).toBeLessThan(
      ten.findIndex((t) => t.includes("PH tao sau")),
    );

    // HIỂN THỊ: dòng khách quay lại phải mang nhãn, và phải in mốc MỚI (29/08) chứ không
    // phải ngày tạo (01/01). Thiếu vế này thì đổi thứ tự mà quên đổi ô ngày vẫn xanh.
    const dongQuayLai = page.locator("tbody tr", { hasText: "PH cu quay lai" }).first();
    await expect(dongQuayLai).toContainText("nhập lại");
    await expect(dongQuayLai).toContainText("29/08/2026");
    await expect(dongQuayLai).not.toContainText("01/01/2026");
  });
});
