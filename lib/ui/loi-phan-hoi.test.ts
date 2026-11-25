/**
 * ĐỌC LÝ DO HỎNG TỪ PHẢN HỒI ROUTE NHẬP.
 *
 * Sự cố 16/09/2026 (ảnh chụp prod, màn nhập lead): hộp thoại in đúng một câu
 * "Nhập thất bại: Nhập thất bại". Server không im lặng — lý do nằm nguyên trong
 * `errors[0].error`; màn hình đọc `body.error`, thấy `undefined`, rồi rơi về chuỗi mặc định.
 *
 * Bộ này canh MỘT lời hứa: hàm KHÔNG BAO GIỜ trả về một câu vô nghĩa. Không đọc được gì thì
 * ít nhất phải nói ra mã HTTP — "máy chủ trả lỗi 500 và không nói lý do" vẫn tra được, còn
 * "Import thất bại" thì không.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { docLoiPhanHoi, gopDongLoi } from "./loi-phan-hoi";

describe("[LOI-T10] hình dạng `{ error }` — cổng đầu vào", () => {
  it("lấy nguyên câu của server", () => {
    expect(docLoiPhanHoi(403, { error: "Forbidden" })).toBe("Forbidden");
  });

  it("chuỗi rỗng / toàn khoảng trắng KHÔNG tính là có lý do", () => {
    // `""` là falsy nên bản cũ vẫn rơi về mặc định; `"   "` thì KHÔNG falsy và sẽ lọt qua
    // thành một thông báo lỗi trống trơn.
    expect(docLoiPhanHoi(500, { error: "" })).toBe("Máy chủ trả lỗi 500 và không nói lý do");
    expect(docLoiPhanHoi(500, { error: "   " })).toBe("Máy chủ trả lỗi 500 và không nói lý do");
  });

  it("kiểu lạ (số, object) không được ném hay in ra [object Object]", () => {
    expect(docLoiPhanHoi(500, { error: 42 as unknown as string })).toBe(
      "Máy chủ trả lỗi 500 và không nói lý do",
    );
    expect(docLoiPhanHoi(500, { error: {} as unknown as string })).toContain("500");
  });
});

describe("[LOI-T11] ⚠️ hình dạng `{ errors: [...] }` — ĐÚNG CA ĐÃ HỎNG TRÊN PROD", () => {
  it("đọc được lý do nằm trong mảng", () => {
    // Đây chính là thân mà route nhập lead trả về khi transaction ném.
    const than = {
      success: 0,
      errors: [{ row: 0, error: "Lỗi ghi: Transaction already closed" }],
    };
    expect(docLoiPhanHoi(500, than)).toBe("Lỗi ghi: Transaction already closed");
  });

  it("có số dòng thì NÓI RA số dòng — người dùng đang cầm file Excel", () => {
    expect(docLoiPhanHoi(500, { errors: [{ row: 47, error: "SĐT không hợp lệ" }] })).toBe(
      "dòng 47: SĐT không hợp lệ",
    );
  });

  it("`row = 0` là lỗi của cả lượt, không gắn dòng nào", () => {
    expect(docLoiPhanHoi(500, { errors: [{ row: 0, error: "Hết bộ nhớ" }] })).toBe("Hết bộ nhớ");
  });

  it("nhiều lỗi ⇒ nối lại, không bỏ bớt trong im lặng", () => {
    const c = docLoiPhanHoi(500, {
      errors: [
        { row: 2, error: "A" },
        { row: 3, error: "B" },
      ],
    });
    expect(c).toBe("dòng 2: A · dòng 3: B");
  });

  it("⚠️ quá nhiều lỗi ⇒ cắt bớt NHƯNG PHẢI NÓI là đã cắt", () => {
    // Im lặng bỏ bớt ở một thông báo lỗi là để người đọc tưởng mình đã thấy hết.
    const nhieu = Array.from({ length: 9 }, (_, i) => ({ row: i + 2, error: `E${i}` }));
    const c = docLoiPhanHoi(500, { errors: nhieu });
    expect(c).toContain("dòng 2: E0");
    expect(c).toContain("(và 4 lỗi nữa)");
    expect(c).not.toContain("E8");
  });

  it("mảng rỗng / phần tử rác ⇒ rơi về câu có mã HTTP, không ném", () => {
    expect(docLoiPhanHoi(502, { errors: [] })).toBe("Máy chủ trả lỗi 502 và không nói lý do");
    expect(docLoiPhanHoi(502, { errors: [null, 1, { row: 2 }] as unknown[] })).toBe(
      "Máy chủ trả lỗi 502 và không nói lý do",
    );
    expect(gopDongLoi("khong-phai-mang")).toBe("");
  });

  it("`error` ở TẦNG TRÊN thắng khi có cả hai", () => {
    expect(docLoiPhanHoi(400, { error: "Quá 5000 rows", errors: [{ row: 2, error: "x" }] })).toBe(
      "Quá 5000 rows",
    );
  });
});

describe("[LOI-T12] ⚠️ không bao giờ trả câu vô nghĩa", () => {
  it("thân `null` (server trả HTML chứ không phải JSON) vẫn nói được mã HTTP", () => {
    // Ca thật: Next ném ra trang lỗi HTML ⇒ `res.json()` hỏng ⇒ thân là `null`.
    expect(docLoiPhanHoi(500, null)).toBe("Máy chủ trả lỗi 500 và không nói lý do");
  });

  it("thân rỗng `{}` cũng vậy", () => {
    expect(docLoiPhanHoi(504, {})).toBe("Máy chủ trả lỗi 504 và không nói lý do");
  });

  it("mọi lối ra đều KHÔNG rỗng và KHÔNG phải câu cũ", () => {
    const thu: (Parameters<typeof docLoiPhanHoi>[1])[] = [
      null, {}, { error: "" }, { errors: [] }, { error: "X" }, { errors: [{ row: 1, error: "Y" }] },
    ];
    for (const t of thu) {
      const c = docLoiPhanHoi(500, t);
      expect(c.trim().length).toBeGreaterThan(0);
      expect(c).not.toBe("Import thất bại");
      expect(c).not.toBe("Nhập thất bại");
    }
  });
});

describe("[LOI-T13] ⚠️ MỌI màn nhập phải đi qua hàm này", () => {
  // Hàm thuần đúng không chứng minh được gì nếu màn hình không gọi. Đo 16/09: TÁM màn cùng
  // viết `err.error || "Import thất bại"` — vá một chỗ là còn bảy chỗ vẫn nuốt lý do.
  const MAN = [
    "app/(admin)/admin/leads/import/_components/man-nhap-lead.tsx",
    "app/(admin)/admin/centers/import/page.tsx",
    "app/(admin)/admin/classes/import/page.tsx",
    "app/(admin)/admin/holidays/import/page.tsx",
    "app/(admin)/admin/inventory/items/import/page.tsx",
    "app/(admin)/admin/nhan-su/import/page.tsx",
    "app/(admin)/admin/questions/import/page.tsx",
    "app/(admin)/admin/rooms/import/page.tsx",
    "app/(admin)/admin/students/import/page.tsx",
  ];

  const doc = (p: string) => {
    const duong = path.join(process.cwd(), p);
    expect(fs.existsSync(duong), `${duong} không còn ở chỗ cũ`).toBe(true);
    return fs.readFileSync(duong, "utf8");
  };

  it("phép quét tự kiểm: đọc được cả chín màn", () => {
    for (const p of MAN) expect(doc(p).length).toBeGreaterThan(500);
  });

  it("⚠️ KHÔNG màn nào còn `err.error || \"…thất bại\"`", () => {
    for (const p of MAN) {
      const s = doc(p);
      expect(s, p).not.toContain('err.error || "Import thất bại"');
      expect(s, p).not.toContain('err.error || "Nhập thất bại"');
    }
  });

  it("màn nhập LEAD đọc lý do qua đường có kiểm cả `errors`", () => {
    // Màn lead viết tay (có thêm khối chú thích về hai hình dạng) — canh nó đọc `errors`.
    //
    // ⚠️ 17/09/2026 — ĐỔI ĐƯỜNG DẪN. `page.tsx` nay chỉ còn là vỏ SERVER hỏi quyền
    // `leads:overwrite`; thân màn dời sang `_components/man-nhap-lead.tsx`. Cổng này đỏ
    // ngay lúc dời — đúng việc nó sinh ra: một lưới ghim mã nguồn phải ĐỎ khi mã đi chỗ
    // khác, chứ không lặng lẽ soi một tệp rỗng rồi xanh mãi.
    const s = doc("app/(admin)/admin/leads/import/_components/man-nhap-lead.tsx");
    expect(s).toContain("errors");
    expect(s).toContain("res.status");
  });

  it("tám màn còn lại gọi thẳng `docLoiPhanHoi`", () => {
    for (const p of MAN.slice(1)) {
      expect(doc(p), p).toContain("docLoiPhanHoi(res.status, than)");
    }
  });
});
