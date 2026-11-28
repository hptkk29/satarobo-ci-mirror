// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const h = vi.hoisted(() => ({
  notify: vi.fn(async (p: { userIds: readonly string[] }) => p.userIds.length),
  users: [] as { id: string; email: string | null }[],
  findMany: vi.fn(),
}));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: h.notify }));
vi.mock("@/lib/db", () => ({
  db: { user: { findMany: h.findMany } },
}));

import { BIEN_CHI_TOI_MIEN, mienChiNhan, notifyElearning } from "@/lib/elearning/notify-gate";

const P = (userIds: string[]) => ({ userIds, dedupeKey: "k", title: "t", body: "b" });
const envCu = process.env[BIEN_CHI_TOI_MIEN];

beforeEach(() => {
  h.notify.mockClear();
  h.findMany.mockReset();
  h.users = [
    { id: "u-uat1", email: "uat.el.hv1@uat.satarobo.invalid" },
    { id: "u-uat2", email: "UAT.EL.DT1@UAT.SATAROBO.INVALID" },
    { id: "u-that", email: "nguoi.that@satarobo.vn" },
    { id: "u-lua", email: "x@evil-uat.satarobo.invalid" },
    { id: "u-null", email: null },
  ];
  h.findMany.mockImplementation(async (a: { where: { id: { in: string[] } } }) => h.users.filter((u) => a.where.id.in.includes(u.id)));
});
afterEach(() => {
  if (envCu === undefined) delete process.env[BIEN_CHI_TOI_MIEN];
  else process.env[BIEN_CHI_TOI_MIEN] = envCu;
});

describe("mienChiNhan — đọc biến", () => {
  it("không đặt / rỗng ⇒ undefined (không giới hạn)", () => {
    expect(mienChiNhan({})).toBeUndefined();
    expect(mienChiNhan({ [BIEN_CHI_TOI_MIEN]: "  " })).toBeUndefined();
  });
  it("hợp lệ ⇒ chuẩn hoá chữ thường", () => {
    expect(mienChiNhan({ [BIEN_CHI_TOI_MIEN]: " UAT.satarobo.invalid " })).toBe("uat.satarobo.invalid");
  });
  it("hỏng (có @, có dấu cách, không có chấm, ký tự lạ) ⇒ null (fail-closed)", () => {
    for (const x of ["@uat.satarobo.invalid", "uat satarobo.invalid", "uat", "uat..invalid", "a.b;drop", "-x.invalid"]) {
      expect(mienChiNhan({ [BIEN_CHI_TOI_MIEN]: x }), x).toBeNull();
    }
  });
});

describe("🔴 notifyElearning — người nhận bị giới hạn theo miền", () => {
  it("KHÔNG đặt biến ⇒ đi thẳng notifyStaff nguyên danh sách và KHÔNG chạm DB (hành vi PROD không đổi)", async () => {
    delete process.env[BIEN_CHI_TOI_MIEN];
    expect(await notifyElearning(P(["u-uat1", "u-that"]))).toBe(2);
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ["u-uat1", "u-that"] }));
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("đặt miền UAT ⇒ chỉ người UAT nhận; người thật, email null, miền giả mạo bị LOẠI TRƯỚC khi gọi notifyStaff", async () => {
    process.env[BIEN_CHI_TOI_MIEN] = "uat.satarobo.invalid";
    await notifyElearning(P(["u-uat1", "u-uat2", "u-that", "u-lua", "u-null"]));
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0]![0].userIds).toEqual(["u-uat1", "u-uat2"]);
  });

  it("không ai thuộc miền ⇒ KHÔNG gọi notifyStaff, trả 0", async () => {
    process.env[BIEN_CHI_TOI_MIEN] = "uat.satarobo.invalid";
    expect(await notifyElearning(P(["u-that", "u-null"]))).toBe(0);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("biến đặt nhưng HỎNG ⇒ không gửi cho AI (kể cả người UAT), không chạm DB", async () => {
    process.env[BIEN_CHI_TOI_MIEN] = "@uat.satarobo.invalid";
    expect(await notifyElearning(P(["u-uat1"]))).toBe(0);
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.findMany).not.toHaveBeenCalled();
  });

  it("các trường khác (dedupeKey, title, href…) đi nguyên sang notifyStaff", async () => {
    process.env[BIEN_CHI_TOI_MIEN] = "uat.satarobo.invalid";
    await notifyElearning({ ...P(["u-uat1"]), href: "/elearning", entityId: "e1" });
    expect(h.notify.mock.calls[0]![0]).toMatchObject({ dedupeKey: "k", title: "t", body: "b", href: "/elearning", entityId: "e1" });
  });
});

describe("🔴 lưới nguồn — mọi tệp E-learning gửi chuông đều đi qua cổng", () => {
  const GOC = process.cwd();
  const duyet = (d: string): string[] =>
    readdirSync(d).flatMap((t) => {
      const p = join(d, t);
      return statSync(p).isDirectory() ? duyet(p) : [p];
    });
  const chiMa = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("không tệp nào dưới lib/elearning (trừ cổng + test) import trực tiếp @/lib/notifications/notify", () => {
    const viPham = duyet(join(GOC, "lib/elearning"))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith("notify-gate.ts"))
      .filter((f) => /@\/lib\/notifications\/notify/.test(chiMa(readFileSync(f, "utf8"))))
      .map((f) => relative(GOC, f).replace(/\\/g, "/"));
    expect(viPham).toEqual([]);
  });

  it("ĐỐI CHỨNG DƯƠNG: năm tệp gửi chuông của khu đều import từ notify-gate", () => {
    for (const f of ["cron-cert-expiry.ts", "cron-reminders.ts", "grader-reminder.ts", "_handlers/automation-run.ts", "_handlers/notify.ts"]) {
      expect(chiMa(readFileSync(join(GOC, "lib/elearning", f), "utf8")), f).toMatch(/@\/lib\/elearning\/notify-gate/);
    }
  });
});
