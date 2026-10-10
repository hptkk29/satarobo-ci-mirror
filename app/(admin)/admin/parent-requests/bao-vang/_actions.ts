"use server";

// Gộp vào trang /parent-requests — logic xử lý báo vắng đã chuyển sang
// ../actions.ts. Giữ re-export để các import cũ không vỡ.
export { resolveAbsence } from "../actions";
