import { beforeEach, describe, expect, it, vi } from "vitest";

// ── HÀNH VI của hai route ảnh OG với mục chưa công khai (issue #1088) ─────────────────────────────
// Mã TRƯỚC bản vá: `/tin-tuc/<slug>/og` đọc News theo slug KHÔNG kiểm isPublished ⇒ tiêu đề + tóm tắt bài NHÁP được vẽ thẳng vào ảnh PNG
// (đo TEST 01/11/2026: ảnh của bài nháp khác ảnh mặc định, HTTP 200). `/vinh-danh/<slug>/og` cũng vậy (layout ẩn mục không phủ lên route handler).
// Test chạy route THẬT với db + next/og giả, rồi soi cây phần tử truyền vào ImageResponse.
const bat = vi.hoisted(() => ({
  cay: null as unknown,
  dem: 0,
  news: vi.fn(),
  honor: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { news: { findUnique: bat.news }, honor: { findUnique: bat.honor } },
}));
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(el: unknown) {
      bat.cay = el;
      bat.dem += 1;
    }
  },
}));

import { GET as ogTinTuc } from "../../app/tin-tuc/[slug]/og/route";
import { GET as ogVinhDanh } from "../../app/(public)/vinh-danh/[slug]/og/route";

const THAM_SO = (slug: string) => ({ params: Promise.resolve({ slug }) });
const req = new Request("http://localhost/x");
const veRa = () => JSON.stringify(bat.cay);

beforeEach(() => {
  bat.cay = null;
  bat.dem = 0;
  bat.news.mockReset();
  bat.honor.mockReset();
});

describe("[OG-PUB] ảnh OG của mục chưa công khai", () => {
  it("[OG-PUB-01] tin tức NHÁP ⇒ ảnh mặc định, KHÔNG vẽ tiêu đề/tóm tắt của bài", async () => {
    bat.news.mockResolvedValue({ title: "TIEU DE BAI NHAP", excerpt: "TOM TAT BAI NHAP", isPublished: false });
    await ogTinTuc(req, THAM_SO("bai-nhap"));
    expect(bat.dem).toBe(1);
    const s = veRa();
    expect(s).not.toContain("TIEU DE BAI NHAP");
    expect(s).not.toContain("TOM TAT BAI NHAP");
    expect(s).toContain("Tin tức & Blog");
  });

  it("[OG-PUB-02] tin tức ĐÃ xuất bản ⇒ vẽ đúng tiêu đề và tóm tắt (không làm sai bài công khai)", async () => {
    bat.news.mockResolvedValue({ title: "TIEU DE CONG KHAI", excerpt: "TOM TAT CONG KHAI", isPublished: true });
    await ogTinTuc(req, THAM_SO("bai-cong-khai"));
    const s = veRa();
    expect(s).toContain("TIEU DE CONG KHAI");
    expect(s).toContain("TOM TAT CONG KHAI");
  });

  it("[OG-PUB-03] slug không tồn tại / lỗi DB ⇒ ảnh mặc định như cũ", async () => {
    bat.news.mockResolvedValue(null);
    await ogTinTuc(req, THAM_SO("khong-co"));
    expect(veRa()).toContain("Tin tức & Blog");
    bat.cay = null;
    bat.news.mockReturnValue(Promise.reject(new Error("db chet")));
    await ogTinTuc(req, THAM_SO("loi-db"));
    expect(veRa()).toContain("Tin tức & Blog");
  });

  it("[OG-PUB-04] truy vấn tin tức PHẢI lấy cột isPublished (thiếu cột ⇒ mọi bài bị coi là nháp)", async () => {
    bat.news.mockResolvedValue(null);
    await ogTinTuc(req, THAM_SO("x"));
    expect(bat.news.mock.calls[0][0].select.isPublished).toBe(true);
  });

  it("[OG-PUB-05] hồ sơ vinh danh CHƯA công khai ⇒ 404, không dựng ảnh", async () => {
    bat.honor.mockResolvedValue({ fullName: "HO TEN CHUA CONG KHAI", awardName: "GIAI CHUA CONG KHAI", isPublished: false, employee: null });
    const r = await ogVinhDanh(req, THAM_SO("ho-so-nhap"));
    expect(r.status).toBe(404);
    expect(bat.dem).toBe(0);
  });

  it("[OG-PUB-06] hồ sơ vinh danh ĐÃ công khai ⇒ vẽ tên + giải thưởng; truy vấn lấy isPublished", async () => {
    bat.honor.mockResolvedValue({
      fullName: "HO TEN CONG KHAI",
      jobTitle: null,
      jobTitleAtTime: "VI TRI",
      awardName: "GIAI CONG KHAI",
      isPublished: true,
      employee: null,
    });
    await ogVinhDanh(req, THAM_SO("ho-so-cong-khai"));
    expect(bat.dem).toBe(1);
    const s = veRa();
    expect(s).toContain("HO TEN CONG KHAI");
    expect(s).toContain("GIAI CONG KHAI");
    expect(bat.honor.mock.calls[0][0].select.isPublished).toBe(true);
  });

  it("[OG-PUB-07] hồ sơ không tồn tại ⇒ 404 như cũ", async () => {
    bat.honor.mockResolvedValue(null);
    const r = await ogVinhDanh(req, THAM_SO("khong-co"));
    expect(r.status).toBe(404);
  });
});
