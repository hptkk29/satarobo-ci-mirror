/**
 * ĐĂNG KÝ ĐỘNG CƠ DISC THẬT — gọi từ route handler (CHỈ MÁY CHỦ).
 *
 * `ensureDiscEngine()` idempotent: gọi bao nhiêu lần cũng chỉ `datEngine(engineThat)` một lần. Mọi route DISC chạm
 * `layEngine()` phải gọi hàm này TRƯỚC (đường lưu, đường phát bộ đề). Không import file này từ component client:
 * `server-only` làm build đỏ nếu ai làm vậy.
 */
import "server-only";

import { datEngine, layEngine } from "./engine";
import { engineThat } from "./engine-that";

let daDangKy = false;

export function ensureDiscEngine(): void {
  if (daDangKy && layEngine() === engineThat) return;
  datEngine(engineThat);
  daDangKy = true;
}
