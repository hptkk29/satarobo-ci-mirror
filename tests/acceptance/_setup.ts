/**
 * globalSetup của bộ nghiệm thu: (1) đọc id thật của dữ liệu seed từ DB,
 * (2) đăng nhập TỪNG vai một lần rồi cất `storageState` riêng.
 *
 * Vì sao cất storageState thay vì đăng nhập trong từng spec:
 *   `lib/auth.ts` rate-limit đăng nhập **5 lần/định danh/phút và 10 lần/IP/phút**.
 *   Mỗi kịch bản mở lại 2–3 context; đăng nhập lại mỗi lần là tự bắn vào chân —
 *   `authorize()` trả `null` y hệt sai mật khẩu, và cả bộ test sẽ "đỏ vì bảo mật"
 *   chứ không phải vì chat hỏng.
 */
import { chromium, type FullConfig } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import {
  ACCOUNT_EMAILS,
  ARTIFACT_DIR,
  PASSWORD,
  PREFIX,
  SEED_FILE,
  storageStateFile,
  type AccountKey,
  type SeedInfo,
} from "./_fixtures";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

/** storageState cũ hơn ngần này thì đăng nhập lại (phiên Auth.js sống 30 ngày). */
const STATE_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

async function collectSeed(baseURL: string): Promise<SeedInfo> {
  const db = new PrismaClient({
    datasourceUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  });
  try {
    const users = await db.user.findMany({
      where: { email: { in: Object.values(ACCOUNT_EMAILS) } },
      select: { id: true, email: true, name: true },
    });
    const byEmail = new Map(users.map((u) => [u.email ?? "", u]));
    const resolved = {} as SeedInfo["users"];
    for (const [key, email] of Object.entries(ACCOUNT_EMAILS) as [AccountKey, string][]) {
      const u = byEmail.get(email);
      if (!u) {
        throw new Error(
          `Thiếu tài khoản seed ${email}. Chạy: pnpm exec tsx scripts/_zztest-chat-nghiemthu-seed.ts`,
        );
      }
      resolved[key] = { id: u.id, email, name: u.name ?? key };
    }

    const lopA = await db.class.findUnique({
      where: { classCode: `${PREFIX}-LOPA` },
      select: { id: true },
    });
    const lopB = await db.class.findUnique({
      where: { classCode: `${PREFIX}-LOPB` },
      select: { id: true },
    });
    if (!lopA || !lopB) throw new Error("Thiếu lớp seed — chạy lại script seed.");

    const convs = await db.conversation.findMany({
      where: { subjectId: { in: [lopA.id, lopB.id] }, type: "CLASS_GROUP" },
      select: { id: true, subjectId: true },
    });
    const convA = convs.find((c) => c.subjectId === lopA.id)?.id;
    const convB = convs.find((c) => c.subjectId === lopB.id)?.id;
    if (!convA || !convB) throw new Error("Thiếu nhóm lớp — sync chưa chạy?");

    const hv3 = await db.student.findUnique({
      where: { studentCode: `${PREFIX}-HV3` },
      select: { id: true },
    });
    const enr = hv3
      ? await db.enrollment.findFirst({
          where: { studentId: hv3.id, classId: lopB.id },
          select: { id: true },
        })
      : null;
    if (!enr) throw new Error("Thiếu enrollment của HV3 trong LopB.");

    return {
      baseURL,
      dbHost: (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/\/.*$/, ""),
      users: resolved,
      classes: { lopA: lopA.id, lopB: lopB.id },
      conversations: { lopA: convA, lopB: convB },
      enrollmentHv3: enr.id,
    };
  } finally {
    await db.$disconnect();
  }
}

function stateIsFresh(file: string): boolean {
  if (process.env.ACCEPT_FORCE_LOGIN === "1") return false;
  if (!existsSync(file)) return false;
  return Date.now() - statSync(file).mtimeMs < STATE_MAX_AGE_MS;
}

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    (config.projects[0]?.use.baseURL as string | undefined) ?? "https://test.satarobo.vn";
  mkdirSync(ARTIFACT_DIR, { recursive: true });

  const seed = await collectSeed(baseURL);
  writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2), "utf8");
  console.log(`[setup] DB ${seed.dbHost} · site ${baseURL}`);
  console.log(`[setup] LopA conv ${seed.conversations.lopA} · LopB conv ${seed.conversations.lopB}`);

  const browser = await chromium.launch();
  try {
    for (const key of Object.keys(ACCOUNT_EMAILS) as AccountKey[]) {
      const file = storageStateFile(key);
      if (stateIsFresh(file)) {
        console.log(`[setup] ${key}: dùng lại phiên đã lưu`);
        continue;
      }
      const context = await browser.newContext({ baseURL, locale: "vi-VN" });
      const page = await context.newPage();
      await page.goto("/login");
      const email = page.getByLabel("Email");
      // Form là controlled input — điền trước khi hydrate xong sẽ bị xoá trắng.
      await expectValueSticks(page, email, seed.users[key].email);
      await page.getByLabel("Mật khẩu").fill(PASSWORD);
      await page.getByRole("button", { name: "Đăng nhập" }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 45_000 });
      await context.storageState({ path: file });
      console.log(`[setup] ${key}: đăng nhập OK → ${new URL(page.url()).pathname}`);
      await context.close();
      // Giãn nhịp: 5 lần đăng nhập liên tiếp vẫn dưới trần 10/IP/phút, nhưng chạy
      // lại bộ test nhiều lần trong một phút thì không.
      await new Promise((r) => setTimeout(r, 1_500));
    }
  } finally {
    await browser.close();
  }
}

async function expectValueSticks(
  page: import("@playwright/test").Page,
  locator: import("@playwright/test").Locator,
  value: string,
) {
  for (let i = 0; i < 12; i++) {
    await locator.fill(value);
    await page.waitForTimeout(400);
    if ((await locator.inputValue()) === value) return;
  }
  throw new Error(`Không giữ được giá trị trong ô Email (hydration xoá trắng): ${value}`);
}
