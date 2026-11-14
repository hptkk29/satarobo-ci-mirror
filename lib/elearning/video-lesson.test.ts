// @vitest-environment node
/**
 * EL-10 — lưu siêu dữ liệu bài video.
 *
 * Đây là mảnh làm cả chuỗi EL-10 dùng được: trước nó, bucket / presign / bộ đọc
 * mp4 / route phát đều đã sẵn mà KHÔNG bài học nào mang được một `videoKey`.
 *
 * Case đắt nhất là nhóm "khoá phải thuộc đúng bài": một bài trỏ vào tệp của bài
 * khác thì xoá bài kia làm bài này mất video, và không ai nối được nguyên nhân.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  can: vi.fn((..._a: unknown[]) => true),
  audit: vi.fn(async () => undefined),
  bai: null as unknown,
  /** Khoá đọc qua `scopedDb` — `null` = khoá thuộc cơ sở KHÁC (scopedDb đã lọc mất). */
  khoa: null as unknown,
  khoaTim: vi.fn(async (_a: { where: unknown }) => null as unknown),
  capNhat: vi.fn(async (_a: { where: unknown; data: Record<string, unknown> }) => ({})),
  /** Giao dịch đổi nguồn (`video-doi-nguon.ts`): ở đây chỉ GHI NHẬN lời gọi + chuyển `duLieu` cho `capNhat`. Hành vi thật
   *  (chụp, đặt lại, khoá, từ chối) do ca Postgres thật `tests/elearning/video-doi-nguon-db.test.ts` kiểm. */
  doiNguon: vi.fn(),
  /** Xem trước tác động (chỉ đọc) — hành vi thật do ca Postgres thật `[VDN-*]` kiểm; ở đây chỉ ghi nhận lời gọi. */
  xemTruoc: vi.fn(),
  ketQuaDoi: {
    doiNguon: false,
    revCu: 1,
    revMoi: 1,
    tacDong: { ghiDanhDangHoc: 0, ghiDanhDongBang: 0, daXongDangHoc: 0, daXongDongBang: 0, soCauHoiChen: 0 },
    daChup: 0,
    daDatLai: 0,
    daLamMoiPhanTram: 0,
    daGhiAudit: false,
  } as Record<string, unknown>,
}));

vi.mock("@/lib/auth/can", () => ({ can: h.can }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.audit }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    trnLesson: { findFirst: vi.fn(async () => h.bai), update: h.capNhat },
    trnCourse: { findFirst: vi.fn(async (a: { where: unknown }) => h.khoaTim(a)) },
  }),
}));
vi.mock("@/lib/elearning/video-doi-nguon", () => {
  class LoiDoiNguon extends Error {
    constructor(
      readonly ma: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { LoiDoiNguon, doiNguonBaiVideo: h.doiNguon, xemTruocDoiNguon: h.xemTruoc };
});

import { runAction } from "@/lib/actions/factory";
import { LoiDoiNguon } from "@/lib/elearning/video-doi-nguon";
import {
  cauHinhLuuBaiVideo,
  cauHinhLuuBaiVideoYoutube,
  cauHinhXemTruocDoiNguon,
} from "@/lib/elearning/video-lesson";

const ACTOR = {
  userId: "u-dt",
  isSuperAdmin: false,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
} as unknown as Parameters<typeof runAction>[1];

const CO_BAN = {
  lessonId: "les1",
  title: "Bài an toàn",
  videoKey: "elearning/master/les1/abc.mp4",
  durationSec: 300,
};

const luu = (o: Record<string, unknown> = {}) =>
  runAction(cauHinhLuuBaiVideo, ACTOR, { ...CO_BAN, ...o }, { actorName: "Đào tạo" });

const duLieu = () => h.capNhat.mock.calls[0]?.[0].data;

beforeEach(() => {
  h.can.mockReset();
  h.can.mockReturnValue(true);
  h.audit.mockClear();
  h.doiNguon.mockReset();
  h.xemTruoc.mockReset();
  h.doiNguon.mockImplementation(async (a: { lessonId: string; duLieu: Record<string, unknown> }) => {
    await h.capNhat({ where: { id: a.lessonId }, data: a.duLieu });
    return h.ketQuaDoi;
  });
  h.bai = {
    id: "les1",
    kind: "VIDEO",
    title: "Bài cũ",
    videoKey: null,
    durationSec: null,
    captionKey: null,
    module: { courseId: "c1" },
  };
  h.capNhat.mockClear();
  h.khoa = { id: "c1" };
  h.khoaTim.mockReset();
  h.khoaTim.mockImplementation(async () => h.khoa);
});

describe("ghi được siêu dữ liệu video", () => {
  it("lưu khoá tệp và thời lượng", async () => {
    const { res } = await luu();
    expect(res.ok).toBe(true);
    expect(duLieu()?.videoKey).toBe("elearning/master/les1/abc.mp4");
    expect(duLieu()?.durationSec).toBe(300);
  });

  it("lưu được phụ đề, âm thanh, bản chép lời", async () => {
    await luu({
      captionKey: "elearning/caption/les1/a.vtt",
      audioKey: "elearning/audio/les1/a.m4a",
      transcriptMd: "Xin chào",
    });
    expect(duLieu()?.captionKey).toBe("elearning/caption/les1/a.vtt");
    expect(duLieu()?.transcriptMd).toBe("Xin chào");
  });

  it("không truyền thì các cột phụ về `null`, không giữ giá trị cũ", async () => {
    // Giữ giá trị cũ khi người soạn đã bỏ phụ đề đi là để cổng xuất bản nhìn thấy
    // một phụ đề không còn tồn tại.
    h.bai = { ...(h.bai as object), captionKey: "cu.vtt" };
    await luu();
    expect(duLieu()?.captionKey).toBeNull();
  });
});

describe("khoá tệp phải THUỘC đúng bài này", () => {
  it("khoá của bài KHÁC ⇒ từ chối", async () => {
    // Một bài trỏ vào tệp của bài khác thì xoá bài kia làm bài này mất video, và
    // không ai nối được nguyên nhân.
    const { res } = await luu({ videoKey: "elearning/master/les2/x.mp4" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("KEY_NGOAI_BAI");
    expect(h.capNhat).not.toHaveBeenCalled();
  });

  it("kiểm CẢ phụ đề và âm thanh, không chỉ video", async () => {
    for (const ten of ["captionKey", "audioKey"] as const) {
      h.capNhat.mockClear();
      const { res } = await luu({ [ten]: "elearning/caption/les9/x.vtt" });
      expect(res.ok, ten).toBe(false);
      if (res.ok) continue;
      expect(res.error.field).toBe(ten);
    }
  });
});

describe("chốt codec ở ĐÂY, không chỉ ở bước tải lên", () => {
  it("codec đúng ⇒ cho qua", async () => {
    const { res } = await luu({
      codec: { videoCodec: "avc1", audioCodec: "mp4a", brand: "isom" },
    });
    expect(res.ok).toBe(true);
  });

  it("codec sai ⇒ từ chối, nói rõ phải xuất lại bằng gì", async () => {
    // Bước tải lên có thể bị gọi lại, bị bỏ giữa chừng, hay bị thay tệp; đây là
    // chỗ DUY NHẤT mà tệp và bản ghi bài học gắn với nhau.
    const { res } = await luu({
      codec: { videoCodec: "hev1", audioCodec: "mp4a", brand: "isom" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain("H.264");
  });

  it("không truyền codec thì không chặn — bước tải lên đã kiểm", async () => {
    expect((await luu()).res.ok).toBe(true);
  });
});

describe("thời lượng phải nằm trong chuẩn", () => {
  it("quá dài hoặc quá ngắn ⇒ từ chối", async () => {
    for (const d of [1, 2000]) {
      expect((await luu({ durationSec: d })).res.ok, String(d)).toBe(false);
    }
  });

  it("thiếu `videoKey` ⇒ từ chối", async () => {
    // Bài dạng VIDEO mà không có tệp là một bài người học mở ra thấy trống.
    expect((await luu({ videoKey: "" })).res.ok).toBe(false);
  });
});

describe("gác đúng loại bài và đúng quyền", () => {
  it("bài dạng KHÁC ⇒ từ chối, nêu loại thật", async () => {
    h.bai = { ...(h.bai as object), kind: "READ" };
    const { res } = await luu();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("WRONG_KIND");
    expect(res.error.message).toContain("READ");
  });

  it("thiếu quyền soạn nội dung ⇒ từ chối", async () => {
    h.can.mockReturnValue(false);
    const { res } = await luu();
    expect(res.ok).toBe(false);
    expect(h.capNhat).not.toHaveBeenCalled();
  });

  it("bài không tồn tại ⇒ 404", async () => {
    h.bai = null;
    const { res } = await luu();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });
});

describe("[YT-SAVE] tải tệp lên thì BỎ link YouTube (hai nguồn loại trừ nhau)", () => {
  it("lưu tệp ⇒ `youtubeId` về null và `youtubePhuDe` về false", async () => {
    // Giữ cả hai thì trang học phải chọn một và người soạn không biết nó chọn cái nào.
    h.bai = { ...(h.bai as object), youtubeId: "aBcDeFgHiJk" };
    await luu();
    expect(duLieu()?.youtubeId).toBeNull();
    expect(duLieu()?.youtubePhuDe).toBe(false);
  });
});

describe("[YT-SAVE] lưu bài video dùng LINK YOUTUBE", () => {
  const MA = "aBcDeFg_H-1";
  const luuYt = (o: Record<string, unknown> = {}) =>
    runAction(
      cauHinhLuuBaiVideoYoutube,
      ACTOR,
      {
        lessonId: "les1",
        title: "Bài YouTube",
        url: `https://youtu.be/${MA}`,
        durationSec: 754,
        coPhuDe: true,
        ...o,
      },
      { actorName: "Đào tạo" },
    );

  it("lưu mã video (do SERVER tách), thời lượng và xác nhận phụ đề", async () => {
    const { res } = await luuYt();
    expect(res.ok).toBe(true);
    expect(duLieu()?.youtubeId).toBe(MA);
    expect(duLieu()?.durationSec).toBe(754);
    expect(duLieu()?.youtubePhuDe).toBe(true);
    expect(duLieu()?.title).toBe("Bài YouTube");
  });

  it("🔴 XOÁ nguồn tệp: videoKey, videoKey360, captionKey, audioKey về null", async () => {
    // Loại trừ nhau: bài mang cả hai nguồn là dữ liệu lệch mà trang học phải đoán.
    h.bai = { ...(h.bai as object), videoKey: "elearning/master/les1/abc.mp4" };
    await luuYt();
    for (const c of ["videoKey", "videoKey360", "captionKey", "audioKey"]) {
      expect(duLieu(), c).toHaveProperty(c, null);
    }
  });

  it("nhận nhiều dạng link, luôn ra cùng một mã", async () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${MA}&t=3s`,
      `https://www.youtube.com/embed/${MA}`,
      `youtu.be/${MA}?si=xyz`,
    ]) {
      h.capNhat.mockClear();
      const { res } = await luuYt({ url });
      expect(res.ok, url).toBe(true);
      expect(duLieu()?.youtubeId, url).toBe(MA);
    }
  });

  it("link sai / host giả ⇒ từ chối, KHÔNG ghi gì", async () => {
    for (const url of [
      "https://vimeo.com/123456789",
      `https://youtube.com.evil.com/watch?v=${MA}`,
      `https://youtube.com@evil.com/watch?v=${MA}`,
      "https://www.youtube.com/playlist?list=PLabcdefghijk",
      "không phải link",
    ]) {
      h.capNhat.mockClear();
      const { res } = await luuYt({ url });
      expect(res.ok, url).toBe(false);
      if (res.ok) continue;
      expect(res.error.code, url).toBe("LINK_YOUTUBE_SAI");
      expect(h.capNhat, url).not.toHaveBeenCalled();
    }
  });

  it("server KHÔNG nhận mã đã tách từ client — chỉ nhận `url`", async () => {
    // `.strict()`: gửi thêm trường `youtubeId` là bị từ chối, không phải bị lờ đi.
    const { res } = await luuYt({ youtubeId: "zzzzzzzzzzz" });
    expect(res.ok).toBe(false);
    expect(h.capNhat).not.toHaveBeenCalled();
  });

  it("thời lượng ngoài khoảng hợp lý ⇒ từ chối (sàn 5 giây, trần 3 giờ)", async () => {
    for (const d of [0, 4, 3 * 3600 + 1, 12.5, -1]) {
      h.capNhat.mockClear();
      const { res } = await luuYt({ durationSec: d });
      expect(res.ok, String(d)).toBe(false);
      expect(h.capNhat, String(d)).not.toHaveBeenCalled();
    }
  });

  it("video dài hơn 15 phút ⇒ ĐƯỢC (trần 15 phút chỉ áp cho tệp tải lên)", async () => {
    expect((await luuYt({ durationSec: 2400 })).res.ok).toBe(true);
    expect(duLieu()?.durationSec).toBe(2400);
  });

  it("bài dạng KHÁC ⇒ từ chối, nêu loại thật", async () => {
    h.bai = { ...(h.bai as object), kind: "READ" };
    const { res } = await luuYt();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("WRONG_KIND");
    expect(h.capNhat).not.toHaveBeenCalled();
  });

  it("thiếu quyền soạn nội dung ⇒ từ chối", async () => {
    h.can.mockReturnValue(false);
    const { res } = await luuYt();
    expect(res.ok).toBe(false);
    expect(h.capNhat).not.toHaveBeenCalled();
  });

  it("bài không tồn tại ⇒ 404", async () => {
    h.bai = null;
    const { res } = await luuYt();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("🔴 sổ audit KHÔNG chứa mã video (mã là bí mật của video không công khai)", async () => {
    await luuYt();
    const s = JSON.stringify(h.audit.mock.calls);
    expect(s).not.toContain(MA);
    expect(s).toContain("YOUTUBE");
  });
});

describe("sổ audit ghi được thay đổi có ý nghĩa", () => {
  it("ghi lại việc bài này CÓ hay CHƯA có phụ đề", async () => {
    // Đây là con số mà cổng xuất bản (C10) đứng lên; đọc sổ phải thấy được nó đổi
    // lúc nào và do ai.
    await luu({ captionKey: "elearning/caption/les1/a.vtt" });
    const s = JSON.stringify(h.audit.mock.calls);
    expect(s).toContain("coPhuDe");
  });
});

describe("[DN-ACT] đổi NGUỒN video đi qua giao dịch đổi nguồn (phiên bản + chụp + đặt lại)", () => {
  // Trước 28/10/2026 (#1026 ghim `[YT-SRC-LIMIT]` bằng `it.fails`): cả hai đường lưu chỉ ghi `TrnLesson` — không đụng tiến độ,
  // không kiểm trạng thái khoá. Nay MỌI lần ghi nguồn đi qua `doiNguonBaiVideo`; hành vi thật ở ca Postgres thật `[VDN-*]`.
  // Ca ở đây khoá DÂY NỐI của handler: ai gọi giao dịch với tham số gì, và lỗi chính sách trở thành lỗi có mã thế nào.
  const luuYt = (o: Record<string, unknown> = {}) =>
    runAction(
      cauHinhLuuBaiVideoYoutube,
      ACTOR,
      { lessonId: "les1", title: "Bài YouTube", url: "https://youtu.be/aBcDeFg_H-1", durationSec: 300, coPhuDe: true, ...o },
      { actorName: "Đào tạo", reason: "thay video mới" },
    );
  const thamSo = () => h.doiNguon.mock.calls[0]![0] as Record<string, unknown>;

  it("MP4: truyền nhận dạng nguồn MỚI (khoá tệp, không YouTube), thời lượng, người đổi, lý do — và `duLieu` đầy đủ cột", async () => {
    await runAction(cauHinhLuuBaiVideo, ACTOR, { ...CO_BAN }, { actorName: "Đào tạo", reason: "thay tệp" });
    expect(thamSo()).toMatchObject({
      lessonId: "les1",
      moi: { youtubeId: null, videoKey: "elearning/master/les1/abc.mp4", durationSec: 300 },
      actorUserId: "u-dt",
      actorName: "Đào tạo",
      xacNhanToken: null,
      lyDo: "thay tệp",
    });
    expect(duLieu()?.videoKey).toBe("elearning/master/les1/abc.mp4");
  });

  it("YouTube: nhận dạng nguồn mới là MÃ do SERVER tách (không phải mã client), videoKey null", async () => {
    await luuYt();
    expect(thamSo()).toMatchObject({ moi: { youtubeId: "aBcDeFg_H-1", videoKey: null, durationSec: 300 }, lyDo: "thay video mới" });
  });

  it("`xacNhanToken` đi NGUYÊN VĂN từ đầu vào sang giao dịch (server kiểm chữ ký ở đó); vắng mặt ⇒ null (không có xác nhận)", async () => {
    await luuYt({ xacNhanToken: "chuoi.ky" });
    expect(thamSo().xacNhanToken).toBe("chuoi.ky");
    h.doiNguon.mockClear();
    await luuYt();
    expect(thamSo().xacNhanToken).toBeNull();
  });

  it("🔴 KHÔNG còn cờ boolean: `xacNhanTacDong` (kể cả `true`) bị từ chối ở schema; `xacNhanToken` chỉ nhận chuỗi", async () => {
    for (const lech of [{ xacNhanTacDong: true }, { xacNhanTacDong: "true" }, { xacNhanToken: true }, { xacNhanToken: "" }]) {
      h.doiNguon.mockClear();
      const { res } = await luuYt(lech);
      expect(res.ok, JSON.stringify(lech)).toBe(false);
      expect(h.doiNguon).not.toHaveBeenCalled();
    }
  });

  it("tên người đổi (`actorName`) đi sang giao dịch để audit TRONG giao dịch ghi đúng người", async () => {
    await luuYt();
    expect(thamSo().actorName).toBe("Đào tạo");
  });

  it("🔴 lý do dài quá 500 ký tự bị chặn TRƯỚC khi vào giao dịch (nó đi vào sổ audit bất biến), cả hai đường lưu", async () => {
    const dai = "x".repeat(501);
    const yt = await runAction(
      cauHinhLuuBaiVideoYoutube,
      ACTOR,
      { lessonId: "les1", title: "t", url: "https://youtu.be/aBcDeFg_H-1", durationSec: 300, coPhuDe: true },
      { actorName: "Đào tạo", reason: dai },
    );
    const mp4 = await runAction(cauHinhLuuBaiVideo, ACTOR, { ...CO_BAN }, { actorName: "Đào tạo", reason: dai });
    for (const r of [yt.res, mp4.res]) {
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error.code).toBe("VALIDATION");
      expect(r.error.field).toBe("reason");
    }
    expect(h.doiNguon).not.toHaveBeenCalled();
    // đối chứng: đúng 500 ký tự thì qua
    const ok = await runAction(cauHinhLuuBaiVideo, ACTOR, { ...CO_BAN }, { actorName: "Đào tạo", reason: "x".repeat(500) });
    expect(ok.res.ok).toBe(true);
  });

  it("🔴 quyền xuất bản hỏi bằng `can(actor, 'elearning:content:publish')` THẬT — người chỉ có quyền soạn không được báo là có quyền xuất bản", async () => {
    h.can.mockImplementation((_a: unknown, action: unknown) => action !== "elearning:content:publish");
    await luuYt();
    expect(thamSo().coQuyenXuatBan).toBe(false);
    h.doiNguon.mockClear();
    h.can.mockReturnValue(true);
    await luuYt();
    expect(thamSo().coQuyenXuatBan).toBe(true);
  });

  it("lỗi chính sách của giao dịch (thiếu quyền xuất bản / chưa xác nhận) ⇒ lỗi CÓ MÃ cho form; không có gì được ghi", async () => {
    for (const [ma, thongBao] of [
      ["CAN_XAC_NHAN_TAC_DONG", "Bài này đã có 12 lượt học. Xác nhận để tiếp tục."],
      ["CAN_QUYEN_XUAT_BAN", "Khoá này đã xuất bản — cần quyền xuất bản nội dung."],
      ["TAC_DONG_DA_DOI", "Người học bị ảnh hưởng đã thay đổi kể từ lúc bạn xem trước."],
      ["CAN_LY_DO", "Cần ghi lý do đổi video (từ 5 đến 500 ký tự)."],
    ] as const) {
      h.doiNguon.mockRejectedValueOnce(new LoiDoiNguon(ma, thongBao));
      const { res } = await luuYt();
      expect(res.ok, ma).toBe(false);
      if (res.ok) continue;
      expect(res.error.code).toBe(ma);
      expect(res.error.message).toBe(thongBao);
    }
    expect(h.capNhat).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("lỗi KHÔNG phải lỗi chính sách thì ném ra (để Sentry bắt), không bị nuốt thành lỗi có mã", async () => {
    h.doiNguon.mockRejectedValueOnce(new Error("deadlock detected"));
    await expect(luuYt()).rejects.toThrow("deadlock");
  });

  it("🔴 ĐỔI nguồn ⇒ audit do GIAO DỊCH ghi (cùng giao dịch với việc đổi) nên factory KHÔNG ghi lần hai", async () => {
    h.ketQuaDoi = { ...h.ketQuaDoi, doiNguon: true, revCu: 2, revMoi: 3, daGhiAudit: true };
    try {
      const { res } = await luuYt();
      expect(res.ok).toBe(true);
      expect(h.audit).not.toHaveBeenCalled();
    } finally {
      h.ketQuaDoi = { ...h.ketQuaDoi, doiNguon: false, revCu: 1, revMoi: 1, daGhiAudit: false };
    }
  });

  it("🔴 và ngược lại: giao dịch KHÔNG ghi audit (`daGhiAudit: false`) ⇒ factory ghi, không để việc lưu mất dấu", async () => {
    h.ketQuaDoi = { ...h.ketQuaDoi, daGhiAudit: false };
    await luuYt();
    expect(h.audit).toHaveBeenCalledTimes(1);
  });

  it("không đổi nguồn (chỉ metadata) ⇒ audit nói `doiNguon: false` và không mang số liệu đặt lại", async () => {
    await luuYt();
    const s = JSON.stringify(h.audit.mock.calls);
    expect(s).toContain('"doiNguon":false');
    expect(s).not.toContain("daDatLai");
  });
});

describe("[CS-DOI-NGUON] cách ly CƠ SỞ: bài của khoá thuộc cơ sở KHÁC không đổi được nguồn", () => {
  // ⚠️ `TrnLesson`/`TrnModule` không nằm trong SCOPED_MODELS và `can(publish)` không mang target (quyền seed là GLOBAL),
  // nên lượt đọc KHOÁ qua `scopedDb` là cổng cách ly DUY NHẤT. `h.khoa = null` mô phỏng đúng việc `scopedDb` lọc mất khoá của
  // cơ sở khác. Cùng mẫu với `lib/elearning/lesson-cue-authoring.test.ts`.
  const luuYtCs = () =>
    runAction(
      cauHinhLuuBaiVideoYoutube,
      ACTOR,
      { lessonId: "les1", title: "Bài YouTube", url: "https://youtu.be/aBcDeFg_H-1", durationSec: 300, coPhuDe: true },
      { actorName: "Đào tạo" },
    );
  const baiLoai = (kind: string, courseId = "c1") => ({
    id: "les1",
    kind,
    title: "x",
    videoKey: null,
    youtubeId: null,
    durationSec: null,
    captionKey: null,
    module: { courseId },
  });

  it("🔴 MP4: khoá ngoài phạm vi ⇒ NOT_FOUND, KHÔNG gọi giao dịch đổi nguồn, KHÔNG ghi, KHÔNG audit", async () => {
    h.khoa = null;
    const { res } = await luu();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
    expect(h.doiNguon).not.toHaveBeenCalled();
    expect(h.capNhat).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("🔴 YouTube: khoá ngoài phạm vi ⇒ NOT_FOUND, KHÔNG gọi giao dịch đổi nguồn, KHÔNG ghi, KHÔNG audit", async () => {
    h.khoa = null;
    const { res } = await luuYtCs();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
    expect(h.doiNguon).not.toHaveBeenCalled();
    expect(h.capNhat).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("khoá ngoài phạm vi trả CÙNG lỗi với 'bài không tồn tại' (không cho người dò biết id nào có thật)", async () => {
    h.bai = null;
    const khongCoBai = await luu();
    h.bai = baiLoai("VIDEO");
    h.khoa = null;
    const ngoaiPhamVi = await luu();
    expect(khongCoBai.res.ok).toBe(false);
    expect(ngoaiPhamVi.res.ok).toBe(false);
    if (khongCoBai.res.ok || ngoaiPhamVi.res.ok) return;
    expect(ngoaiPhamVi.res.error.code).toBe(khongCoBai.res.error.code);
    expect(ngoaiPhamVi.res.error.message).toBe(khongCoBai.res.error.message);
  });

  it("cổng cơ sở đứng TRƯỚC cổng loại bài: bài loại khác ở khoá ngoài phạm vi cũng nhận NOT_FOUND (không lộ loại bài)", async () => {
    h.bai = baiLoai("READ");
    h.khoa = null;
    const { res } = await luu();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("đối chứng dương: khoá trong phạm vi ⇒ qua, và lượt đọc khoá dùng ĐÚNG `courseId` của chương chứa bài (cả hai đường)", async () => {
    h.bai = baiLoai("VIDEO", "khoa-cua-bai");
    const mp4 = await luu();
    expect(mp4.res.ok).toBe(true);
    const yt = await luuYtCs();
    expect(yt.res.ok).toBe(true);
    expect(h.khoaTim).toHaveBeenCalledTimes(2);
    for (const goi of h.khoaTim.mock.calls) {
      expect(goi[0].where).toMatchObject({ id: "khoa-cua-bai", deletedAt: null });
    }
    expect(h.doiNguon).toHaveBeenCalledTimes(2);
  });
});

describe("[AUD-MP4] sổ audit KHÔNG chứa khoá tệp / mã nguồn — cả giá trị MỚI lẫn giá trị CŨ (khoá R2 là đường dẫn tới nội dung chưa công khai)", () => {
  // ⚠️ Fixture phải mang khoá CŨ thật: bài mặc định ở `beforeEach` có `videoKey: null`, nên `oldValues.videoKey` chỉ ra `null` và
  // phép cấy "đẩy khoá cũ vào oldValues" không làm ca nào đỏ (lỗ lưới tìm ra khi cấy lỗi ngày 28/10).
  const KHOA_CU = {
    videoKey: "elearning/master/les1/CU-video.mp4",
    captionKey: "elearning/caption/les1/CU-phude.vtt",
    youtubeId: "CuYtId_0001",
  };
  const baiCoNguonCu = () => ({
    id: "les1",
    kind: "VIDEO",
    title: "Bài cũ",
    durationSec: 300,
    ...KHOA_CU,
    module: { courseId: "c1" },
  });
  const khongCoKhoaNao = (s: string) => {
    expect(s).not.toContain(KHOA_CU.videoKey);
    expect(s).not.toContain(KHOA_CU.captionKey);
    expect(s).not.toContain(KHOA_CU.youtubeId);
    expect(s).not.toMatch(/elearning\/(master|caption|audio)\//);
  };

  it("🔴 lưu MP4 mới (bài ĐANG có nguồn cũ) ⇒ audit không chứa khoá CŨ lẫn khoá MỚI", async () => {
    h.bai = baiCoNguonCu();
    const { res } = await luu({
      videoKey: "elearning/master/les1/MOI-video.mp4",
      captionKey: "elearning/caption/les1/MOI-phude.vtt",
      audioKey: "elearning/audio/les1/MOI-am.m4a",
    });
    expect(res.ok).toBe(true);
    expect(h.audit).toHaveBeenCalled();
    const s = JSON.stringify(h.audit.mock.calls);
    khongCoKhoaNao(s);
    expect(s).not.toContain("MOI-video.mp4");
    expect(s).not.toContain("MOI-phude.vtt");
    expect(s).not.toContain("MOI-am.m4a");
  });

  it("🔴 lưu link YouTube mới (bài ĐANG có nguồn cũ) ⇒ audit không chứa khoá CŨ, mã YouTube cũ lẫn mã mới", async () => {
    h.bai = baiCoNguonCu();
    const { res } = await runAction(
      cauHinhLuuBaiVideoYoutube,
      ACTOR,
      { lessonId: "les1", title: "Bài YouTube", url: "https://youtu.be/MoiYtId_002", durationSec: 300, coPhuDe: true },
      { actorName: "Đào tạo" },
    );
    expect(res.ok).toBe(true);
    expect(h.audit).toHaveBeenCalled();
    const s = JSON.stringify(h.audit.mock.calls);
    khongCoKhoaNao(s);
    expect(s).not.toContain("MoiYtId_002");
  });
});

describe("[XT] xem trước tác động đổi nguồn — CHỈ ĐỌC, cùng cổng với hai đường lưu", () => {
  const ketQua = { doiNguon: true, khoaDaXuatBan: true, coQuyenXuatBan: true, yeuCauXacNhan: true, xacNhanToken: "t.k" };
  const xem = (o: Record<string, unknown> = {}, actor = ACTOR) =>
    runAction(cauHinhXemTruocDoiNguon, actor, { lessonId: "les1", loai: "YOUTUBE", url: "https://youtu.be/aBcDeFg_H-1", durationSec: 300, ...o }, { actorName: "Đào tạo" });

  beforeEach(() => {
    h.xemTruoc.mockResolvedValue(ketQua);
  });

  it("YouTube: server TỰ TÁCH mã từ link; truyền nhận dạng nguồn mới + người gọi + quyền xuất bản THẬT", async () => {
    const { res } = await xem();
    expect(res.ok).toBe(true);
    expect(h.xemTruoc).toHaveBeenCalledTimes(1);
    expect(h.xemTruoc.mock.calls[0]![0]).toMatchObject({
      lessonId: "les1",
      moi: { youtubeId: "aBcDeFg_H-1", videoKey: null, durationSec: 300 },
      actorUserId: "u-dt",
      coQuyenXuatBan: true,
    });
    h.xemTruoc.mockClear();
    h.can.mockImplementation((_a: unknown, action: unknown) => action !== "elearning:content:publish");
    await xem();
    expect(h.xemTruoc.mock.calls[0]![0].coQuyenXuatBan).toBe(false);
  });

  it("MP4: khoá tệp phải THUỘC bài; thiếu khoá ⇒ từ chối; trả nhận dạng nguồn là khoá đó", async () => {
    const ok = await xem({ loai: "TEP", url: undefined, videoKey: "elearning/master/les1/abc.mp4" });
    expect(ok.res.ok).toBe(true);
    expect(h.xemTruoc.mock.calls[0]![0].moi).toMatchObject({ youtubeId: null, videoKey: "elearning/master/les1/abc.mp4" });
    const ngoai = await xem({ loai: "TEP", url: undefined, videoKey: "elearning/master/bai-khac/abc.mp4" });
    expect(ngoai.res.ok).toBe(false);
    if (!ngoai.res.ok) expect(ngoai.res.error.code).toBe("KEY_NGOAI_BAI");
    const thieu = await xem({ loai: "TEP", url: undefined });
    expect(thieu.res.ok).toBe(false);
  });

  it("link sai / thiếu link ⇒ từ chối, không hỏi giao dịch", async () => {
    for (const url of ["https://vimeo.com/123", undefined]) {
      h.xemTruoc.mockClear();
      const { res } = await xem({ url });
      expect(res.ok).toBe(false);
      expect(h.xemTruoc).not.toHaveBeenCalled();
    }
  });

  it("🔴 CHỈ ĐỌC: không ghi bài, không ghi audit, không gọi giao dịch đổi nguồn", async () => {
    await xem();
    expect(h.capNhat).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
    expect(h.doiNguon).not.toHaveBeenCalled();
  });

  it("🔴 cùng cổng với đường lưu: thiếu quyền soạn ⇒ PERMISSION_DENIED; khoá ngoài phạm vi ⇒ NOT_FOUND; bài loại khác ⇒ WRONG_KIND; bài không có ⇒ NOT_FOUND", async () => {
    h.can.mockReturnValue(false);
    const a = await xem();
    expect(a.res.ok).toBe(false);
    if (!a.res.ok) expect(a.res.error.code).toBe("PERMISSION_DENIED");
    h.can.mockReturnValue(true);
    h.khoa = null;
    const b = await xem();
    if (!b.res.ok) expect(b.res.error.code).toBe("NOT_FOUND");
    expect(b.res.ok).toBe(false);
    h.khoa = { id: "c1" };
    h.bai = { ...(h.bai as object), kind: "READ" };
    const c = await xem();
    expect(c.res.ok).toBe(false);
    if (!c.res.ok) expect(c.res.error.code).toBe("WRONG_KIND");
    h.bai = null;
    const d = await xem();
    expect(d.res.ok).toBe(false);
    if (!d.res.ok) expect(d.res.error.code).toBe("NOT_FOUND");
    expect(h.xemTruoc).not.toHaveBeenCalled();
  });

  it("trả NGUYÊN kết quả của lõi cho form (số liệu + chuỗi xác nhận)", async () => {
    const { res } = await xem();
    expect(res.ok && res.data).toMatchObject(ketQua);
  });
});

describe("[HD2] hardening vòng hai: lý do an toàn, bản 360p, phạm vi cơ sở của audit", () => {
  const yt = (reason: unknown) =>
    runAction(
      cauHinhLuuBaiVideoYoutube,
      ACTOR,
      { lessonId: "les1", title: "t", url: "https://youtu.be/aBcDeFg_H-1", durationSec: 300, coPhuDe: true },
      { actorName: "Đào tạo", reason: reason as never },
    );

  it("🔴 `reason` không phải chuỗi (client gọi thẳng Server Action) ⇒ VALIDATION, không phải 500", async () => {
    for (const bad of [123, { a: 1 }, ["x"], true]) {
      const { res } = await yt(bad);
      expect(res.ok, JSON.stringify(bad)).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe("VALIDATION");
        expect(res.error.field).toBe("reason");
      }
    }
    expect(h.doiNguon).not.toHaveBeenCalled();
  });

  it("🔴 megabyte khoảng trắng + vài ký tự thật: đo CHUỖI THÔ (không chỉ sau cắt) ⇒ từ chối, không lọt vào sổ audit của nhánh không đổi nguồn", async () => {
    const { res } = await yt(" ".repeat(5_000) + "abcde");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION");
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("🔴 lý do chứa link/mã video ⇒ VALIDATION cả hai đường lưu (mã là bí mật của video không công khai)", async () => {
    const a = await yt("đổi sang https://youtu.be/AbCdEfGhIjK vì bản cũ lỗi");
    const b = await runAction(cauHinhLuuBaiVideo, ACTOR, { ...CO_BAN }, { actorName: "Đào tạo", reason: "tệp elearning/master/les1/moi.mp4 mới" });
    for (const r of [a.res, b.res]) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("VALIDATION");
        expect(r.error.field).toBe("reason");
      }
    }
    expect(h.doiNguon).not.toHaveBeenCalled();
    // đối chứng dương
    expect((await yt("Bản cũ sai tiếng, thay bằng bản đã lồng lại")).res.ok).toBe(true);
  });

  it("🔴 thay MP4 bằng MP4 mới BỎ bản 360p của video cũ (`videoKey360: null`) — giữ lại thì rendition của video đã bị thay vẫn là 'tệp hiện hành'", async () => {
    await runAction(cauHinhLuuBaiVideo, ACTOR, { ...CO_BAN }, { actorName: "Đào tạo", reason: "thay tệp" });
    expect(duLieu()).toHaveProperty("videoKey360", null);
  });

  it("phạm vi cơ sở của khoá đi vào audit của nhánh KHÔNG đổi nguồn (factory ghi): ưu tiên orgUnitId, rơi về centerId", async () => {
    h.khoa = { id: "c1", orgUnitId: "ou-cs2", centerId: "ce-cs2" };
    await yt("Bản cũ sai tiếng, thay bằng bản đã lồng lại");
    expect((h.audit.mock.calls.at(-1) as unknown[])[0]).toMatchObject({ orgUnitId: "ou-cs2" });
    h.audit.mockClear();
    h.khoa = { id: "c1", orgUnitId: null, centerId: "ce-cs2" };
    await runAction(cauHinhLuuBaiVideo, ACTOR, { ...CO_BAN }, { actorName: "Đào tạo", reason: "thay tệp" });
    expect((h.audit.mock.calls.at(-1) as unknown[])[0]).toMatchObject({ orgUnitId: "ce-cs2" });
  });
});
