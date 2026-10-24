/**
 * F-21 — thông báo quá hạn duyệt ảnh/video buổi học: phần THUẦN (gom folder, chọn
 * folder quá hạn, dựng khoá chống trùng, dựng câu chữ).
 *
 * ⚠️ BA THỨ BỘ TEST NÀY GIỮ, vì cả ba đều là lỗi đã ĐO ĐƯỢC trên bản cũ:
 *
 * 1. NGƯỠNG. Bản cũ coi "quá hạn" = ảnh nằm chờ quá 2 ngày kể từ lúc TẢI LÊN
 *    (`lib/pending-tasks.ts`, `cfg.staleMs`). Hạn thật của F-20 là 10h sáng ngày hôm
 *    sau NGÀY DẠY. Hai mốc này khác nhau cả chiều sớm lẫn chiều muộn.
 * 2. ẢNH TẢI LÊN MUỘN. Vì mốc cũ đếm từ `createdAt`, ảnh giáo viên tải lên hôm nay
 *    cho buổi dạy tuần trước được coi là "còn 2 ngày nữa mới trễ" — trong khi hạn
 *    của buổi đó đã trôi qua từ lâu. Đây đúng là ca "bỏ sót ảnh mới tải lên".
 * 3. MÚI GIỜ. Khoá chống trùng cắt theo NGÀY, và "ngày" phải là ngày VIỆT NAM. Đọc
 *    bằng `getDate()` thì trên Vercel/CI (TZ = UTC) mốc 00:30–07:00 VN rơi về ngày
 *    hôm trước ⇒ cùng một buổi bị bắn thông báo hai lần trong một ngày làm việc.
 */
import { describe, it, expect } from "vitest";
import {
  MEDIA_OVERDUE_LOOKBACK_DAYS,
  buildOverdueNotice,
  groupPendingMedia,
  mediaOverdueDedupeKey,
  pickOverdueFolders,
  type FolderWithDeadline,
  type PendingMediaRow,
  type SessionRef,
} from "@/lib/lms/media-review-overdue";
import { computeReviewDeadline } from "@/lib/lms/media-review-deadline";
import { isPendingSyncKey } from "@/lib/notifications/pending-sync";
import { SETTINGS } from "@/lib/settings/registry";

const CFG = {
  hour: SETTINGS["media.reviewDeadlineHour"].default,
  offsetDays: SETTINGS["media.reviewDeadlineOffsetDays"].default,
};

function anh(p: Partial<PendingMediaRow> & { id: string }): PendingMediaRow {
  return {
    classId: "cls1",
    classSessionId: null,
    takenAt: null,
    createdAt: new Date("2026-08-24T02:00:00.000Z"),
    ...p,
  };
}

const buoi = (p: Partial<SessionRef> & { id: string }): SessionRef => ({
  classId: "cls1",
  date: new Date("2026-08-24T00:00:00.000Z"),
  ...p,
});

function folder(
  key: string,
  deadlineAt: Date,
  extra: Partial<FolderWithDeadline> = {},
): FolderWithDeadline {
  return {
    key,
    classId: "cls1",
    classSessionId: null,
    folderAt: new Date("2026-08-24T00:00:00.000Z"),
    mediaIds: ["m1"],
    latestUploadAt: new Date("2026-08-24T02:00:00.000Z"),
    deadlineAt,
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("[F-21] groupPendingMedia — gom ảnh chờ duyệt thành folder BUỔI × NGÀY", () => {
  it("[F-21-T01] nhiều ảnh cùng một buổi → ĐÚNG MỘT folder, mốc hạn lấy theo NGÀY DẠY", () => {
    const sessions = new Map([["s1", buoi({ id: "s1" })]]);
    const folders = groupPendingMedia(
      [
        anh({ id: "m1", classSessionId: "s1" }),
        anh({ id: "m2", classSessionId: "s1" }),
        anh({ id: "m3", classSessionId: "s1" }),
      ],
      sessions,
    );
    expect(folders).toHaveLength(1);
    expect(folders[0]!.key).toBe("s:s1");
    expect(folders[0]!.mediaIds).toEqual(["m1", "m2", "m3"]);
    // Mốc tính hạn là NGÀY DẠY của buổi, KHÔNG phải lúc tải ảnh lên.
    expect(folders[0]!.folderAt.toISOString()).toBe("2026-08-24T00:00:00.000Z");
  });

  it("[F-21-T02] hai buổi khác nhau của cùng lớp → hai folder rời", () => {
    const sessions = new Map([
      ["s1", buoi({ id: "s1" })],
      ["s2", buoi({ id: "s2", date: new Date("2026-08-26T00:00:00.000Z") })],
    ]);
    const folders = groupPendingMedia(
      [anh({ id: "m1", classSessionId: "s1" }), anh({ id: "m2", classSessionId: "s2" })],
      sessions,
    );
    expect(folders.map((f) => f.key).sort()).toEqual(["s:s1", "s:s2"]);
  });

  it("[F-21-T03] ảnh KHÔNG gắn buổi → gom theo LỚP × NGÀY VN (folder F-10/F-11)", () => {
    const folders = groupPendingMedia(
      [
        anh({ id: "m1", takenAt: new Date("2026-08-24T03:00:00.000Z") }),
        anh({ id: "m2", takenAt: new Date("2026-08-24T09:00:00.000Z") }),
        anh({ id: "m3", takenAt: new Date("2026-08-25T03:00:00.000Z") }),
      ],
      new Map(),
    );
    expect(folders.map((f) => f.key).sort()).toEqual([
      "c:cls1:2026-08-24",
      "c:cls1:2026-08-25",
    ]);
  });

  it("[F-21-T04] ảnh trỏ tới buổi ĐÃ BỊ XOÁ vẫn vào folder lớp×ngày — không được rơi khỏi hàng duyệt", () => {
    // 🔴 Nếu code bỏ qua ảnh có classSessionId mà tra không ra buổi thì ảnh đó biến
    // mất khỏi mọi cảnh báo, trong khi nó vẫn PENDING và vẫn chờ người duyệt.
    const folders = groupPendingMedia(
      [anh({ id: "m1", classSessionId: "da-xoa", takenAt: new Date("2026-08-24T03:00:00.000Z") })],
      new Map(),
    );
    expect(folders).toHaveLength(1);
    expect(folders[0]!.key).toBe("c:cls1:2026-08-24");
    expect(folders[0]!.mediaIds).toEqual(["m1"]);
  });

  it("[F-21-T05] không có takenAt → lấy ngày TẢI LÊN, và cắt ngày theo ĐỒNG HỒ VN", () => {
    // 2026-08-24T18:30Z = 01:30 sáng 25/08 giờ VN. Cắt ngày bằng UTC ra 24/08 → sai
    // folder, sai hạn đúng một ngày.
    const folders = groupPendingMedia(
      [anh({ id: "m1", takenAt: null, createdAt: new Date("2026-08-24T18:30:00.000Z") })],
      new Map(),
    );
    expect(folders[0]!.key).toBe("c:cls1:2026-08-25");
  });

  it("[F-21-T06] latestUploadAt = ảnh MỚI NHẤT trong folder (để câu chữ nói đúng)", () => {
    const sessions = new Map([["s1", buoi({ id: "s1" })]]);
    const folders = groupPendingMedia(
      [
        anh({ id: "m1", classSessionId: "s1", createdAt: new Date("2026-08-24T02:00:00.000Z") }),
        anh({ id: "m2", classSessionId: "s1", createdAt: new Date("2026-08-27T02:00:00.000Z") }),
        anh({ id: "m3", classSessionId: "s1", createdAt: new Date("2026-08-25T02:00:00.000Z") }),
      ],
      sessions,
    );
    expect(folders[0]!.latestUploadAt.toISOString()).toBe("2026-08-27T02:00:00.000Z");
  });

  it("[F-21-T07] ảnh của hai LỚP khác nhau không bao giờ chung folder", () => {
    const folders = groupPendingMedia(
      [
        anh({ id: "m1", classId: "clsA", takenAt: new Date("2026-08-24T03:00:00.000Z") }),
        anh({ id: "m2", classId: "clsB", takenAt: new Date("2026-08-24T03:00:00.000Z") }),
      ],
      new Map(),
    );
    expect(folders).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[F-21] pickOverdueFolders — quá hạn tính theo hạn F-20, KHÔNG theo 2 ngày", () => {
  // Buổi 24/08 → hạn mặc định 10h sáng 25/08 VN = 2026-08-25T03:00Z.
  const HAN = computeReviewDeadline(new Date("2026-08-24T00:00:00.000Z"), CFG);

  it("[F-21-T10] chưa tới hạn → không chọn", () => {
    const out = pickOverdueFolders([folder("s:s1", HAN)], new Date("2026-08-25T02:59:00.000Z"));
    expect(out).toEqual([]);
  });

  it("[F-21-T11] ĐÚNG mốc hạn vẫn còn kịp (10:00:00 không phải là trễ)", () => {
    const out = pickOverdueFolders([folder("s:s1", HAN)], new Date(HAN));
    expect(out).toEqual([]);
  });

  it("[F-21-T12] qua hạn 1 phút → chọn", () => {
    const out = pickOverdueFolders(
      [folder("s:s1", HAN)],
      new Date(HAN.getTime() + 60_000),
    );
    expect(out.map((f) => f.key)).toEqual(["s:s1"]);
  });

  it("[F-21-T13] 🔴 ẢNH TẢI LÊN HÔM NAY CHO BUỔI TUẦN TRƯỚC — bản cũ bỏ sót, nay phải bắt", () => {
    // Buổi 22/08, giáo viên mới tải ảnh lên lúc 24/08 08:00 VN. Ngưỡng cũ ("chờ quá
    // 2 ngày kể từ createdAt") nói CHƯA trễ; hạn thật đã trôi từ 10h sáng 23/08.
    const buoiCu = new Date("2026-08-22T00:00:00.000Z");
    const han = computeReviewDeadline(buoiCu, CFG);
    const f = folder("s:s-cu", han, {
      folderAt: buoiCu,
      latestUploadAt: new Date("2026-08-24T01:00:00.000Z"),
    });
    const now = new Date("2026-08-24T01:05:00.000Z");
    // Kiểm chứng ngược: ngưỡng cũ đúng là đang nói "chưa trễ".
    expect(now.getTime() - f.latestUploadAt.getTime()).toBeLessThan(2 * 86_400_000);
    expect(pickOverdueFolders([f], now).map((x) => x.key)).toEqual(["s:s-cu"]);
  });

  it("[F-21-T14] quá hạn đã lâu hơn cửa sổ nhắc → thôi nhắc (không đào mồ vô hạn)", () => {
    const now = new Date(
      HAN.getTime() + (MEDIA_OVERDUE_LOOKBACK_DAYS + 1) * 86_400_000,
    );
    expect(pickOverdueFolders([folder("s:s1", HAN)], now)).toEqual([]);
  });

  it("[F-21-T15] còn trong cửa sổ nhắc thì vẫn nhắc", () => {
    const now = new Date(
      HAN.getTime() + (MEDIA_OVERDUE_LOOKBACK_DAYS - 1) * 86_400_000,
    );
    expect(pickOverdueFolders([folder("s:s1", HAN)], now).map((f) => f.key)).toEqual([
      "s:s1",
    ]);
  });

  it("[F-21-T16] chọn lọc từng folder một, folder chưa tới hạn không bị kéo theo", () => {
    const hanSau = computeReviewDeadline(new Date("2026-08-30T00:00:00.000Z"), CFG);
    const out = pickOverdueFolders(
      [folder("s:s1", HAN), folder("s:s2", hanSau)],
      new Date(HAN.getTime() + 3_600_000),
    );
    expect(out.map((f) => f.key)).toEqual(["s:s1"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[F-21] mediaOverdueDedupeKey — chống nhắc lại mỗi lượt cron", () => {
  it("[F-21-T20] hai lượt cron trong CÙNG ngày VN → cùng một khoá (chỉ một thông báo)", () => {
    const k1 = mediaOverdueDedupeKey("s:s1", new Date("2026-08-25T03:00:30.000Z"));
    const k2 = mediaOverdueDedupeKey("s:s1", new Date("2026-08-25T15:00:30.000Z"));
    expect(k1).toBe(k2);
    expect(k1).toBe("media_review.overdue:s:s1:2026-08-25");
  });

  it("[F-21-T21] sang ngày làm việc mới → khoá mới (việc vẫn treo thì vẫn được nhắc lại)", () => {
    const k1 = mediaOverdueDedupeKey("s:s1", new Date("2026-08-25T03:00:00.000Z"));
    const k2 = mediaOverdueDedupeKey("s:s1", new Date("2026-08-26T03:00:00.000Z"));
    expect(k1).not.toBe(k2);
  });

  it("[F-21-T22] 🔴 ranh giới ngày cắt theo GIỜ VN, không theo UTC", () => {
    // 2026-08-25T17:30Z = 00:30 ngày 26/08 VN → đã là NGÀY MỚI của người dùng.
    // 2026-08-25T16:30Z = 23:30 ngày 25/08 VN → vẫn ngày cũ.
    const cu = mediaOverdueDedupeKey("s:s1", new Date("2026-08-25T16:30:00.000Z"));
    const moi = mediaOverdueDedupeKey("s:s1", new Date("2026-08-25T17:30:00.000Z"));
    expect(cu).toBe("media_review.overdue:s:s1:2026-08-25");
    expect(moi).toBe("media_review.overdue:s:s1:2026-08-26");
  });

  it("[F-21-T23] folder lớp×ngày cũng ra khoá ổn định", () => {
    expect(
      mediaOverdueDedupeKey("c:cls1:2026-08-24", new Date("2026-08-25T03:00:00.000Z")),
    ).toBe("media_review.overdue:c:cls1:2026-08-24:2026-08-25");
  });

  it("[F-21-T24] 🔴 khoá KHÔNG được vòng đồng bộ việc tồn nhận là của nó", () => {
    // `syncStaffNotifications` đánh dấu ĐÃ ĐỌC mọi khoá thuộc phạm vi nó quản lý khi
    // loại việc biến mất. Nếu khoá F-21 lọt vào phạm vi đó, thông báo quá hạn bị dập
    // ngay trong chính request người dùng mở chuông — đúng lỗi BUG-1 đã vá 19/08.
    for (const key of [
      mediaOverdueDedupeKey("s:s1", new Date("2026-08-25T03:00:00.000Z")),
      mediaOverdueDedupeKey("c:cls1:2026-08-24", new Date("2026-08-25T03:00:00.000Z")),
    ]) {
      expect(isPendingSyncKey(key)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("[F-21] buildOverdueNotice — câu chữ", () => {
  const HAN = computeReviewDeadline(new Date("2026-08-24T00:00:00.000Z"), CFG);

  it("[F-21-T30] nói rõ lớp, ngày buổi và mốc hạn — đọc bằng đồng hồ VN", () => {
    const n = buildOverdueNotice({
      folder: folder("s:s1", HAN),
      className: "CS1-LTR-01",
      soAnh: 4,
    });
    expect(n.title).toContain("quá hạn");
    expect(n.body).toContain("CS1-LTR-01");
    expect(n.body).toContain("24/08/2026"); // ngày dạy
    expect(n.body).toContain("25/08/2026"); // ngày hạn
    expect(n.body).toContain("10:00");
    expect(n.body).toContain("4");
  });

  it("[F-21-T31] 🔴 ngày trong câu chữ không đổi theo TZ máy chạy", () => {
    // Buổi 00:30 sáng 25/08 giờ VN (= 24/08 17:30Z). Máy chạy UTC đọc ra "24/08" nếu
    // dùng toLocaleDateString — người nhận sẽ đi tìm nhầm folder.
    const buoiDem = new Date("2026-08-24T17:30:00.000Z");
    const n = buildOverdueNotice({
      folder: folder("s:s1", computeReviewDeadline(buoiDem, CFG), { folderAt: buoiDem }),
      className: "CS1-LTR-01",
      soAnh: 1,
    });
    expect(n.body).toContain("25/08/2026");
    expect(n.body).not.toContain("24/08/2026");
  });

  it("[F-21-T32] không nhét số điện thoại/tiền vào thông báo (PRD T5)", () => {
    const n = buildOverdueNotice({
      folder: folder("s:s1", HAN),
      className: "CS1-LTR-01",
      soAnh: 2,
    });
    expect(`${n.title} ${n.body}`).not.toMatch(/0\d{8,10}/);
  });
});
