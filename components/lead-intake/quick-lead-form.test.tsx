// @vitest-environment jsdom
// components/lead-intake/quick-lead-form.test.tsx — biểu mẫu nhập khách ĐIỀN SẴN.
//
// Vì sao phải render thật chứ không chỉ test hàm thuần: `useState(...)` chỉ đọc giá
// trị khởi tạo ở LƯỢT DỰNG ĐẦU TIÊN. Một bản hiện thực "đúng trên giấy" (truyền prop
// vào state) vẫn có thể hỏng câm nếu prop tới sau lượt dựng đầu, và không có kiểu nào
// bắt được chuyện đó — chỉ có màn hình thật mới bắt.
//
// Bối cảnh: chốt 9.13/9.5 của đợt ZaloCRM — từ khung chat bấm "Tạo khách" thì nhảy sang
// `/nhap-khach-hang?phone=…&name=…`. Không có prop `initial` thì cú nhảy đó đưa người
// tư vấn tới một biểu mẫu TRẮNG và họ phải gõ lại số vừa nhìn thấy trên màn chat.
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Biểu mẫu import Server Action (`"use server"`) ở tầng module — kéo nguyên `@/lib/db`
// vào jsdom. Chặn ở đây; lượt gửi thật là việc của test tầng action.
vi.mock("@/lib/lead/intake/quick-form-action", () => ({
  createInternalLeadAction: vi.fn(async () => ({ ok: true, leadId: "lead-1" })),
}));

import { QuickLeadForm } from "@/components/lead-intake/quick-lead-form";
import { docPrefillTuQuery } from "@/lib/lead/intake/prefill";

const CENTERS = [
  { code: "CS1", name: "Cơ sở 1 — 211 Nguyễn Hữu Thọ" },
  { code: "CS2", name: "Cơ sở 2 — 114 Hoàng Diệu" },
];

function o(nhan: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return screen.getByLabelText(nhan) as HTMLInputElement;
}

/**
 * Các ô của biểu mẫu — dùng để khẳng định "trắng hoàn toàn".
 *
 * 03/09/2026 (bản trên `main`) — ô "Tên con" ĐƠN LẺ đã thay bằng khối NHIỀU CON, mỗi bé
 * một dòng với nhãn `Tên bé thứ N`. Ca này đo "form giống hệt EMPTY", nên đo ô đầu tiên
 * của khối đó là đủ; số dòng con do `conMoi()` quyết, không phải việc của bộ ca này.
 */
const MOI_O = [
  "Tên phụ huynh",
  "SĐT phụ huynh",
  "Tên bé thứ 1",
  "Nguồn",
  "Link Facebook",
  "Cơ sở phụ huynh chọn",
  "Ghi chú",
];

describe("[ZC-PF] QuickLeadForm điền sẵn", () => {
  it("[ZC-PF-01] initial.phone điền sẵn vào ô SĐT", () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} initial={{ phone: "0905123456" }} />);
    expect(o("SĐT phụ huynh").value).toBe("0905123456");
  });

  it("[ZC-PF-01b] initial.parentName điền sẵn vào ô tên phụ huynh", () => {
    render(
      <QuickLeadForm centers={CENTERS} courses={[]} initial={{ phone: "0905123456", parentName: "Chị An" }} />,
    );
    expect(o("Tên phụ huynh").value).toBe("Chị An");
    expect(o("SĐT phụ huynh").value).toBe("0905123456");
  });

  it("[ZC-PF-01c] có giá trị điền sẵn ⇒ nút Lưu KHÔNG còn bị khoá", () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} initial={{ phone: "0905123456" }} />);
    expect(screen.getByRole("button", { name: /Lưu và nhập phiếu tiếp/ })).not.toBeDisabled();
  });

  it("[ZC-PF-02] không truyền initial ⇒ form giống hệt EMPTY và nút Lưu bị khoá", () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} />);
    for (const nhan of MOI_O) expect(o(nhan).value).toBe("");
    expect(screen.getByRole("button", { name: /Lưu và nhập phiếu tiếp/ })).toBeDisabled();
  });

  it("[ZC-PF-02b] initial rỗng ({}) cho kết quả y hệt không truyền gì", () => {
    render(<QuickLeadForm centers={CENTERS} courses={[]} initial={{}} />);
    for (const nhan of MOI_O) expect(o(nhan).value).toBe("");
  });

  it("[ZC-PF-03] SĐT trong query không hợp lệ ⇒ ô để trống, không đổ chuỗi rác", () => {
    // Đúng đường đi thật: query → hàm thuần → prop. Không dựng tay giá trị prop,
    // vì chỗ hỏng nằm ở mối nối giữa hai tầng.
    render(
      <QuickLeadForm
        centers={CENTERS} courses={[]}
        initial={docPrefillTuQuery({ phone: "khong-phai-so", name: "Chị An" })}
      />,
    );
    expect(o("SĐT phụ huynh").value).toBe("");
    expect(o("Tên phụ huynh").value).toBe("Chị An");
  });

  it("[ZC-PF-03b] initial KHÔNG chạm được các ô khác (chỉ tên + SĐT đi qua query)", () => {
    render(
      <QuickLeadForm
        centers={CENTERS} courses={[]}
        initial={docPrefillTuQuery({ phone: "0905123456", note: "rac", centerCode: "CS9" })}
      />,
    );
    expect(o("Ghi chú").value).toBe("");
    expect(o("Cơ sở phụ huynh chọn").value).toBe("");
  });
});
