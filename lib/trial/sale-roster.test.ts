// Đợt C (kế hoạch Site Sale, 22/08/2026) — test viết TRƯỚC hiện thực (luật cứng #5).
//
// Trang trải nghiệm bản SALE khác bản GIÁO VIÊN ở đúng hai cột, và cả hai đều là
// chỗ dễ sai:
//   • **Phụ huynh** — site giáo viên CỐ Ý ẩn (quyết định câu 46). Trên site Sale
//     là dữ liệu nghiệp vụ chính đáng, nhưng phải qua kiểm quyền, không select thẳng.
//   • **Đã nhập học** — nguồn đúng là `LeadTrialHistory.outcome`, không phải suy
//     từ trạng thái ghi danh.
import { describe, it, expect } from "vitest";
import { buildSaleTrialStudent } from "./sale-roster";

const NEN = {
  enrollmentId: "te-1",
  studentName: "Bé Minh",
  birthYear: 2018,
  courseName: "Sata 3",
  status: "ACTIVE" as const,
  evaluated: false,
  enrolled: false,
  parentName: "Nguyễn Thị Hương",
  parentPhone: "84905123456",
};

describe("[Đợt C] buildSaleTrialStudent — cột Phụ huynh đi qua kiểm quyền", () => {
  it("có quyền xem liên hệ → thấy đầy đủ tên và số", () => {
    const r = buildSaleTrialStudent(NEN, { canViewParentContact: true });
    expect(r.parentName).toBe("Nguyễn Thị Hương");
    expect(r.parentPhone).toBe("84905123456");
  });

  it("KHÔNG có quyền → thấy bản che, KHÔNG rò số thật", () => {
    const r = buildSaleTrialStudent(NEN, { canViewParentContact: false });
    expect(r.parentPhone).not.toBe("84905123456");
    expect(r.parentPhone).not.toContain("905123456");
    expect(r.parentName).not.toBe("Nguyễn Thị Hương");
    // Che chứ không xoá trắng — người dùng vẫn cần phân biệt các dòng với nhau.
    expect(r.parentName?.length).toBeGreaterThan(0);
  });

  it("che ở TẦNG DỮ LIỆU, không phải tầng giao diện", () => {
    // Toàn bộ đối tượng trả về không được chứa số thật ở bất kỳ trường nào —
    // nếu lọt, nó đi thẳng vào payload gửi xuống trình duyệt.
    const r = buildSaleTrialStudent(NEN, { canViewParentContact: false });
    expect(JSON.stringify(r)).not.toContain("84905123456");
  });

  it("lead không có tên/số phụ huynh → null, không bịa chuỗi che", () => {
    const r = buildSaleTrialStudent(
      { ...NEN, parentName: null, parentPhone: null },
      { canViewParentContact: false },
    );
    expect(r.parentName).toBeNull();
    expect(r.parentPhone).toBeNull();
  });
});

describe("[Đợt C] buildSaleTrialStudent — cờ đã nhập học", () => {
  it("đã ghi danh khoá chính → bật cờ", () => {
    expect(buildSaleTrialStudent({ ...NEN, enrolled: true }, { canViewParentContact: true }).enrolled).toBe(true);
  });

  it("học xong buổi trải nghiệm nhưng CHƯA chốt khoá → KHÔNG bật cờ", () => {
    // Bẫy: bản mẫu suy "đã nhập học" từ trạng thái ghi danh trải nghiệm.
    // COMPLETED nghĩa là học hết buổi thử, không phải đã mua khoá.
    const r = buildSaleTrialStudent(
      { ...NEN, status: "COMPLETED", enrolled: false },
      { canViewParentContact: true },
    );
    expect(r.enrolled).toBe(false);
  });

  it("giữ nguyên các trường còn lại", () => {
    const r = buildSaleTrialStudent({ ...NEN, evaluated: true }, { canViewParentContact: true });
    expect(r).toMatchObject({
      enrollmentId: "te-1",
      studentName: "Bé Minh",
      birthYear: 2018,
      courseName: "Sata 3",
      status: "ACTIVE",
      evaluated: true,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// S-7 (26/08/2026) — vế "+% hoa hồng" của cột "Đã nhập học".
//
// Kế hoạch (`plan/25 §3`) ghi cột này là **"Đã nhập học · +% hoa hồng"**, đọc tỉ
// lệ từ cấu hình chứ không chép con số. Nhưng ĐO TRƯỚC KHI VẼ: hệ thống **chưa
// từng sinh một dòng hoa hồng nào cho Sale**. Engine 4 tầng
// (`lib/crm/commission.ts`) đủ logic và có test, nhưng `setStatementLines` —
// đường DUY NHẤT ghi dòng cho 4 tầng đó — không được gọi từ chỗ nào trong sản
// phẩm, chỉ có test gọi. Bảng kê kỳ nào cũng rỗng.
//
// Nên vế phải của cột KHÔNG được in "+4%" hay "0đ": cả hai đều là **nói dối một
// con số**. Người xem sẽ tin là đã tính rồi và đi hỏi kế toán vì sao chưa nhận
// tiền. Đúng luật `SS-CV-08` của kế hoạch kiểm thử: *"Job chốt kỳ hoa hồng chưa
// chạy → empty-state có nghĩa, KHÔNG hiện 0đ như thể đã chốt"*.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { nhanHoaHongSale } from "./sale-commission-label";

describe("[S-7] nhãn hoa hồng cạnh 'Đã nhập học'", () => {
  it("chưa nhập học → không nói gì về hoa hồng", () => {
    expect(nhanHoaHongSale(false)).toBeNull();
  });

  it("đã nhập học → 'chốt cuối kỳ', KHÔNG in phần trăm và KHÔNG in số tiền", () => {
    // 27/08 — nhãn đổi từ "chưa tính" sang "chốt cuối kỳ": hoa hồng Sale nay CÓ được
    // sinh thật (`commission-run.ts`), nhưng tính trên TIỀN ĐÃ THU và chỉ chốt khi kế
    // toán chốt kỳ, nên in "+4%" cạnh trạng thái nhập học vẫn là gợi ý sai.
    const n = nhanHoaHongSale(true);
    expect(n).not.toBeNull();
    expect(n!.nhan).toContain("chốt cuối kỳ");
    // Không một chữ số nào trong nhãn: có số là người đọc tin đó là tiền/tỉ lệ thật.
    expect(n!.nhan).not.toMatch(/\d/);
    expect(n!.nhan).not.toContain("%");
    expect(n!.nhan).not.toContain("đ");
  });

  it("kèm LÝ DO đọc được, không phải một dấu gạch câm", () => {
    const n = nhanHoaHongSale(true)!;
    expect(n.lyDo.length).toBeGreaterThan(40);
    // Lý do phải chỉ đúng thứ còn thiếu để người đọc biết đi hỏi ai.
    expect(n.lyDo).toMatch(/hoa hồng/i);
  });
});

describe("[S-7] nhãn phải ở module THUẦN — không kéo Prisma xuống trình duyệt", () => {
  it("sale-commission-label.ts không import gì cả", () => {
    // `trial-list.tsx` là Client Component. Nhãn từng nằm trong `sale-roster.ts`, mà
    // file đó import `scopedDb` → Prisma. `import type` cũ bị xoá lúc biên dịch nên
    // không sao; đổi sang import THẬT là cả Prisma đi vào gói gửi xuống trình duyệt.
    // tsc KHÔNG bắt được chuyện này, chỉ `next build` mới kêu (hoặc không kêu gì cả
    // mà lặng lẽ phình gói) — nên khoá bằng test.
    const src = readFileSync(join(process.cwd(), "lib", "trial", "sale-commission-label.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });

  // ⚠️ 22/09/2026 — `app/(sale)/sale/trial/_components/trial-list.tsx` GỠ cùng site
  // Sale, nên ca "chỉ import KIỂU, không import giá trị" mất file để soi. Bất biến
  // gốc vẫn đúng và vẫn cần: `sale-roster.ts` kéo Prisma, nên component client nào
  // import GIÁ TRỊ từ nó là kéo Prisma xuống trình duyệt. Dựng lại màn trải nghiệm
  // ở admin thì dán lại ca này, trỏ vào file mới.

});

describe("[S-7] canh gác: đường sinh hoa hồng Sale phải có ĐÚNG MỘT cửa", () => {
  // 27/08/2026 — canh gác này ĐÃ ĐỔI CHIỀU. Trước đó nó khẳng định
  // `setStatementLines` chưa được gọi từ sản phẩm (bảng kê kỳ nào cũng rỗng) và hẹn
  // "ngày ai đó nối job chốt kỳ thì test này đỏ". Hôm nay job đó được nối
  // (`lib/crm/commission-run.ts`, hoa hồng trên tiền đã thu), nên canh gác giữ nguyên
  // mục đích — khoá số cửa ghi dòng hoa hồng — nhưng đổi thành: đúng MỘT cửa, và
  // phải là cửa đã biết. Thêm cửa thứ hai là mở đường cộng đôi tiền thật.
  it("`setStatementLines` chỉ được gọi từ `lib/crm/commission-run.ts`", () => {
    const goc = join(process.cwd());
    const files: string[] = [];
    const quet = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
          quet(p);
        } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
          files.push(p);
        }
      }
    };
    for (const thuMuc of ["app", "lib", "scripts"]) {
      const p = join(goc, thuMuc);
      try {
        if (statSync(p).isDirectory()) quet(p);
      } catch {
        /* thư mục không có thì thôi */
      }
    }
    const goiTu = files
      .filter((f) => {
        if (f.endsWith(join("lib", "crm", "commission-statement.ts"))) return false; // nơi ĐỊNH NGHĨA
        return /\bsetStatementLines\s*\(/.test(readFileSync(f, "utf8"));
      })
      .map((f) => f.slice(goc.length + 1).replace(/\\/g, "/"));

    expect(
      goiTu,
      "Chỉ `lib/crm/commission-run.ts` được ghi dòng hoa hồng 4 tầng Sale. Có cửa thứ " +
        "hai nghĩa là hai đường cùng ghi một kỳ — `setStatementLines` XOÁ rồi GHI cả " +
        "kỳ, nên cửa sau sẽ xoá mất dòng của cửa trước (hoặc ngược lại) tuỳ thứ tự chạy.",
    ).toEqual(["lib/crm/commission-run.ts"]);
    // ⚠️ TRẦN THỜI GIAN TƯỜNG MINH — 24/09/2026, và nó KHÔNG phải "vá triệu chứng".
    //
    // Ca này đọc THẬT **2168 tệp** `.ts/.tsx` trong `app` + `lib` + `scripts`. Đo lúc máy
    // rảnh: **174 ms**. Nhưng chạy trong cả bộ `test:unit` (nhiều worker tranh I/O trên
    // Windows) nó vọt qua **5000 ms** mặc định và ĐỎ vì `Test timed out` — không phải vì
    // khẳng định sai. Chữ ký luật 18: xanh khi chạy một mình, đỏ khi chạy cả bộ.
    //
    // Trần mặc định 5 giây không phải một ngân sách có nghĩa cho một lượt quét đĩa 2168
    // tệp; con số dưới đây mới là. ĐỪNG hạ nó xuống, và cũng đừng nâng trần TOÀN CỤC —
    // trần toàn cục che luôn những ca chậm vì lý do THẬT.
    //
    // Nếu một ngày ca này lại đỏ vì timeout: cây mã đã lớn hơn nhiều, và lúc đó việc đúng
    // là làm lưới rẻ đi (quét một lượt, chia cho nhiều lưới dùng chung) chứ không phải
    // nâng tiếp con số này.
  }, 30_000);
});
