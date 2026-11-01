// lib/parttime/cong-viec-hop-le-an-toan.ts — cửa vào AN TOÀN cho `coSoCoViecParttime` (H1), dùng ở đường ghi lượt (`timelog.ts`) và
// đường tính lại ngày công (`recompute.ts`).
//   · Công tắc ATTENDANCE_CONTEXT TẮT mọi nơi ⇒ tập rỗng NGAY — không nạp bộ đọc P4, không câu tra nào chạm bảng Parttime.
//   · Bộ đọc nạp ĐỘNG: nó kéo `server-only` (P4), mà `timelog` / `recompute` còn được script `tsx` nhập (vd `tinh-lai-mot-ngay.ts`).
//   · Lỗi bất kỳ (kể cả lỗi nạp) ⇒ tập rỗng = luật cờ cũ, không bao giờ làm hỏng lượt chấm công / lần tính lại.
import { congTacBatODau } from "./cong-tac";

export async function coSoCoViecParttimeAnToan(p: { userId: string; workDate: Date; now: Date }): Promise<Set<string>> {
  try {
    if (!(await congTacBatODau("ATTENDANCE_CONTEXT"))) return new Set();
    const { coSoCoViecParttime } = await import("./cong-viec-hop-le-db");
    return await coSoCoViecParttime(p);
  } catch (e) {
    console.error("[coSoCoViecParttime] lỗi — giữ luật cờ CHAM_NGOAI_LICH cũ", e);
    return new Set();
  }
}
