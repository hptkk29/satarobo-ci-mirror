import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Bộ đếm lượt thử bằng Postgres (phương án C, docs/mobile/11_BACKEND_MOBILE_API_DESIGN.md mục 3.8 + 9.1).
 *
 * MỘT câu lệnh cho mỗi lượt đếm, nguyên tử, không mở giao dịch tương tác. `:now` do nơi gọi truyền vào (kiểm thử không đọc đồng hồ thật).
 * Không đếm được (lỗi DB) ⇒ ném `LoiKhongDemDuoc`; nơi gọi trả `503 SERVER` + `Retry-After`, KHÔNG BAO GIỜ trả 401 và không cho qua.
 *
 * ⚠️ Bộ đếm này CHƯA được web dùng: đăng nhập web vẫn đếm bằng `rateLimit()` của `lib/rate-limit.ts` (PR 2b của thiết kế — đổi hành vi web — chưa làm).
 * Hệ quả đã biết: một kẻ dò mật khẩu chia lượt giữa web và mobile được tối đa (ngưỡng web + ngưỡng mobile). Xem docs/MOBILE-B1-AUTH-REPORT.md.
 */
export class LoiKhongDemDuoc extends Error {
  constructor(public readonly nguyen: unknown) {
    super("Không đếm được lượt thử");
    this.name = "LoiKhongDemDuoc";
  }
}

export type KetQuaDemDangNhap = {
  soLanIp: number;
  /** `null` khi IP đã vượt trần: lượt thử bị từ chối mà không chèn dòng định danh nào. */
  soLanDinhDanh: number | null;
  /** Đúng khi một trong hai vượt ngưỡng. */
  chamTran: boolean;
};

/**
 * Đăng nhập: tăng khoá IP TRƯỚC; chỉ khi IP chưa vượt trần mới tăng khoá định danh (điểm C-6 của thiết kế).
 * Thứ tự khoá luôn là dòng IP rồi dòng định danh để hai lượt song song không khoá chéo nhau.
 */
export async function demDangNhap(input: {
  khoaIp: string;
  khoaDinhDanh: string;
  now: Date;
  cuaSoMs: number;
  nguongIp: number;
  nguongDinhDanh: number;
}): Promise<KetQuaDemDangNhap> {
  const cuaSoGiay = input.cuaSoMs / 1000;
  try {
    const hang = await db.$queryRaw<Array<{ soLanIp: number | null; soLanDinhDanh: number | null }>>(Prisma.sql`
      WITH ip AS (
        INSERT INTO "AuthAttemptCounter" ("khoa", "cuaSoTu", "soLan", "updatedAt")
        VALUES (${input.khoaIp}, ${input.now}, 1, ${input.now})
        ON CONFLICT ("khoa") DO UPDATE SET
          "soLan"     = CASE WHEN "AuthAttemptCounter"."cuaSoTu" <= ${input.now} - make_interval(secs => ${cuaSoGiay})
                             THEN 1 ELSE "AuthAttemptCounter"."soLan" + 1 END,
          "cuaSoTu"   = CASE WHEN "AuthAttemptCounter"."cuaSoTu" <= ${input.now} - make_interval(secs => ${cuaSoGiay})
                             THEN ${input.now} ELSE "AuthAttemptCounter"."cuaSoTu" END,
          "updatedAt" = ${input.now}
        RETURNING "soLan"
      ), dinh_danh AS (
        INSERT INTO "AuthAttemptCounter" ("khoa", "cuaSoTu", "soLan", "updatedAt")
        SELECT ${input.khoaDinhDanh}, ${input.now}, 1, ${input.now} FROM ip WHERE ip."soLan" <= ${input.nguongIp}
        ON CONFLICT ("khoa") DO UPDATE SET
          "soLan"     = CASE WHEN "AuthAttemptCounter"."cuaSoTu" <= ${input.now} - make_interval(secs => ${cuaSoGiay})
                             THEN 1 ELSE "AuthAttemptCounter"."soLan" + 1 END,
          "cuaSoTu"   = CASE WHEN "AuthAttemptCounter"."cuaSoTu" <= ${input.now} - make_interval(secs => ${cuaSoGiay})
                             THEN ${input.now} ELSE "AuthAttemptCounter"."cuaSoTu" END,
          "updatedAt" = ${input.now}
        RETURNING "soLan"
      )
      SELECT (SELECT "soLan" FROM ip)::int AS "soLanIp", (SELECT "soLan" FROM dinh_danh)::int AS "soLanDinhDanh"
    `);
    const h = hang[0];
    if (!h || h.soLanIp === null) throw new Error("bộ đếm không trả dòng nào");
    const cham = h.soLanIp > input.nguongIp || h.soLanDinhDanh === null || h.soLanDinhDanh > input.nguongDinhDanh;
    void donDem(input.now);
    return { soLanIp: h.soLanIp, soLanDinhDanh: h.soLanDinhDanh, chamTran: cham };
  } catch (e) {
    throw new LoiKhongDemDuoc(e);
  }
}

/** Đếm MỘT khoá trong cửa sổ trượt-theo-mốc. Trả số lần SAU khi đã tính lượt này. */
export async function demMotKhoa(input: { khoa: string; now: Date; cuaSoMs: number }): Promise<number> {
  const cuaSoGiay = input.cuaSoMs / 1000;
  try {
    const hang = await db.$queryRaw<Array<{ soLan: number }>>(Prisma.sql`
      INSERT INTO "AuthAttemptCounter" ("khoa", "cuaSoTu", "soLan", "updatedAt")
      VALUES (${input.khoa}, ${input.now}, 1, ${input.now})
      ON CONFLICT ("khoa") DO UPDATE SET
        "soLan"     = CASE WHEN "AuthAttemptCounter"."cuaSoTu" <= ${input.now} - make_interval(secs => ${cuaSoGiay})
                           THEN 1 ELSE "AuthAttemptCounter"."soLan" + 1 END,
        "cuaSoTu"   = CASE WHEN "AuthAttemptCounter"."cuaSoTu" <= ${input.now} - make_interval(secs => ${cuaSoGiay})
                           THEN ${input.now} ELSE "AuthAttemptCounter"."cuaSoTu" END,
        "updatedAt" = ${input.now}
      RETURNING "soLan"::int AS "soLan"
    `);
    if (!hang[0]) throw new Error("bộ đếm không trả dòng nào");
    void donDem(input.now);
    return hang[0].soLan;
  } catch (e) {
    throw new LoiKhongDemDuoc(e);
  }
}

/** Dọn tối đa 50 dòng đã hết cửa sổ từ hơn hai giờ (gấp đôi cửa sổ dài nhất). Best-effort: lỗi dọn không ảnh hưởng ai. */
async function donDem(now: Date): Promise<void> {
  try {
    await db.$executeRaw(Prisma.sql`
      DELETE FROM "AuthAttemptCounter" WHERE "khoa" IN (
        SELECT "khoa" FROM "AuthAttemptCounter" WHERE "cuaSoTu" < ${now} - interval '2 hours' LIMIT 50
      )
    `);
  } catch {
    /* bỏ qua */
  }
}
