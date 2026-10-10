/**
 * Hội sở KHÔNG nhận lead (chủ dự án chốt 04/08/2026).
 *
 * Trước đây chỉ giấu Hội sở khỏi dropdown — chưa đủ, vì có HAI đường TỰ ĐỘNG không
 * đi qua dropdown nào:
 *   1. `autoAssignNewLead` chia lead từ form web về cơ sở. Comment cũ khẳng định
 *      "HO không có row Center nên tự loại" — SAI với dữ liệu thật: `Center(hoi-so)`
 *      tồn tại và `isActive: true` (đo prod+dev 04/08/2026).
 *   2. Import Excel tra cơ sở theo mã; mã Hội sở trong file sẽ tra trúng.
 *
 * Chạy thẳng trên building-block như các spec r7 khác — không dựng HTTP/auth().
 */
import { test, expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { resetDb } from "../_helpers/seed";
import { autoAssignNewLead, type Actor } from "../../../lib/lead/auto-assign";
import { getNonEnrollableCenterIds } from "../../../lib/enrollment-flow";

let n = 0;
const uniq = () => `${Date.now()}${n++}`;

/** Cây tổ chức thật: ROOT → HO (không dạy học) + CS1/CS2 (type=CENTER). */
async function seedTree(): Promise<{ ho: string; cs1: string; cs2: string }> {
  const mk = async (name: string) =>
    (await db.center.create({
      data: { code: `${name}${uniq()}`, name, slug: `${name}-${uniq()}`.toLowerCase(), address: "x" },
    })).id;

  const ho = await mk("HO");
  const cs1 = await mk("CS1");
  const cs2 = await mk("CS2");

  const root = await db.orgUnit.create({ data: { code: `ROOT${uniq()}`, name: "Sata", type: "ROOT" } });
  // HO là OrgUnit type=HO và KHÔNG trỏ tới Center nào — đúng hình dạng seed thật.
  await db.orgUnit.create({ data: { code: `HOU${uniq()}`, name: "Hội sở", type: "HO", parentId: root.id } });
  for (const [name, id] of [["CS1", cs1], ["CS2", cs2]] as const) {
    await db.orgUnit.create({
      data: { code: `${name}${uniq()}`, name, type: "CENTER", parentId: root.id, centerId: id },
    });
  }
  return { ho, cs1, cs2 };
}

// `Actor` của auto-assign chỉ dùng để ghi nhật ký (không phải actor RBAC).
const actorStub: Actor = { actorId: null, actorName: "Hệ thống" };

test.describe("[HO-LEAD] Hội sở không nhận lead", () => {
  test.beforeEach(async () => {
    await resetDb();
  });

  test("[HO-LEAD-01] Center Hội sở CÓ tồn tại và active — vẫn phải bị loại khỏi phân phối", async () => {
    const { ho } = await seedTree();

    // Giả định cũ ("HO không có row Center") sai — chứng minh bằng chính DB.
    const row = await db.center.findUniqueOrThrow({ where: { id: ho }, select: { isActive: true } });
    expect(row.isActive).toBe(true);

    expect(await getNonEnrollableCenterIds()).toContain(ho);
  });

  test("[HO-LEAD-02] chia lead tự động KHÔNG bao giờ rơi vào Hội sở", async () => {
    const { ho, cs1, cs2 } = await seedTree();

    // Chia nhiều lead: nếu HO còn trong rổ, cân-tải sẽ ưu tiên nó vì đang 0 lead.
    const landed = new Set<string | null>();
    for (let i = 0; i < 6; i++) {
      const lead = await db.lead.create({
        data: { parentName: `PH ${i}`, phone: `090${uniq()}`.slice(0, 11), source: "web", status: "MOI" },
      });
      const res = await autoAssignNewLead(lead.id, actorStub);
      expect(res.ok).toBe(true);
      landed.add((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).centerId);
    }

    expect(landed.has(ho)).toBe(false);
    expect([...landed].every((c) => c === cs1 || c === cs2)).toBe(true);
    expect(await db.lead.count({ where: { centerId: ho } })).toBe(0);
  });

  test("[HO-LEAD-03] lead ĐÃ gắn Hội sở sẵn → không bị chia bừa sang cơ sở khác", async () => {
    // Chỉ chặn đường TẠO MỚI; lead cũ đang ở HO giữ nguyên để người dùng tự dọn,
    // không âm thầm chuyển cơ sở dưới chân họ.
    const { ho } = await seedTree();
    const lead = await db.lead.create({
      data: { parentName: "PH cũ", phone: `0912${uniq()}`.slice(0, 11), source: "web", status: "MOI", centerId: ho },
    });

    await autoAssignNewLead(lead.id, actorStub);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).centerId).toBe(ho);
  });
});
