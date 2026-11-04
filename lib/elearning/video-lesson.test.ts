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
  can: vi.fn(() => true),
  audit: vi.fn(async () => undefined),
  bai: null as unknown,
  capNhat: vi.fn(async (_a: { where: unknown; data: Record<string, unknown> }) => ({})),
}));

vi.mock("@/lib/auth/can", () => ({ can: h.can }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.audit }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    trnLesson: { findFirst: vi.fn(async () => h.bai), update: h.capNhat },
  }),
}));

import { runAction } from "@/lib/actions/factory";
import { cauHinhLuuBaiVideo } from "@/lib/elearning/video-lesson";

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
  h.can.mockReturnValue(true);
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

describe("sổ audit ghi được thay đổi có ý nghĩa", () => {
  it("ghi lại việc bài này CÓ hay CHƯA có phụ đề", async () => {
    // Đây là con số mà cổng xuất bản (C10) đứng lên; đọc sổ phải thấy được nó đổi
    // lúc nào và do ai.
    await luu({ captionKey: "elearning/caption/les1/a.vtt" });
    const s = JSON.stringify(h.audit.mock.calls);
    expect(s).toContain("coPhuDe");
  });
});
