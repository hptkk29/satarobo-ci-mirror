// @vitest-environment node
/**
 * [NHH-HC-01] — BẢNG "hàng chờ nào chặn khoá kỳ / mức nghiêm trọng" (04 §10.5). THUẦN.
 *
 * Vì sao có tệp này — cấy 08/10: đưa `UNRESOLVED_BENEFICIARY` ra khỏi tập mã KHÔNG chặn (`hangChoChanKy` trả `true` cho nó) ⇒ 0 ca đỏ
 * ở cả bộ thuần lẫn bộ DB. Mọi chỗ gọi hôm nay đều truyền `blockingPeriodId = null` cho hàng chờ treo nên hành vi không đổi — bảng này là
 * LỚP PHÒNG THỨ HAI (cùng CHECK của DB), và một chỗ gọi mới truyền kỳ cho hàng chờ treo sẽ khoá kỳ vĩnh viễn nếu bảng sai.
 *
 * Bảng được chép từ ĐẶC TẢ (04 §10.5), không từ mã: sửa mã cho khớp mã thì ca này vô nghĩa.
 */
import { CommissionHoldCode } from "@prisma/client";
import { describe, it, expect } from "vitest";

import { hangChoChanKy, mucCuaHangCho, type MaHold } from "./hang-cho";

const CHAN: readonly MaHold[] = [
  "CHUA_GAN_CON",
  "CHO_HOC_VIEN",
  "CAP_EXCEEDED",
  "POLICY_OVERLAP",
  "MANUAL_REVIEW_REQUIRED",
  "PENDING_REGULATION",
  "INTERNAL_TRANSFER",
  "NEGATIVE_WITHOUT_ORIGIN",
  "INPUT_DRIFT",
  "NO_ORG_UNIT",
  "PAYMENT_WITHDRAWN",
];
const KHONG_CHAN: readonly MaHold[] = ["UNRESOLVED_BENEFICIARY", "NEGATIVE_BALANCE"];
const MEM: readonly MaHold[] = ["CHUA_GAN_CON", "CHO_HOC_VIEN", "UNRESOLVED_BENEFICIARY", "NEGATIVE_BALANCE"];

describe("[NHH-HC-01] bảng hàng chờ (04 §10.5)", () => {
  it("[NHH-HC-01] tự-kiểm: bảng đặc tả phủ ĐỦ mọi mã của enum (thêm mã mới mà chưa phân loại ⇒ đỏ ở đây, không âm thầm rơi vào 'chặn')", () => {
    expect([...CHAN, ...KHONG_CHAN].sort()).toEqual(Object.values(CommissionHoldCode).sort());
  });

  it("[NHH-HC-01] chặn khoá kỳ: đúng 11 mã; KHÔNG chặn: UNRESOLVED_BENEFICIARY và NEGATIVE_BALANCE", () => {
    for (const m of CHAN) expect(hangChoChanKy(m), `${m} chặn khoá`).toBe(true);
    for (const m of KHONG_CHAN) expect(hangChoChanKy(m), `${m} KHÔNG chặn khoá`).toBe(false);
  });

  it("[NHH-HC-01] mức: bốn mã mềm (CHUA_GAN_CON · CHO_HOC_VIEN · UNRESOLVED_BENEFICIARY · NEGATIVE_BALANCE), còn lại cứng", () => {
    for (const m of [...CHAN, ...KHONG_CHAN]) expect(mucCuaHangCho(m), m).toBe(MEM.includes(m) ? "SOFT" : "HARD");
  });
});
