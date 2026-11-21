// tests/disc-db/_fx.ts — đồ dùng chung cho bộ QA DISC chạm Postgres THẬT.
// ⚠️ TOÀN BỘ dữ liệu là GIẢ (tên, năm sinh, điểm, SĐT bịa). KHÔNG bộ đề / thuật toán DISC thật (chưa có giấy phép).
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { discStore } from "../../lib/disc/store-prisma";
import { luuKetQuaDisc, type CongCrm, type LuuDeps } from "../../lib/disc/luu";
import type { DiscEngine } from "../../lib/disc/engine";
import { phoneKeyTuSdtChuan } from "../../lib/disc/phone-key";

export const RUN = RUN_DB_TESTS;
/** Tiền tố tên phụ huynh của MỌI lead do bộ này tạo — dùng để dọn. */
export const P = "DISCDB";
/** Mốc thời gian TUYỆT ĐỐI (luật 19) — không đọc đồng hồ thật. */
export const NOW = new Date("2026-11-01T03:00:00.000Z");
export const KHOA = process.env.NEXTAUTH_SECRET ?? "";

/** Chỉ chạy trên đúng database `ci_test` (hoặc satarobo_test). Ném nếu trỏ nhầm — đặc biệt là `satarobo_local`. */
export async function assertCiTest(): Promise<void> {
  const r = await db.$queryRaw<{ ten: string }[]>`select current_database() as ten`;
  const ten = r[0]?.ten ?? "";
  if (ten !== "ci_test" && ten !== "satarobo_test") throw new Error(`[disc-db] TỪ CHỐI: database "${ten}" không phải ci_test/satarobo_test.`);
}

// ── SĐT duy nhất mỗi lần gọi (tránh lead tồn dư từ lượt chạy trước làm dính "lead đã có") ──────────────────────
let seq = 0;
const goc = Date.now() % 1_000_000;
/** SĐT di động VN giả, dạng nội địa 090xxxxxxx; mỗi lời gọi khác nhau, các lượt chạy khác nhau cũng khác nhau. */
const daCap: string[] = [];
export function sdtMoi(): string {
  seq += 1;
  const so = (goc * 7 + seq * 13) % 10_000_000;
  const s = `090${String(so).padStart(7, "0")}`;
  daCap.push(s);
  return s;
}
export const sdtChuan = (s: string) => `84${s.slice(1)}`;

let keySeq = 0;
/** Khoá idempotency hợp lệ (≥22 ký tự base64url). */
export const khoaIdem = (t = "k") => `${t}-${Date.now().toString(36)}-${goc}-${(keySeq += 1)}-padpadpadpad`;

// ── Engine GIẢ (không phải DISC thật): chọn bộ đề cố định, tổng điểm = tổng câu trả lời ──────────────────────────
export const engineGia: DiscEngine = {
  phienBan: "engine-GIA-1",
  chonBoDe: ({ vai }) => ({ ma: vai === "PH" ? "PH-GIA" : "HS-GIA", phienBan: "gia-1", doiTuong: vai === "PH" ? "PH" : "TH", nguoiLonTraLoiHo: false, cauHoi: [] }),
  layBoDe: () => null,
  cham: (ma, traLoi) => {
    const v = Object.values(traLoi);
    if (!v.length) return { ok: false, lyDo: "THIEU_CAU_TRA_LOI" };
    const tong = v.reduce((a, b) => a + b, 0) % 100;
    return { ok: true, ketQua: { diem: { D: tong, I: 11, S: 22, C: 33 }, maBoDe: ma, phienBanBoDe: "gia-1" } };
  },
};

/** Tên GIẢ có điểm đặc trưng để dò rò rỉ. */
export const TEN_CON = "Trần Bảo Kiểm-Thử";
export const NAM_SINH_CON = 2016;

export function dauVao(sdt: string, o: { key?: string; tenCon?: string; email?: string | null; tiepThi?: boolean; traLoi?: number; chienDich?: string } = {}): Record<string, unknown> {
  return {
    idempotencyKey: o.key ?? khoaIdem(),
    soDienThoai: sdt,
    email: o.email ?? null,
    dongY: { xuLyHoSo: true, tiepThi: o.tiepThi ?? false },
    phuHuynh: { hoTen: `${P} Phụ huynh`, vaiTro: "ME", namSinh: 1988 },
    hocSinh: { hoTen: o.tenCon ?? TEN_CON, namSinh: NAM_SINH_CON, bacHoc: "4" },
    bai: {
      phuHuynh: { maBoDe: "PH-GIA", traLoi: { q1: 3, q2: o.traLoi ?? 4 } },
      hocSinh: { maBoDe: "HS-GIA", traLoi: { q1: 1, q2: 2, q3: 3 } },
    },
    ...(o.chienDich ? { chienDich: o.chienDich } : {}),
  };
}

/** Phụ thuộc cho `luuKetQuaDisc` — store THẬT, đồng hồ cố định, engine giả, email không gửi gì. */
export function depLuu(crm: CongCrm, them: Partial<LuuDeps> = {}): LuuDeps {
  let t = 0;
  return {
    store: discStore,
    crm,
    guiEmail: async () => ({ ok: false, loi: "KHONG_CAN" }), // KHÔNG gửi email thật
    nguonIp: "203.0.113.1", // IP tài liệu (RFC 5737) — không phải IP thật
    now: () => NOW,
    // Token/mã khác nhau mỗi lượt gọi để thấy xoay token ở lượt phát lại.
    sinhToken: () => `TOKEN-GIA-${Date.now().toString(36)}-${(t += 1)}-${Math.random().toString(36).slice(2, 10)}`,
    sinhMa: () => ["ABCDEFGHJK", "MNPQRSTUVW", "XYZ2345678", "23456789AB"][(t += 1) % 4]!,
    khoaBam: () => KHOA,
    engine: () => engineGia,
    choPhepTinDiemClient: () => false,
    ...them,
  };
}

export const crmKhong: CongCrm = async () => ({ leadId: null });

export const luu = luuKetQuaDisc;

/** Dọn CHỈ thứ bộ này tạo (theo phoneKey của các SĐT đã cấp + tên phụ huynh có tiền tố); KHÔNG TRUNCATE, không đụng dòng của bộ khác. */
export async function don(): Promise<void> {
  const keys = daCap.map((s) => phoneKeyTuSdtChuan(sdtChuan(s), KHOA));
  const phones = daCap.flatMap((s) => [s, sdtChuan(s)]);
  const leads = await db.lead.findMany({ where: { OR: [{ parentName: { startsWith: P } }, { phone: { in: phones } }] }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  await db.discSubmission.deleteMany({ where: { OR: [{ phoneKey: { in: keys } }, ...(ids.length ? [{ leadId: { in: ids } }] : [])] } }); // Subject cascade
  if (ids.length) {
    await db.affiliateReferral.deleteMany({ where: { leadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await db.user.deleteMany({ where: { phone: { in: phones }, role: "PARENT", lastLoginAt: null } });
}
