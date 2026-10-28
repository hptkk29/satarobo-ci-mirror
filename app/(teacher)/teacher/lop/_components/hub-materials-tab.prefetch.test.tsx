// @vitest-environment node
// [TLHP-10] Tab "Tài liệu học phần": nút "Mở trình chiếu" KHÔNG được prefetch.
//
// Đo TEST 25/10/2026 (lớp có 3 bài gắn SCORM): chỉ mở tab đã phát thêm 3 request `/teacher/scorm/play/…` (RSC 11 so với 8). Prefetch
// không chạy thân trang play (0 dòng ScormAccessLog, không cấp vé, không làm nóng R2) nhưng chạy layout phía máy chủ cho từng nút
// thấy được trong khung nhìn — với lớp 48 bài có SCORM là hàng chục lượt dựng layout giáo viên chưa chắc ai bấm.
//
// `renderToStaticMarkup` không in `prefetch` ra HTML, nên thay `next/link` bằng bản ghi lại prop để khẳng định HÀNH VI (nút nào
// trỏ /scorm/play thì phải prefetch=false), thay vì grep mã nguồn.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({ lessons: [] as Row[], scormPkgs: [] as Row[] }));

vi.mock("next/link", () => ({
  default: (p: { href: string; prefetch?: boolean; children?: ReactNode }) => (
    <a href={p.href} data-prefetch={String(p.prefetch)}>
      {p.children}
    </a>
  ),
}));
vi.mock("@/lib/flags", () => ({ isScormEnabled: () => true }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("@/lib/scorm/dem-dia", () => ({ lamNongGoi: async () => undefined }));
vi.mock("@/lib/db-scope", () => ({
  actorGiangDay: (a: unknown) => a,
  scopedDb: () => ({
    class: { findUnique: async () => ({ courseId: "c1" }) },
    curriculum: { findFirst: async () => ({ name: "Sata3", lessons: h.lessons }) },
    document: { findMany: async () => [] },
    scormPackage: { findMany: async () => h.scormPkgs },
    classSession: { findMany: async () => [] },
  }),
}));

import { HubMaterialsTab } from "./hub-materials-tab";

const bai = (id: string, order: number): Row => ({
  id,
  order,
  title: `Bài ${order}`,
  objectives: [],
  assemblyManualUrl: null,
  assemblyManualSetName: null,
  assemblyManualModelName: null,
});

beforeEach(() => {
  h.lessons = [bai("b1", 1), bai("b2", 2), bai("b3", 3)];
  h.scormPkgs = [
    { id: "sc1", name: "Giáo án 1", lessonId: "b1", storagePrefix: "scorm/sc1/" },
    { id: "sc2", name: "Giáo án 2", lessonId: "b2", storagePrefix: "scorm/sc2/" },
    { id: "sc3", name: "Giáo án 3", lessonId: "b3", storagePrefix: "scorm/sc3/" },
  ];
});

describe("HubMaterialsTab × prefetch trình chiếu", () => {
  it("[TLHP-10] mọi nút 'Mở trình chiếu' (trỏ /scorm/play) đều prefetch=false", async () => {
    const out = renderToStaticMarkup(await HubMaterialsTab({ actor: { id: "gv1" } as never, classId: "lop1", courseIdDaBiet: "c1" }));
    const nut = [...out.matchAll(/<a href="([^"]*)" data-prefetch="([^"]*)"/g)].filter((m) => (m[1] ?? "").includes("/scorm/play/"));
    // Đối chứng dương: có đủ ba nút để kiểm (không có nút nào thì ca này xanh vì lý do sai).
    expect(nut).toHaveLength(3);
    for (const m of nut) expect(m[2]).toBe("false");
  });
});
