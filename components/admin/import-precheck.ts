"use client";

/**
 * Helper preview-cảnh-báo-GHI-ĐÈ cho các màn import UPSERT theo mã: hỏi
 * /api/admin/import/precheck xem mã nào ĐÃ CÓ trong hệ thống → trả warnings
 * (vàng — dòng vẫn import được, import sẽ CẬP NHẬT bản ghi cũ; khác leads:
 * trùng là LỖI đỏ vì lead không upsert).
 *
 * `keys[i]` = mã của dòng i (null/"" = dòng không có mã → luôn CREATE, bỏ qua).
 * Lỗi mạng → warnings rỗng (không chặn import — semantics upsert vốn an toàn).
 */
export async function precheckUpsert(
  kind: string,
  keys: (string | null)[],
  excelRows: number[],
  label: string,
): Promise<{ warnings: Map<number, string> }> {
  const warnings = new Map<number, string>();
  const uniq = [...new Set(keys.filter((k): k is string => Boolean(k)))];
  if (uniq.length === 0) return { warnings };

  const res = await fetch("/api/admin/import/precheck", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, keys: uniq }),
  });
  if (!res.ok) return { warnings };
  const { matches } = (await res.json()) as { matches: { key: string; name: string }[] };
  const byKey = new Map(matches.map((m) => [m.key, m]));

  keys.forEach((k, i) => {
    if (!k) return;
    const m = byKey.get(k);
    if (m) {
      warnings.set(
        excelRows[i],
        `${label} "${k}" ĐÃ CÓ (${m.name}) — import sẽ CẬP NHẬT (ghi đè) bản ghi cũ`,
      );
    }
  });
  return { warnings };
}
