/**
 * Đọc body request THEO LUỒNG với bộ đếm byte (S-11). `req.text()` đệm TOÀN BỘ body vào RAM trước khi ta kiểm kích thước, nên body
 * chunked không khai Content-Length có thể ăn RAM tuỳ ý. Ở đây: vượt `tranByte` ⇒ HUỶ luồng ngay (không đọc tiếp) và báo `QUA_LON`.
 * Dùng chung cho mọi route DISC nhận JSON (`bo-de` · `luu` · `tai` · `xoa`).
 */
export type KetQuaDocBody = { ok: true; text: string } | { ok: false; loi: "QUA_LON" };

export async function docBodyCoTran(req: Request, tranByte: number): Promise<KetQuaDocBody> {
  const body = req.body;
  if (!body) return { ok: true, text: "" };
  const reader = body.getReader();
  const manh: Uint8Array[] = [];
  let tong = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    tong += value.byteLength;
    if (tong > tranByte) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, loi: "QUA_LON" };
    }
    manh.push(value);
  }
  const gop = new Uint8Array(tong);
  let vt = 0;
  for (const m of manh) {
    gop.set(m, vt);
    vt += m.byteLength;
  }
  return { ok: true, text: new TextDecoder("utf-8").decode(gop) };
}
