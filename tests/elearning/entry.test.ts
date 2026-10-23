// @vitest-environment node
/**
 * EL-01 PR3 — LỐI VÀO KHU ĐÀO TẠO NỘI BỘ TRÊN MENU TÀI KHOẢN.
 *
 * Hai tầng, vì chúng hỏng theo hai kiểu khác hẳn nhau:
 *
 * 1. **Hành vi `elearningEntryUrl`** — cờ OFF hoặc không có hồ sơ nhân sự thì không
 *    có URL. Đây là cổng D4: 9 tài khoản staff trên prod không gắn `Employee` — họ
 *    KHÔNG được thấy mục menu, vì cỗ máy giao bài nhắm vào `Employee` sẽ không bao
 *    giờ giao gì cho họ.
 *
 * 2. **Quét MÃ NGUỒN của hai menu** — ba điểm của AC1 mà không test hành vi nào chạm
 *    tới được: đúng nhãn, đúng vị trí thứ hai, và mở tab mới có kèm `rel="noopener"`.
 *    Đổi nhãn hay kéo mục xuống cuối danh sách là việc một dòng, không ai nhớ, và
 *    mọi test render vẫn xanh — nên pin thẳng vào nguồn.
 *
 * ⚠️ Test này KHÔNG chứng minh khu e-learning được bảo vệ. Giấu mục menu chỉ là
 * chuyện giao diện; cổng thật ở `app/(elearning)/elearning/layout.tsx` (PR2).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({
  isElearningEnabled: vi.fn(() => true),
  resolveActor: vi.fn(async (userId: string) => ({ userId }) as unknown),
  // Tham số phải được KHAI KIỂU, không được để `vi.fn(async () => ...)` không tham số:
  // khi đó `mock.calls[0]` là tuple rỗng và `calls[0][0].where` không biên dịch được
  // (TS2493/TS2339). Vitest vẫn chạy xanh — chỉ `tsc` bắt, nên dễ lọt nếu chỉ chạy test.
  findFirst: vi.fn(
    async (_args: { where: Record<string, unknown>; select?: unknown }) =>
      null as { id: string } | null,
  ),
  bypassSeen: [] as boolean[],
}));

vi.mock("@/lib/flags", () => ({ isElearningEnabled: h.isElearningEnabled }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: (_actor: unknown, opts?: { bypass?: boolean }) => {
    h.bypassSeen.push(opts?.bypass === true);
    return { employee: { findFirst: h.findFirst } };
  },
}));

import { elearningEntryUrl } from "@/lib/elearning/entry";

const ROOT = process.cwd();
const ADMIN_MENU = join(ROOT, "components/admin/topbar.tsx");
const GV_MENU = join(ROOT, "app/(teacher)/teacher/_components/user-menu.tsx");

describe("EL-01 · elearningEntryUrl — cổng hiển thị mục menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.bypassSeen.length = 0;
    h.isElearningEnabled.mockReturnValue(true);
    h.findFirst.mockResolvedValue({ id: "emp-1" });
  });

  it("cờ OFF ⇒ null, và KHÔNG đụng DB", async () => {
    h.isElearningEnabled.mockReturnValue(false);
    await expect(elearningEntryUrl("u1")).resolves.toBeNull();
    // Thứ tự rẻ-trước-đắt-sau: cờ OFF là toàn bộ nhân sự mở trang quản trị, mỗi
    // lượt thêm một truy vấn vô ích thì đó là thuế trên mọi trang.
    expect(h.findFirst).not.toHaveBeenCalled();
    expect(h.resolveActor).not.toHaveBeenCalled();
  });

  it("cờ ON + có hồ sơ nhân sự ⇒ URL host e-learning", async () => {
    await expect(elearningEntryUrl("u1")).resolves.toBe(
      "https://e-learning.satarobo.vn/",
    );
  });

  it("cờ ON nhưng KHÔNG có hồ sơ nhân sự ⇒ null (cổng D4)", async () => {
    h.findFirst.mockResolvedValue(null);
    await expect(elearningEntryUrl("u1")).resolves.toBeNull();
  });

  it("chỉ nhận nhân sự đang làm việc: isActive + status ACTIVE, khoá theo chính mình", async () => {
    await elearningEntryUrl("u-42");
    const where = h.findFirst.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({
      userAccount: { id: "u-42" },
      isActive: true,
      status: "ACTIVE",
    });
  });

  it("dùng bypass — nhân sự Hội sở có centerId null vẫn phải thấy mục menu", async () => {
    await elearningEntryUrl("u1");
    // 10/14 nhân sự prod đang `centerId = null` (đúng chủ đích, xem `actions.ts:220-222`).
    // Bỏ bypass ⇒ bộ lọc cơ sở nuốt hết nhóm đó ⇒ menu biến mất đúng với Hội sở, mà
    // không báo lỗi ⇒ hỏng câm. Đó là lý do dòng này được pin.
    expect(h.bypassSeen).toEqual([true]);
  });
});

describe("EL-01 · AC1 trên mã nguồn hai menu", () => {
  const menus: Array<[string, string]> = [
    ["menu admin", ADMIN_MENU],
    ["menu site GV", GV_MENU],
  ];

  it.each(menus)("%s — nhãn đúng là “Học tập nội bộ”", (_n, file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain("Học tập nội bộ");
    // "Đào tạo nội bộ" là nhãn đã BẮC BỎ: nó trùng tên phòng Đào tạo nên người dùng
    // đọc thành "khu của phòng Đào tạo", không phải "chỗ tôi học".
    expect(src).not.toContain("Đào tạo nội bộ");
  });

  it.each(menus)("%s — mở tab mới kèm rel noopener", (_n, file) => {
    const src = readFileSync(file, "utf8");
    const i = src.indexOf("href={elearningUrl}");
    expect(i).toBeGreaterThan(-1);
    const around = src.slice(i, i + 300);
    expect(around).toContain('target="_blank"');
    expect(around).toContain('rel="noopener noreferrer"');
  });

  it.each(menus)(
    "%s — mục ở VỊ TRÍ THỨ HAI: sau Hồ sơ cá nhân, TRƯỚC Hướng dẫn",
    (_n, file) => {
      const src = readFileSync(file, "utf8");
      const hoSo = src.indexOf("Hồ sơ cá nhân");
      const el = src.indexOf("Học tập nội bộ");
      const huongDan = src.indexOf("Hướng dẫn sử dụng");
      expect(hoSo).toBeGreaterThan(-1);
      expect(huongDan).toBeGreaterThan(-1);
      expect(el).toBeGreaterThan(hoSo);
      expect(el).toBeLessThan(huongDan);
    },
  );

  it("portal phụ huynh KHÔNG có lối vào (QĐ-2: người học là nhân sự)", () => {
    const src = readFileSync(
      join(ROOT, "components/portal/v2-shell.tsx"),
      "utf8",
    );
    expect(src).not.toContain("elearning");
    expect(src).not.toContain("Học tập nội bộ");
  });
});
