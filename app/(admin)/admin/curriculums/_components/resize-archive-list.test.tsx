// @vitest-environment node
// [LR3D-R1*] Hộp xác nhận "giảm số buổi": cảnh báo CỤ THỂ cho buổi bị lưu trữ có tài liệu lắp ráp 3D.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ResizeArchiveList, type ArchiveRow } from "./resize-archive-list";

const dong = (order: number, over: Partial<ArchiveRow> = {}): ArchiveRow => ({
  id: `b${order}`,
  order,
  title: `Bài ${order}`,
  examCount: 0,
  assignmentCount: 0,
  documentCount: 0,
  hasLinks: false,
  isInUse: false,
  assemblyManual: null,
  ...over,
});
const ve = (items: ArchiveRow[]) => renderToStaticMarkup(<ResizeArchiveList items={items} />);

describe("ResizeArchiveList", () => {
  it("[LR3D-R10] không buổi nào có link ⇒ KHÔNG có khung cảnh báo lắp ráp, không dòng 'Lắp ráp 3D'", () => {
    const out = ve([dong(5), dong(6)]);
    expect(out).not.toContain("Lắp ráp 3D");
    expect(out).not.toContain('role="alert"');
    expect(out).toContain("Bài 5: Bài 5");
  });

  it("[LR3D-R11] có link ⇒ khung cảnh báo nêu SỐ buổi + từng bài, nói rõ link KHÔNG bị xoá nhưng giáo viên mất nút", () => {
    const out = ve([
      dong(5, { assemblyManual: { setName: "Alpha Set A", modelName: "03.Catapult Car" } }),
      dong(6),
      dong(7, { assemblyManual: { setName: null, modelName: null } }),
    ]);
    expect(out).toContain('role="alert"');
    expect(out).toContain("2 buổi bị lưu trữ đang có tài liệu lắp ráp 3D");
    expect(out).toContain("bài 5, 7");
    expect(out).toContain("không bị xoá");
    expect(out).toContain("không còn thấy nút");
  });

  it("[LR3D-R12] dòng của buổi có link in tên bộ · mô hình; link không tên in 'chưa đặt tên'; buổi không link không có dòng này", () => {
    const out = ve([
      dong(5, { assemblyManual: { setName: "Alpha Set A", modelName: "03.Catapult Car" } }),
      dong(6),
      dong(7, { assemblyManual: { setName: null, modelName: null } }),
    ]);
    expect(out).toContain("Lắp ráp 3D: Alpha Set A · 03.Catapult Car");
    expect(out).toContain("Lắp ráp 3D: chưa đặt tên");
    expect(out.split("Lắp ráp 3D:").length - 1).toBe(2);
  });

  it("[LR3D-R13] cảnh báo đề thi/bài tập/tài liệu cũ vẫn hiện, độc lập với lắp ráp", () => {
    const out = ve([dong(5, { hasLinks: true, examCount: 1, assignmentCount: 2, documentCount: 3 })]);
    expect(out).toContain("1 đề thi · 2 bài tập · 3 tài liệu");
    expect(out).not.toContain("Lắp ráp 3D");
  });
});
