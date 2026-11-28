import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/** Kho đếm theo khoá (đã băm). Cửa sổ cố định tính từ lượt ĐẦU TIÊN; hết cửa sổ thì đếm lại từ 1. */
export interface KhoDem {
  /** Tăng 1, trả số lần SAU khi tính lượt này. Nguyên tử. Lỗi ⇒ ném. */
  tang(khoa: string, now: Date, cuaSoMs: number): Promise<number>;
  /** Trả lại 1 lượt (lượt đăng nhập ĐÚNG không được tính vào bộ đếm SAI). Không giảm dưới 0; hết cửa sổ thì không làm gì. */
  hoan(khoa: string, now: Date, cuaSoMs: number): Promise<void>;
  /** Đọc số hiện tại trong cửa sổ (0 nếu chưa có / đã hết hạn) — KHÔNG tăng. */
  doc(khoa: string, now: Date, cuaSoMs: number): Promise<number>;
}

/** Kho trong bộ nhớ — chỉ dùng cho kiểm thử / mô phỏng. */
export class KhoBoNho implements KhoDem {
  readonly dong = new Map<string, { tu: number; so: number }>();
  async tang(khoa: string, now: Date, cuaSoMs: number): Promise<number> {
    const t = now.getTime();
    const d = this.dong.get(khoa);
    if (!d || d.tu <= t - cuaSoMs) {
      this.dong.set(khoa, { tu: t, so: 1 });
      return 1;
    }
    d.so += 1;
    return d.so;
  }
  async hoan(khoa: string, now: Date, cuaSoMs: number): Promise<void> {
    const d = this.dong.get(khoa);
    if (!d || d.tu <= now.getTime() - cuaSoMs) return;
    if (d.so <= 1) this.dong.delete(khoa);
    else d.so -= 1;
  }
  async doc(khoa: string, now: Date, cuaSoMs: number): Promise<number> {
    const d = this.dong.get(khoa);
    return !d || d.tu <= now.getTime() - cuaSoMs ? 0 : d.so;
  }
}

/** Kho Postgres — bảng `AuthAttemptCounter` DÙNG CHUNG (cùng bảng mobile đang dùng ⇒ web và mobile thấy cùng một con số). */
export class KhoPostgres implements KhoDem {
  async tang(khoa: string, now: Date, cuaSoMs: number): Promise<number> {
    const cuaSoGiay = cuaSoMs / 1000;
    const hang = await db.$queryRaw<Array<{ soLan: number }>>(Prisma.sql`
      INSERT INTO "AuthAttemptCounter" ("khoa", "cuaSoTu", "soLan", "updatedAt")
      VALUES (${khoa}, ${now}, 1, ${now})
      ON CONFLICT ("khoa") DO UPDATE SET
        "soLan"     = CASE WHEN "AuthAttemptCounter"."cuaSoTu" <= ${now} - make_interval(secs => ${cuaSoGiay}) THEN 1 ELSE "AuthAttemptCounter"."soLan" + 1 END,
        "cuaSoTu"   = CASE WHEN "AuthAttemptCounter"."cuaSoTu" <= ${now} - make_interval(secs => ${cuaSoGiay}) THEN ${now} ELSE "AuthAttemptCounter"."cuaSoTu" END,
        "updatedAt" = ${now}
      RETURNING "soLan"::int AS "soLan"
    `);
    if (!hang[0]) throw new Error("bộ đếm không trả dòng nào");
    return hang[0].soLan;
  }
  async hoan(khoa: string, now: Date, cuaSoMs: number): Promise<void> {
    const cuaSoGiay = cuaSoMs / 1000;
    // Ràng buộc `soLan >= 1`: còn >1 thì trừ, còn đúng 1 thì xoá dòng. MỘT câu lệnh, hai nhánh rời nhau.
    await db.$executeRaw(Prisma.sql`
      WITH giam AS (
        UPDATE "AuthAttemptCounter" SET "soLan" = "soLan" - 1, "updatedAt" = ${now}
        WHERE "khoa" = ${khoa} AND "soLan" > 1 AND "cuaSoTu" > ${now} - make_interval(secs => ${cuaSoGiay})
        RETURNING 1
      )
      DELETE FROM "AuthAttemptCounter"
      WHERE "khoa" = ${khoa} AND "soLan" = 1 AND "cuaSoTu" > ${now} - make_interval(secs => ${cuaSoGiay})
    `);
  }
  async doc(khoa: string, now: Date, cuaSoMs: number): Promise<number> {
    const cuaSoGiay = cuaSoMs / 1000;
    const hang = await db.$queryRaw<Array<{ soLan: number }>>(Prisma.sql`
      SELECT "soLan"::int AS "soLan" FROM "AuthAttemptCounter"
      WHERE "khoa" = ${khoa} AND "cuaSoTu" > ${now} - make_interval(secs => ${cuaSoGiay})
    `);
    return hang[0]?.soLan ?? 0;
  }
}
