// lib/nguon-hoa-hong/tab-con-khieu-nai.ts — LUẬT THUẦN của bốn tab con trong tab "Khiếu nại & lịch sử" (06 §5.5): tab con nào hiện được, mặc định mở tab nào.
//
// MỖI TAB CON GÁC RIÊNG bằng đúng key của nó (06 §5.5, 05 §1.5) — tab cha chỉ là cái vỏ:
//   · Khiếu nại           → gửi khiếu nại (view-self) HOẶC duyệt (commission_disputes:review)
//   · Đổi nguồn           → xem nguồn (sources:view) ∧ cờ nguồn
//   · Lịch sử chính sách  → xem chính sách (commission_policies:view)
//   · Nhật ký             → quản kỳ (commission_periods:manage) HOẶC duyệt khiếu nại
// "Đổi nguồn" ở đây là LỐI VÀO PHỤ: 05 Nhật ký #37 đã dời nơi ở chính của nó sang tab Nguồn (gác `sources:view` ∧ cờ nguồn, mở được cả lúc pilot nguồn khi cờ engine tắt).
// Component đọc nhật ký (`lib/hoa-hong/nhat-ky-doc.ts`) dùng lại nguyên khi tab Nguồn dựng route riêng — không viết lần hai.
//
// THUẦN: nhận một hàm `coQuyen`/`coCo` đã giải sẵn; test không cần session.
export const TAB_CON = ["khieu-nai", "doi-nguon", "chinh-sach", "nhat-ky"] as const;
export type TabCon = (typeof TAB_CON)[number];

export const NHAN_TAB_CON: Readonly<Record<TabCon, string>> = {
  "khieu-nai": "Khiếu nại",
  "doi-nguon": "Đổi nguồn",
  "chinh-sach": "Lịch sử chính sách",
  "nhat-ky": "Nhật ký",
};

/** Key quyền của từng tab con (OR) — in trong `NoPermission` và là NGUỒN của `tabConMoDuoc`. */
export const KEY_TAB_CON: Readonly<Record<TabCon, readonly string[]>> = {
  "khieu-nai": ["commission:view-self", "commission_disputes:review"],
  "doi-nguon": ["sources:view"],
  "chinh-sach": ["commission_policies:view"],
  "nhat-ky": ["commission_periods:manage", "commission_disputes:review"],
};

export const HOI_AI_TAB_CON: Readonly<Record<TabCon, string>> = {
  "khieu-nai": "Quản trị hệ thống hoặc HR Hội sở",
  "doi-nguon": "Marketing Hội sở, Kế toán Hội sở hoặc Quản lý cơ sở",
  "chinh-sach": "HR Hội sở, Kế toán Hội sở hoặc Quản trị hệ thống",
  "nhat-ky": "Kế toán Hội sở, HR Hội sở hoặc Quản trị hệ thống",
};

export type DauVaoTabCon = {
  coQuyen: (cacKey: readonly string[]) => boolean;
  /** Cờ nguồn (`nguon.enabled`) — chỉ tab con "Đổi nguồn" cần. */
  coNguon: boolean;
};

export function tabConMoDuoc(t: TabCon, v: DauVaoTabCon): boolean {
  if (t === "doi-nguon" && !v.coNguon) return false;
  return v.coQuyen(KEY_TAB_CON[t]);
}

export function tabConUngVien(v: DauVaoTabCon): TabCon[] {
  return TAB_CON.filter((t) => tabConMoDuoc(t, v));
}

/** `?con=` → tab con. Giá trị lạ hoặc tab con người xem KHÔNG mở được ⇒ ứng viên đầu tiên; không ứng viên ⇒ `null` (page hiện NoPermission). */
export function chonTabCon(raw: string | null, v: DauVaoTabCon): TabCon | null {
  const ung = tabConUngVien(v);
  if (ung.length === 0) return null;
  const yeuCau = TAB_CON.find((t) => t === raw);
  return yeuCau && ung.includes(yeuCau) ? yeuCau : ung[0]!;
}
