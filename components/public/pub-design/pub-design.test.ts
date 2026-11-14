/** [PUB2-*] Nền giao diện public v2: chủ đề, chế độ nhẹ 3D, và lưới "CSS không rò ra ngoài `.page`". */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PUB_THEME_KEY, PUB_THEME_SCRIPT, chuDeHieuLuc, docChuDe } from "@/components/public/pub-theme";
import { duocTai3D, laCheDoNhe } from "./pub-3d-thuan";

describe("[PUB2-01] chủ đề: đã lưu thắng, chưa lưu thì theo hệ điều hành", () => {
  it("giá trị lạ/trống không được coi là đã lưu", () => {
    expect(docChuDe("dark")).toBe("dark");
    expect(docChuDe("light")).toBe("light");
    expect(docChuDe("auto")).toBeNull();
    expect(docChuDe(null)).toBeNull();
  });
  it("đã lưu thì theo đã lưu; chưa lưu hoặc giá trị lạ ⇒ SÁNG (mặc định sáng, không theo hệ điều hành — 04/11/2026)", () => {
    expect(chuDeHieuLuc("light")).toBe("light");
    expect(chuDeHieuLuc("dark")).toBe("dark");
    expect(chuDeHieuLuc(null)).toBe("light");
    expect(chuDeHieuLuc(undefined)).toBe("light");
    expect(chuDeHieuLuc("auto")).toBe("light");
  });
});

describe("[PUB2-02] script chống nháy chủ đề", () => {
  it("React escape chữ của <script> nên script không được chứa < > & ' \"", () => {
    expect(PUB_THEME_SCRIPT).not.toMatch(/[<>&'"]/);
  });
  it("đọc đúng khoá của artifact và đặt class lên phần tử gốc", () => {
    expect(PUB_THEME_KEY).toBe("sata-theme");
    expect(PUB_THEME_SCRIPT).toContain("localStorage.getItem(`sata-theme`)");
    expect(PUB_THEME_SCRIPT).not.toContain("prefers-color-scheme"); // mặc định sáng: không hỏi hệ điều hành
    expect(PUB_THEME_SCRIPT).not.toContain("matchMedia");
    expect(PUB_THEME_SCRIPT).toContain("document.currentScript.parentElement");
  });
  it("chạy thật trên DOM giả: chưa lưu ⇒ theme-light DÙ hệ điều hành tối; đã lưu dark ⇒ theme-dark (đối chứng); đã lưu light ⇒ theme-light", () => {
    const chay = (luu: string | null, toi: boolean) => {
      const cl = new Set(["theme-light"]);
      const root = { classList: { remove: (...a: string[]) => a.forEach((x) => cl.delete(x)), add: (...a: string[]) => a.forEach((x) => cl.add(x)) } };
      new Function("localStorage", "matchMedia", "document", PUB_THEME_SCRIPT)(
        { getItem: () => luu },
        () => ({ matches: toi }),
        { currentScript: { parentElement: root } },
      );
      return [...cl];
    };
    expect(chay(null, true)).toEqual(["theme-light"]); // hệ điều hành tối nhưng chưa chọn ⇒ SÁNG
    expect(chay("light", true)).toEqual(["theme-light"]);
    expect(chay("dark", false)).toEqual(["theme-dark"]); // đã chọn tối thì giữ tối
    expect(chay(null, false)).toEqual(["theme-light"]);
    expect(chay("auto", true)).toEqual(["theme-light"]); // giá trị lạ ⇒ sáng
  });
});

describe("[PUB2-03] 3D: chế độ nhẹ giống fx.js, nhẹ/giảm chuyển động/không WebGL ⇒ chỉ poster", () => {
  it("công thức MỚI (chủ dự án chốt 03/11/2026): Save-Data ∨ slow-2g/2g ∨ (≤2 nhân ∧ (không biết RAM ∨ RAM ≤2GB))", () => {
    expect(laCheDoNhe({ saveData: true })).toBe(true);
    expect(laCheDoNhe({ effectiveType: "slow-2g" })).toBe(true);
    expect(laCheDoNhe({ effectiveType: "2g" })).toBe(true);
    // ĐỐI CHỨNG: bản cũ coi 3g là nhẹ ⇒ máy bàn mạng tốt mất 3D. Nay KHÔNG.
    expect(laCheDoNhe({ effectiveType: "3g" })).toBe(false);
    expect(laCheDoNhe({ effectiveType: "4g" })).toBe(false);
    // Chỉ RAM thấp HOẶC chỉ ít nhân thì KHÔNG đủ (bản cũ dùng HOẶC).
    expect(laCheDoNhe({ deviceMemory: 2 })).toBe(false);
    expect(laCheDoNhe({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe(false);
    expect(laCheDoNhe({ hardwareConcurrency: 2, deviceMemory: 8 })).toBe(false);
    // Cả hai: ≤2 nhân VÀ (RAM ≤2GB hoặc không báo RAM) ⇒ nhẹ.
    expect(laCheDoNhe({ hardwareConcurrency: 2, deviceMemory: 2 })).toBe(true);
    expect(laCheDoNhe({ hardwareConcurrency: 2 })).toBe(true);
    expect(laCheDoNhe({ hardwareConcurrency: 1, deviceMemory: 1 })).toBe(true);
    expect(laCheDoNhe({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe(false);
    expect(laCheDoNhe({})).toBe(false);
  });
  it("fx.js (nguồn thật nạp ở trang) dùng ĐÚNG công thức mới — không còn 3g, không còn HOẶC theo RAM/nhân", () => {
    const ma = readFileSync(resolve(process.cwd(), "public/pub/fx.js"), "utf-8");
    const dong = ma.split("\n").find((d) => d.includes("var LITE ="));
    expect(dong, "không thấy dòng `var LITE =` trong fx.js").toBeTruthy();
    expect(dong).toContain("/^(slow-2g|2g)$/.test(CON.effectiveType");
    expect(dong).not.toMatch(/3g/);
    expect(dong).toContain("NAV.hardwareConcurrency && NAV.hardwareConcurrency <= 2 && (!NAV.deviceMemory || NAV.deviceMemory <= 2)");
    expect(dong).not.toMatch(/\(NAV\.deviceMemory && NAV\.deviceMemory <= 2\) \|\|/);
  });
  it("`window.__sataLite` do fx.js đặt thắng mọi thứ", () => {
    expect(laCheDoNhe({ saveData: true }, false)).toBe(false);
    expect(laCheDoNhe({ deviceMemory: 16 }, true)).toBe(true);
  });
  it("chỉ tải khi KHÔNG nhẹ, KHÔNG giảm chuyển động, CÓ WebGL (mỗi điều kiện đều cắt được)", () => {
    const ok = { nhe: false, giamChuyenDong: false, coWebgl: true };
    expect(duocTai3D(ok)).toBe(true);
    expect(duocTai3D({ ...ok, nhe: true })).toBe(false);
    expect(duocTai3D({ ...ok, giamChuyenDong: true })).toBe(false);
    expect(duocTai3D({ ...ok, coWebgl: false })).toBe(false);
  });
});

describe("[PUB2-04] CSS thiết kế: mọi selector nằm dưới `.page` hoặc `:where(.page)` (độ ưu tiên 0) (không rò sang portal/admin)", () => {
  const dir = resolve(process.cwd(), "app/(public)/pub-design");
  /** Trả về mọi selector cấp rule, kể cả bên trong @media/@supports; bỏ qua thân @keyframes. */
  function selectors(css: string): string[] {
    const out: string[] = [];
    const bo = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const stack: Array<{ kf: boolean }> = [];
    let buf = "";
    for (const ch of bo) {
      if (ch === "{") {
        const head = buf.trim();
        const trongKf = stack.some((s) => s.kf);
        const laAt = head.startsWith("@");
        if (!laAt && !trongKf) out.push(...head.split(",").map((s) => s.trim()));
        stack.push({ kf: trongKf || /^@(-\w+-)?keyframes/.test(head) });
        buf = "";
      } else if (ch === "}") {
        stack.pop();
        buf = "";
      } else if (ch === ";") {
        buf = "";
      } else buf += ch;
    }
    return out;
  }
  const tep = readdirSync(dir).filter((f) => f.endsWith(".css"));

  it("có đủ tệp chung + tệp riêng từng nhóm trang", () => {
    for (const can of ["chung.css", "trang-chu.css", "khoa-hoc.css", "xac-thuc.css", "disc.css", "disc-ket-qua.css"]) {
      expect(tep, `thiếu ${can}`).toContain(can);
    }
  });
  it.each(["chung.css", "trang-chu.css", "khoa-hoc.css", "xac-thuc.css", "disc.css", "disc-ket-qua.css"])("%s: không có selector nào ngoài `.page`/`:where(.page)`/`html`", (f) => {
    const ds = selectors(readFileSync(resolve(dir, f), "utf8"));
    expect(ds.length, `${f}: không đọc được selector nào — đổi cách bóc`).toBeGreaterThan(0);
    const ngoai = ds.filter((s) => !/^(\.page|:where\(\.page\)|:where\(html\)|html[.:\s])/.test(s));
    expect(ngoai, `${f}: selector rò ra ngoài .page`).toEqual([]);
  });
  it("không còn tên @keyframes trần (đã đổi thành srp-*) — tránh đụng keyframes của Tailwind", () => {
    const css = readFileSync(resolve(dir, "chung.css"), "utf8");
    const khongChuThich = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const ten = [...khongChuThich.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]!);
    expect(ten.length).toBeGreaterThan(20);
    expect(ten.filter((t) => !t.startsWith("srp-"))).toEqual([]);
  });
  it("đối chứng của bộ bóc: một selector rò ra ngoài PHẢI bị bắt", () => {
    expect(selectors(".card{color:red}.page .x{a:b}@keyframes k{from{a:b}}")).toEqual([".card", ".page .x"]);
  });
});

describe("[PUB2-05] độ ưu tiên: selector chỉ-thẻ của artifact giữ nguyên (0,0,1), không bị tiền tố `.page` đẩy lên (0,1,1)", () => {
  const css = readFileSync(resolve(process.cwd(), "app/(public)/pub-design/chung.css"), "utf8");
  it("selector chỉ-thẻ/lớp được bọc :where(.page)", () => {
    expect(css).toMatch(/:where\(\.page\) \.card\{/);
    expect(css).toMatch(/:where\(\.page\)\.theme-dark \.card\{/);
  });
  it("luật VỐN mang `.page` (vd `.page a`) giữ nguyên `.page` (đối chứng: không bị hạ về 0)", () => {
    expect(css).toMatch(/(^|[},\n])\.page a\{/);
  });
  it("không còn selector `.page <thẻ>` do TIỀN TỐ sinh ra: `.page .card` (lớp) phải là dạng :where", () => {
    expect(css).not.toMatch(/(^|[},\n])\.page \.card\{/);
  });
});

describe("[PUB2-06] vầng sáng theo chuột trên màn rộng: --pz phải khớp đúng hệ số zoom của .page", () => {
  const chung = readFileSync(resolve(process.cwd(), "app/(public)/pub-design/chung.css"), "utf8");
  const bs = readFileSync(resolve(process.cwd(), "components/public/pub-design/phan-bo-sung.css"), "utf8");
  const bac = (css: string, thuocTinh: string) =>
    [...css.matchAll(new RegExp(String.raw`@media \(min-width:(\d+)px\)\{\.page\{${thuocTinh}:([\d.]+)\}\}`, "g"))].map((m) => `${m[1]}:${m[2]}`);

  it("mỗi bậc `.page{zoom:z}` ở chung.css có đúng một `.page{--pz:z}` cùng ngưỡng ở phan-bo-sung.css", () => {
    const zoom = bac(chung, "zoom");
    expect(zoom.length, "đổi cách viết zoom ở chung.css — cập nhật bộ bóc").toBeGreaterThanOrEqual(6);
    expect(bac(bs, "--pz")).toEqual(zoom);
  });
  it("mọi chỗ dùng toạ độ chuột của fx.js (--gx/--gy, --mx/--my) đều chia cho --pz", () => {
    const css = bs.replace(/\/\*[\s\S]*?\*\//g, "");
    const dung = [...css.matchAll(/var\(--(gx|gy|mx|my)\b[^)]*\)/g)].map((m) => css.slice(m.index!, m.index! + m[0].length + 14));
    expect(dung.length).toBeGreaterThanOrEqual(6);
    for (const d of dung) expect(d, d).toMatch(/^var\(--(gx|gy|mx|my)[^)]*\) \/ var\(--pz,1\)/);
  });
  it("đối chứng của bộ bóc: bậc zoom khác nhau PHẢI bị bắt", () => {
    expect(bac("@media (min-width:1920px){.page{zoom:1.18}}", "zoom")).not.toEqual(bac("@media (min-width:1920px){.page{--pz:1.2}}", "--pz"));
  });
});

describe("[PUB2-07..09] ba lỗi nghiệm thu giao diện public (04/11/2026)", () => {
  const bs = readFileSync(resolve(process.cwd(), "components/public/pub-design/phan-bo-sung.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const chung = readFileSync(resolve(process.cwd(), "app/(public)/pub-design/chung.css"), "utf8");
  const doc = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");

  it("[PUB2-07] thẻ có cả .iri và .a-flip: lật vào đúng MỘT lần, viền cầu vồng chạy mãi (không còn flipIn lặp vô hạn)", () => {
    // gốc lỗi vẫn còn ở chung.css (chép nguyên văn): .iri đặt vòng lặp vô hạn, .a-flip chỉ đổi tên ⇒ phần sửa BẮT BUỘC có ở phan-bo-sung
    expect(chung).toMatch(/\.iri\{[^}]*animation:srp-iri 8s ease infinite/);
    expect(chung).toMatch(/\.a-flip\{animation-name:srp-flipIn/);
    const luat = bs.match(/\.page \.iri\.sv\.a-flip\{([^}]*)\}/)?.[1] ?? "";
    expect(luat).toContain("animation-name:srp-flipIn,srp-iri");
    expect(luat).toContain("animation-iteration-count:1,infinite");
    // hai độ trễ d2/d3 cũng phải có hai giá trị (flipIn trễ, viền không trễ)
    expect(bs).toMatch(/\.iri\.sv\.a-flip\.d2\{animation-delay:\.08s,0s\}/);
    expect(bs).toMatch(/\.iri\.sv\.a-flip\.d3\{animation-delay:\.16s,0s\}/);
    // và trang chủ vẫn dùng đúng tổ hợp lớp này (nếu đổi tên lớp thì luật trên thành vô nghĩa)
    expect(doc("components/public/home/khoa-hoc.tsx")).toMatch(/className="lift sv d2 a-flip iri"/);
  });

  it("[PUB2-08] lưới Ưu đãi: lớp .uu-dai-grid 1→2→3 cột; không còn auto-fit/minmax(190px) ở trang Khoá học", () => {
    const trang = doc("components/public/khoa-hoc/trang-danh-sach.tsx");
    expect(trang).toContain('className="uu-dai-grid"');
    expect(trang).not.toMatch(/auto-fit,\s*minmax\(190px/);
    expect(bs).toMatch(/\.uu-dai-grid\{display:grid;[^}]*grid-template-columns:1fr\}/);
    expect(bs).toMatch(/@media \(min-width:560px\)\{\.page \.uu-dai-grid\{grid-template-columns:repeat\(2,/);
    expect(bs).toMatch(/@media \(min-width:900px\)\{\.page \.uu-dai-grid\{grid-template-columns:repeat\(3,/);
  });

  it("[PUB2-09] Đăng nhập: lớp thẻ ảnh quay (.spinner) CAO HƠN lớp linh vật 3D (.center)", () => {
    const disc = doc("app/(public)/pub-design/disc-ket-qua.css");
    const zCenter = Number(disc.match(/\.orbit \.center\{[^}]*z-index:(\d+)/)?.[1]);
    const zSpinner = Number(bs.match(/\.orbit \.spinner\{[^}]*z-index:(\d+)/)?.[1]);
    expect(zCenter, "đổi cách viết .center ở disc-ket-qua.css — cập nhật bộ bóc").toBeGreaterThan(0);
    expect(zSpinner).toBeGreaterThan(zCenter);
    expect(bs).toMatch(/\.orbit \.spinner\{[^}]*pointer-events:none/);
  });
});

describe("[PUB2-10] hiệu ứng tiêu đề mới thay «xáo ký tự»: CSS thuần theo cuộn, không JS, tôn trọng giảm chuyển động", () => {
  const bs = readFileSync(resolve(process.cwd(), "components/public/pub-design/phan-bo-sung.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("có keyframes pub-tieu-de và luật gắn vào h1/h2 qua animation-timeline: view(), chỉ khi trình duyệt hỗ trợ và không chọn giảm chuyển động", () => {
    expect(bs).toMatch(/@keyframes pub-tieu-de\{from\{opacity:0;/);
    const khoi = bs.match(/@supports \(animation-timeline: view\(\)\)\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(khoi).toContain("@media (prefers-reduced-motion:no-preference)");
    expect(khoi).toMatch(/html:not\(\.fx-lite\) \.page main :is\(h1,h2\)\{animation:pub-tieu-de linear both;animation-timeline:view\(\)/);
  });
  it("hiệu ứng ngắn: dựa vào cuộn (animation-range chỉ phần đầu của lúc vào), KHÔNG có độ trễ hay thời lượng cố định kéo dài", () => {
    const luat = bs.match(/:is\(h1,h2\)\{animation:pub-tieu-de[^}]*\}/)?.[0] ?? "";
    expect(luat).toContain("animation-range:entry 0% entry 45%");
    expect(luat).not.toMatch(/\d+(\.\d+)?s\b/); // không có "0.9s" / "1s" … — chuyển động theo tay cuộn, không theo đồng hồ
  });
});

describe("[PUB2-11] chiều cao theo cửa sổ (vh) trong .page có zoom phải chia cho --pz", () => {
  const doc = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const bs = doc("components/public/pub-design/phan-bo-sung.css");
  const GOC = ["app/(public)/pub-design/chung.css", "app/(public)/pub-design/xac-thuc.css", "app/(public)/pub-design/disc-ket-qua.css"];
  // bộ chọn của mọi luật có min/max-height tính theo vh (kể cả luật nằm trong @media)
  const chonVh = (css: string) =>
    css
      .split("}")
      .filter((r) => /(?:min|max)-height:[^;]*\dvh/.test(r))
      .map((r) => {
        const p = r.split("{");
        return p[p.length - 2]!.trim().replace(/^:where\(\.page\)\s*/, "");
      });

  it("mọi luật dùng vh ở CSS nguồn (chép nguyên văn từ artifact) đều có bản ghi đè chia --pz ở phan-bo-sung.css", () => {
    const dung = [...new Set(GOC.flatMap((f) => chonVh(doc(f))))].sort();
    expect(dung).toEqual([".auth", ".mnav", ".modal-card"]); // tập đổi = có chỗ dùng vh MỚI: phải thêm bản ghi đè rồi cập nhật ở đây
    for (const lop of [...dung, ".pub-ck-custom"]) {
      const i = bs.indexOf(".page " + lop + "{");
      expect(i, lop).toBeGreaterThan(-1);
      expect(bs.slice(i, bs.indexOf("}", i)), lop).toMatch(/(?:min|max)-height:calc\(100vh \/ var\(--pz,1\)/);
    }
  });
  it("thẻ bọc PubRoot không đặt minHeight bằng vh trần (nhân zoom ⇒ tràn trang)", () => {
    const root = readFileSync(resolve(process.cwd(), "components/public/pub-root.tsx"), "utf8");
    expect(root).toContain('minHeight: "calc(100vh / var(--pz, 1))"');
    expect(root).not.toMatch(/minHeight:\s*"100(d|s)?vh"/);
  });
  it("đối chứng của bộ bóc: luật vh trần PHẢI bị nhận ra; bản ghi đè của ta không còn vh trần", () => {
    expect(chonVh(".page .x{min-height:100vh}")).toEqual([".page .x"]);
    expect(bs.match(/(?:min|max)-height:[^;}]*100vh(?! \/ var\(--pz)/g)).toBeNull();
  });
});
