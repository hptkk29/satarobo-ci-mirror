// Stub cho package "server-only" khi chạy test (Vitest/jsdom). Trong runtime thật
// "server-only" ném lỗi nếu bị import ở client; ở test ta chỉ cần nó là no-op.
export {};
