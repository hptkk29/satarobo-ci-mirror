// @vitest-environment node
// [HSTR-*] Class Hub: đổi tab không phải chờ phần không liên quan (24/10/2026).
//
// Gốc: đổi `?tab=` là điều hướng CÙNG segment ⇒ `loading.tsx` không hiện; trang `await` hai truy vấn badge của tab Điểm danh
// TRƯỚC khi trả JSX ⇒ mọi tab chờ chúng. Nay viên thuốc badge là component async riêng, bọc `<Suspense fallback={null}>` và đưa vào
// `HubTabBar.badgeDiemDanh` (thanh tab + tab đang chọn vẽ ngay); nội dung tab nằm trong `<Suspense key=…>` có khung chờ.
//
// Hai nửa: (1) HÀNH VI của HubDiemDanhBadge + HubTabBar (con số "chưa điểm danh" đúng như bản cũ trong page.tsx);
// (2) DÂY NỐI của page.tsx — nó là RSC async đọc auth/DB nên không render được trong test thuần, nên canh bằng văn bản đã BỎ
// chú thích (chú thích giải thích bản vá chứa đúng chuỗi đang canh — bẫy luật 11).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({
  sessions: [] as { id: string }[],
  attended: [] as { sessionId: string }[],
  attendanceCalls: 0,
}));

vi.mock("@/lib/db-scope", () => ({
  actorGiangDay: (a: unknown) => a,
  withMakeupException: () => ({
    classSession: { findMany: async () => h.sessions },
    attendance: {
      findMany: async () => {
        h.attendanceCalls++;
        return h.attended;
      },
    },
  }),
}));

import { HubDiemDanhBadge } from "./hub-diem-danh-badge";
import { HubTabBar } from "./hub-tab-bar";

const actor = { id: "gv1" } as never;
const todayEnd = new Date("2026-10-24T17:00:00.000Z");

beforeEach(() => {
  h.sessions = [];
  h.attended = [];
  h.attendanceCalls = 0;
});

const ve = async () => renderToStaticMarkup(await HubDiemDanhBadge({ actor, classId: "lop1", todayEnd }));

describe("HubDiemDanhBadge", () => {
  it("[HSTR-01] badge = số buổi đã tới ngày mà CHƯA có bản ghi điểm danh (3 buổi − 1 đã điểm danh = 2)", async () => {
    h.sessions = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
    h.attended = [{ sessionId: "s1" }];
    expect(await ve()).toMatch(/<span[^>]*>2<\/span>/);
  });

  it("[HSTR-02] mọi buổi đã điểm danh ⇒ KHÔNG vẽ gì (đối chứng dương cho HSTR-01)", async () => {
    h.sessions = [{ id: "s1" }];
    h.attended = [{ sessionId: "s1" }];
    expect(await ve()).toBe("");
  });

  it("[HSTR-03] không có buổi nào trong cửa sổ ⇒ không hỏi bảng điểm danh (đỡ một lượt đi-về)", async () => {
    await ve();
    expect(h.attendanceCalls).toBe(0);
  });
});

describe("HubTabBar × badgeDiemDanh", () => {
  it("[HSTR-04] thanh tab vẽ ĐỦ 6 tab và tô đúng tab đang chọn khi viên thuốc chưa có (badgeDiemDanh = null)", () => {
    const out = renderToStaticMarkup(<HubTabBar classId="lop1" active="tai-lieu" badgeDiemDanh={null} />);
    expect(out.match(/<a /g)?.length).toBe(6);
    expect(out.match(/aria-current="page"/g)?.length).toBe(1);
    expect(out).toMatch(/aria-current="page"(?:(?!<\/a>).)*Tài liệu học phần/);
  });

  it("[HSTR-05] badgeDiemDanh thắng attendancePending; chỉ tab Điểm danh mang viên thuốc", () => {
    const out = renderToStaticMarkup(
      <HubTabBar classId="lop1" active="tai-lieu" attendancePending={9} badgeDiemDanh={<b>XYZ</b>} />,
    );
    expect(out.match(/<b>XYZ<\/b>/g)?.length).toBe(1);
    expect(out).not.toMatch(/>9</);
    expect(out).toMatch(/Điểm danh<b>XYZ<\/b>/);
  });

  it("[HSTR-06] đường số (attendancePending) vẫn vẽ viên thuốc; 0 thì không vẽ", () => {
    expect(renderToStaticMarkup(<HubTabBar classId="lop1" active="diem-danh" attendancePending={4} />)).toMatch(
      /Điểm danh<span[^>]*>4<\/span>/,
    );
    expect(renderToStaticMarkup(<HubTabBar classId="lop1" active="diem-danh" attendancePending={0} />)).not.toMatch(
      /Điểm danh<span/,
    );
  });
});

// Bỏ chú thích (dòng và khối, kể cả khối JSX) rồi mới đếm.
function maBoChuThich(f: string) {
  return readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("page.tsx — dây nối streaming", () => {
  const page = maBoChuThich("app/(teacher)/teacher/lop/page.tsx");

  it("[HSTR-W1] nội dung tab nằm trong <Suspense key=…> có khung chờ — đúng MỘT chỗ", () => {
    expect(
      page.match(/<Suspense key=\{`\$\{classId\}:\$\{activeTab\}`\} fallback=\{<HubTabSkeleton \/>\}>/g)?.length,
    ).toBe(1);
  });

  it("[HSTR-W2] viên thuốc badge đi qua <Suspense fallback={null}> RIÊNG, truyền vào HubTabBar.badgeDiemDanh — không bọc cả thanh tab", () => {
    expect(page.match(/badgeDiemDanh=\{\s*<Suspense fallback=\{null\}>\s*<HubDiemDanhBadge /g)?.length).toBe(1);
    expect(page.match(/<HubDiemDanhBadge /g)?.length).toBe(1);
    // Trang KHÔNG truyền badge dạng số tính tại chỗ nữa.
    expect(page).not.toMatch(/attendancePending=/);
  });

  it("[HSTR-W3] thân trang KHÔNG còn await truy vấn điểm danh ở nhánh hub (chỉ còn ở danh sách lớp)", () => {
    // Trước: hub (b) + danh sách (a) mỗi nơi một `xdb.attendance.findMany`. Còn đúng MỘT — của danh sách lớp.
    expect(page.match(/xdb\.attendance\.findMany/g)?.length).toBe(1);
  });

  it("[HSTR-W4] tab Tài liệu nhận sẵn khoá của lớp từ câu đọc lớp của trang", () => {
    expect(page.match(/courseIdDaBiet=\{cls\.courseId\}/g)?.length).toBe(1);
    expect(page.match(/courseId: true,/g)?.length).toBe(1);
  });
});
