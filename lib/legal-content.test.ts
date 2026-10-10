/**
 * Bất biến của NỘI DUNG 10 trang chính sách nộp Bộ Công Thương (`content/legal/*.md`).
 *
 * ⚠️ File test này PHẢI nằm ở `lib/` chứ không cạnh dữ liệu nó kiểm: `include` của vitest là
 * bộ lọc CỨNG và `content/**` không nằm trong đó — để ở `content/legal/` thì vitest báo
 * "No test files found", tức test xanh giả vì không chạy.
 *
 * Bốn lớp lỗi dưới đây có chung một tính chất: **không cái nào ném lỗi, không cái nào làm
 * build đỏ, console vẫn sạch.** Chỉ người mở trang bằng mắt mới thấy — và với trang pháp lý
 * thì người mở bằng mắt là cán bộ tiếp nhận hồ sơ.
 *
 *  1. `components/public/legal-page.tsx` đọc `content/legal/<slug>.md` bằng `fs.readFile`
 *     **KHÔNG có try/catch** ⇒ một slug gõ sai là trang đó **ném 500**, không phải 404.
 *  2. Bản `.txt` bóc từ `.docx` **mất dòng phân cách `|---|---|`** của bảng. Thiếu nó,
 *     `remark-gfm` không nhận ra bảng và render ra một đoạn văn đầy dấu `|` — **im lặng**.
 *  3. Hướng dẫn BCT **cấm** nhãn "Trụ sở chính" sau địa chỉ. Nhãn này từng có ở
 *     `chinh-sach-hoan-tra.md` và ở 14 chỗ khác.
 *  4. Ba hộp thư từng được công bố trên trang pháp lý (`dpo@`, `cskh@`, `phuc@`) **không tồn
 *     tại** — grep cả repo chỉ ra 3 dòng `.md` đó. Công bố một hộp thư chết trong hồ sơ là
 *     tự tạo một lời hứa không thực hiện được.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { LEGAL_PAGES, LEGAL_PAGES_PHU } from "./legal-pages";

// ⚠️ `import.meta.url` trong cấu hình vitest của repo này KHÔNG phải URL `file://` nên
// `fileURLToPath` ném — dùng `process.cwd()` (luật đọc số, mẫu LƯỚI GHIM MÃ NGUỒN).
const legalDir = resolve(process.cwd(), "content", "legal");
const mdPath = (slug: string) => resolve(legalDir, `${slug}.md`);

/** Chỉ 10 chính sách bắt buộc có file .md; `/quyen-rieng-tu` là trang tương tác, không dùng .md. */
const SLUGS_CO_MD = [
  ...LEGAL_PAGES.map((p) => p.slug),
  ...LEGAL_PAGES_PHU.filter((p) => p.slug !== "quyen-rieng-tu").map((p) => p.slug),
];

describe("nội dung 10 trang chính sách (hồ sơ BCT)", () => {
  it("[MD-01] mỗi slug trong LEGAL_PAGES có file .md tương ứng", () => {
    // Thiếu file = trang ném 500 lúc render, KHÔNG phải 404.
    for (const slug of SLUGS_CO_MD) {
      expect(existsSync(mdPath(slug)), `thiếu content/legal/${slug}.md`).toBe(true);
    }
  });

  it("[MD-02] mọi bảng đều có dòng phân cách — thiếu là mất bảng, im lặng", () => {
    for (const slug of SLUGS_CO_MD) {
      const dong = readFileSync(mdPath(slug), "utf-8").split("\n");
      for (let i = 0; i < dong.length; i++) {
        const d = dong[i]?.trim() ?? "";
        // Một dòng bảng: bắt đầu và kết thúc bằng '|'. Dòng ngay sau HÀNG ĐẦU của bảng
        // phải là dòng phân cách dạng |---|---|.
        const laHangBang = d.startsWith("|") && d.endsWith("|") && d.length > 2;
        const truocDoLaBang = (dong[i - 1]?.trim() ?? "").startsWith("|");
        if (laHangBang && !truocDoLaBang) {
          const sau = dong[i + 1]?.trim() ?? "";
          expect(
            /^\|[\s:|-]+\|$/.test(sau),
            `${slug}.md dòng ${i + 2}: hàng đầu bảng không có dòng phân cách |---|---| ngay sau`,
          ).toBe(true);
        }
      }
    }
  });

  it('[MD-03] KHÔNG trang nào còn nhãn "Trụ sở chính" — hướng dẫn BCT cấm', () => {
    for (const slug of SLUGS_CO_MD) {
      const noiDung = readFileSync(mdPath(slug), "utf-8");
      expect(/trụ sở chính/i.test(noiDung), `${slug}.md còn nhãn "Trụ sở chính"`).toBe(false);
    }
  });

  // 09/10/2026 — đổi từ danh sách CẤM (ghi tên từng hộp thư chết, có cả email cá nhân) sang
  // danh sách CHO PHÉP: chặt hơn (một hộp thư lạ mới thêm cũng đỏ) và không phải ghi email
  // người thật vào mã — mã nguồn được xuất sang repo gương public cho CI.
  const HOP_THU_DUOC_CONG_BO = new Set(["thongtin@satarobo.vn", "info@satarobo.vn"]);
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g;

  it("[MD-04] chỉ công bố hộp thư có thật (danh sách cho phép)", () => {
    for (const slug of SLUGS_CO_MD) {
      const noiDung = readFileSync(mdPath(slug), "utf-8");
      for (const hop of noiDung.match(EMAIL) ?? []) {
        expect(HOP_THU_DUOC_CONG_BO.has(hop.toLowerCase()), `${slug}.md công bố hộp thư lạ ${hop}`).toBe(true);
      }
    }
  });

  it("[MD-04b] đối chứng dương: bộ dò THẤY hộp thư trên trang pháp lý", () => {
    const tong = SLUGS_CO_MD.reduce(
      (n, slug) => n + (readFileSync(mdPath(slug), "utf-8").match(EMAIL)?.length ?? 0),
      0,
    );
    expect(tong).toBeGreaterThan(0);
  });

  it("[MD-05] mỗi trang in mã số doanh nghiệp ĐẦY ĐỦ kèm cơ quan cấp + ngày cấp", () => {
    // Hướng dẫn BCT mục 2 đòi nguyên văn cụm này; in mỗi con số trần là thiếu.
    const cum = "0402301783 do Sở Tài chính Thành phố Đà Nẵng cấp ngày 02/10/2025";
    for (const slug of SLUGS_CO_MD) {
      const noiDung = readFileSync(mdPath(slug), "utf-8");
      expect(noiDung.includes(cum), `${slug}.md thiếu cụm mã số doanh nghiệp đầy đủ`).toBe(true);
    }
  });

  it("[MD-06] mỗi trang in địa chỉ ĐẦY ĐỦ theo hồ sơ", () => {
    const diaChi = "211 Nguyễn Hữu Thọ, Phường Hòa Cường, Thành phố Đà Nẵng, Việt Nam";
    for (const slug of SLUGS_CO_MD) {
      const noiDung = readFileSync(mdPath(slug), "utf-8");
      expect(noiDung.includes(diaChi), `${slug}.md thiếu địa chỉ đầy đủ`).toBe(true);
    }
  });

  it("[MD-07] bảng mức hoàn trả của chính sách #9 còn nguyên 4 mốc", () => {
    // Bảng này là thứ phụ huynh đọc để biết được hoàn bao nhiêu; mất một dòng là mất một mức.
    const noiDung = readFileSync(mdPath("chinh-sach-cham-dut-dich-vu"), "utf-8");
    for (const moc of ["100% học phí", "70% học phí còn lại", "50% học phí còn lại", "Không hoàn trả"]) {
      expect(noiDung.includes(moc), `thiếu mốc "${moc}"`).toBe(true);
    }
  });
});

/**
 * Nhãn "Trụ sở chính" trên BỀ MẶT CÔNG KHAI — hướng dẫn BCT mục 2 cấm:
 * *"Địa chỉ kinh doanh nếu khác địa chỉ trụ sở chính trong Đăng ký kinh doanh thì không
 * chú thích 'Trụ sở chính' sau Địa chỉ"*.
 *
 * Nhãn này còn SAI SỰ THẬT: trụ sở đăng ký của pháp nhân MST 0402301783 là **258 Lê Thanh
 * Nghị** (`lib/finance/hoa-don/phap-nhan.ts`, đo từ hoá đơn thật), không phải 211 Nguyễn
 * Hữu Thọ. Nó từng có ở 8 chỗ công khai, trong đó một chỗ chỉ MÁY đọc được
 * (`lib/seo/jsonld.ts` nối chuỗi vào `address[].name` của JSON-LD trang chủ) — soi bằng
 * mắt trên màn hình không bao giờ thấy.
 *
 * ⚠️ Vì sao phải BÓC CHÚ THÍCH trước khi soi: chính các bản vá gỡ nhãn đều để lại chú
 * thích giải thích, và chú thích đó CHỨA ĐÚNG CHUỖI ĐANG CẤM. Một bộ so khớp ngây thơ sẽ
 * đỏ vì lời giải thích chứ không vì lỗi — rồi người sau sẽ nới nó ra cho hết đỏ, và lúc đó
 * lưới không còn bắt được gì. Đây đúng là ca mà luật 12 mô tả.
 */
describe('nhãn "Trụ sở chính" trên bề mặt công khai', () => {
  // Chỉ những file NGƯỜI MUA nhìn thấy. Không rà admin/portal/teacher.
  const FILE_CONG_KHAI = [
    "app/(public)/lien-he/page.tsx",
    "app/(public)/ve-chung-toi/page.tsx",
    "components/home/faq-section.tsx",
    "components/legacy-laptrinhrobot/Hero.tsx",
    "components/legacy-laptrinhrobot/Locations.tsx",
    "components/legacy-laptrinhrobot/Footer.tsx",
    "components/legacy-laptrinhrobot/_data/faqs.ts",
    "components/legacy-laptrinhrobot/_data/locations.ts",
    "components/legacy-luyenthirobosim/Footer.tsx",
    "components/sections/site-footer.tsx",
    "lib/locations.ts",
    "lib/seo/jsonld.ts",
  ];

  /** Bỏ chú thích khối và chú thích dòng — giữ lại phần mã + chuỗi hiển thị. */
  const bocChuThich = (ma: string) =>
    ma.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("[HQ-01] không file công khai nào còn nhãn, sau khi bóc chú thích", () => {
    for (const f of FILE_CONG_KHAI) {
      const ma = bocChuThich(readFileSync(resolve(process.cwd(), f), "utf-8"));
      expect(/trụ sở chính/i.test(ma), `${f} còn nhãn "Trụ sở chính" trong mã`).toBe(false);
    }
  });

  it('[HQ-02] cũng không còn nhãn rút gọn "Trụ sở" đứng một mình làm nhãn ô', () => {
    // `label: "Trụ sở"` ở /lien-he từng là nhãn ô địa chỉ — vẫn là cùng một lời khai.
    for (const f of FILE_CONG_KHAI) {
      const ma = bocChuThich(readFileSync(resolve(process.cwd(), f), "utf-8"));
      expect(/["'`]\s*Trụ sở\s*["'`]/.test(ma), `${f} còn nhãn "Trụ sở"`).toBe(false);
    }
  });

  it("[HQ-03] cờ isHQ VẪN CÒN — gỡ nhãn không được gỡ cờ", () => {
    // Đối chứng dương. Thiếu ca này thì một bản vá "xoá sạch isHQ" cũng xanh, trong khi nó
    // làm vỡ 4 chỗ đang dùng cờ để chọn cơ sở mặc định / sắp xếp.
    const src = readFileSync(resolve(process.cwd(), "lib/locations.ts"), "utf-8");
    expect(src).toMatch(/isHQ:\s*true/);
  });
});

/**
 * Ô TÍCH ĐỒNG Ý CHÍNH SÁCH BẢO MẬT — hồ sơ BCT mục 3.
 *
 * Hướng dẫn nêu đích danh câu chữ phải hiện, và ảnh minh hoạ chốt thêm ba chi tiết chữ
 * không nói: ô vuông RỖNG (chưa tích sẵn) · chỉ cụm "Chính sách bảo mật" được gạch chân
 * làm link · mũi tên "Gắn link nội dung chính sách" trỏ vào đúng cụm ấy.
 *
 * Ca nhãn dưới đây so với chuỗi CHÉP TAY từ tài liệu, không suy từ chính hằng đang kiểm —
 * suy từ nguồn đang kiểm là tautology, sửa nguồn thì test tự đúng theo.
 */
describe("ô tích đồng ý Chính sách bảo mật", () => {
  const FORM_CONG_KHAI = [
    "app/(auth)/kich-hoat/activate-form.tsx",
    "app/(public)/lien-he/_components/contact-form.tsx",
    "components/legacy-laptrinhrobot/RegistrationForm.tsx",
    "components/khoa-hoc/consult-modal.tsx",
  ];

  it("[OT-01] cả 4 biểu mẫu công khai đều dựng ô tích", () => {
    for (const f of FORM_CONG_KHAI) {
      const src = readFileSync(resolve(process.cwd(), f), "utf-8");
      expect(src.includes("<OTichChinhSach"), `${f} chưa có ô tích`).toBe(true);
    }
  });

  it("[OT-02] nhãn khớp NGUYÊN VĂN hướng dẫn, và link chỉ bọc cụm giữa", async () => {
    const m = await import("@/components/public/o-tich-chinh-sach");
    // Chép tay từ "0. HƯỚNG DẪN CHỈNH SỬA GIAO DIỆN WEB.docx" mục 3.
    expect(m.NHAN_O_TICH_TRUOC + m.NHAN_O_TICH_LINK + m.NHAN_O_TICH_SAU).toBe(
      "Tôi đã đọc và đồng ý với Chính sách bảo mật của website",
    );
    // Chỉ ba chữ này là link — đúng phần được gạch chân trong ảnh.
    expect(m.NHAN_O_TICH_LINK).toBe("Chính sách bảo mật");
  });

  it("[OT-03] state ĐỒNG Ý không được khởi tạo true", () => {
    // Ảnh minh hoạ vẽ ô vuông RỖNG. Một ô tích sẵn không phải là sự đồng ý — và repo
    // từng có đúng lỗi đó: ô tích duy nhất của site khởi tạo `useState(true)` và còn
    // được đặt lại `true` mỗi lần mở modal.
    //
    // ⚠️ Soi ĐÚNG state đồng ý, không soi mọi `useState(true)`: `RegistrationForm.tsx`
    // có `shouldRedirectToZalo = useState(true)` chẳng liên quan gì, và một bộ so khớp
    // bắt cả nó sẽ đỏ vì lý do sai — rồi người sau nới nó ra cho hết đỏ.
    // ⚠️ KHÔNG dùng `new RegExp` với template literal ở đây: trong template literal
    // `\s` rụng mất dấu gạch chéo thành `s`, nên mẫu biến thành chuỗi vô nghĩa và test
    // xanh vĩnh viễn mà không bắt được gì. Đã dính đúng lỗi đó một lần — chỉ bước cấy
    // lại lỗi mới lộ ra. Nay so khớp CHUỖI trên mã đã bỏ hết khoảng trắng.
    const TEN_STATE_DONG_Y = ["dongYCsbm", "consent"];
    for (const f of FORM_CONG_KHAI) {
      const gon = readFileSync(resolve(process.cwd(), f), "utf-8").replace(/\s+/g, "");
      for (const ten of TEN_STATE_DONG_Y) {
        const setter = `set${ten[0]!.toUpperCase()}${ten.slice(1)}`;
        expect(
          gon.includes(`[${ten},${setter}]=useState(true)`),
          `${f}: state "${ten}" tích sẵn`,
        ).toBe(false);
        expect(gon.includes(`${setter}(true)`), `${f}: state "${ten}" bị đặt lại true`).toBe(
          false,
        );
      }
    }
  });

  it("[OT-04] ô tích trỏ đúng trang chính sách bảo mật", async () => {
    const src = readFileSync(
      resolve(process.cwd(), "components/public/o-tich-chinh-sach.tsx"),
      "utf-8",
    );
    expect(src).toContain('legalHref("chinh-sach-bao-mat")');
  });
});
