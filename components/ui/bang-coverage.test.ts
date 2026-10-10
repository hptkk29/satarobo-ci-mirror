/**
 * MỌI BẢNG DỮ LIỆU ĐỀU PHẢI CÓ PHÂN TRANG — không màn nào đổ hết ra một trang.
 *
 * Vì sao cần test: sweep 11/08 bọc 111 bảng, nhưng rà lại 12/08 vẫn còn 19 bảng lọt —
 * nằm trong `components/**` (sweep chỉ quét `app/**`), hoặc bị bỏ qua vì có ô nhập bên
 * trong. Không có test thì lần thêm bảng mới sau này lại lọt tiếp, và không ai biết cho
 * tới khi người dùng phải cuộn hết bảng để xem thứ nằm dưới nó.
 *
 * Cách "sửa" khi test đỏ:
 *   · Bảng dữ liệu (số dòng có thể vượt 10) → bọc `<PhanTrangBang>`.
 *   · Bảng nội dung / vỏ dùng lại / bảng chốt cứng vài dòng → khai vào MIEN_TRU KÈM LÝ DO.
 * Đừng xoá test.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const GOC = ["app", "components"];

/** File có `<table>` mà CỐ Ý không phân trang — mỗi dòng phải nêu lý do. */
const MIEN_TRU: Record<string, string> = {
  "app/(admin)/admin/orders/_components/cong-no-theo-con.tsx":
    'HAI bảng, cùng một lý do miễn trừ [cập nhật 24/09/2026 — trước đó dòng này chỉ mô tả MỘT bảng, và vì danh sách miễn trừ khoá theo ĐƯỜNG DẪN nên bảng thứ hai vào file mà không ca nào đỏ; lý do miễn trừ âm thầm thành sai là cách một lưới chết mà vẫn xanh]. (1) "Học phí từng con theo các đợt của đơn": số dòng = số CON, số cột = số đợt. (2) Bảng số theo con (Con · Phải thu · Đã thu · Chờ XN · Còn nợ · hành động): đúng 6 cột cố định, một dòng một con. CẢ HAI có số dòng chặn bởi số con trên đơn (thực tế 1–3, trần là số dòng hàng người bán gõ tay) và CẢ HAI phải nhìn HẾT một lượt: hàng tổng ở `<tfoot>` là thứ người đọc đối chiếu với khối "Phiếu thu & QR theo đợt" ngay dưới, nên cắt trang là giấu mất chính phép kiểm mà bảng sinh ra để phơi. Rộng chứ không dài — cả hai bọc `overflow-x-auto`',
  "app/(admin)/admin/cau-hinh-van-hanh/_components/tab-nick-zalo-bang.tsx":
    "một dòng một nick Zalo của cơ sở — nick là SIM thật nên số dòng bị chặn bởi số SIM công ty mua, hôm nay 3; phân trang ở đây là hai thanh điều khiển cho ba dòng",
  "components/ui/table.tsx":
    "primitive shadcn — mọi nơi GỌI nó đã bọc rồi, bọc thêm ở đây là hai thanh điều khiển chồng nhau",
  "app/(admin)/admin/design-system-preview/client.tsx":
    "màn xem thử design system, chỉ dev dùng",
  "app/(admin)/admin/huong-dan/_components/guide-markdown.tsx":
    "bảng trong tài liệu hướng dẫn",
  "app/(portal)/portal/huong-dan/_components/guide-markdown.tsx":
    "bảng trong tài liệu hướng dẫn",
  "app/(teacher)/teacher/huong-dan/_components/guide-markdown.tsx":
    "bảng trong tài liệu hướng dẫn",
  "components/blog/markdown-renderer.tsx":
    'bảng trong VĂN BẢN markdown (bài viết + 10 trang chính sách nộp Bộ Công Thương) — nội dung cố định do người soạn viết, không phải danh sách đọc từ DB. Thẻ <table> ở đây thêm 21/09/2026 CHỈ để bọc `overflow-x-auto`: `prose` không có wrapper cuộn ngang nên bảng "mức hoàn trả" 2 cột đẩy tràn cả trang ở 375px. Phân trang một bảng 4 dòng của văn bản pháp lý là giấu mất mức hoàn tiền',
  "app/(public)/khoa-hoc/page.tsx":
    "bảng SO SÁNH hai khoá học — nội dung cố định, không phải danh sách",
  "app/(public)/hoc-cu/page.tsx": "bảng so sánh gói học cụ — nội dung cố định",
  "components/cham-cong/ui/bang-gio-ca.tsx":
    "bảng tra GIỜ CÁC CA — danh mục chốt cứng (21 mã), nằm trong <details> đóng sẵn; phân trang một bảng tra cứu là bắt người ta bấm sang trang để tìm nghĩa của một mã",
  "app/(admin)/admin/quan-ly-chia-lead/lich-su/page.tsx":
    "ĐÃ có phân trang, nhưng PHÍA SERVER (skip/take + link Trước/Sau) — nhật ký pool chỉ có thêm không bao giờ bớt, cắt trang trong trình duyệt là phải tải cả sổ về trước",
  "app/(admin)/admin/cham-cong/danh-muc-ca/_components/template-editor.tsx":
    "bảng ĐOẠN CA bên trong form sửa một mã (tối đa 6 dòng, là ô nhập chứ không phải danh sách) — phân trang một form là vô nghĩa",
  "app/(admin)/admin/cham-cong/phan-ca/import/_components/mapping-table.tsx":
    "bảng ánh xạ tên = số người trên Sheet (19–20 dòng, nhóm theo khối CS1/CS2/HO) — phải nhìn HẾT một lượt để xác nhận từng người và thấy ai CHƯA ánh xạ; cắt trang là giấu mất đúng thứ người dùng đang phải soát trước khi bấm Áp",
  "app/(admin)/admin/bao-cao/phan-hoi-hop-thu/page.tsx":
    "hai bảng GỘP SẴN: một dòng cho mỗi người phụ trách, một dòng cho mỗi đơn vị — số dòng chặn bởi quy mô đội, không theo lượng hội thoại. Đây lại đúng là bảng phải nhìn HẾT một lượt: cắt trang là giấu mất người đang tồn nhiều khách chờ, tức giấu đúng thứ bảng sinh ra để phơi",
  "app/(admin)/admin/nhan-su/import/page.tsx":
    "bảng CHẠY THỬ của lượt nhập nhân sự — dựng sau sự cố 08/09/2026 (file 9 cột xoá trắng 3 cột ngày trên 9 hồ sơ PROD). Nó tồn tại ĐỂ người vận hành nhìn HẾT trước khi bấm Ghi thật, và mỗi dòng đỏ là một ô sắp mất dữ liệu; cắt trang là giấu đúng thứ nó sinh ra để phơi bày. Số dòng chặn bởi số hồ sơ THỰC SỰ ĐỔI, không phải số dòng file",
  "app/(admin)/admin/cham-cong/phan-ca/import/_components/result-diff-table.tsx":
    'bảng đối chiếu 15–21 MÃ CA (Sheet vs hệ thống) sau khi áp — số dòng chặn bởi danh mục mã ca, và đây là bằng chứng "khớp hay lệch" phải đọc trọn vẹn một lần; phân trang một bảng đối chiếu là giấu mất dòng lệch',
  "app/(admin)/admin/quan-ly-chia-lead/_components/pool-table.tsx":
    "một bảng = MỘT cơ sở, số dòng = số sale của cơ sở đó (thực tế 2–5). Phân trang ở đây là thêm thanh điều khiển vô nghĩa, mà đây lại đúng là bảng cần nhìn HẾT một lượt để tin là công bằng — cắt trang là giấu mất người đang bị tắt",
  "app/(admin)/admin/quan-ly-chia-lead/_components/so-chia.tsx":
    "ĐÃ có phân trang, nhưng PHÍA SERVER (skip/take + link Trước/Sau) chứ không bọc `PhanTrangBang` — sổ chia lead chỉ có thêm không bao giờ bớt, cắt trang trong trình duyệt là phải tải cả sổ về trước",
  "app/(admin)/admin/hoc-bu/_components/bang-can-bu.tsx":
    "ĐÃ có phân trang PHÍA SERVER (skip/take 5 dòng — chốt chủ dự án 29/09 — + `DieuHuongTrangLink` ở page.tsx) chứ không bọc `PhanTrangBang`: danh sách cần bù của cả cơ sở tăng theo mỗi buổi vắng, tải hết về trình duyệt rồi mới cắt là sai tầng",
  "app/(admin)/admin/ban-giao-lead/_components/chuyen-lead-form.tsx":
    "Danh sách CHỌN lead để chuyển (01/10/2026), không phải bảng tra cứu: cuộn trong khung cao 70vh, server cắt 300 lead đang mở, " +
    "và ô \"chọn tất cả\" phải chọn đúng tập ĐANG LỌC — chia trang thì người dùng tick ở trang 1 rồi tưởng đã chọn hết.",
  "app/(admin)/admin/hoc-bu/_components/bang-da-huy.tsx":
    "ĐÃ có phân trang PHÍA SERVER (skip/take theo ô Hiển thị + `DieuHuongTrangLink` ở page.tsx), cùng khuôn bảng Cần bù",
  "app/(admin)/admin/courses/[id]/_components/hoc-bu-section.tsx":
    "bảng cấu hình = một dòng mỗi HỌC PHẦN của khoá (Sata 3–7: 4 dòng, khoá không chia học phần: 1 dòng) — số dòng chặn bởi giáo trình, và phải nhìn trọn để thấy tổng lượt bù",
  "components/legacy-laptrinhrobot/InternalAwards.tsx":
    "bảng giải thưởng trên landing cũ — danh sách chốt cứng trong code, không đọc từ DB",
  "app/(admin)/admin/orders/_components/them-con-dialog.tsx":
    "bảng XEM TRƯỚC của lượt thêm con — một dòng cho MỖI CON của đơn, tức 2–4 dòng. Số dòng " +
    "chặn bởi số con trong một gia đình, không theo lượng dữ liệu. Và đây đúng là bảng phải " +
    "nhìn HẾT một lượt trước khi bấm: nó nói con nào được giảm, con nào bị sửa đợt thu — cắt " +
    "trang là giấu đúng thứ màn này sinh ra để phơi.",
};

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Bỏ chú thích trước khi soi — `<table>` nằm trong JSDoc không phải một cái bảng. */
function boChuThich(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const TEN_TUONG_DOI = (f: string) =>
  path.relative(ROOT, f).split(path.sep).join("/");

// Quét CÓ NHỚ: cả ba `it` đều gọi `fileCoBang()`, mà mỗi lượt là một lần duyệt đồng bộ
// toàn bộ `app/` + `components/` rồi đọc từng file. Chạy riêng thì ~1s, nhưng trong cả bộ
// (267 file test chạy song song) lượt thứ hai vượt trần 5s và test đỏ vì HẾT GIỜ chứ
// không phải vì có bảng thiếu phân trang — đúng kiểu đỏ giả làm người ta mất niềm tin vào
// test. Cây thư mục không đổi giữa các `it` nên nhớ lại là an toàn tuyệt đối.
let _cache: string[] | null = null;

function fileCoBang(): string[] {
  if (_cache) return _cache;
  _cache = quetFileCoBang();
  return _cache;
}

function quetFileCoBang(): string[] {
  return GOC.flatMap((g) => walk(path.join(ROOT, g)))
    .filter((f) => !f.includes(".test."))
    .filter((f) => {
      const ten = TEN_TUONG_DOI(f);
      // Hai file ĐỊNH NGHĨA cỗ máy phân trang — chúng chứa `<table>` là đương nhiên.
      if (ten.endsWith("components/ui/bang-phan-trang.tsx")) return false;
      if (ten.endsWith("components/ui/phan-trang-bang.tsx")) return false;
      return /<table[\s>]|<Table[\s>]/.test(
        boChuThich(fs.readFileSync(f, "utf8")),
      );
    })
    .map(TEN_TUONG_DOI);
}

describe("Mọi bảng dữ liệu đều có phân trang", () => {
  it("không file nào có <table> mà thiếu phân trang (trừ danh sách miễn trừ)", () => {
    const thieu = fileCoBang().filter((ten) => {
      if (ten in MIEN_TRU) return false;
      const src = fs.readFileSync(path.join(ROOT, ten), "utf8");
      // Tìm THẺ ĐANG DÙNG, không tìm tên: chỉ còn dòng `import` mà không còn thẻ thì bảng
      // đó KHÔNG hề phân trang — đột biến thử đã lọt đúng vì kiểm hớ chỗ này (12/08/2026).
      return !/<PhanTrangBang|<BangPhanTrang|<DieuHuongTrang/.test(src);
    });
    expect(
      thieu,
      `Bảng chưa phân trang (bọc <PhanTrangBang>, hoặc khai MIEN_TRU kèm lý do):\n  - ${thieu.join("\n  - ")}\n`,
    ).toEqual([]);
  });

  it("MIEN_TRU không có dòng chết (file đã xoá hoặc nay đã phân trang)", () => {
    // Danh sách miễn trừ không ai dọn thì lần sau nó che mất lỗi thật.
    const co = new Set(fileCoBang());
    const chet = Object.keys(MIEN_TRU).filter((ten) => {
      if (!co.has(ten)) return true;
      const src = fs.readFileSync(path.join(ROOT, ten), "utf8");
      return /<PhanTrangBang|<BangPhanTrang/.test(src);
    });
    expect(
      chet,
      `Dòng MIEN_TRU không còn cần thiết:\n  - ${chet.join("\n  - ")}\n`,
    ).toEqual([]);
  });

  it("mỗi dòng miễn trừ đều có lý do viết ra", () => {
    for (const [ten, lyDo] of Object.entries(MIEN_TRU)) {
      expect(lyDo.trim().length, `${ten} thiếu lý do`).toBeGreaterThan(15);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// Ba luật về VỎ của bảng — thêm 06/09/2026 sau khi chủ dự án báo "một số bảng bị mất một
// góc bên phải".
//
// Triệu chứng đó không đến từ cái bảng mà từ CÁI VỎ mỗi chỗ gọi tự dựng, và có đúng hai
// tổ hợp sinh ra nó:
//
//   1. Vùng cuộn TRÙNG với thẻ bo góc (`overflow-x-auto` cùng phần tử với `rounded-*`).
//      Viền vẽ theo border-box và không cuộn, còn nội dung bị cắt theo padding-box đã bo,
//      nên kéo ngang là dải nền `<thead>` bị vạt chéo ở góc. Đúng khuôn phải đẩy việc cuộn
//      xuống div con — `PhanTrangBang cuonNgang` làm sẵn việc đó.
//   2. `<table>` có `min-w-[Npx]` mà THIẾU `w-full`. Bảng co theo nội dung, nên khi thẻ
//      rộng hơn N thì bảng dừng ở N và chừa một dải nền trống bên phải: dải header và
//      đường kẻ hàng không chạm viền — nhìn đúng như mất một góc.
//
// Hai lỗi này im lặng tuyệt đối: không cảnh báo, không lỗi thời gian chạy, chỉ xấu. Vá
// từng chỗ thì lần thêm bảng thứ mười một lại tái phát, nên khoá bằng luật tĩnh.
describe("Vỏ bảng — không sinh ra 'mất góc bên phải'", () => {
  /** Dòng chứa `<PhanTrangBang`, kèm 3 dòng ngay trước để soi thẻ bọc. */
  function khoiPhanTrang(
    src: string,
  ): { truoc: string; dong: string; sau: string }[] {
    const dong = src.split("\n");
    const ra: { truoc: string; dong: string; sau: string }[] = [];
    for (let i = 0; i < dong.length; i++) {
      if (!/<PhanTrangBang[\s>]/.test(dong[i])) continue;
      ra.push({
        truoc: dong.slice(Math.max(0, i - 3), i).join("\n"),
        dong: dong[i],
        sau: dong.slice(i, Math.min(dong.length, i + 6)).join("\n"),
      });
    }
    return ra;
  }

  it("vùng cuộn không được trùng với thẻ bo góc", () => {
    const xau: string[] = [];
    for (const ten of fileCoBang()) {
      const src = boChuThich(fs.readFileSync(path.join(ROOT, ten), "utf8"));
      for (const k of khoiPhanTrang(src)) {
        // Bắt cả `overflow-auto`, không riêng `overflow-x-auto`: đổi sang tên khác mà vẫn đặt
        // vùng cuộn lên thẻ bo góc thì bệnh y nguyên, chỉ là test thôi nhìn thấy.
        //
        // NGOẠI LỆ CÓ NGUYÊN TẮC: thẻ đặt `max-h-*` là một HỘP CUỘN DỌC (xem trước file nhập,
        // danh sách chấm bài…), thường kèm `<thead sticky top-0>`. Ở đó vùng cuộn BẮT BUỘC nằm
        // trên chính thẻ giới hạn chiều cao — đẩy xuống div con là mất hàng tiêu đề dính. Bệnh
        // "mất góc phải" chỉ nói về bảng RỘNG cuộn ngang trong thẻ bo góc không giới hạn cao.
        const thePhamLoi = k.truoc
          .split("\n")
          .find(
            (d) =>
              /overflow-(?:x-)?auto/.test(d) &&
              /rounded-/.test(d) &&
              !/max-h-/.test(d),
          );
        if (thePhamLoi) xau.push(`${ten} — ${thePhamLoi.trim()}`);
      }
    }
    expect(
      xau,
      "Thẻ bọc bảng vừa `overflow-x-auto` vừa `rounded-*` ⇒ nội dung bị vạt góc khi kéo ngang.\n" +
        "Đổi thẻ sang `overflow-hidden` và cho `PhanTrangBang` prop `cuonNgang`:\n  - " +
        xau.join("\n  - ") +
        "\n",
    ).toEqual([]);
  });

  it("bảng cuộn ngang phải có w-full bên cạnh min-w", () => {
    const xau: string[] = [];
    for (const ten of fileCoBang()) {
      const src = boChuThich(fs.readFileSync(path.join(ROOT, ten), "utf8"));
      for (const k of khoiPhanTrang(src)) {
        if (!/cuonNgang/.test(k.dong)) continue;
        const the = k.sau.match(/<table className="([^"]*)"/);
        if (!the) continue;
        const cls = the[1];
        if (/min-w-\[/.test(cls) && !/\bw-full\b/.test(cls))
          xau.push(`${ten} — <table className="${cls}">`);
      }
    }
    expect(
      xau,
      "Bảng có `min-w-[…]` mà thiếu `w-full` ⇒ chừa dải trống bên phải khi thẻ rộng hơn:\n  - " +
        xau.join("\n  - ") +
        "\n",
    ).toEqual([]);
  });
});
