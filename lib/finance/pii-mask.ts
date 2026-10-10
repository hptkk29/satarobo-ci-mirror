// lib/finance/pii-mask.ts — #15 (câu 32): che CCCD phụ huynh + địa chỉ ở màn thanh
// toán. Mask MẶC ĐỊNH cho mọi người; break-glass (payments:view-pii + reason + audit)
// mới trả bản đầy đủ — thống nhất pattern mask/break-glass của #05 (lib/audit).
// THUẦN (không I/O) → test được. KHÔNG bao giờ gửi bản raw xuống client khi chưa unmask.

/**
 * Che CCCD/CMND phụ huynh: giữ 4 số đầu + 2 số cuối, giữa thay bằng `****`.
 * VD "0123456789" → "0123****89". Chuỗi quá ngắn (≤6) → che toàn bộ "****".
 * null/rỗng → null (không có dữ liệu để hiển thị).
 */
export function maskNationalId(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  if (s.length === 0) return null;
  if (s.length <= 6) return "****";
  return `${s.slice(0, 4)}****${s.slice(-2)}`;
}

/**
 * Che địa chỉ (rút gọn): chỉ để lộ phần THÔ nhất (quận/huyện, tỉnh/TP) — giấu số nhà
 * & tên đường (phần nhạy cảm nhất). Nếu có dấu phẩy → hiện 2 đoạn cuối, prefix "…, ".
 * Không có phẩy → chỉ hiện vài ký tự đầu + "…" để biết có dữ liệu mà không lộ chi tiết.
 * null/rỗng → null.
 */
export function maskAddress(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = v.trim();
  if (s.length === 0) return null;
  const parts = s
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length >= 2) {
    // Giữ tối đa 2 đoạn cuối (thường là quận/huyện + tỉnh/TP), giấu số nhà + đường.
    return `…, ${parts.slice(-2).join(", ")}`;
  }
  // 1 đoạn (địa chỉ tự do, không tách được quận/tỉnh) → che TOÀN BỘ. KHÔNG lộ ký tự đầu
  // vì địa chỉ VN thường mở đầu bằng số nhà + tên đường (phần nhạy cảm nhất).
  return "•••";
}
