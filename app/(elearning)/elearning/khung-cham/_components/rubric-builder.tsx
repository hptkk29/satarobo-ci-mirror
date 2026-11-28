"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GhiChu } from "../../_components/ui/trang";
import { NHAN_O, NUT_CHINH, NUT_NHO, NUT_PHU, O_NHAP, O_NHAP_GOC } from "../../_components/ui/dieu-khien";
import {
  daDoiTieuChi,
  diemToiDaNhap,
  loiTieuChiNhap,
  lyDoChuaKichHoat,
  mucTuNhap,
  nhapTuTieuChi,
  tieuChiMoi,
  tongDiemNhap,
  trangThaiTongDiem,
  type TieuChiNhap,
} from "@/lib/elearning/khung-cham-soan";
import {
  suaKhungAction,
  themTieuChiAction,
  suaTieuChiAction,
  xoaTieuChiAction,
  sapXepTieuChiAction,
  kichHoatKhungAction,
} from "../_actions";

/**
 * EL-15b + P8/QtKhungCham — DỰNG BỘ TIÊU CHÍ CHO MỘT KHUNG.
 *
 * Thiết kế 20/11: bản NHÁP có ô nhập MỞ SẴN (mã · tên · thang · ngưỡng; mỗi tiêu chí là một khối ô điểm + tên mức), dòng "Tổng điểm
 * các tiêu chí N/M — khớp thang điểm" và hai nút "Thêm tiêu chí" / "Kích hoạt khung". Nghiệp vụ KHÔNG đổi:
 *
 * ⚠️ Khung ĐÃ KÍCH HOẠT thì chỉ ĐỌC (thiết kế vẽ ô nhập cả ở khung "Kích hoạt" — sai khác có chủ đích, ghi ở VISUAL-AUDIT). Sửa tiêu chí của một
 * khung đã chấm bài làm LỆCH ĐIỂM của mọi bài đã chấm, im lặng — và điểm đó nằm trong hồ sơ nhân sự. Server cũng chặn.
 *
 * ⚠️ LƯU RÕ RÀNG, không tự lưu khi rời ô: mỗi khối tiêu chí có "Lưu tiêu chí" CHỈ khi đã sửa; thông số khung có "Lưu thông số khung".
 * Nút "Kích hoạt khung" khoá kèm LÝ DO khi còn thay đổi chưa lưu — kích hoạt bản chưa lưu là kích hoạt thứ người soạn không thấy.
 *
 * ⚠️ Trạng thái đang sửa chỉ giữ PHẦN GHI ĐÈ (theo id), phần còn lại đọc thẳng từ props: giữ bản sao cả danh sách trong `useState` thì sau
 * `router.refresh()` nó là danh sách CŨ (xem bài học `dangHuy` ở trình tải video).
 */

export type Muc = { label: string; points: number; desc?: string | null };

export type TieuChiTrongKhung = {
  criterionId: string;
  label: string;
  description: string | null;
  levels: Muc[];
};

type KetQua = { ok: boolean; error?: { message: string } };

export function RubricBuilder(props: {
  rubricId: string;
  code: string;
  title: string;
  status: string;
  totalPoints: number;
  passPoints: number;
  cacTieuChi: TieuChiTrongKhung[];
  duocKichHoat: boolean;
}) {
  if (props.status !== "DRAFT") return <KhungChiDoc {...props} />;
  return <KhungNhap {...props} />;
}

// ── Khung đã kích hoạt / lưu trữ: chỉ đọc ──────────────────────────────────────────────────────────────────────────────
function KhungChiDoc(props: { totalPoints: number; passPoints: number; cacTieuChi: TieuChiTrongKhung[] }) {
  const tong = props.cacTieuChi.reduce((s, t) => s + (t.levels.length === 0 ? 0 : Math.max(...t.levels.map((m) => m.points))), 0);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <p>
          <strong>{props.cacTieuChi.length}</strong> tiêu chí · tổng <strong>{tong}</strong>/{props.totalPoints} điểm · đạt từ{" "}
          <strong>{props.passPoints}</strong>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">Khung đã kích hoạt — chỉ đọc. Sửa lúc này sẽ làm lệch điểm của những bài đã chấm.</p>
      </div>
      <ol className="space-y-2">
        {props.cacTieuChi.map((t, i) => (
          <li key={t.criterionId} className="rounded-xl border border-border bg-card p-4 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-base font-semibold text-foreground">
                {i + 1}. {t.label}
              </span>
              <span className="text-sm text-muted-foreground">
                tối đa {t.levels.length === 0 ? 0 : Math.max(...t.levels.map((m) => m.points))} điểm · {t.levels.length} mức
              </span>
            </div>
            {t.description ? <p className="mt-1 text-sm text-muted-foreground">{t.description}</p> : null}
            <ul className="mt-2 space-y-0.5">
              {t.levels.map((m, j) => (
                <li key={j} className="text-sm text-muted-foreground">
                  <span className="inline-block w-10 font-semibold tabular-nums text-foreground">{m.points}</span> {m.label}
                  {m.desc ? ` · ${m.desc}` : ""}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Bản nháp: ô nhập mở sẵn ────────────────────────────────────────────────────────────────────────────────────────────
type ThongSo = { code: string; title: string; totalPoints: string; passPoints: string };

function KhungNhap(props: {
  rubricId: string;
  code: string;
  title: string;
  totalPoints: number;
  passPoints: number;
  cacTieuChi: TieuChiTrongKhung[];
  duocKichHoat: boolean;
}) {
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  /** Chỉ PHẦN ĐÃ SỬA, theo criterionId. Chưa sửa ⇒ đọc thẳng từ props. */
  const [sua, setSua] = useState<Record<string, TieuChiNhap>>({});
  const [moi, setMoi] = useState<TieuChiNhap | null>(null);
  const [thongSoSua, setThongSoSua] = useState<ThongSo | null>(null);
  const [xoaId, setXoaId] = useState<string | null>(null);

  const thuTu = props.cacTieuChi.map((t) => t.criterionId);
  const goc = new Map(props.cacTieuChi.map((t) => [t.criterionId, nhapTuTieuChi(t)]));
  const hienTai = (id: string): TieuChiNhap => sua[id] ?? goc.get(id)!;
  const hang = props.cacTieuChi.map((t) => hienTai(t.criterionId));
  // Tiêu chí MỚI chưa lưu không tính vào tổng — máy chủ chỉ cộng cái đã lưu.
  const { tong, hopLe } = tongDiemNhap(hang);

  const thongSo: ThongSo = thongSoSua ?? {
    code: props.code,
    title: props.title,
    totalPoints: String(props.totalPoints),
    passPoints: String(props.passPoints),
  };
  const thangNhap = Number(thongSo.totalPoints);
  const nguongNhap = Number(thongSo.passPoints);
  const thongSoDoi =
    thongSoSua !== null &&
    (thongSoSua.code !== props.code || thongSoSua.title !== props.title || thongSoSua.totalPoints !== String(props.totalPoints) || thongSoSua.passPoints !== String(props.passPoints));
  const loiThongSo =
    thongSo.code.trim().length < 3
      ? "Mã khung cần ít nhất 3 ký tự"
      : thongSo.title.trim().length < 3
        ? "Tên khung cần ít nhất 3 ký tự"
        : !Number.isInteger(thangNhap) || thongSo.totalPoints.trim() === "" || thangNhap < 1
          ? "Thang điểm phải là số nguyên từ 1"
          : !Number.isInteger(nguongNhap) || thongSo.passPoints.trim() === "" || nguongNhap < 0
            ? "Ngưỡng đạt phải là số nguyên không âm"
            : nguongNhap > thangNhap
              ? "Ngưỡng đạt không được lớn hơn thang điểm"
              : null;

  const coTieuChiDoi = props.cacTieuChi.some((t) => daDoiTieuChi(goc.get(t.criterionId)!, hienTai(t.criterionId)));
  const conChuaLuu = coTieuChiDoi || moi !== null || thongSoDoi;
  // Tổng/thang đo trên cái ĐÃ LƯU (máy chủ kiểm kích hoạt trên bản lưu); hiển thị cái đang nhập kèm nhắc lưu.
  const thangLuu = props.totalPoints;
  const tongLuu = tongDiemNhap(props.cacTieuChi.map((t) => goc.get(t.criterionId)!));
  const coTieuChiHong = props.cacTieuChi.some((t) => t.levels.length === 0);
  const lyDoKhoa = lyDoChuaKichHoat({
    soTieuChi: props.cacTieuChi.length,
    lechThang: tongLuu.tong !== thangLuu || !tongLuu.hopLe,
    coTieuChiHong,
    conChuaLuu,
  });
  const dong = trangThaiTongDiem({ tong, thang: Number.isInteger(thangNhap) && thangNhap > 0 ? thangNhap : props.totalPoints, soTieuChi: props.cacTieuChi.length, hopLe });

  const chay = (fn: () => Promise<KetQua>, ok: string, sauKhi?: () => void) =>
    batDau(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error?.message ?? "Không thực hiện được");
        return;
      }
      toast.success(ok);
      sauKhi?.();
      setXoaId(null);
      router.refresh();
    });

  const datTieuChi = (id: string, vao: TieuChiNhap) => setSua((s) => ({ ...s, [id]: vao }));
  const boSua = (id: string) =>
    setSua((s) => {
      const { [id]: _bo, ...con } = s;
      void _bo;
      return con;
    });

  const luuTieuChi = (t: TieuChiNhap, laMoi: boolean) => {
    const levels = mucTuNhap(t.levels);
    if (!levels) return;
    const chung = { label: t.label.trim(), description: t.description.trim() || null, levels };
    chay(
      () => (laMoi ? themTieuChiAction({ rubricId: props.rubricId, ...chung }) : suaTieuChiAction({ criterionId: t.criterionId, ...chung })),
      laMoi ? "Đã thêm tiêu chí" : "Đã lưu tiêu chí",
      () => (laMoi ? setMoi(null) : boSua(t.criterionId)),
    );
  };

  return (
    <div className="space-y-5">
      {/* Thông số khung */}
      <section aria-label="Thông số khung" className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_9rem]">
          <label className="block">
            <span className={NHAN_O}>Mã khung</span>
            <input
              value={thongSo.code}
              onChange={(e) => setThongSoSua({ ...thongSo, code: e.target.value })}
              maxLength={40}
              className={`mt-1 ${O_NHAP} font-mono`}
            />
          </label>
          <label className="block">
            <span className={NHAN_O}>Tên khung</span>
            <input value={thongSo.title} onChange={(e) => setThongSoSua({ ...thongSo, title: e.target.value })} maxLength={200} className={`mt-1 ${O_NHAP}`} />
          </label>
          <label className="block">
            <span className={NHAN_O}>Thang điểm</span>
            <input
              type="number"
              min={1}
              value={thongSo.totalPoints}
              onChange={(e) => setThongSoSua({ ...thongSo, totalPoints: e.target.value })}
              className={`mt-1 ${O_NHAP}`}
            />
          </label>
          <label className="block">
            <span className={NHAN_O}>Ngưỡng đạt (điểm, không phải %)</span>
            <input
              type="number"
              min={0}
              value={thongSo.passPoints}
              onChange={(e) => setThongSoSua({ ...thongSo, passPoints: e.target.value })}
              className={`mt-1 ${O_NHAP}`}
            />
          </label>
        </div>
        {thongSoDoi ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={dangChay || loiThongSo !== null}
              onClick={() =>
                chay(
                  () =>
                    suaKhungAction({
                      rubricId: props.rubricId,
                      code: thongSo.code.trim().toUpperCase(),
                      title: thongSo.title.trim(),
                      totalPoints: Number(thongSo.totalPoints),
                      passPoints: Number(thongSo.passPoints),
                    }),
                  "Đã lưu thông số khung",
                  () => setThongSoSua(null),
                )
              }
              className={NUT_CHINH}
            >
              {dangChay ? "Đang lưu…" : "Lưu thông số khung"}
            </button>
            <button type="button" onClick={() => setThongSoSua(null)} className={NUT_PHU}>
              Hoàn tác
            </button>
            {loiThongSo ? <span className="text-sm text-state-danger-ink">{loiThongSo}</span> : null}
          </div>
        ) : null}
        <p className="text-sm text-muted-foreground">Các mức xếp từ thấp tới cao — người chấm đọc từ trên xuống.</p>
      </section>

      {/* Tiêu chí */}
      <ol className="space-y-0">
        {props.cacTieuChi.map((t, i) => {
          const cur = hienTai(t.criterionId);
          const doi = daDoiTieuChi(goc.get(t.criterionId)!, cur);
          return (
            <li key={t.criterionId}>
              <KhoiTieuChi
                stt={i + 1}
                gia={cur}
                dangChay={dangChay}
                doi={doi}
                laDauTien={i === 0}
                dangXoa={xoaId === t.criterionId}
                onDoi={(v) => datTieuChi(t.criterionId, v)}
                onLuu={() => luuTieuChi(cur, false)}
                onHoanTac={() => boSua(t.criterionId)}
                onXoa={() =>
                  xoaId === t.criterionId
                    ? chay(() => xoaTieuChiAction({ criterionId: t.criterionId }), "Đã xoá tiêu chí", () => boSua(t.criterionId))
                    : setXoaId(t.criterionId)
                }
                onLen={() => {
                  const ds = [...thuTu];
                  const a = ds.indexOf(t.criterionId);
                  if (a < 1) return;
                  [ds[a - 1], ds[a]] = [ds[a]!, ds[a - 1]!];
                  chay(() => sapXepTieuChiAction({ rubricId: props.rubricId, thuTu: ds }), "Đã đổi thứ tự");
                }}
              />
            </li>
          );
        })}
        {moi ? (
          <li>
            <KhoiTieuChi
              stt={props.cacTieuChi.length + 1}
              gia={moi}
              dangChay={dangChay}
              doi
              laMoi
              laDauTien
              dangXoa={false}
              onDoi={setMoi}
              onLuu={() => luuTieuChi(moi, true)}
              onHoanTac={() => setMoi(null)}
            />
          </li>
        ) : null}
      </ol>

      {coTieuChiHong ? (
        <GhiChu sac="warning">Có tiêu chí hệ thống không đọc được các mức. Nhập lại mức rồi lưu — để nguyên thì kích hoạt sẽ bị từ chối.</GhiChu>
      ) : null}

      <GhiChu sac={dong.sac === "success" ? "success" : dong.sac === "danger" ? "danger" : "warning"}>
        {dong.cau}
        {coTieuChiDoi ? " (đang tính theo ô nhập — nhớ lưu từng tiêu chí)" : ""}
      </GhiChu>

      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border pt-4">
        <button
          type="button"
          disabled={dangChay || moi !== null}
          onClick={() => setMoi(tieuChiMoi())}
          className={`${NUT_PHU} inline-flex items-center gap-2`}
        >
          <Plus className="size-4" aria-hidden />
          Thêm tiêu chí
        </button>
        {props.duocKichHoat ? (
          <div className="flex flex-col items-end gap-1.5">
            <button
              type="button"
              disabled={dangChay || lyDoKhoa !== null}
              onClick={() => chay(() => kichHoatKhungAction({ rubricId: props.rubricId }), "Đã kích hoạt khung")}
              className={NUT_CHINH}
            >
              {dangChay ? "Đang kích hoạt…" : "Kích hoạt khung"}
            </button>
            <p className="max-w-md text-right text-sm text-muted-foreground">
              {lyDoKhoa ?? "Kích hoạt xong là ĐÓNG BĂNG: không sửa, không thêm, không xoá tiêu chí nữa. Cần đổi thì tạo khung mới."}
            </p>
          </div>
        ) : (
          // Nói rõ ai bấm được, thay vì ẩn nút và để người soạn tưởng hệ thống hỏng.
          <p className="max-w-md text-sm text-muted-foreground">Khung đã dựng xong thì nhờ người có quyền xuất bản nội dung kích hoạt.</p>
        )}
      </div>
    </div>
  );
}

function KhoiTieuChi(props: {
  stt: number;
  gia: TieuChiNhap;
  dangChay: boolean;
  doi: boolean;
  laMoi?: boolean;
  laDauTien: boolean;
  dangXoa: boolean;
  onDoi: (v: TieuChiNhap) => void;
  onLuu: () => void;
  onHoanTac: () => void;
  onXoa?: () => void;
  onLen?: () => void;
}) {
  const { gia, stt } = props;
  const loi = loiTieuChiNhap(gia);
  const datMuc = (j: number, phan: Partial<TieuChiNhap["levels"][number]>) =>
    props.onDoi({ ...gia, levels: gia.levels.map((m, k) => (k === j ? { ...m, ...phan } : m)) });
  const diemCao = diemToiDaNhap(gia.levels);
  return (
    <section aria-label={`Tiêu chí ${stt}`} className="space-y-3 border-t border-border py-5">
      <div className="flex items-center gap-2">
        <input
          value={gia.label}
          onChange={(e) => props.onDoi({ ...gia, label: e.target.value })}
          maxLength={200}
          placeholder="Tên tiêu chí"
          aria-label={`Tên tiêu chí ${stt}`}
          className={`${O_NHAP_GOC} min-w-0 flex-1 text-base font-medium`}
        />
        <span className="hidden flex-none text-sm text-muted-foreground sm:inline">tối đa {diemCao ?? "—"} điểm</span>
        {props.onLen && !props.laDauTien ? (
          <button type="button" disabled={props.dangChay} onClick={props.onLen} aria-label={`Đưa tiêu chí ${stt} lên trên`} className={NUT_NHO}>
            <ArrowUp className="size-4" aria-hidden />
          </button>
        ) : null}
        {props.onXoa ? (
          <button
            type="button"
            disabled={props.dangChay}
            onClick={props.onXoa}
            aria-label={props.dangXoa ? `Bấm lần nữa để xoá tiêu chí ${stt}` : `Xoá tiêu chí ${stt}`}
            className={props.dangXoa ? `${NUT_NHO} inline-flex items-center gap-1 border-state-danger/40 text-state-danger-ink` : NUT_NHO}
          >
            <Trash2 className="size-4" aria-hidden />
            {props.dangXoa ? "Bấm lần nữa để xoá" : null}
          </button>
        ) : null}
      </div>
      <input
        value={gia.description}
        onChange={(e) => props.onDoi({ ...gia, description: e.target.value })}
        maxLength={2000}
        placeholder="Mô tả (không bắt buộc)"
        aria-label={`Mô tả tiêu chí ${stt}`}
        className={`${O_NHAP_GOC} w-full text-sm`}
      />
      <ul className="space-y-2">
        {gia.levels.map((m, j) => (
          <li key={j} className="flex flex-wrap items-center gap-2">
            <input
              inputMode="numeric"
              value={m.points}
              onChange={(e) => datMuc(j, { points: e.target.value })}
              aria-label={`Điểm của mức ${j + 1} (tiêu chí ${stt})`}
              className={`${O_NHAP_GOC} w-16 text-center tabular-nums`}
            />
            <input
              value={m.label}
              onChange={(e) => datMuc(j, { label: e.target.value })}
              maxLength={120}
              placeholder="Tên mức"
              aria-label={`Tên mức ${j + 1} (tiêu chí ${stt})`}
              className={`${O_NHAP_GOC} min-w-0 flex-1 basis-40`}
            />
            {gia.levels.length > 2 ? (
              <button
                type="button"
                onClick={() => props.onDoi({ ...gia, levels: gia.levels.filter((_, k) => k !== j) })}
                aria-label={`Bỏ mức ${j + 1} (tiêu chí ${stt})`}
                className={NUT_NHO}
              >
                Bỏ
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={gia.levels.length >= 10}
          onClick={() => props.onDoi({ ...gia, levels: [...gia.levels, { label: "", points: String((diemCao ?? 0) + 10) }] })}
          className={NUT_NHO}
        >
          Thêm mức
        </button>
        {props.doi ? (
          <>
            <button type="button" disabled={props.dangChay || loi !== null} onClick={props.onLuu} className={NUT_CHINH}>
              {props.dangChay ? "Đang lưu…" : props.laMoi ? "Thêm tiêu chí vào khung" : "Lưu tiêu chí"}
            </button>
            <button type="button" onClick={props.onHoanTac} className={NUT_PHU}>
              {props.laMoi ? "Thôi" : "Hoàn tác"}
            </button>
          </>
        ) : null}
        {props.doi && loi ? <span className="text-sm text-state-danger-ink">{loi}</span> : null}
      </div>
    </section>
  );
}
