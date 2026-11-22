// Ca [PVD-*] — phạm vi nhìn của danh sách đơn. Thuần, không DB.
//
// 🔴 Chủ dự án 25/09/2026: *"nhớ rule sale nào thì thấy đơn hàng của sale đó"*.
//
// ⚠️ Ca đắt nhất của bộ này là `[PVD-03]` — KẾ TOÁN CƠ SỞ. Bản nháp đầu siết theo
// "không có `orders:manage` ⇒ chỉ thấy đơn của mình" và nó làm màn hình của kế toán
// **trắng trơn**: họ không tạo đơn bao giờ nên "đơn của mình" là tập rỗng. Không lỗi nào
// nổ, không ca nào đỏ — chỉ có một người mở danh sách ra và không thấy gì.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { phamViDon, loPhamViDon, moTaPhamVi } from "./pham-vi-don";

const TOI = "u-sale-1";

/** Ba vai thật, đo từ `prisma/seed-roles.ts` ngày 25/09/2026. */
const VAI = {
  quanLy: { canManage: true, canCreate: true, userId: TOI },
  sale: { canManage: false, canCreate: true, userId: TOI },
  keToanCoSo: { canManage: false, canCreate: false, userId: TOI },
};

describe("[PVD-01] Quản lý / Kế toán hội sở — thấy tất cả", () => {
  it("có `orders:manage` ⇒ TAT_CA, không thêm điều kiện `where` nào", () => {
    const pv = phamViDon(VAI.quanLy);
    expect(pv).toEqual({ kieu: "TAT_CA" });
    expect(loPhamViDon(pv)).toBeNull();
    expect(moTaPhamVi(pv)).toBeNull();
  });
});

describe("[PVD-02] Sale — chỉ đơn gắn lead MÌNH ĐANG PHỤ TRÁCH", () => {
  it("có `orders:create`, KHÔNG có `orders:manage` ⇒ lọc theo `lead.assignedToId`", () => {
    const pv = phamViDon(VAI.sale);
    expect(pv).toEqual({ kieu: "THEO_LEAD", userId: TOI });
    expect(loPhamViDon(pv)).toEqual({ lead: { assignedToId: TOI } });
  });

  it("lọc theo LEAD chứ KHÔNG theo `createdById` — chốt 25/09/2026", () => {
    // Hệ quả cố ý: bàn giao lead đi thì sale cũ thôi thấy đơn mình từng lập; quản lý lập
    // đơn hộ cho khách của sale thì sale VẪN thấy. Cùng nguyên tắc với cổng tạo đơn:
    // "nhận lead phải đi qua đường phân công".
    const lo = loPhamViDon(phamViDon(VAI.sale));
    expect(JSON.stringify(lo)).not.toContain("createdById");
    expect(JSON.stringify(lo)).toContain("assignedToId");
  });

  it("màn hình PHẢI nói ra là đang bị thu hẹp", () => {
    // Im lặng ở đây là để sale tưởng hệ thống mất đơn — hoặc lập lại một đơn thứ hai.
    expect(moTaPhamVi(phamViDon(VAI.sale))).toBeTruthy();
  });
});

describe("[PVD-03] KẾ TOÁN CƠ SỞ — KHÔNG được siết, đây là ca dễ hỏng nhất", () => {
  it("không tạo đơn bao giờ ⇒ vẫn thấy TẤT CẢ đơn trong cơ sở", () => {
    // Nếu ca này đỏ thì bản vá vừa xoá trắng màn hình của người đi đối soát tiền.
    const pv = phamViDon(VAI.keToanCoSo);
    expect(pv).toEqual({ kieu: "TAT_CA" });
    expect(loPhamViDon(pv)).toBeNull();
  });

  it("đối chứng DƯƠNG: cùng lúc đó Sale VẪN bị siết", () => {
    // Luật 11 — một ca chỉ khẳng định "không bị siết" sẽ ĐẠT kể cả khi tính năng siết
    // hỏng hoàn toàn. Phải đo cả hai đầu trong cùng một ca.
    expect(phamViDon(VAI.keToanCoSo).kieu).toBe("TAT_CA");
    expect(phamViDon(VAI.sale).kieu).toBe("THEO_LEAD");
  });
});

describe("[PVD-05] DÂY NỐI — `queryOrders` phải THẬT SỰ cắm phạm vi vào `where`", () => {
  // ⚠️ VÌ SAO CẦN LƯỚI GHIM MÃ NGUỒN Ở ĐÂY: `phamViDon`/`loPhamViDon` là hàm thuần, test
  // chúng bao nhiêu cũng xanh — trong khi con bug nguy hiểm nhất là **chỗ gọi quên đẩy
  // mảnh `where` vào câu tra**. Khi đó mọi ca ở trên vẫn xanh, không lỗi biên dịch, và
  // hậu quả là sale đọc được đơn của nhau. Cùng họ với `[DS-01b]` (CLAUDE.md, mẫu "lưới
  // ghim mã nguồn").
  //
  // Mã TRƯỚC bản vá 25/09: `queryOrders` chỉ có `scopedDb` (cách ly CƠ SỞ), không có
  // tầng lọc theo người phụ trách nào cả.
  const NGUON = "app/(admin)/admin/orders/_actions.ts";

  /** Bỏ chú thích TRƯỚC khi đếm — khối giải thích bản vá có nhắc đúng các tên đang tìm. */
  function boChuThich(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  const src = boChuThich(readFileSync(resolve(process.cwd(), NGUON), "utf8"));

  it("gọi `phamViDon(` đúng MỘT lần", () => {
    // Hai lần là hai phạm vi trên cùng một màn — con số trên chip và tập dòng trong bảng
    // sẽ nói hai điều khác nhau.
    expect(src.match(/phamViDon\(/g) ?? []).toHaveLength(1);
  });

  it("kết quả `loPhamViDon(` được ĐẨY VÀO điều kiện, không chỉ tính rồi bỏ đó", () => {
    expect(src).toMatch(/loPhamViDon\(/);
    // Neo vào LUẬT (có nhánh "khác null thì thêm vào AND"), không neo vào cách viết một
    // dòng cụ thể — xem bài học `[NDC-07]`/`[QCS-03]` trong CLAUDE.md.
    expect(src).toMatch(/if\s*\(\s*loPv\s*\)\s*AND\.push\(/);
  });

  it("con số `soChoDuyet` cũng đếm TRONG phạm vi ấy", () => {
    // Đếm ngoài phạm vi là chip nói "7 chờ duyệt" trong khi sale chỉ mở được 2 — và con
    // số ấy còn tiết lộ có bao nhiêu đơn của người khác.
    expect(src).toMatch(/loPv\s*\?\s*\[loPv\]\s*:\s*\[\]/);
  });
});

describe("[PVD-04] `canManage` thắng `canCreate`", () => {
  it("có cả hai ⇒ TAT_CA (không rơi nhầm xuống nhánh sale)", () => {
    expect(phamViDon({ canManage: true, canCreate: true, userId: TOI }).kieu).toBe("TAT_CA");
  });
});
