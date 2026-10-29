import "server-only";
// lib/ai-lead/dich-vu/nen.ts — VIỆC NỀN SAU KHI ĐÃ TRẢ LỜI Agent (thông báo · tự tạo lead).
//
// Vì sao KHÔNG làm trước khi trả lời: việc nền có thể ĐỌC CRM (tự tạo lead gọi ingest, ingest kiểm trùng). Làm trong đường phản hồi thì thời gian trả lời
// lộ "khách đã có trong CRM hay chưa" dù từng byte phản hồi giống nhau (N1). `after()` của Next chạy SAU khi phản hồi đã gửi.
//
// `after()` NÉM khi gọi ngoài phạm vi một request (vitest gọi thẳng handler) ⇒ lùi về chạy ngay và chờ qua `doiViecNen()` (test).
import { after } from "next/server";
import { maLoiNoiBo } from "../loi-he-thong";

export type LenLichNen = (viec: () => Promise<void>) => void;

const dangChay = new Set<Promise<void>>();

async function chayAnToan(viec: () => Promise<void>): Promise<void> {
  try {
    await viec();
  } catch (err) {
    console.error(`[ai-lead:nen] viec nen loi loi=${maLoiNoiBo(err)}`);
  }
}

/** Mặc định của route. */
export const lenLichSauPhanHoi: LenLichNen = (viec) => {
  try {
    after(() => chayAnToan(viec));
  } catch {
    const p = chayAnToan(viec).finally(() => dangChay.delete(p));
    dangChay.add(p);
  }
};

/** Chờ mọi việc nền đã lùi về chạy ngay (chỉ test dùng). */
export async function doiViecNen(): Promise<void> {
  while (dangChay.size > 0) await Promise.all([...dangChay]);
}
