import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "@/components/blog/markdown-renderer";
import {
  SO_BAI_MOI_LAN,
  baiChoFeed,
  chuyenMucCoBai,
  dinhDangNgay,
  duongDanTag,
  giaiMaTag,
  locTheoChuyenMuc,
  phanDangHien,
  tachMucLuc,
  taoIdMuc,
  type TinTucItem,
} from "@/components/blog/tin-tuc-thuan";

function bai(category: string | null, coverImage: string | null = null): TinTucItem {
  return { slug: "x", title: "t", excerpt: "", coverImage, category, ngay: "", phutDoc: 1, noiBat: false };
}

describe("[PUB-C-01] id mục lục", () => {
  it("bỏ dấu tiếng Việt, đ → d, gạch nối", () => {
    expect(taoIdMuc("Học viên Sata Robo thể hiện ra sao?")).toBe("hoc-vien-sata-robo-the-hien-ra-sao");
    expect(taoIdMuc("Đường đua ĐÀ NẴNG")).toBe("duong-dua-da-nang");
  });
  it("tiêu đề toàn ký hiệu vẫn ra id hợp lệ", () => {
    expect(taoIdMuc("???")).toBe("muc");
  });
});

describe("[PUB-C-02] tachMucLuc", () => {
  const md = [
    "# Tiêu đề bài (cấp 1, bị ẩn)",
    "Mở đầu",
    "## Cuộc thi diễn ra thế nào",
    "### Tiểu mục (cấp 3, không vào mục lục)",
    "```",
    "## Dòng này nằm trong khối mã",
    "```",
    "## **Đậm** và [liên kết](https://x.vn)",
    "## Cuộc thi diễn ra thế nào",
    "##Không có dấu cách thì không phải tiêu đề",
  ].join("\n");

  it("chỉ lấy h2 ngoài khối mã, bỏ cú pháp inline", () => {
    expect(tachMucLuc(md).map((m) => m.text)).toEqual([
      "Cuộc thi diễn ra thế nào",
      "Đậm và liên kết",
      "Cuộc thi diễn ra thế nào",
    ]);
  });
  it("tiêu đề trùng được đánh số, id không bao giờ trùng", () => {
    const ids = tachMucLuc(md).map((m) => m.id);
    expect(ids).toEqual(["cuoc-thi-dien-ra-the-nao", "dam-va-lien-ket", "cuoc-thi-dien-ra-the-nao-2"]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("CRLF vẫn tách đúng", () => {
    expect(tachMucLuc("## A\r\n## B\r\n").map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("[PUB-C-03] id trên thẻ h2 KHỚP mục lục (cùng bài, cùng tiêu đề trùng)", () => {
  it("renderer biến thể pub gắn đúng các id mà tachMucLuc trả ra", () => {
    const md = "## Mở đầu\n\nA\n\n## Ba mẹ hỏi: con có hợp không?\n\nB\n\n## Mở đầu\n\nC\n\n### Phụ\n";
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} variant="pub" />);
    const idTrenThe = [...html.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
    expect(idTrenThe).toEqual(tachMucLuc(md).map((m) => m.id));
    expect(idTrenThe).toEqual(["mo-dau", "ba-me-hoi-con-co-hop-khong", "mo-dau-2"]);
  });
  it("biến thể mặc định KHÔNG đổi: không có id, vẫn dùng lớp prose-lg", () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content={"## Mở đầu\n\nA"} />);
    expect(html).not.toContain(" id=");
    expect(html).toContain("prose-lg");
  });
  it("biến thể pub không mang màu cứng của biến thể cũ (vỡ chủ đề tối)", () => {
    const md = "> trích dẫn\n\nđoạn `mã` và [liên kết](https://x.vn)\n\n```\nkhối\n```\n";
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} variant="pub" />);
    for (const cu of ["bg-soft-cream", "bg-orange-50", "text-primary-orange", "bg-gray-900", "prose-lg"]) {
      expect(html, cu).not.toContain(cu);
    }
  });
});

describe("[PUB-C-04] chuyên mục & lọc", () => {
  const ds = [bai("Kiến thức"), bai("kiến thức "), bai("Sự kiện"), bai(null), bai("Tin trung tâm"), bai("Tin trung tâm")];
  it("chuyên mục trùng nhãn thiết kế đứng đầu theo đúng thứ tự thiết kế, chuyên mục khác theo số bài", () => {
    const ds2 = [bai("Kiến thức"), bai("Kiến thức"), bai("Góc phụ huynh"), bai("khóa học mới"), bai("Sự kiện"), bai("Tin trung tâm"), bai("Sự kiện")];
    expect(chuyenMucCoBai(ds2).map((c) => [c.label, c.soBai])).toEqual([
      ["Sự kiện", 2],
      ["khóa học mới", 1],
      ["Góc phụ huynh", 1],
      ["Kiến thức", 2],
      ["Tin trung tâm", 1],
    ]);
  });
  it("đếm gộp không phân biệt hoa thường", () => {
    expect(chuyenMucCoBai(ds).find((c) => c.label === "Kiến thức")?.soBai).toBe(2);
  });
  it("bài không chuyên mục chỉ ở 'Tất cả'", () => {
    expect(locTheoChuyenMuc(ds, null)).toHaveLength(6);
    expect(locTheoChuyenMuc(ds, "kiến thức")).toHaveLength(2);
    expect(locTheoChuyenMuc(ds, "không-có")).toHaveLength(0);
  });
});

describe("[PUB-C-05] phân đoạn & feed", () => {
  it("mỗi lần xem thêm 9 bài, tối thiểu 1 trang", () => {
    const ds = Array.from({ length: 25 }, (_, i) => i);
    expect(phanDangHien(ds, 1)).toHaveLength(SO_BAI_MOI_LAN);
    expect(phanDangHien(ds, 3)).toHaveLength(25);
    expect(phanDangHien(ds, 0)).toHaveLength(SO_BAI_MOI_LAN);
  });
  it("thẻ nổi lấy 3 bài đầu (mới nhất); ít hơn 3 thì đủ số có; không có thì rỗng", () => {
    const ds3 = [bai("a"), bai("b", "/1.jpg"), bai("c"), bai("d", "/3.jpg")];
    expect(baiChoFeed(ds3)).toHaveLength(3);
    expect(baiChoFeed([bai("a")])).toHaveLength(1);
    expect(baiChoFeed([])).toEqual([]);
  });
});

describe("[PUB-C-06] ngày & tag", () => {
  it("ngày theo múi giờ Việt Nam (không lệch ngày khi server chạy UTC)", () => {
    expect(dinhDangNgay(new Date("2026-11-01T18:30:00Z"))).toBe("02/11/2026");
    expect(dinhDangNgay(null)).toBe("");
  });
  it("tag có dấu / % mã hoá được và giải mã lại đúng; % lẻ không nổ", () => {
    for (const tag of ["Robot 2026", "Giáo dục & STEM", "100%", "Đà Nẵng"]) {
      expect(giaiMaTag(duongDanTag(tag).split("/").pop() ?? "")).toBe(tag);
    }
    expect(giaiMaTag("100%")).toBe("100%");
  });
});
