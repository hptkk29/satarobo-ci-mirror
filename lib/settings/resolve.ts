/**
 * R6-A — Hàm resolve thuần (testable, không DB).
 * Thứ tự ưu tiên: CenterSetting (nếu key centerOverridable) → SystemSetting (GLOBAL)
 * → default trong registry. Giá trị DB không khớp schema → bỏ qua, fallback tầng dưới
 * (an toàn: cấu hình hỏng không làm sập runtime — US-R6A-2 AC2).
 */
import type { SettingDef } from "./registry";

export interface SettingRow {
  valueJson: unknown;
}

export function resolveSettingValue<T>(args: {
  def: SettingDef<T>;
  centerRow?: SettingRow | null;
  globalRow?: SettingRow | null;
}): T {
  const { def, centerRow, globalRow } = args;

  if (def.centerOverridable && centerRow != null) {
    const r = def.schema.safeParse(centerRow.valueJson);
    if (r.success) return r.data;
  }
  if (globalRow != null) {
    const r = def.schema.safeParse(globalRow.valueJson);
    if (r.success) return r.data;
  }
  return def.default;
}
