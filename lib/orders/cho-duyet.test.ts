// Ca [CDT-*] — "đơn này có đang chờ duyệt không". Thuần, không DB.
//
// 🔴 Chủ dự án 25/09/2026: *"các đơn hàng cần duyệt thì thiết kế nổi bật lên để QLCS biết
// sẽ có những đơn nào cần duyệt"*. Từ nay câu hỏi ấy được hỏi ở HAI chỗ — khối "Chờ duyệt"
// (tra DB) và từng dòng bảng đơn (suy trong bộ nhớ). Hai công thức thì có ngày lệch, và
// khi lệch thì màn hình nói dối.
//
// 🔴 BA PHẦN từ 25/09/2026 — thêm "số buổi không khớp mốc học phần" (chủ dự án: *"nếu
// buổi học khác 12 24 36 48 tức 1/2/3/4 học phần thì phải qua quản lý duyệt"*).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WHERE_CHO_DUYET, laDonChoDuyet, nhanChoDuyet, lyDoChuaDuyetQr } from "./cho-duyet";

const CHO = "PENDING_APPROVAL";
/** Các giá trị KHÁC mà ba cột có thể mang trên dữ liệu thật. */
const KHAC = [null, "APPROVED", "REJECTED"] as const;

describe("[CDT-01] từng phần một — cờ và nhãn phải khớp nhau", () => {
  it.each([
    [
      "giảm giá",
      { d: CHO, i: null, b: null },
      { giamGia: true, traGop: false, soBuoi: false },
      "Chờ duyệt giảm giá",
    ],
    [
      "trả góp",
      { d: "APPROVED", i: CHO, b: null },
      { giamGia: false, traGop: true, soBuoi: false },
      "Chờ duyệt trả góp",
    ],
    [
      "số buổi",
      { d: null, i: "REJECTED", b: CHO },
      { giamGia: false, traGop: false, soBuoi: true },
      "Chờ duyệt số buổi",
    ],
  ] as const)("chỉ %s", (_ten, cot, mong, nhan) => {
    // ⚠️ Ca "chỉ số buổi" là ca ĐẮT NHẤT của bộ. Bản if/else cũ (hai cờ) trả nhãn SAI cho
    // đúng ca này — đơn chỉ vướng số buổi bị gắn nhãn "Chờ duyệt trả góp", và không lỗi
    // nào báo, không ca nào đỏ. Đó là lý do nhãn nay dựng từ DANH SÁCH chứ không if/else.
    const p = laDonChoDuyet({
      discountApprovalStatus: cot.d,
      installmentApprovalStatus: cot.i,
      soBuoiApprovalStatus: cot.b,
    });
    expect(p).toEqual({ co: true, ...mong });
    expect(nhanChoDuyet(p)).toBe(nhan);
  });
});

describe("[CDT-02] nhiều phần cùng lúc — nhãn phải nói ĐỦ, theo thứ tự cố định", () => {
  // Một nhãn chung là bắt người ta mở ra mới biết. Ba phần sửa bằng ba thao tác khác nhau,
  // nên biết trước là biết mình sắp phải làm gì.
  it.each([
    [{ d: CHO, i: CHO, b: null }, "Chờ duyệt giảm giá + trả góp"],
    [{ d: CHO, i: null, b: CHO }, "Chờ duyệt giảm giá + số buổi"],
    [{ d: null, i: CHO, b: CHO }, "Chờ duyệt trả góp + số buổi"],
    [{ d: CHO, i: CHO, b: CHO }, "Chờ duyệt giảm giá + trả góp + số buổi"],
  ] as const)("%o ⇒ %s", (cot, nhan) => {
    const p = laDonChoDuyet({
      discountApprovalStatus: cot.d,
      installmentApprovalStatus: cot.i,
      soBuoiApprovalStatus: cot.b,
    });
    expect(nhanChoDuyet(p)).toBe(nhan);
  });
});

describe("[CDT-03] CÂU CHẶN QR — một nguồn cho cả HAI cửa phát mã", () => {
  // ⚠️ Có ĐÚNG HAI cửa phát QR (`_qr-core.ts:guardIssuable` và trang đơn dựng URL ảnh
  // VietQR thẳng, không qua `_qr-core`). Trước 25/09 chúng chép tay cùng một điều kiện,
  // và cách chống thủng là *nhớ sửa cả hai*. Cờ thứ ba cho thấy cách ấy không bền.
  it("nói ĐÚNG bản chất từng phần — số buổi KHÔNG phải chuyện vượt mức", () => {
    const p = laDonChoDuyet({
      discountApprovalStatus: null,
      installmentApprovalStatus: null,
      soBuoiApprovalStatus: CHO,
    });
    const cau = lyDoChuaDuyetQr(p);
    // Bán 20 buổi không "vượt" gì cả — nó chỉ không rơi đúng mốc. Câu lỗi nói sai bản
    // chất là câu lỗi sale đọc xong đi sửa nhầm chỗ.
    expect(cau).toContain("không khớp mốc học phần");
    expect(cau).not.toContain("vượt mức");
    expect(cau).toContain("xuất được mã QR");
  });

  it("chờ cả ba ⇒ liệt kê cả ba, không nuốt bớt", () => {
    const cau = lyDoChuaDuyetQr(
      laDonChoDuyet({
        discountApprovalStatus: CHO,
        installmentApprovalStatus: CHO,
        soBuoiApprovalStatus: CHO,
      }),
    );
    // So KHÔNG PHÂN BIỆT HOA THƯỜNG: phần đứng đầu được viết hoa chữ cái đầu, nên
    // neo vào dạng thường là lưới đỏ chỉ vì thứ tự liệt kê đổi — ghim cách viết,
    // không ghim luật.
    const thuong = cau!.toLowerCase();
    expect(thuong).toContain("chia đợt");
    expect(thuong).toContain("ưu đãi");
    expect(thuong).toContain("mốc học phần");
  });

  it("không chờ gì ⇒ null, KHÔNG phải chuỗi rỗng", () => {
    // Chuỗi rỗng đọc là "giả" với `if (lyDo)` nhưng vẫn in ra được ở chỗ khác — hai cách
    // đọc cho cùng một giá trị là chỗ bug nằm.
    expect(
      lyDoChuaDuyetQr(
        laDonChoDuyet({
          discountApprovalStatus: "APPROVED",
          installmentApprovalStatus: null,
          soBuoiApprovalStatus: "REJECTED",
        }),
      ),
    ).toBeNull();
  });
});

describe("[CDT-04] KHÔNG chờ duyệt ⇒ không nhãn, không tô sáng", () => {
  it.each(
    KHAC.flatMap((a) =>
      KHAC.flatMap((b) => KHAC.map((c) => [String(a), String(b), String(c), a, b, c] as const)),
    ),
  )("giảm giá=%s · trả góp=%s · số buổi=%s", (_a, _b, _c, d, i, bu) => {
    const p = laDonChoDuyet({
      discountApprovalStatus: d,
      installmentApprovalStatus: i,
      soBuoiApprovalStatus: bu,
    });
    expect(p.co).toBe(false);
    expect(nhanChoDuyet(p)).toBeNull();
    expect(lyDoChuaDuyetQr(p)).toBeNull();
  });
});

describe("[CDT-05] `WHERE_CHO_DUYET` và `laDonChoDuyet` phải nói CÙNG một điều", () => {
  it("khớp trên đủ 64 tổ hợp", () => {
    // Đây là khoá giữ hai mặt của một luật. Không có ca này thì sửa một bên mà quên bên
    // kia là bảng gắn cờ cho đơn mà khối duyệt không liệt kê — hoặc ngược lại — và cả hai
    // đều trông hoàn toàn bình thường trên màn.
    const moi = [CHO, ...KHAC] as const;
    /** Mô phỏng đúng ngữ nghĩa của mảnh `where`: OR trên BA phép so bằng. */
    const theoWhere = (d: string | null, i: string | null, b: string | null) =>
      WHERE_CHO_DUYET.OR.some(
        (dk) =>
          ("discountApprovalStatus" in dk && dk.discountApprovalStatus === d) ||
          ("installmentApprovalStatus" in dk && dk.installmentApprovalStatus === i) ||
          ("soBuoiApprovalStatus" in dk && dk.soBuoiApprovalStatus === b),
      );

    for (const d of moi) {
      for (const i of moi) {
        for (const b of moi) {
          expect(
            laDonChoDuyet({
              discountApprovalStatus: d,
              installmentApprovalStatus: i,
              soBuoiApprovalStatus: b,
            }).co,
            `giảm giá=${d} · trả góp=${i} · số buổi=${b}`,
          ).toBe(theoWhere(d, i, b));
        }
      }
    }
  });

  it("mảnh `where` có ĐÚNG BA vế — thêm cột mà quên vế là cột đó câm", () => {
    // ⚠️ Lỗi CÂM điển hình: cột `soBuoiApprovalStatus` ghi xuống DB đàng hoàng, dòng bảng
    // gắn cờ đúng (vì `laDonChoDuyet` đọc trong bộ nhớ), nhưng HÀNG CHỜ và SỐ ĐẾM trên nút
    // lại bỏ sót đơn ấy — quản lý không bao giờ thấy nó.
    expect(WHERE_CHO_DUYET.OR).toHaveLength(3);
  });
});

describe("[CDT-06] không được dựng lại phép ĐỌC — lưới ghim mã nguồn", () => {
  // ⚠️ LÝ LẼ của lưới, và nó hẹp hơn bản nháp đầu. Bản nháp cấm MỌI lần nhắc
  // `"PENDING_APPROVAL"` trong các tệp đơn hàng, và nó đỏ oan ngay: `_actions.ts` GHI
  // chuỗi ấy lúc tạo đơn (`installmentApprovalStatus: … ? "PENDING_APPROVAL" : null`) —
  // một phép GHI hoàn toàn hợp lệ, không phải bản sao của phép đọc.
  //
  // Luật thật sự cần khoá: **đừng dựng lại câu hỏi "đơn nào đang chờ duyệt"**. Câu hỏi ấy
  // chỉ có hai hình dạng — một mảnh `OR` để tra DB, và một phép so `===` để suy trong bộ
  // nhớ. Lưới neo vào đúng hai hình dạng đó.
  //
  // Mã TRƯỚC bản vá: `duyet/page.tsx` tự dựng
  //   `OR: [{ discountApprovalStatus: "PENDING_APPROVAL" }, { installmentApprovalStatus: … }]`.
  const TEP = [
    "lib/orders/du-lieu-the-duyet.ts",
    "app/(admin)/admin/orders/_components/khoi-cho-duyet.tsx",
    "app/(admin)/admin/orders/[id]/duyet/page.tsx",
    "app/(admin)/admin/orders/_actions.ts",
    "app/(admin)/admin/orders/_components/orders-list-client.tsx",
    // 25/09 — hai cửa phát QR nay cũng đi qua `lyDoChuaDuyetQr`, nên chúng vào danh sách.
    "app/(admin)/admin/orders/_qr-core.ts",
    "app/(admin)/admin/orders/[id]/page.tsx",
    "app/(admin)/admin/orders/duyet/_components/order-approval-card.tsx",
  ];

  /** Bỏ chú thích TRƯỚC khi đếm — chính khối giải thích bản vá có chứa chuỗi đang cấm. */
  function boChuThich(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it.each(TEP)("%s không tự SO SÁNH với chuỗi chờ duyệt", (tep) => {
    const src = boChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
    expect(src.match(/[!=]==\s*"PENDING_APPROVAL"/g) ?? []).toHaveLength(0);
  });

  it("nơi TRA đơn chờ duyệt dùng ĐÚNG mảnh `where` dùng chung, không dựng OR riêng", () => {
    // ⚠️ Lưới này đã phải đổi đường dẫn BA LẦN trong một ngày (25/09/2026):
    //   `duyet/page.tsx` → `khoi-cho-duyet.tsx` → `lib/orders/du-lieu-the-duyet.ts`,
    // mỗi lần vì câu tra dời chỗ. Cả ba lần nó đỏ vì LÝ DO ĐÚNG, và luật nó canh không
    // đổi một chữ: "nơi nào liệt kê đơn chờ duyệt cũng phải dùng mảnh `where` dùng
    // chung". Đổi đường dẫn, giữ nguyên khẳng định — đừng gỡ lưới.
    const src = boChuThich(
      readFileSync(resolve(process.cwd(), "lib/orders/du-lieu-the-duyet.ts"), "utf8"),
    );
    expect(src.match(/WHERE_CHO_DUYET/g) ?? []).toHaveLength(3); // import + 2 nơi dùng
    // Không còn mảnh OR nào dựng tay trong tệp ấy.
    expect(src).not.toMatch(/discountApprovalStatus:\s*"/);
    expect(src).not.toMatch(/installmentApprovalStatus:\s*"/);
    expect(src).not.toMatch(/soBuoiApprovalStatus:\s*"/);
  });

  it("`/orders/duyet` nay CHỈ là một cú chuyển hướng — không còn logic duyệt nào", () => {
    // Khẳng định dương cho việc gộp màn: tệp ấy mà mọc lại câu tra là có người vô tình
    // dựng lại trang cũ, và từ đó hai màn nói hai điều khác nhau về cùng một tập đơn.
    const src = boChuThich(
      readFileSync(resolve(process.cwd(), "app/(admin)/admin/orders/duyet/page.tsx"), "utf8"),
    );
    // ⚠️ Neo vào LUẬT, không vào chuỗi. Bản đầu đòi đúng văn bản `redirect("/orders")`
    // và đã đỏ oan khi đích đổi thành `/orders?duyet=1` (25/09) — trong khi luật nó canh
    // ("tệp này CHỈ đá về màn Đơn hàng, không còn logic duyệt") không đổi một chữ. Cùng
    // họ với `[NDC-07]`, `[QCS-03]` trong CLAUDE.md.
    expect(src).toMatch(/redirect\("\/orders[^"]*"\)/);
    expect(src.match(/redirect\(/g) ?? []).toHaveLength(1);
    expect(src).not.toMatch(/findMany/);
    expect(src).not.toMatch(/ApprovalStatus/);
  });

  it("chuỗi enum xuất hiện ĐÚNG MỘT lần trong `cho-duyet.ts`", () => {
    const src = boChuThich(readFileSync(resolve(process.cwd(), "lib/orders/cho-duyet.ts"), "utf8"));
    expect(src.match(/"PENDING_APPROVAL"/g) ?? []).toHaveLength(1);
  });

  it("CÂU CHẶN QR chỉ có MỘT bản — hai cửa phát mã cùng gọi `lyDoChuaDuyetQr`", () => {
    // ⚠️ Lưới DÂY NỐI. Mọi ca ở trên là hàm thuần: chúng xanh y nguyên kể cả khi không ai
    // gọi `lyDoChuaDuyetQr`. Con bug đắt nhất ở đây là "viết xong mà quên cắm một cửa" —
    // và nó câm tuyệt đối: mã QR vẫn phát ra cho một đơn chưa ai ký.
    for (const tep of [
      "app/(admin)/admin/orders/_qr-core.ts",
      "app/(admin)/admin/orders/[id]/page.tsx",
    ]) {
      const src = boChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
      expect(src.match(/lyDoChuaDuyetQr\(/g) ?? [], `${tep} không gọi lyDoChuaDuyetQr`).toHaveLength(
        1,
      );
    }
  });
});

describe("[CDT-07] THẺ DUYỆT — khối chờ duyệt phải KHÁC khối bối cảnh", () => {
  // 🔴 Chủ dự án 26/09/2026: *"phần nào cần duyệt thì thiết kế chữ nổi bật lên cho QLCS
  // dễ nhận thấy"*.
  //
  // ⚠️ Lưới này CHỈ ghim DÂY NỐI. Phần "có trông khác nhau thật không" đo ở `[DTD-05]`
  // (Playwright, so MÀU NỀN thật của hai khối) — văn bản mã không trả lời được câu đó.
  // Nhưng dây nối thì văn bản trả lời được, và nó là chỗ hỏng CÂM: truyền nhầm `dangCho`
  // là mọi khối lại giống nhau, không ca nào đỏ, console sạch.
  function boChuThich(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }
  const THE = boChuThich(
    readFileSync(
      resolve(process.cwd(), "app/(admin)/admin/orders/duyet/_components/order-approval-card.tsx"),
      "utf8",
    ),
  );

  it("ĐÚNG BA khối đi qua `KhoiXetDuyet` — không khối nào tự vẽ nền riêng", () => {
    // Ba khối: giải trình giảm giá · số buổi · kế hoạch thanh toán. Một khối tự vẽ
    // `rounded-lg bg-muted` bên ngoài component là một khối không bao giờ nổi lên được.
    expect(THE.match(/<KhoiXetDuyet\b/g) ?? []).toHaveLength(3);
    expect(THE.match(/<\/KhoiXetDuyet>/g) ?? []).toHaveLength(3);
  });

  it("mỗi khối nhận ĐÚNG cờ của phần nó nói", () => {
    // Truyền nhầm cờ là nói dối đúng thứ dải đầu thẻ vừa hứa: dải bảo "giảm giá" mà khối
    // sáng lên lại là "kế hoạch thanh toán".
    expect(THE).toMatch(/dangCho=\{choDuyetGiamGia\}/);
    expect(THE).toMatch(/dangCho=\{choDuyetKeHoach\}/);
    // Khối số buổi CHỈ được vẽ khi đang chờ, nên nó truyền `dangCho` trần.
    expect(THE).toMatch(/<KhoiXetDuyet dangCho tieuDe="Số buổi/);
  });

  it("độ nổi quyết định bởi `dangCho`, KHÔNG phải nền cứng", () => {
    // Bản trước: `className="space-y-1.5 rounded-lg bg-muted p-3"` cố định cho cả ba khối.
    expect(THE).toMatch(/dangCho\s*\?\s*"border border-state-warning-ink[^"]*bg-state-warning-soft"/);
    expect(THE).toMatch(/dangCho\s*\?\s*"font-bold text-state-warning-ink"/);
  });

});
