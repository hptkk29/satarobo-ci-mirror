// @vitest-environment jsdom
// ModuleNav là thứ THAY THẾ 10 mục sidebar, nên hai lỗi ở đây đắt hơn ở màn thường:
// bày tab của màn người ta không vào được (dead-link mà không bộ test nào khác bắt được, vì
// ModuleNav không nằm trong `sidebar.tsx`), và làm rơi kỳ/khối khi chuyển tab — đúng bug cũ của
// `date-nav-input.tsx`. Ba nhóm test dưới ghim đúng ba thứ đó.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ModuleAction, ModuleScope, ScopeBlock } from "@/lib/cham-cong/module-scope";
import { ModuleNav } from "./module-nav";

// next/link cần router context của App Router; ở đây chỉ cần cái thẻ <a> để đọc href.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const ALL: ModuleAction[] = [
  "hr_attendance:view",
  "hr_attendance:assign",
  "hr_attendance:config",
  "hr_attendance:approve",
  "hr_attendance:adjust",
  "hr_attendance:close-period",
  "hr_attendance:export",
];

/** ModuleScope giả — cố ý KHÔNG nhập `moduleScopeFrom`: file đó kéo theo Prisma. */
function fakeScope(spec: Record<string, ModuleAction[]>): ModuleScope {
  const blocks: ScopeBlock[] = Object.entries(spec).map(([id, actions]) => {
    const perms = {} as Record<ModuleAction, boolean>;
    for (const a of ALL) perms[a] = actions.includes(a);
    return { id, code: id.toUpperCase(), label: id.toUpperCase(), perms };
  });
  return {
    blocks,
    has: (a, c) => (c ? (blocks.find((b) => b.id === c)?.perms[a] ?? false) : false),
    blocksWith: (a) => blocks.filter((b) => b.perms[a]),
    any: (a) => blocks.some((b) => b.perms[a]),
    pick: (c, a) => {
      const ok = blocks.filter((b) => b.perms[a]);
      return ok.find((b) => b.id === c) ?? ok[0] ?? null;
    },
  };
}

const CTX = { ky: "2026-09", coSo: "cs1", date: "2026-09-09" };

function hrefOf(label: string): string {
  return screen.getByRole("link", { name: label }).getAttribute("href") ?? "";
}

describe("ModuleNav — lọc tab theo quyền", () => {
  it("chỉ có approve ⇒ chỉ hiện Đơn từ (không bày màn không vào được)", () => {
    render(<ModuleNav active="don" scope={fakeScope({ cs1: ["hr_attendance:approve"] })} ctx={CTX} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Đơn từ" })).toBeInTheDocument();
  });

  it("không có approve ⇒ ẩn Đơn từ; view ở một khối vẫn đủ cho 9 tab còn lại", () => {
    render(
      <ModuleNav active="ngay" scope={fakeScope({ cs1: ["hr_attendance:view"] })} ctx={CTX} />,
    );
    expect(screen.queryByRole("link", { name: "Đơn từ" })).toBeNull();
    // Bảng công ngày · Lưới phân ca · Bảng công tháng · Kỳ công & chốt · Nội quy & thống kê ·
    // Công dạy · Nghỉ bù · Đối soát · Cấu hình. (Nghỉ bù thêm 08/10/2026 — đợt 8 đơn từ.)
    // Đếm bằng SỐ chứ không bằng tên để test không phải sửa mỗi lần đổi nhãn — nhưng khi con số
    // này đổi thì phải đổi có chủ đích, đúng như lần thêm tab thống kê 07/09.
    expect(screen.getAllByRole("link")).toHaveLength(9);
  });

  it("không quyền nào ⇒ không render gì (nav rỗng là nhiễu, không phải điều hướng)", () => {
    const { container } = render(<ModuleNav active="ngay" scope={fakeScope({ cs1: [] })} ctx={CTX} />);
    expect(container.querySelector("nav")).toBeNull();
  });

  it("Cấu hình trỏ Mã ca khi có config, rơi về Loại nghỉ khi chỉ có view", () => {
    const { unmount } = render(
      <ModuleNav
        active="ngay"
        scope={fakeScope({ cs1: ["hr_attendance:view", "hr_attendance:config"] })}
        ctx={CTX}
      />,
    );
    expect(hrefOf("Cấu hình")).toContain("/cham-cong/danh-muc-ca");
    unmount();
    render(<ModuleNav active="ngay" scope={fakeScope({ cs1: ["hr_attendance:view"] })} ctx={CTX} />);
    expect(hrefOf("Cấu hình")).toContain("/cham-cong/loai-nghi");
  });
});

describe("ModuleNav — giữ ngữ cảnh trong href", () => {
  const scope = fakeScope({
    cs1: ["hr_attendance:view", "hr_attendance:assign", "hr_attendance:approve"],
    cs2: ["hr_attendance:view"],
  });

  it("mỗi tab mang đúng tham số của nó (ngày cho bảng công, kỳ cho lưới/kỳ/đối soát)", () => {
    render(<ModuleNav active="ngay" scope={scope} ctx={CTX} />);
    expect(hrefOf("Bảng công ngày")).toBe("/cham-cong?coSo=cs1&date=2026-09-09");
    expect(hrefOf("Lưới phân ca")).toBe("/cham-cong/phan-ca?ky=2026-09&coSo=cs1");
    expect(hrefOf("Kỳ công & chốt")).toBe("/cham-cong/ky-cong?ky=2026-09&coSo=cs1");
    expect(hrefOf("Đối soát")).toBe("/cham-cong/doi-soat?ky=2026-09&coSo=cs1");
    expect(hrefOf("Đơn từ")).toBe("/don-tu?coSo=cs1");
  });

  it("khối đang xem KHÔNG dùng được ở tab đích ⇒ bỏ ?coSo thay vì đẩy sang bảng rỗng", () => {
    render(<ModuleNav active="ngay" scope={scope} ctx={{ ...CTX, coSo: "cs2" }} />);
    expect(hrefOf("Bảng công ngày")).toBe("/cham-cong?coSo=cs2&date=2026-09-09");
    expect(hrefOf("Đơn từ")).toBe("/don-tu"); // cs2 không có quyền duyệt
  });
});

describe("ModuleNav — tab đang mở", () => {
  it("đúng một link mang aria-current=page", () => {
    render(
      <ModuleNav
        active="ky"
        scope={fakeScope({ cs1: ["hr_attendance:view", "hr_attendance:approve"] })}
        ctx={CTX}
      />,
    );
    const current = screen.getAllByRole("link").filter((a) => a.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("Kỳ công & chốt");
  });
});
