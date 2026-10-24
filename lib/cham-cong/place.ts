// lib/cham-cong/place.ts — Resolve NƠI LÀM của một ca cho một người vào một ngày. THUẦN.
//
// Đầu vào: mã ca (segments + defaultPlace), cơ sở "nhà" của người đó trên Sheet (khối
// CS1/CS2/HO), bản đồ mã cơ sở → orgUnitId. Đầu ra: placeMode + allowedOrgUnitIds + segments
// đã gắn orgUnitIds, và `centerId` chịu công của ngày (kế hoạch §3.1 ShiftAssignment).
//
// Luật (§4.10, Q-04): HO / LD / NG / 2C không bao giờ sinh cờ SAI_NOI_LAM ⇒ placeMode khác
// AT_UNITS. `HOME` với người HO = ANY_CENTER (HO chấm cơ sở nào cũng được).
import type { PlaceToken, ShiftSegment } from "./catalog";

export type CenterMap = {
  /** "CS1" → { centerId, orgUnitId } … Chỉ cơ sở vận hành. */
  byCode: Record<string, { centerId: string; orgUnitId: string | null }>;
  /** centerId của Hội sở ("hoi-so") — kỳ công HO dùng làm centerId. */
  hoCenterId: string;
};

export type PlaceModeT = "AT_UNITS" | "ANY_CENTER" | "OFFSITE" | "ANYWHERE";

export type ResolvedSegment = ShiftSegment & { orgUnitIds: string[] };

export type ResolvedPlace = {
  placeMode: PlaceModeT;
  allowedOrgUnitIds: string[];
  /** Cơ sở chịu công của ngày: cơ sở đầu tiên có mặt trong ca, không có thì cơ sở nhà, HO thì "hoi-so". */
  centerId: string;
  segments: ResolvedSegment[];
  /** Cảnh báo cho người xếp lịch (mã cơ sở lạ, HC không có phân công…). */
  warnings: string[];
};

function unitsOf(
  token: PlaceToken,
  homeUnit: string,
  map: CenterMap,
  warnings: string[],
): { mode: PlaceModeT; orgUnitIds: string[]; centerIds: string[] } {
  const home = map.byCode[homeUnit];
  if (token === "HOME" || token === "ASSIGNED") {
    if (homeUnit === "HO" || !home) {
      // Người Hội sở: HOME/ASSIGNED = bất kỳ cơ sở nào (Q-04). ASSIGNED sẽ được lịch lớp
      // / phân công tay siết lại ở L3; ở đây không bịa cơ sở.
      return { mode: "ANY_CENTER", orgUnitIds: [], centerIds: [] };
    }
    return { mode: "AT_UNITS", orgUnitIds: home.orgUnitId ? [home.orgUnitId] : [], centerIds: [home.centerId] };
  }
  if (token === "ANY_CENTER") return { mode: "ANY_CENTER", orgUnitIds: [], centerIds: [] };
  if (token === "OFFSITE") return { mode: "OFFSITE", orgUnitIds: [], centerIds: [] };
  if (token === "ANYWHERE") return { mode: "ANYWHERE", orgUnitIds: [], centerIds: [] };
  const code = token.slice("CENTER:".length);
  const c = map.byCode[code];
  if (!c) {
    warnings.push(`Mã cơ sở lạ trong nơi làm: "${code}"`);
    return { mode: "AT_UNITS", orgUnitIds: [], centerIds: [] };
  }
  return { mode: "AT_UNITS", orgUnitIds: c.orgUnitId ? [c.orgUnitId] : [], centerIds: [c.centerId] };
}

export function resolvePlace(input: {
  segments: ShiftSegment[];
  defaultPlace: PlaceToken;
  /** Khối trên Sheet: "CS1" | "CS2" | "HO". */
  homeUnit: string;
  map: CenterMap;
}): ResolvedPlace {
  const warnings: string[] = [];
  const modes = new Set<PlaceModeT>();
  const allowed: string[] = [];
  const centerIds: string[] = [];
  const push = (arr: string[], v: string) => {
    if (!arr.includes(v)) arr.push(v);
  };
  const segments: ResolvedSegment[] = input.segments.map((s) => {
    const r = unitsOf(s.place ?? input.defaultPlace, input.homeUnit, input.map, warnings);
    modes.add(r.mode);
    r.orgUnitIds.forEach((u) => push(allowed, u));
    r.centerIds.forEach((c) => push(centerIds, c));
    return { ...s, orgUnitIds: r.orgUnitIds };
  });
  if (input.segments.length === 0) {
    const r = unitsOf(input.defaultPlace, input.homeUnit, input.map, warnings);
    modes.add(r.mode);
    r.orgUnitIds.forEach((u) => push(allowed, u));
    r.centerIds.forEach((c) => push(centerIds, c));
  }
  // Ưu tiên chế độ RỘNG nhất nếu có đoạn nào rộng (2C = ANY_CENTER dù mã có đoạn AT_UNITS).
  const placeMode: PlaceModeT = modes.has("ANYWHERE")
    ? "ANYWHERE"
    : modes.has("OFFSITE")
      ? "OFFSITE"
      : modes.has("ANY_CENTER")
        ? "ANY_CENTER"
        : "AT_UNITS";
  const home = input.map.byCode[input.homeUnit];
  const centerId = centerIds[0] ?? (input.homeUnit === "HO" || !home ? input.map.hoCenterId : home.centerId);
  return { placeMode, allowedOrgUnitIds: allowed, centerId, segments, warnings };
}

/**
 * Gộp ô con trỏ D1/D2 (kế hoạch §3.1 "đã gộp D1/D2"): Mr Phúc có 2 dòng — CS1 ghi "D2" hôm
 * nào thì dòng CS2 cùng ngày ghi mã thật (CG). Trả về mã thật + khối chịu công + sourceCells.
 */
export function mergePointerCells(
  cellsByUnit: Record<string, string | null>,
): { code: string | null; unit: string | null; sourceCells: Record<string, string> } {
  const sourceCells: Record<string, string> = {};
  for (const [u, c] of Object.entries(cellsByUnit)) if (c) sourceCells[u] = c;
  const real = Object.entries(cellsByUnit).filter(([, c]) => c && c !== "D1" && c !== "D2");
  if (real.length === 1) return { code: real[0][1], unit: real[0][0], sourceCells };
  if (real.length > 1) {
    // Hai khối cùng có mã thật — lấy theo thứ tự CS1, CS2, HO và để người import thấy sourceCells.
    const order = ["CS1", "CS2", "HO"];
    real.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    return { code: real[0][1], unit: real[0][0], sourceCells };
  }
  // Chỉ có con trỏ (D1/D2) mà không có mã thật ở khối kia → giữ D1/D2, khối = khối đích.
  const pointer = Object.entries(cellsByUnit).find(([, c]) => c === "D1" || c === "D2");
  if (pointer) return { code: pointer[1], unit: pointer[1] === "D1" ? "CS1" : "CS2", sourceCells };
  return { code: null, unit: null, sourceCells };
}
