// lib/phan-cong/ap-khung-db.ts — THỰC THI "Áp khung lịch" (GĐ4). MỘT thân hàm, HAI cửa:
//   · `ghiThat: false` (xem trước) — chạy ĐÚNG các bước ghi trong một giao dịch rồi NÉM để quay lui: người xem thấy chính những lỗi mà
//     lần ghi thật sẽ gặp (trùng lịch GV / phòng, người đã giữ vai khác…), và không để lại dòng nào — kể cả DomainEvent.
//   · `ghiThat: true` — cùng các bước, giao dịch được commit; mỗi dòng mang nguồn `AP_KHUNG`; mỗi TUẦN một dòng audit `PT_AP_KHUNG`.
// Kế hoạch (bước nào) ở hàm thuần `keHoachApKhung` (`ap-khung.ts`). Ghi qua cửa sẵn có: `datNguoiVaoBuoi` (→ phan-cong-db) và
// `giaoTruc` / `huyTruc`.
// GIAO DỊCH THEO TUẦN (chốt lượt 2 điểm 5, 27/10): một khoảng dài trong MỘT giao dịch có thể chạm trần 60 giây (đường VPS). Mỗi tuần
// (T2–CN) một giao dịch: lỗi ở tuần k ⇒ tuần k quay lui, tuần trước đó GIỮ, kết quả nói rõ "đã áp tới tuần nào"; dừng ngay, không áp
// tuần sau. Chạy lại an toàn: kế hoạch so TRẠNG THÁI hiện tại (`keHoachApKhung`) nên tuần đã áp ra 0 bước — không nhân đôi.
import "server-only";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { docTuanPhanCong } from "@/lib/parttime/bang-phan-cong";
import { TRANG_THAI_SONG } from "@/lib/parttime/phan-cong";
import { giaoTruc, huyTruc } from "@/lib/parttime/truc-van-hanh-db";
import type { NguoiThaoTac, ThongBaoPhanCong } from "@/lib/parttime/phan-cong-db";
import { chiaBuocTheoTuan, keHoachApKhung, thuCua, type BuocApKhung, type CheDoApKhung } from "./ap-khung";
import { datNguoiVaoBuoi, LoiGiaoGo } from "./giao-go-db";

const ngayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const congNgay = (s: string, n: number) => ymd(new Date(ngayDate(s).getTime() + n * 86_400_000));

export type KetQuaApKhung = {
  xemTruoc: boolean;
  buoc: BuocApKhung[];
  boQuaNgay: string[];
  xungDot: { sourceId: string; ngay: string; userId: string; lyDo: string }[];
  thongBao: ThongBaoPhanCong[];
  /** Từng tuần ĐÃ chạy xong (ghi thật: đã commit; xem trước: đã chạy rồi quay lui), theo thứ tự — kèm thời gian giao dịch. */
  tuan: { thuHai: string; soBuoc: number; ms: number }[];
  /** Lỗi ở một tuần ⇒ dừng. `daApToi` = Thứ Hai của tuần cuối đã áp xong (null = chưa tuần nào). */
  loi: { thuHai: string; thongDiep: string; daApToi: string | null } | null;
};

class XemTruoc extends Error {
  constructor(readonly thongBao: ThongBaoPhanCong[]) {
    super("xem trước — quay lui");
  }
}

/** `tuanMau`: Thứ Hai của tuần mẫu. `tu`/`den`: khoảng ngày đích. `homNay` BẮT BUỘC (luật 7) — ngày ≤ hôm nay bị bỏ qua. */
export async function apKhung(p: {
  centerId: string;
  tuanMau: string;
  tu: string;
  den: string;
  cheDo: CheDoApKhung;
  giaoVien: readonly string[] | null;
  homNay: string;
  ghiThat: boolean;
  actor: NguoiThaoTac & { id: string };
}): Promise<KetQuaApKhung> {
  if (p.den < p.tu) throw new LoiGiaoGo("Khoảng áp khung không hợp lệ (đến trước từ).");
  if (ngayDate(p.den).getTime() - ngayDate(p.tu).getTime() > 92 * 86_400_000) throw new LoiGiaoGo("Áp khung tối đa 3 tháng một lần.");
  const cuoiMau = congNgay(p.tuanMau, 6);
  const khoangMau = { gte: ngayDate(p.tuanMau), lte: ngayDate(cuoiMau) };

  // ── Đọc mẫu + đích (ngoài giao dịch — chỉ đọc) ──
  const [trucMau, pcMau, buoiDich, trucDich] = await Promise.all([
    db.operationsDutyAssignment.findMany({ where: { centerId: p.centerId, workDate: khoangMau, status: { in: [...TRANG_THAI_SONG] } }, select: { userId: true, workDate: true, shiftCode: true } }),
    // CHỈ lớp chính thức — học bù / Trial không chép (prompt GĐ4).
    db.sessionStaffAssignment.findMany({
      where: { centerId: p.centerId, ngay: khoangMau, status: { in: [...TRANG_THAI_SONG] }, sourceType: "CLASS_SESSION", role: { in: ["MAIN_TEACHER", "TEACHING_ASSISTANT"] } },
      select: { userId: true, sourceId: true, ngay: true, gioBatDau: true, role: true },
    }),
    docTuanPhanCong({ centerId: p.centerId, tu: p.tu, den: p.den }),
    db.operationsDutyAssignment.findMany({ where: { centerId: p.centerId, workDate: { gte: ngayDate(p.tu), lte: ngayDate(p.den) }, status: { in: [...TRANG_THAI_SONG] } }, select: { id: true, userId: true, workDate: true, shiftCode: true } }),
  ]);
  const lopCua = new Map(
    (pcMau.length ? await db.classSession.findMany({ where: { id: { in: [...new Set(pcMau.map((x) => x.sourceId))] } }, select: { id: true, classId: true } }) : []).map((s) => [s.id, s.classId]),
  );
  const ngays: string[] = [];
  for (let d = p.tu; d <= p.den; d = congNgay(d, 1)) ngays.push(d);

  const kh = keHoachApKhung({
    mau: {
      truc: trucMau.map((t) => ({ userId: t.userId, thu: thuCua(ymd(t.workDate)), ca: t.shiftCode })),
      phanCong: pcMau.flatMap((x) => {
        const classId = lopCua.get(x.sourceId);
        return classId ? [{ userId: x.userId, classId, thu: thuCua(ymd(x.ngay)), gioBatDau: x.gioBatDau, role: x.role as "MAIN_TEACHER" | "TEACHING_ASSISTANT" }] : [];
      }),
    },
    dich: {
      ngays,
      buoiLop: buoiDich
        .filter((b) => b.sourceType === "CLASS_SESSION" && b.classId)
        .map((b) => ({
          sourceId: b.sourceId,
          classId: b.classId!,
          ngay: b.ngay,
          gioBatDau: b.gioBatDau,
          mo: b.tinhTrang === "MO" && b.apDung,
          main: b.main?.song ? b.main.userId : null,
          ta: b.ta?.song ? [b.ta.userId] : [],
        })),
      truc: trucDich.map((t) => ({ id: t.id, userId: t.userId, ngay: ymd(t.workDate), ca: t.shiftCode })),
    },
    giaoVien: p.giaoVien,
    cheDo: p.cheDo,
    homNay: p.homNay,
  });

  const lyDo = `Áp khung tuần ${p.tuanMau} (${p.cheDo === "GHI_DE" ? "ghi đè" : "bổ sung"})`;
  const kq: KetQuaApKhung = { xemTruoc: !p.ghiThat, buoc: kh.buoc, boQuaNgay: kh.boQuaNgay, xungDot: kh.xungDot, thongBao: [], tuan: [], loi: null };
  for (const { thuHai, buoc } of chiaBuocTheoTuan(kh.buoc)) {
    const batDau = performance.now();
    try {
      const thongBao = await db.$transaction(
        async (tx) => {
          const tb: ThongBaoPhanCong[] = [];
          for (const b of buoc) {
            if (b.loai === "GIAO_TRUC") {
              const r = await giaoTruc(tx, { userId: b.userId, centerId: p.centerId, ngay: b.ngay, shiftCode: b.ca, note: lyDo, nguonGiao: "AP_KHUNG", actor: p.actor });
              if (!r.ok) throw new LoiGiaoGo(`Trực ${b.ngay} ca ${b.ca}: ${r.loi}`);
            } else if (b.loai === "GO_TRUC") {
              const r = await huyTruc(tx, { dutyId: b.dutyId, lyDo, actor: p.actor });
              if (!r.ok) throw new LoiGiaoGo(`Gỡ trực ${b.ngay} ca ${b.ca}: ${r.loi}`);
            } else {
              const r = await datNguoiVaoBuoi(tx, {
                nguon: { sourceType: "CLASS_SESSION", sourceId: b.sourceId },
                role: b.role,
                userId: b.userId,
                boUserId: b.boUserId,
                phamVi: "CHI_BUOI_NAY",
                homNay: p.homNay,
                lyDo,
                nguonGiao: "AP_KHUNG",
                actor: p.actor,
              });
              tb.push(...r.thongBao);
            }
          }
          await writeAudit({
            actor: p.actor,
            module: "hr_attendance",
            entityType: "Center",
            entityId: p.centerId,
            action: "PT_AP_KHUNG",
            newValues: {
              tuanMau: p.tuanMau,
              tu: p.tu,
              den: p.den,
              tuanDich: thuHai,
              cheDo: p.cheDo,
              giaoVien: p.giaoVien,
              soBuoc: buoc.length,
              giaoTruc: buoc.filter((x) => x.loai === "GIAO_TRUC").length,
              goTruc: buoc.filter((x) => x.loai === "GO_TRUC").length,
              datNguoi: buoc.filter((x) => x.loai === "DAT_NGUOI").length,
            },
            reason: lyDo,
            tx,
          });
          if (!p.ghiThat) throw new XemTruoc(tb);
          return tb;
        },
        { timeout: 60_000 },
      );
      kq.thongBao.push(...thongBao);
    } catch (e) {
      if (!(e instanceof XemTruoc)) {
        const truoc = kq.tuan.at(-1)?.thuHai ?? null;
        kq.loi = { thuHai, thongDiep: e instanceof Error ? e.message : "Không áp được tuần này", daApToi: truoc };
        return kq;
      }
    }
    kq.tuan.push({ thuHai, soBuoc: buoc.length, ms: Math.round(performance.now() - batDau) });
  }
  if (!p.ghiThat) kq.thongBao = [];
  return kq;
}

/** Thứ Hai của tuần chứa `ngay` — tiện cho action / màn (giờ VN đã quy về "YYYY-MM-DD"). */
export function thuHaiCua(ngay: string): string {
  return congNgay(ngay, -(thuCua(ngay) - 1));
}
