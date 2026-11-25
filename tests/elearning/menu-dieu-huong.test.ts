// @vitest-environment node
/**
 * 🔴 MENU khu học tập nội bộ — hợp đồng quyền → lối vào.
 *
 * Đây là lưới chống hai kiểu hỏng của một thanh điều hướng dựng lại:
 *   1. LỘ lối vào: người học thuần thấy "Chấm bài", quản lý cơ sở thấy báo cáo TOÀN HỆ (F-01 đã nghiệm thu).
 *   2. GIẤU lối vào: người có quyền không còn tới được màn của mình.
 * Menu không phải cổng bảo vệ (cổng là `can()` ở từng trang) — nhưng mục menu mà đích từ chối thì người dùng
 * tưởng mình mất quyền; còn trang không có lối vào thì chỉ người viết ra nó biết đường.
 *
 * Mỗi ca ghi TẬP href kỳ vọng bằng tay (không suy từ chính menu) — một bảng suy từ mã là bảng luôn khớp mã.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  khuDangMo,
  menuElearning,
  moiHrefThay,
  mucDangMo,
  type QuyenMenu,
} from "@/app/(elearning)/elearning/_components/menu";

const KHONG: QuyenMenu = {
  soan: false,
  cham: false,
  giao: false,
  baoCao: false,
  baoCaoDoi: false,
  quanLyYeuCau: false,
  quanLyChuongTrinh: false,
  evalLinkBat: false,
};
const q = (p: Partial<QuyenMenu>): QuyenMenu => ({ ...KHONG, ...p });
const tap = (p: Partial<QuyenMenu>) => new Set(moiHrefThay(menuElearning(q(p))));

const HOC = [
  "/elearning",
  "/elearning/khoa-cua-toi",
  "/elearning/chung-nhan-cua-toi",
  "/elearning/du-lieu-cua-toi",
];
const TQ_DT = "/elearning/dao-tao";
const SOAN = [
  TQ_DT,
  "/elearning/chuong-trinh",
  "/elearning/soan-khoa",
  "/elearning/kho-cau-hoi",
  "/elearning/de-thi",
  "/elearning/khung-cham",
];
const CHAM = [TQ_DT, "/elearning/cham-bai-tap", "/elearning/cham-bai"];
const BAO_CAO = [
  "/elearning/bao-cao",
  "/elearning/bao-cao-r4",
  "/elearning/bao-cao-r5",
  "/elearning/bao-cao-r7",
  "/elearning/ma-tran",
  "/elearning/chung-nhan",
  "/elearning/yeu-cau",
  "/elearning/tu-dong-hoa",
];

describe("[MENU-01] tổ hợp quyền → tập href thấy được", () => {
  it("người học thuần: ĐÚNG bốn mục khu Học tập, không gì khác", () => {
    expect(tap({})).toEqual(new Set(HOC));
  });

  it("chỉ `content:author` → thêm khu soạn, KHÔNG thêm chấm/giao/báo cáo", () => {
    expect(tap({ soan: true })).toEqual(new Set([...HOC, ...SOAN]));
  });

  it("chỉ `exam:grade` → thêm hai hàng chờ chấm", () => {
    expect(tap({ cham: true })).toEqual(new Set([...HOC, ...CHAM]));
  });

  it("chỉ `assignment:create` → thêm Giao khoá", () => {
    expect(tap({ giao: true })).toEqual(new Set([...HOC, TQ_DT, "/elearning/giao-bai"]));
  });

  it("chỉ `progress:view-all` → báo cáo + ma trận + yêu cầu + chứng nhận + tự động hoá, KHÔNG soạn/chấm/giao và KHÔNG tổng quan Đào tạo", () => {
    expect(tap({ baoCao: true })).toEqual(new Set([...HOC, ...BAO_CAO]));
    expect(tap({ baoCao: true }).has(TQ_DT)).toBe(false);
  });

  it("chỉ `requirement:manage` → Yêu cầu + Ma trận, không báo cáo", () => {
    expect(tap({ quanLyYeuCau: true })).toEqual(
      new Set([...HOC, "/elearning/yeu-cau", "/elearning/ma-tran"]),
    );
  });

  it("chỉ `program:manage` → Tự động hoá; Mức đánh giá CHỈ khi cờ EL-21 bật", () => {
    expect(tap({ quanLyChuongTrinh: true })).toEqual(new Set([...HOC, "/elearning/tu-dong-hoa"]));
    expect(tap({ quanLyChuongTrinh: true, evalLinkBat: true })).toEqual(
      new Set([...HOC, "/elearning/tu-dong-hoa", "/elearning/muc-danh-gia"]),
    );
  });

  it("cờ EL-21 bật mà KHÔNG có `program:manage` → vẫn không có Mức đánh giá (đối chứng)", () => {
    expect(tap({ evalLinkBat: true, baoCao: true }).has("/elearning/muc-danh-gia")).toBe(false);
    expect(tap({ evalLinkBat: true }).has("/elearning/muc-danh-gia")).toBe(false);
  });

  it("vai đầy đủ: thấy hết, không trùng href ngoài `/elearning/bao-cao` (đã loại trừ), không mục nào lặp", () => {
    const khu = menuElearning(
      q({
        soan: true,
        cham: true,
        giao: true,
        baoCao: true,
        quanLyYeuCau: true,
        quanLyChuongTrinh: true,
        evalLinkBat: true,
      }),
    );
    const hrefs = moiHrefThay(khu);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(new Set(hrefs)).toEqual(
      new Set([...HOC, ...SOAN, ...CHAM, "/elearning/giao-bai", ...BAO_CAO, "/elearning/muc-danh-gia"]),
    );
  });
});

describe("[MENU-02] F-01 — quản lý cơ sở chỉ có MỘT lối vào báo cáo, và nó là 'Báo cáo đội'", () => {
  it("`view-team` không kèm `view-all`: đúng thêm /elearning/bao-cao, nhãn 'Báo cáo đội'", () => {
    const khu = menuElearning(q({ baoCaoDoi: true }));
    expect(new Set(moiHrefThay(khu))).toEqual(new Set([...HOC, "/elearning/bao-cao"]));
    const muc = khu.flatMap((k) => k.muc).find((m) => m.href === "/elearning/bao-cao");
    expect(muc?.nhan).toBe("Báo cáo đội");
    // Đối chứng ÂM: không một lối nào tới báo cáo toàn hệ / chứng nhận / ma trận.
    for (const cam of [
      "/elearning/bao-cao-r4",
      "/elearning/bao-cao-r5",
      "/elearning/bao-cao-r7",
      "/elearning/chung-nhan",
      "/elearning/ma-tran",
      "/elearning/tu-dong-hoa",
    ]) {
      expect(tap({ baoCaoDoi: true }).has(cam), cam).toBe(false);
    }
  });

  it("khu của quản lý cơ sở là 'co-so', không phải 'bao-cao'", () => {
    const khu = menuElearning(q({ baoCaoDoi: true }));
    expect(khu.map((k) => k.id)).toEqual(["hoc-tap", "co-so"]);
  });

  it("có cả `view-all` lẫn `view-team`: `view-all` thắng — một mục 'Báo cáo', không 'Báo cáo đội'", () => {
    const khu = menuElearning(q({ baoCao: true, baoCaoDoi: true }));
    const nhan = khu.flatMap((k) => k.muc).filter((m) => m.href === "/elearning/bao-cao");
    expect(nhan).toHaveLength(1);
    expect(nhan[0]?.nhan).not.toBe("Báo cáo đội");
    expect(khu.map((k) => k.id)).not.toContain("co-so");
  });
});

describe("[MENU-03] khu làm việc", () => {
  it("khu 'Học tập' luôn đứng đầu và luôn có; khu rỗng không xuất hiện", () => {
    expect(menuElearning(KHONG).map((k) => k.id)).toEqual(["hoc-tap"]);
    expect(menuElearning(q({ soan: true, baoCao: true })).map((k) => k.id)).toEqual([
      "hoc-tap",
      "dao-tao",
      "bao-cao",
      "quan-tri",
    ]);
  });

  it("mỗi mục thuộc đúng MỘT khu", () => {
    const khu = menuElearning(q({ soan: true, cham: true, giao: true, baoCao: true, quanLyChuongTrinh: true }));
    const dem = new Map<string, number>();
    for (const m of khu.flatMap((k) => k.muc)) dem.set(m.href, (dem.get(m.href) ?? 0) + 1);
    for (const [h, n] of dem) expect(n, h).toBe(1);
  });
});

describe("[MENU-04] mục đang mở theo đường dẫn", () => {
  const day = menuElearning(
    q({ soan: true, cham: true, giao: true, baoCao: true, quanLyChuongTrinh: true }),
  );
  const mo = (p: string) => mucDangMo(day, p)?.href ?? null;

  it("`/elearning` chỉ khớp chính nó, không nuốt mọi trang con", () => {
    expect(mo("/elearning")).toBe("/elearning");
    expect(mo("/elearning/giao-bai")).toBe("/elearning/giao-bai");
  });

  it("tiền tố theo ĐOẠN: bao-cao-r4 không bị bao-cao nuốt", () => {
    expect(mo("/elearning/bao-cao")).toBe("/elearning/bao-cao");
    expect(mo("/elearning/bao-cao/video")).toBe("/elearning/bao-cao");
    expect(mo("/elearning/bao-cao-r4")).toBe("/elearning/bao-cao-r4");
  });

  it("trang con thuộc mục cha: đề cương/bài học → Khoá của tôi; trình soạn bài → Soạn khoá", () => {
    expect(mo("/elearning/hoc/abc")).toBe("/elearning/khoa-cua-toi");
    expect(mo("/elearning/hoc/abc/def")).toBe("/elearning/khoa-cua-toi");
    expect(mo("/elearning/soan/xyz")).toBe("/elearning/soan-khoa");
    expect(mo("/elearning/soan-khoa/c1")).toBe("/elearning/soan-khoa");
    expect(mo("/elearning/de-thi/e1")).toBe("/elearning/de-thi");
    expect(mo("/elearning/cham-bai/a1")).toBe("/elearning/cham-bai");
  });

  it("clean URL trên host e-learning (không tiền tố) vẫn khớp đúng mục", () => {
    expect(mo("/")).toBe("/elearning");
    expect(mo("/ma-tran")).toBe("/elearning/ma-tran");
    expect(mo("/hoc/abc")).toBe("/elearning/khoa-cua-toi");
    expect(mo("/elearning/ma-tran/")).toBe("/elearning/ma-tran");
  });

  it("khu đang mở theo trang; đường lạ rơi về Học tập", () => {
    expect(khuDangMo(day, "/elearning/de-thi/e1")).toBe("dao-tao");
    expect(khuDangMo(day, "/elearning/ma-tran")).toBe("bao-cao");
    expect(khuDangMo(day, "/elearning/tu-dong-hoa")).toBe("quan-tri");
    expect(khuDangMo(day, "/elearning/khong-co-trang-nay")).toBe("hoc-tap");
  });
});

// ── Khoá menu = khoá TRANG ────────────────────────────────────────────────────────────────────
// Nếu một mục menu hiện cho người KHÔNG qua được cổng của trang đích thì người ấy thấy cánh cửa mở ra là bị
// từ chối (và nghĩ mình mất quyền). Ghim: mỗi mục có trang tự gác thì trang ấy phải hỏi đúng khoá mà menu dùng.
const doc = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("[MENU-05] khoá của mục menu = khoá mà trang đích tự hỏi", () => {
  const CAP: [string, string, string][] = [
    ["soan-khoa", "elearning:content:author", "soan"],
    ["kho-cau-hoi", "elearning:content:author", "soan"],
    ["de-thi", "elearning:content:author", "soan"],
    ["khung-cham", "elearning:content:author", "soan"],
    ["cham-bai", "elearning:exam:grade", "cham"],
    ["cham-bai-tap", "elearning:exam:grade", "cham"],
    ["giao-bai", "elearning:assignment:create", "giao"],
    ["ma-tran", "elearning:progress:view-all", "baoCao"],
    ["bao-cao-r4", "elearning:progress:view-all", "baoCao"],
    ["bao-cao-r5", "elearning:progress:view-all", "baoCao"],
    ["bao-cao-r7", "elearning:progress:view-all", "baoCao"],
    ["chung-nhan", "elearning:progress:view-all", "baoCao"],
    ["muc-danh-gia", "elearning:program:manage", "quanLyChuongTrinh"],
  ];

  it("dao-tao: trang tự hỏi cả ba khoá vận hành mà menu mở bằng (soạn ∨ chấm ∨ giao); `view-all` một mình không thấy mục", () => {
    const file = "app/(elearning)/elearning/dao-tao/page.tsx";
    const src = chiMa(doc(file));
    for (const k of ["elearning:content:author", "elearning:exam:grade", "elearning:assignment:create"]) {
      expect(src, k).toContain(`can(actor, "${k}")`);
    }
    // Khối "tiến độ" của trang chỉ có khi `view-all` — số lượt quá hạn toàn hệ không lộ cho người chỉ có quyền soạn.
    expect(src).toContain('can(actor, "elearning:progress:view-all")');
    expect(tap({ soan: true }).has("/elearning/dao-tao")).toBe(true);
    expect(tap({ cham: true }).has("/elearning/dao-tao")).toBe(true);
    expect(tap({ giao: true }).has("/elearning/dao-tao")).toBe(true);
    expect(tap({ baoCao: true, quanLyYeuCau: true, quanLyChuongTrinh: true }).has("/elearning/dao-tao")).toBe(false);
  });

  it.each(CAP)("%s: trang hỏi %s ⇔ menu mở bằng %s", (seg, khoa, truong) => {
    const file = `app/(elearning)/elearning/${seg}/page.tsx`;
    expect(existsSync(join(process.cwd(), file)), file).toBe(true);
    expect(chiMa(doc(file)), `${seg} không còn hỏi ${khoa}`).toContain(`"${khoa}"`);
    // và chỉ người có đúng quyền ấy mới thấy mục trong menu (đối chứng dương + âm):
    const href = `/elearning/${seg}`;
    const them = truong === "quanLyChuongTrinh" ? { evalLinkBat: true } : {};
    expect(tap({ [truong]: true, ...them } as Partial<QuyenMenu>).has(href), `${href} phải hiện`).toBe(true);
    expect(tap({ ...them }).has(href), `${href} không được hiện cho người thiếu quyền`).toBe(false);
  });

  it("layout vẫn tự hỏi đủ bảy khoá bằng `can()` (không dời quyết định quyền sang menu)", () => {
    const layout = chiMa(doc("app/(elearning)/elearning/layout.tsx"));
    for (const k of [
      "elearning:content:author",
      "elearning:exam:grade",
      "elearning:assignment:create",
      "elearning:progress:view-all",
      "elearning:progress:view-team",
      "elearning:requirement:manage",
      "elearning:program:manage",
    ]) {
      expect(layout, k).toContain(`can(actor, "${k}")`);
    }
    expect(layout).toContain("isElearningEvalLinkEnabled()");
    expect(layout).toContain("menuElearning(");
  });

  it("F-01: layout tính `baoCaoDoi` chỉ khi KHÔNG có `view-all`", () => {
    expect(chiMa(doc("app/(elearning)/elearning/layout.tsx"))).toMatch(
      /const baoCaoDoi = !baoCao && can\(actor, "elearning:progress:view-team"\)/,
    );
  });
});
