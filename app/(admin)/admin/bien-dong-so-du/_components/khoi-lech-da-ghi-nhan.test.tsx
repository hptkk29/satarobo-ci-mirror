// @vitest-environment jsdom
/**
 * [POS3-UI-*] — khối "đã ghi nhận nhưng file ghi khác" trong panel Import POS (GĐ3, docs/pos-gd3-thiet-ke.md
 * §8). Dựng THẬT component trình bày, soi chữ in ra; lưới dây nối giữ chỗ panel vẽ nó.
 *
 * Luật 12: khối này KHÔNG có nút — không có hành động nào tự động làm được ở đây (sổ KHÔNG đổi; điều
 * chỉnh đi bằng gỡ gắn / hoàn tiền của luồng hiện có).
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LechDong } from "@/lib/payments/pos/lech-da-ghi-nhan";
import { KhoiLechDaGhiNhan } from "./khoi-lech-da-ghi-nhan";

const MA = "6040f2d1b836f56e62eb37ba7af33211";

describe("[POS3-UI] khối báo lệch", () => {
  it("[POS3-UI-01] không lệch ⇒ không vẽ gì; có lệch ⇒ tiêu đề + mã + hai con số + câu 'sổ không đổi'", () => {
    const { container, unmount } = render(<KhoiLechDaGhiNhan lech={[]} />);
    expect(container.innerHTML).toBe("");
    unmount();

    const lech: LechDong[] = [
      { maGiaoDich: MA, truong: "soTien", daGhiNhan: "2.000", trongFile: "1" },
      { maGiaoDich: MA, truong: "trangThai", daGhiNhan: "Thành công", trongFile: "Thất bại" },
    ];
    render(<KhoiLechDaGhiNhan lech={lech} />);
    const khoi = screen.getByRole("region", { name: /file ghi khác/i });
    // Hai trường lệch của CÙNG một giao dịch ⇒ tiêu đề đếm 1 giao dịch.
    expect(khoi).toHaveTextContent(/1 giao dịch/);
    expect(khoi).toHaveTextContent(/sổ không đổi/i);
    // Rà đối kháng GĐ3 (#6): MỘT mục cho MỘT giao dịch — các trường lệch nằm trong mục đó, cùng đơn vị
    // với tiêu đề. Mã TRƯỚC bản vá: mỗi (giao dịch × trường) một mục, mã lặp hai lần.
    const dong = within(khoi).getAllByRole("listitem");
    expect(dong).toHaveLength(1);
    expect(dong[0]).toHaveTextContent(MA);
    expect(dong[0]).toHaveTextContent("Số tiền: đã ghi 2.000đ · file 1đ");
    expect(dong[0]).toHaveTextContent("Trạng thái: đã ghi Thành công · file Thất bại");
  });

  it("[POS3-UI-02] 25 lệch ⇒ 20 dòng + '… và 5 khác'; KHÔNG có nút nào (luật 12)", () => {
    const lech: LechDong[] = Array.from({ length: 25 }, (_, i) => ({
      maGiaoDich: `${String(i).padStart(2, "0")}${MA.slice(2)}`,
      truong: "soTien",
      daGhiNhan: "2.000",
      trongFile: "1",
    }));
    render(<KhoiLechDaGhiNhan lech={lech} />);
    const khoi = screen.getByRole("region", { name: /file ghi khác/i });
    expect(khoi).toHaveTextContent(/25 giao dịch/);
    const dong = within(khoi).getAllByRole("listitem");
    expect(dong).toHaveLength(21); // 20 giao dịch + 1 dòng "… và 5 giao dịch khác"
    expect(dong[20]).toHaveTextContent("… và 5 giao dịch khác");
    expect(within(khoi).queryAllByRole("button")).toHaveLength(0);
    expect(within(khoi).queryAllByRole("link")).toHaveLength(0);
  });

  it("[POS3-UI-03] 25 giao dịch lệch CẢ HAI trường (50 mục) ⇒ tiêu đề 25, liệt kê 20 GIAO DỊCH, '… và 5 giao dịch khác'", () => {
    // Mã TRƯỚC bản vá (đo): 15 giao dịch × 2 trường ⇒ tiêu đề "15 giao dịch", danh sách 10 mã, rồi
    // "… và 10 khác" ⇒ người đọc cộng ra 20 ≠ 15 (luật 12).
    const lech: LechDong[] = Array.from({ length: 25 }, (_, i) => `${String(i).padStart(2, "0")}${MA.slice(2)}`).flatMap(
      (ma): LechDong[] => [
        { maGiaoDich: ma, truong: "soTien", daGhiNhan: "2.000", trongFile: "1" },
        { maGiaoDich: ma, truong: "trangThai", daGhiNhan: "Thành công", trongFile: "Thất bại" },
      ],
    );
    render(<KhoiLechDaGhiNhan lech={lech} />);
    const khoi = screen.getByRole("region", { name: /file ghi khác/i });
    expect(khoi).toHaveTextContent(/25 giao dịch/);
    const dong = within(khoi).getAllByRole("listitem");
    expect(dong).toHaveLength(21);
    const maLietKe = new Set(dong.slice(0, 20).map((d) => (d.textContent ?? "").slice(0, 32)));
    expect(maLietKe.size, "20 mục = 20 giao dịch khác nhau").toBe(20);
    for (const d of dong.slice(0, 20)) {
      expect(d).toHaveTextContent("Số tiền: đã ghi 2.000đ · file 1đ");
      expect(d).toHaveTextContent("Trạng thái: đã ghi Thành công · file Thất bại");
    }
    expect(dong[20]).toHaveTextContent("… và 5 giao dịch khác");
  });

  it("[POS3-UI-W] panel vẽ khối ĐÚNG MỘT lần; KET_QUA_RONG / congKetQua lấy từ ket-qua-lo (không định nghĩa lại)", () => {
    const nguon = readFileSync(
      resolve(process.cwd(), "app/(admin)/admin/bien-dong-so-du/_components/nhap-file-pos.tsx"),
      "utf8",
    )
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(nguon.match(/<KhoiLechDaGhiNhan\b/g)?.length ?? 0).toBe(1);
    expect(nguon).toMatch(/<KhoiLechDaGhiNhan lech=\{ketQua\.lech\} \/>/);
    expect(nguon).toMatch(/import \{[^}]*\bKET_QUA_RONG\b[^}]*\btongLuotSauLo\b[^}]*\} from "@\/lib\/payments\/pos\/ket-qua-lo";/);
    // Rà đối kháng GĐ3 (#4): tổng của lượt trên màn = SỐ ĐẾM CỦA LƯỢT trong DB (`tongLuotSauLo`), không
    // cộng kết quả từng lô. Mã TRƯỚC bản vá: `tong = congKetQua(tong, r.ketQua)`.
    expect(nguon.match(/\btongLuotSauLo\(tong, r\.ketQua\)/g)?.length ?? 0).toBe(1);
    expect(nguon.match(/\bcongKetQua\(/g)?.length ?? 0).toBe(0);
    // Mã TRƯỚC bản vá: `const KET_QUA_RONG: KetQuaLoPos = {…}` + `function congKetQua(…)` ngay trong màn.
    expect(nguon.match(/const KET_QUA_RONG\b/g)?.length ?? 0).toBe(0);
    expect(nguon.match(/function congKetQua\b/g)?.length ?? 0).toBe(0);
  });
});
