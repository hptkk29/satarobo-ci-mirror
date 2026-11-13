import { describe, expect, it } from "vitest";
import { docBodyCoTran } from "./doc-body";

// Body dựng từ luồng, KHÔNG khai Content-Length (chunked) — đúng hình dạng S-11 mô tả.
function reqLuong(chunks: Uint8Array[]) {
  let i = 0;
  let daHuy = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(chunks[i++]!);
      else ctrl.close();
    },
    cancel() {
      daHuy = true;
    },
  });
  const req = new Request("http://localhost/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  return { req, daHuy: () => daHuy, soChunkDaDoc: () => i };
}
const mb = (n: number, c = 0x61) => new Uint8Array(n).fill(c);

describe("[DISC-BODY-01] S-11: đọc body theo luồng có trần byte", () => {
  it("body trong trần ⇒ trả đúng văn bản (đa byte UTF-8 ghép qua ranh giới chunk vẫn đúng)", async () => {
    const bytes = new TextEncoder().encode('{"ten":"Nguyễn Thị Mai"}');
    const { req } = reqLuong([bytes.slice(0, 13), bytes.slice(13)]); // cắt giữa ký tự nhiều byte
    expect(await docBodyCoTran(req, 1024)).toEqual({ ok: true, text: '{"ten":"Nguyễn Thị Mai"}' });
  });
  it("không có body ⇒ chuỗi rỗng", async () => {
    expect(await docBodyCoTran(new Request("http://localhost/x", { method: "POST" }), 10)).toEqual({ ok: true, text: "" });
  });
  it("đúng bằng trần ⇒ qua; hơn trần 1 byte ⇒ QUA_LON", async () => {
    expect((await docBodyCoTran(reqLuong([mb(100)]).req, 100)).ok).toBe(true);
    expect(await docBodyCoTran(reqLuong([mb(101)]).req, 100)).toEqual({ ok: false, loi: "QUA_LON" });
  });
  it("vượt trần giữa chừng ⇒ HUỶ luồng và KHÔNG đọc phần còn lại (không đệm cả luồng vào RAM)", async () => {
    const chunks = Array.from({ length: 1000 }, () => mb(1024)); // ~1 MB, trần 3 KB
    const { req, daHuy, soChunkDaDoc } = reqLuong(chunks);
    expect(await docBodyCoTran(req, 3 * 1024)).toEqual({ ok: false, loi: "QUA_LON" });
    expect(daHuy()).toBe(true);
    expect(soChunkDaDoc()).toBeLessThan(50); // dừng sớm, không phải 1000
  });
});
