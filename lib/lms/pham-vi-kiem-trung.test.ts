// [PVK] `phamViKiemTrung` — một thao tác trên buổi chỉ bị CHẶN vì thứ chính nó làm đổi (09/10/2026).
//
// Sự cố: duyệt đơn "Dạy thay" (chỉ đổi GV) bị chặn "Trùng phòng" vì buổi đang nằm sẵn trong
// một trùng phòng có từ trước (prod: CS1-201, CN 09:45, hai lớp × 43 tuần). Tầng DB đầy đủ:
// `tests/nen/day-thay-trung-phong.spec.ts` [DTP-*].
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { phamViKiemTrung } from "@/lib/lms/scheduling";
import { WR_KIND_GIAI_THICH } from "@/lib/work-request";

const BUOI = { roomId: "R201", teacherId: "GV_A" };

describe("[PVK] phamViKiemTrung", () => {
  it("[PVK-01] chỉ đổi GV, giờ + phòng giữ nguyên ⇒ chỉ chặn theo GV", () => {
    expect(phamViKiemTrung({ truoc: BUOI, sau: { ...BUOI, teacherId: "GV_DAT" }, doiGio: false })).toEqual({
      chanPhong: false,
      chanGv: true,
    });
  });

  it("[PVK-02] chỉ đổi phòng ⇒ chỉ chặn theo phòng", () => {
    expect(phamViKiemTrung({ truoc: BUOI, sau: { ...BUOI, roomId: "R203" }, doiGio: false })).toEqual({
      chanPhong: true,
      chanGv: false,
    });
  });

  it("[PVK-03] đổi giờ ⇒ chặn cả hai, kể cả khi phòng/GV giữ nguyên", () => {
    expect(phamViKiemTrung({ truoc: BUOI, sau: BUOI, doiGio: true })).toEqual({ chanPhong: true, chanGv: true });
  });

  it("[PVK-04] buổi MỚI (truoc = null) ⇒ chặn cả hai", () => {
    expect(phamViKiemTrung({ truoc: null, sau: BUOI, doiGio: false })).toEqual({ chanPhong: true, chanGv: true });
  });

  it("[PVK-05] không đổi gì ⇒ không chặn gì (sửa chủ đề/ghi chú không bị trùng có sẵn chặn)", () => {
    expect(phamViKiemTrung({ truoc: BUOI, sau: BUOI, doiGio: false })).toEqual({ chanPhong: false, chanGv: false });
  });

  it("[PVK-06] không có phòng / GV sau thao tác ⇒ không có gì để chặn", () => {
    expect(phamViKiemTrung({ truoc: null, sau: { roomId: null, teacherId: null }, doiGio: true })).toEqual({
      chanPhong: false,
      chanGv: false,
    });
  });
});

// ── Lưới ghim dây nối ────────────────────────────────────────────────────────────────────
// Trước 09/10 luật chặn + câu "Trùng phòng" chép tay ở HAI nơi (`adjust.ts:221`,
// `sessions/_actions.ts:73`). Nay cả hai phải đi qua `kiemTrungThaoTacBuoi`; một bản chép lại
// là hai nơi lệch luật lần nữa — và màn sửa buổi không có ca DB nào canh (server action cần đăng nhập).
const boChuThich = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));

describe("[DTP-W] mọi đường sửa buổi đi qua MỘT hàm kiểm trùng", () => {
  it.each(["lib/classes/adjust.ts", "app/(admin)/admin/sessions/_actions.ts"])(
    "[DTP-W1] %s gọi kiemTrungThaoTacBuoi đúng 1 lần, không tự gọi detectSessionConflicts, không tự viết câu trùng",
    (p) => {
      const src = doc(p);
      expect(src.match(/kiemTrungThaoTacBuoi\(/g)?.length ?? 0).toBe(1);
      expect(src).not.toMatch(/detectSessionConflicts\(/);
      expect(src).not.toMatch(/Trùng phòng|Trùng lịch giáo viên/);
    },
  );

  it("[DTP-W2] chữ \"i\" của Dạy thay không còn hứa kiểm phòng (luật 12)", () => {
    const khiDuyet = WR_KIND_GIAI_THICH.SUB_TEACH.khiDuyet;
    expect(khiDuyet).not.toMatch(/kiểm trùng lịch giáo viên và phòng/);
    expect(khiDuyet).toMatch(/không kiểm lại phòng/);
    expect(khiDuyet).toMatch(/cảnh báo/);
  });
});
