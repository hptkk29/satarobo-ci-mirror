/**
 * "Lớp trải nghiệm của Sale nào" — phép suy hai nguồn.
 *
 * Ca đáng chú ý nhất là [SCL-04]: nó canh việc cột KHÔNG được nhận vơ. Nhánh suy từ lead
 * là phỏng đoán, và một phỏng đoán trình bày như sự thật thì không ném lỗi, không làm test
 * đỏ, console vẫn sạch — chỉ người đọc bảng hiểu sai (luật 12).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { suySaleCuaLop } from "./sale-cua-lop";

describe("[SCL-01] có NGƯỜI TẠO ⇒ lấy người tạo", () => {
  it("người tạo thắng, và KHÔNG đánh dấu là suy", () => {
    expect(
      suySaleCuaLop({ tenNguoiTao: "Trần Bình", saleTheoCon: ["Lê Cường", "Lê Cường"] }),
    ).toEqual({ ten: "Trần Bình", suyTuLead: false, soSaleKhac: 0 });
  });

  it("lớp RỖNG vẫn trả lời được — đó là lý do cột `createdById` tồn tại", () => {
    // Trước 18/09 không cột nào trả lời được câu này cho lớp chưa xếp con nào.
    expect(suySaleCuaLop({ tenNguoiTao: "Trần Bình", saleTheoCon: [] })).toEqual({
      ten: "Trần Bình",
      suyTuLead: false,
      soSaleKhac: 0,
    });
  });

  it("tên người tạo toàn khoảng trắng ⇒ coi như không có, rơi xuống nhánh suy", () => {
    expect(suySaleCuaLop({ tenNguoiTao: "   ", saleTheoCon: ["Lê Cường"] })).toEqual({
      ten: "Lê Cường",
      suyTuLead: true,
      soSaleKhac: 0,
    });
  });
});

describe("[SCL-02] KHÔNG có người tạo ⇒ suy từ Sale phụ trách lead của các con", () => {
  it("lớp cũ một Sale", () => {
    expect(suySaleCuaLop({ tenNguoiTao: null, saleTheoCon: ["Lê Cường", "Lê Cường"] })).toEqual({
      ten: "Lê Cường",
      suyTuLead: true,
      soSaleKhac: 0,
    });
  });

  it("giữ THỨ TỰ xếp vào — con vào trước thì Sale của con đó đứng trước", () => {
    const r = suySaleCuaLop({ tenNguoiTao: null, saleTheoCon: ["Lê Cường", "Trần Bình"] });
    expect(r?.ten).toBe("Lê Cường");
  });

  it("lead chưa ai phụ trách ⇒ bỏ qua, lấy Sale kế tiếp", () => {
    expect(
      suySaleCuaLop({ tenNguoiTao: null, saleTheoCon: [null, "Trần Bình"] }),
    ).toEqual({ ten: "Trần Bình", suyTuLead: true, soSaleKhac: 0 });
  });
});

describe("[SCL-03] không suy ra được ⇒ null (để bảng in gạch)", () => {
  it("lớp cũ, chưa con nào", () => {
    expect(suySaleCuaLop({ tenNguoiTao: null, saleTheoCon: [] })).toBeNull();
  });

  it("có con nhưng lead chưa ai phụ trách", () => {
    expect(suySaleCuaLop({ tenNguoiTao: null, saleTheoCon: [null, null, "  "] })).toBeNull();
  });
});

describe("[SCL-04] ⚠️ NHIỀU Sale trong một lớp thì phải KHAI RA", () => {
  it("3 Sale khác nhau ⇒ soSaleKhac = 2, không im lặng hiện một tên", () => {
    // Hiện "Lê Cường" rồi im về hai người còn lại là nói dối bằng cách bỏ bớt: quản lý cơ
    // sở đọc bảng sẽ tưởng cả lớp là khách của một Sale.
    const r = suySaleCuaLop({
      tenNguoiTao: null,
      saleTheoCon: ["Lê Cường", "Trần Bình", "Lê Cường", "Phạm Dung"],
    });
    expect(r).toEqual({ ten: "Lê Cường", suyTuLead: true, soSaleKhac: 2 });
  });

  it("trùng tên KHÔNG bị đếm thành người khác", () => {
    const r = suySaleCuaLop({
      tenNguoiTao: null,
      saleTheoCon: ["Lê Cường", " Lê Cường ", "Lê Cường"],
    });
    expect(r?.soSaleKhac).toBe(0);
  });
});

describe("[SCL-05] ⚠️ đường GHI `createdById` — bộ trên không chạm tới", () => {
  // `suySaleCuaLop` là hàm thuần: cấy lỗi "service không ghi `createdById`" vào
  // `lib/trial/service.ts` mà mọi ca trên vẫn XANH, vì không ca nào chạm đường ghi. Canh
  // bằng lưới ghim mã nguồn (luật 11: neo hẹp, và đã cấy lại để thấy đỏ).
  const doc = (p: string) => {
    const duong = path.join(process.cwd(), p);
    expect(fs.existsSync(duong), `${duong} không còn ở chỗ cũ`).toBe(true);
    return fs.readFileSync(duong, "utf8");
  };

  it("phép quét tự kiểm: đọc được ba tệp liên quan", () => {
    for (const p of [
      "lib/trial/service.ts",
      "prisma/schema.prisma",
      "app/(admin)/admin/lop-trial/_lib/queries.ts",
    ]) {
      expect(doc(p).length).toBeGreaterThan(500);
    }
  });

  it("`createTrialClass` GHI người tạo — không nhận `actorId` rồi bỏ rơi", () => {
    expect(doc("lib/trial/service.ts")).toContain("createdById: params.actorId");
  });

  it("schema có cột `createdById` trên `TrialClassV2`", () => {
    const m = doc("prisma/schema.prisma").match(/model TrialClassV2 \{[\s\S]*?\n\}/);
    expect(m, "không tìm thấy model TrialClassV2").not.toBeNull();
    expect(m![0]).toMatch(/createdById\s+String\?/);
  });

  it("câu tra danh sách ĐỌC cả người tạo lẫn tên con — nguồn của hai cột mới", () => {
    const q = doc("app/(admin)/admin/lop-trial/_lib/queries.ts");
    expect(q).toContain("suySaleCuaLop(");
    expect(q).toContain("leadChild: {");
    expect(q).toContain("assignedTo: { select: { name: true } }");
  });

  it("bảng KHÔNG còn cột Sĩ số, và CÓ hai cột mới", () => {
    const t = doc("app/(admin)/admin/lop-trial/_components/class-table.tsx");
    // Neo vào ô tiêu đề, không phải chữ "Sĩ số" ở bất kỳ đâu — chú thích trong tệp có
    // thể nhắc lại tên cột cũ mà không phải là cột đang hiển thị.
    expect(t).not.toContain('font-semibold">Sĩ số<');
    // 23/09 — cột Sale đổi thành "Sale có case trial" (chủ dự án).
    expect(t).toContain('font-semibold">Sale có case trial<');
    expect(t).toContain('font-semibold">Học viên<');
    // Số `<th>` phải khớp `colSpan` của dòng "chưa có lớp nào", kẻo dòng đó lệch ô.
    const soTh = (t.match(/<th className/g) ?? []).length;
    const colSpan = t.match(/colSpan=\{(\d+)\}/);
    expect(colSpan, "không tìm thấy colSpan").not.toBeNull();
    expect(Number(colSpan![1])).toBe(soTh);
  });
});
