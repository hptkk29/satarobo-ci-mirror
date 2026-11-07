// [GT-*] ĐẢO 20/10/2026 — phân công là GÁN THẲNG: "đã có hiệu lực" hỏi MỘT hàm `daGan` (theo trạng thái), không hỏi bản ghi
// xác nhận của giáo viên. DB thật (tạo ACCEPTED · đổi lịch giữ trạng thái): `tests/cham-cong/parttime-phan-cong.spec.ts`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { daGan, trangThaiNhanLuc } from "./phan-cong";

describe("[GT] daGan", () => {
  it("[GT-01] ACCEPTED / ACTIVE / COMPLETED là đã gán; chờ nhận / đề xuất / kết thúc thì không", () => {
    const co = (["ACCEPTED", "ACTIVE", "COMPLETED"] as const).map((status) => daGan({ status }));
    const khong = (["WAITING_ACCEPTANCE", "PROPOSED", "DECLINED", "REPLACED", "CANCELLED"] as const).map((status) => daGan({ status }));
    expect(co).toEqual([true, true, true]);
    expect(khong).toEqual([false, false, false, false, false]);
  });
  it("[GT-02] buổi chỉ có GV chính ĐÃ GÁN (không bản ghi xác nhận nào) ⇒ đủ người", () => {
    expect(trangThaiNhanLuc([{ role: "MAIN_TEACHER", status: "ACCEPTED", daNhan: daGan({ status: "ACCEPTED" }) }], false)).toBe("STAFFING_CONFIRMED");
  });
});

// Lưới ghim dây nối: mọi nơi đọc "đã nhận" của phân công buổi phải đi qua `daGan`. Mã TRƯỚC 20/10 ở cả bốn chỗ:
//   daNhan: xacNhanConHieuLuc(x.acceptances, x.assignmentVersion) != null,
// — với phân công gán thẳng (không bản ghi xác nhận) chỗ nào còn dạng đó thì công bị chặn CHUA_NHAN mà không ca hành vi mock nào đỏ.
const NOI_DOC = ["lib/parttime/bang-chung-cong-db.ts", "lib/parttime/bang-phan-cong.ts", "lib/parttime/cutover-db.ts", "lib/parttime/phan-cong-db.ts"];
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("[GT-W] dây nối daGan", () => {
  it.each(NOI_DOC)("[GT-W1] %s suy daNhan bằng daGan, không bằng xacNhanConHieuLuc", (tep) => {
    const s = bo(readFileSync(resolve(process.cwd(), tep), "utf8"));
    expect(s.match(/daNhan:\s*daGan\(/g)?.length ?? 0).toBe(1);
    expect(s).not.toMatch(/xacNhanConHieuLuc\(/);
  });
  it("[GT-W2] phanCongVaoBuoi tạo ở trạng thái ACCEPTED; đổi lịch không đưa về WAITING_ACCEPTANCE", () => {
    const s = bo(readFileSync(resolve(process.cwd(), "lib/parttime/phan-cong-db.ts"), "utf8"));
    // Chỉ xét thân hai hàm: tệp còn chứa lệnh dọn lời mời cũ (where status WAITING_ACCEPTANCE) và "Sửa buổi đã qua".
    const than = (ten: string) => {
      const i = s.indexOf(`async function ${ten}(`);
      return s.slice(i, s.indexOf("\n}", i));
    };
    expect(than("phanCongVaoBuoi").match(/status:\s*"ACCEPTED",\s*replacesAssignmentId/g)?.length ?? 0).toBe(1);
    expect(than("phanCongVaoBuoi")).not.toMatch(/"WAITING_ACCEPTANCE"/);
    expect(than("doiLichMot")).not.toMatch(/status:\s*"WAITING_ACCEPTANCE"/);
  });
});
