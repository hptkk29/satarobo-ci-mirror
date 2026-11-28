// @vitest-environment node
/** [BND-*] Vân tay nội dung bài + so sánh hai phiên bản — phần thuần. */
import { describe, expect, it } from "vitest";
import { TRUONG_BAM_BAI, bamNoiDungBai, soSanhBan, type BaiDeBam, type BaiTrongBan } from "./ban-noi-dung";

const bai = (o: Partial<BaiDeBam> = {}): BaiDeBam => ({
  title: "Bài 1",
  kind: "READ",
  contentMd: "nội dung",
  minReadSeconds: 30,
  videoKey: null,
  youtubeId: null,
  youtubePhuDe: null,
  captionKey: null,
  durationSec: null,
  examId: null,
  rubricId: null,
  sessionDate: null,
  ...o,
});

describe("[BND-01] bamNoiDungBai", () => {
  it("cùng nội dung ⇒ cùng vân tay; MỖI trường trong danh sách đổi ⇒ vân tay đổi (không trường nào là trang trí)", () => {
    const g = bamNoiDungBai(bai());
    expect(bamNoiDungBai(bai())).toBe(g);
    expect(g).toMatch(/^[0-9a-f]{64}$/);
    const doi: Record<(typeof TRUONG_BAM_BAI)[number], Partial<BaiDeBam>> = {
      title: { title: "Bài 1 sửa" },
      kind: { kind: "VIDEO" },
      contentMd: { contentMd: "nội dung sửa" },
      minReadSeconds: { minReadSeconds: 31 },
      videoKey: { videoKey: "v" },
      youtubeId: { youtubeId: "y" },
      youtubePhuDe: { youtubePhuDe: true },
      captionKey: { captionKey: "c" },
      durationSec: { durationSec: 60 },
      examId: { examId: "e" },
      rubricId: { rubricId: "r" },
      sessionDate: { sessionDate: new Date("2026-11-18T00:00:00.000Z") },
    };
    for (const k of TRUONG_BAM_BAI) expect(bamNoiDungBai(bai(doi[k])), `trường ${k}`).not.toBe(g);
  });
  it("[BND-02] ghim danh sách trường (thêm/bớt trường là đổi vân tay MỌI bài — phải có chủ đích)", () => {
    expect([...TRUONG_BAM_BAI]).toEqual([
      "title", "kind", "contentMd", "minReadSeconds", "videoKey", "youtubeId", "youtubePhuDe", "captionKey", "durationSec", "examId", "rubricId", "sessionDate",
    ]);
  });
});

const b = (id: string, o: Partial<BaiTrongBan> = {}): BaiTrongBan => ({ lessonId: id, title: `Bài ${id}`, orderIndex: 0, required: true, contentHash: `h-${id}`, ...o });

describe("[BND-03] soSanhBan", () => {
  it("giống hệt ⇒ khongDoi; không có bản trước ⇒ mọi bài là THÊM", () => {
    const x = [b("a"), b("b", { orderIndex: 1 })];
    expect(soSanhBan(x, x).khongDoi).toBe(true);
    const r = soSanhBan(null, x);
    expect(r.them.map((t) => t.lessonId)).toEqual(["a", "b"]);
    expect(r.khongDoi).toBe(false);
  });
  it("thêm · bớt · đổi bắt buộc · đổi nội dung · đổi thứ tự — mỗi loại vào ĐÚNG ô của nó", () => {
    const cu = [b("a"), b("b", { orderIndex: 1 }), b("c", { orderIndex: 2 }), b("d", { orderIndex: 3 }), b("e", { orderIndex: 4 })];
    const moi = [
      b("a", { contentHash: "h-a2" }), // đổi nội dung
      b("b", { orderIndex: 1, required: false }), // đổi bắt buộc
      b("c", { orderIndex: 9 }), // đổi thứ tự
      b("e", { orderIndex: 4 }), // giữ
      b("f", { orderIndex: 5 }), // thêm   (d bị bớt)
    ];
    const r = soSanhBan(cu, moi);
    expect(r.them.map((t) => t.lessonId)).toEqual(["f"]);
    expect(r.bot.map((t) => t.lessonId)).toEqual(["d"]);
    expect(r.doiNoiDung.map((t) => t.lessonId)).toEqual(["a"]);
    expect(r.doiBatBuoc).toEqual([{ lessonId: "b", title: "Bài b", tu: true, den: false }]);
    expect(r.doiThuTu).toEqual([{ lessonId: "c", title: "Bài c", tu: 2, den: 9 }]);
    expect(r.chuaSoDuoc).toBe(0);
  });
  it("🔴 vân tay RỖNG (bản cũ trước P5a) ⇒ 'chưa so được', KHÔNG phải 'đã đổi' — nếu không mọi bài cũ hiện là đã sửa", () => {
    const r = soSanhBan([b("a", { contentHash: "" })], [b("a", { contentHash: "h-a" })]);
    expect(r.doiNoiDung).toEqual([]);
    expect(r.chuaSoDuoc).toBe(1);
    const r2 = soSanhBan([b("a", { contentHash: "h-a" })], [b("a", { contentHash: "" })]);
    expect(r2.doiNoiDung).toEqual([]);
    expect(r2.chuaSoDuoc).toBe(1);
  });
});
