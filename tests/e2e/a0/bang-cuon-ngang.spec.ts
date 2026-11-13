/**
 * 09/09/2026 — BẢNG RỘNG PHẢI CUỘN NGANG ĐƯỢC, VÀ PHẢI CÓ GÌ ĐÓ BÁO LÀ CUỘN ĐƯỢC.
 *
 * Chủ dự án báo: màn Danh mục mã ca bị cắt từ cột thứ bảy, "không cuộn ngang tới được".
 * Đo trên prod thì **cuộn được**: đặt `scrollLeft` là cột "Hành động" về đúng mép. Cái
 * thiếu là AFFORDANCE — thanh cuộn nằm ở đáy bảng 21 dòng, cách hàng tiêu đề ~1000px,
 * nên trong tầm mắt không có gì báo. Luật 12 ở dạng ngược: khả năng có thật, không ai
 * biết.
 *
 * ⚠️ VÌ SAO TEST QUA TRÌNH DUYỆT (luật 11): thứ cần khẳng định là HÀNH VI —
 * `scrollWidth > clientWidth`, đặt `scrollLeft` thì cột cuối tới được, và lớp phủ chỉ
 * hiện khi THẬT SỰ còn nội dung bên đó. Grep class name không chứng minh được điều nào
 * trong ba điều đó: một `overflow-x-auto` nằm trong khối `width: 0` vẫn khớp grep mà
 * không cuộn nổi.
 *
 * ⚠️ Đặt ở `tests/e2e/a0` vì đó là bộ DUY NHẤT có trình duyệt + webServer :3100 +
 * Postgres local (job "E2E Phase R7" cố ý không cài browser — xem
 * `class-roster-actions.spec.ts`).
 *
 * Phủ:
 *  B1 — vùng cuộn của bảng mã ca THỰC SỰ rộng hơn khung (có gì để cuộn).
 *  B2 — đặt `scrollLeft` thì cột CUỐI CÙNG ("Hành động") lọt vào khung.
 *  B3 — lớp phủ mép PHẢI hiện khi còn nội dung bên phải, và BIẾN MẤT khi cuộn hết.
 *  B4 — lớp phủ mép TRÁI ngược lại: ẩn lúc đầu, hiện sau khi cuộn.
 *  B5 — lớp phủ KHÔNG nuốt click (pointer-events: none) — nếu không thì nó che mất
 *       chính cột "Hành động" mà nó vừa chỉ đường tới.
 */
import { test, expect, type Page } from "@playwright/test";

import { db } from "../../../lib/db";
import { login } from "../_helpers/auth";
import { resetDb, seedOrg, seedRoles, seedUser } from "../_helpers/seed";
import { assignUserOrgRole, type RbacActor } from "../../../lib/auth/rbac-service";
import { seedShiftTemplates } from "../../../lib/cham-cong/seed-core";

const SA: RbacActor = { id: "seed-sa", name: "SA", role: "SUPER_ADMIN" };
const EMAIL = "cuonngang@smoke.test";

/** `actor.isSuperAdmin` suy từ `UserOrgRole`, KHÔNG từ `User.role` — thiếu dòng này thì
 *  `scopedDb` chèn `centerId IN []` và trang trả 404. */
async function seedAdmin() {
  const u = await seedUser({ email: EMAIL, role: "SUPER_ADMIN" });
  const root = await db.orgUnit.findFirst({
    where: { code: "SATAROBO" },
    select: { id: true },
  });
  const org =
    root ??
    (await db.orgUnit.findFirstOrThrow({
      where: { code: "HO" },
      select: { id: true },
    }));
  const role = await db.roleDef.findUniqueOrThrow({
    where: { code: "SUPER_ADMIN" },
    select: { id: true },
  });
  await assignUserOrgRole(SA, {
    userId: u.id,
    orgUnitId: org.id,
    roleId: role.id,
    reason: "smoke cuộn ngang",
  });
}

/** Vùng cuộn của bảng nhiều cột trên trang. */
const VUNG = ".overflow-x-auto";

async function doVung(page: Page) {
  return page.evaluate((sel) => {
    const el = [...document.querySelectorAll<HTMLElement>(sel)].find(
      (e) => !!e.querySelector("table thead th:nth-child(6)"),
    );
    if (!el) return null;
    const tb = el.querySelector("table")!;
    const cuoi = tb.querySelector("thead th:last-child")!;
    return {
      w: el.clientWidth,
      sw: el.scrollWidth,
      scrollLeft: Math.round(el.scrollLeft),
      cotCuoiThua: Math.round(
        cuoi.getBoundingClientRect().right - el.getBoundingClientRect().right,
      ),
      tenCotCuoi: cuoi.textContent?.trim() ?? "",
    };
  }, VUNG);
}

async function datScrollLeft(page: Page, x: number) {
  await page.evaluate(
    ({ sel, x: gt }) => {
      const el = [...document.querySelectorAll<HTMLElement>(sel)].find(
        (e) => !!e.querySelector("table thead th:nth-child(6)"),
      );
      if (el) el.scrollLeft = gt;
    },
    { sel: VUNG, x },
  );
  // Cho `scroll` listener chạy rồi React vẽ lại lớp phủ.
  await page.waitForTimeout(150);
}

/**
 * Khung bảng — cha TRỰC TIẾP của vùng cuộn. Hai lớp phủ là con của chính nó
 * (`components/ui/phan-trang-bang.tsx`: `<div relative><div overflow-x-auto>…</div>` + hai phủ).
 */
const khungBang = (page: Page) =>
  page.locator("div:has(> div.overflow-x-auto)").filter({
    has: page.locator("table thead th:nth-child(6)"),
  });

/**
 * ⚠️ PHẢI GIỚI HẠN TRONG KHUNG BẢNG, KHÔNG QUÉT CẢ TRANG.
 *
 * Bản đầu tìm `[class*="inset-y-0"][class*="left-0"][class*="shadow-"]` trên toàn trang. Ngày
 * 13/09/2026 nó đỏ thật: khung admin mới (`components/admin/admin-shell.tsx`) có ngăn kéo điện
 * thoại mang đúng `absolute inset-y-0 left-0 w-64 shadow-xl`. Ngăn kéo ấy `md:hidden` nên ở
 * 1280px nó `display:none` — nhưng `toHaveCount` đếm cả phần tử ẩn, nên ca "chưa cuộn ⇒ KHÔNG
 * có vệt trái" nhận 1 thay vì 0. Đỏ cả 3 lượt thử lại, không phải flake.
 *
 * Đây đúng lớp mong manh mà luật 11 nói: bộ chọn theo HÌNH DẠNG CLASS bắt nhầm bất kỳ thành
 * phần nào tình cờ dùng chung tổ hợp tiện ích — và Tailwind thì tổ hợp nào cũng có người dùng
 * lại. Neo vào khung bảng thì nó chỉ còn thấy đúng hai lớp phủ nó sinh ra để canh.
 *
 * Phép khẳng định KHÔNG đổi một chữ: vẫn là "còn nội dung bên phải ⇒ có vệt", "chưa cuộn ⇒
 * không có vệt trái".
 */
const phuPhai = (page: Page) =>
  khungBang(page).locator('> [class*="inset-y-0"][class*="right-0"][class*="shadow-"]');
const phuTrai = (page: Page) =>
  khungBang(page).locator('> [class*="inset-y-0"][class*="left-0"][class*="shadow-"]');

test.describe("bảng rộng: cuộn ngang được VÀ nói cho người dùng biết", () => {
  test.beforeAll(async () => {
    await resetDb();
    // Trang đọc `loadCenterMap()` — thiếu Center có `code` là 500, không phải bảng rỗng.
    await db.center.create({
      data: { code: "CS1", name: "CS1 Nguyễn Hữu Thọ", slug: "cs1", address: "211 NHT" },
    });
    await seedOrg(["HO", "CS1"]);
    await seedRoles();
    await seedAdmin();
    // 21 mã ca thật — bảng 10 cột, đủ rộng để tràn khung `max-w-6xl` (1152px).
    await seedShiftTemplates(db);
  });

  test("B1–B5: có gì để cuộn, cuộn tới được cột cuối, lớp phủ nói thật", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // ⚠️ Trên server a0 đường admin là `/admin/...`: proxy coi host localhost là site
    // công khai, nên `/cham-cong` bị đẩy sang cổng 3000 (ECONNREFUSED).
    await login(page, { email: EMAIL });
    await page.goto("/admin/cham-cong/danh-muc-ca");
    await expect(page.locator("table thead th").first()).toBeVisible();

    // ── B1: vùng cuộn thật sự có phần thừa ────────────────────────────────
    const dau = await doVung(page);
    expect(dau, "phải tìm được vùng cuộn của bảng mã ca").not.toBeNull();
    expect(
      dau!.sw,
      "bảng phải rộng hơn khung — nếu không thì ca này không kiểm gì",
    ).toBeGreaterThan(dau!.w);
    expect(dau!.scrollLeft).toBe(0);
    expect(dau!.tenCotCuoi).toBe("Hành động");
    expect(dau!.cotCuoiThua, "lúc đầu cột cuối phải nằm NGOÀI khung").toBeGreaterThan(0);

    // ── B3 + B4: lớp phủ lúc chưa cuộn ────────────────────────────────────
    await expect(phuPhai(page), "còn nội dung bên phải ⇒ phải có vệt mờ").toHaveCount(1);
    await expect(phuTrai(page), "chưa cuộn ⇒ KHÔNG có vệt trái").toHaveCount(0);

    // ── B5: lớp phủ không nuốt click ──────────────────────────────────────
    const nuot = await page.evaluate(() => {
      // Cùng cách neo với `phuPhai`: tìm TRONG khung bảng. Đo 13/09 cho thấy mép PHẢI hiện
      // chưa va với thành phần nào, nhưng bộ chọn vẫn là loại quét cả trang — và mép TRÁI đã
      // va rồi. Sửa cả hai một lượt thay vì chờ tới lượt nó.
      const p = document.querySelector<HTMLElement>(
        'div:has(> div.overflow-x-auto) > [class*="inset-y-0"][class*="right-0"][class*="shadow-"]',
      );
      return p ? getComputedStyle(p).pointerEvents : "khong-thay";
    });
    expect(nuot, "vệt mờ che mất chính cột nó chỉ đường tới là vô nghĩa").toBe("none");

    // ── B2: cuộn hết sang phải thì cột cuối lọt vào khung ─────────────────
    await datScrollLeft(page, 99999);
    const sau = await doVung(page);
    expect(sau!.scrollLeft, "phải cuộn được thật").toBeGreaterThan(0);
    expect(
      sau!.cotCuoiThua,
      "cuộn hết thì cột 'Hành động' phải nằm TRONG khung",
    ).toBeLessThanOrEqual(1);

    // ── B3 + B4: lớp phủ sau khi cuộn hết ─────────────────────────────────
    await expect(phuPhai(page), "hết nội dung bên phải ⇒ vệt phải biến mất").toHaveCount(0);
    await expect(phuTrai(page), "đã cuộn ⇒ có vệt trái để biết quay lại").toHaveCount(1);

    // Quay lại đầu: trạng thái phải đối xứng, không kẹt.
    await datScrollLeft(page, 0);
    await expect(phuPhai(page)).toHaveCount(1);
    await expect(phuTrai(page)).toHaveCount(0);
  });

  test("375px: bảng cuộn trong khung, KHÔNG kéo cả trang trượt ngang", async ({
    page,
  }) => {
    // Bảng `min-w-[1120px]` trong màn 375px — nếu vùng cuộn hỏng thì `<body>` tự trượt,
    // và đó là lỗi khác hẳn (cả trang lệch, không chỉ bảng).
    await page.setViewportSize({ width: 375, height: 800 });
    await login(page, { email: EMAIL });
    await page.goto("/admin/cham-cong/danh-muc-ca");
    await expect(page.locator("table thead th").first()).toBeVisible();

    const body = await page.evaluate(() => ({
      w: document.documentElement.clientWidth,
      sw: document.documentElement.scrollWidth,
    }));
    expect(body.sw, "trang KHÔNG được trượt ngang").toBeLessThanOrEqual(body.w + 1);

    const v = await doVung(page);
    expect(v!.sw, "bảng vẫn phải cuộn được trong khung của nó").toBeGreaterThan(v!.w);
    await expect(phuPhai(page)).toHaveCount(1);
  });
});
