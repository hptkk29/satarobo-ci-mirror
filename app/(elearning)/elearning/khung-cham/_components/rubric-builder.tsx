"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  suaKhungAction,
  themTieuChiAction,
  suaTieuChiAction,
  xoaTieuChiAction,
  sapXepTieuChiAction,
  kichHoatKhungAction,
} from "../_actions";

/**
 * EL-15b — DỰNG BỘ TIÊU CHÍ CHO MỘT KHUNG.
 *
 * ⚠️ Khung ĐÃ KÍCH HOẠT thì chỉ ĐỌC. Sửa tiêu chí của một khung đã chấm bài làm
 * LỆCH ĐIỂM của mọi bài đã chấm, im lặng — và điểm đó nằm trong hồ sơ nhân sự.
 * Server cũng chặn; màn này không bày ra nút để người ta bấm rồi mới biết.
 *
 * ⚠️ Tổng điểm các tiêu chí phải KHỚP thang điểm của khung. Hiện phép cộng đó ngay
 * trên màn, cập nhật theo từng lần sửa: người soạn thấy mình đang lệch bao nhiêu
 * trước khi bấm kích hoạt, thay vì bị từ chối rồi đi đếm tay.
 */

export type Muc = { label: string; points: number; desc?: string | null };

export type TieuChiTrongKhung = {
  criterionId: string;
  label: string;
  description: string | null;
  levels: Muc[];
};

const MUC_MOI = (): Muc[] => [
  { label: "Chưa đạt", points: 0 },
  { label: "Đạt", points: 10 },
];

/** Điểm tối đa của một tiêu chí = mức CAO NHẤT, không phải mức cuối mảng. */
const diemToiDa = (levels: Muc[]) =>
  levels.length === 0 ? 0 : Math.max(...levels.map((m) => m.points));

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
  const router = useRouter();
  const [dangChay, batDau] = useTransition();
  const [soan, setSoan] = useState<{
    criterionId: string | null;
    label: string;
    description: string;
    levels: Muc[];
  } | null>(null);
  const [xoaId, setXoaId] = useState<string | null>(null);
  const [suaKhung, setSuaKhung] = useState<{
    code: string;
    title: string;
    totalPoints: string;
    passPoints: string;
  } | null>(null);

  /**
   * ⚠️ Thứ tự tiêu chí đọc THẲNG từ props, KHÔNG giữ trong `useState`.
   *
   * `useState` chỉ đọc giá trị khởi tạo ở lượt kết xuất ĐẦU TIÊN. Giữ danh sách id
   * trong state thì sau mỗi lần thêm/xoá tiêu chí + `router.refresh()`, state vẫn
   * là danh sách CŨ — nút ↑ gửi lên một bộ id thiếu (hoặc thừa) và server trả
   * `THU_TU_KHONG_KHOP`; tệ hơn, nếu số lượng tình cờ khớp thì nó GHI NHẦM thứ tự.
   *
   * Cùng một lớp lỗi với `dangHuy` ở trình tải video và ba state của trình làm bài
   * thi. Cách chữa rẻ nhất là đừng nhân bản trạng thái mà server đã có.
   */
  const thuTu = props.cacTieuChi.map((t) => t.criterionId);

  const khoa = props.status !== "DRAFT";
  const tongDiem = props.cacTieuChi.reduce(
    (s, t) => s + diemToiDa(t.levels),
    0,
  );
  const lechThang = tongDiem !== props.totalPoints;

  const khungSaiSo = suaKhung
    ? !Number.isInteger(Number(suaKhung.totalPoints)) ||
      !Number.isInteger(Number(suaKhung.passPoints)) ||
      suaKhung.totalPoints.trim() === "" ||
      suaKhung.passPoints.trim() === "" ||
      Number(suaKhung.passPoints) > Number(suaKhung.totalPoints) ||
      suaKhung.code.trim().length < 3 ||
      suaKhung.title.trim().length < 3
    : false;

  // ⚠️ Tiêu chí có `levelsJson` không đọc được đọc ra danh sách mức RỖNG. Nút kích
  // hoạt phải khoá vì server chắc chắn ném `TIEU_CHI_HONG` — và con số "tổng X/Y"
  // trên màn cũng đang thiếu phần điểm của tiêu chí đó, tức nó là số SAI.
  const coTieuChiHong = props.cacTieuChi.some((t) => t.levels.length === 0);

  const chay = (
    fn: () => Promise<{ ok: boolean; error?: { message: string } }>,
    ok: string,
  ) =>
    batDau(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(r.error?.message ?? "Không thực hiện được");
        return;
      }
      toast.success(ok);
      setSoan(null);
      setXoaId(null);
      router.refresh();
    });

  const luuSoan = () => {
    if (!soan) return;
    const levels = soan.levels.map((m) => ({
      label: m.label.trim(),
      points: Number(m.points),
      desc: m.desc?.trim() || null,
    }));
    chay(
      () =>
        soan.criterionId
          ? suaTieuChiAction({
              criterionId: soan.criterionId,
              label: soan.label.trim(),
              description: soan.description.trim() || null,
              levels,
            })
          : themTieuChiAction({
              rubricId: props.rubricId,
              label: soan.label.trim(),
              description: soan.description.trim() || null,
              levels,
            }),
      soan.criterionId ? "Đã lưu tiêu chí" : "Đã thêm tiêu chí",
    );
  };

  // ── Ô soạn một tiêu chí ───────────────────────────────────────────────────
  const tangDan = soan
    ? soan.levels.every(
        (m, i) => i === 0 || m.points > (soan.levels[i - 1]?.points ?? 0),
      )
    : true;
  const duMuc = (soan?.levels.length ?? 0) >= 2;

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3 text-sm">
        <p>
          <strong>{props.cacTieuChi.length}</strong> tiêu chí · tổng{" "}
          <strong>{tongDiem}</strong>/{props.totalPoints} điểm · đạt từ{" "}
          <strong>{props.passPoints}</strong>
        </p>
        {lechThang && props.cacTieuChi.length > 0 ? (
          // Nói TRƯỚC, và nói LỆCH BAO NHIÊU — "không khớp" bắt người ta tự đếm.
          // ⚠️ Câu này bày ra HAI lối đi (sửa tiêu chí, hoặc sửa thang), nên cả hai
          // phải bấm được. Trước đó chỉ có lối thứ nhất: `suaKhungAction` tồn tại
          // nhưng không màn nào gọi — một lựa chọn không có đường đi, đúng thứ quy
          // ước 20 cấm.
          <p className="mt-1 text-xs text-amber-800">
            Tổng điểm các tiêu chí đang {tongDiem > props.totalPoints ? "thừa" : "thiếu"}{" "}
            {Math.abs(tongDiem - props.totalPoints)} so với thang {props.totalPoints}.
            Sửa điểm các mức, hoặc đổi thang bên dưới.
          </p>
        ) : null}
        {khoa ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Khung đã kích hoạt — chỉ đọc. Sửa lúc này sẽ làm lệch điểm của những bài
            đã chấm.
          </p>
        ) : null}
      </div>

      {!khoa ? (
        <div className="rounded-md border p-3 text-sm">
          {suaKhung ? (
            <div className="space-y-2">
              <label className="block text-xs">
                <span className="text-muted-foreground">Mã khung</span>
                <input
                  value={suaKhung.code}
                  onChange={(e) =>
                    setSuaKhung({ ...suaKhung, code: e.target.value })
                  }
                  maxLength={40}
                  className="mt-1 w-full rounded-md border px-2 py-1 font-mono text-sm"
                />
              </label>
              <label className="block text-xs">
                <span className="text-muted-foreground">Tên khung</span>
                <input
                  value={suaKhung.title}
                  onChange={(e) =>
                    setSuaKhung({ ...suaKhung, title: e.target.value })
                  }
                  maxLength={200}
                  className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <label className="text-xs">
                  <span className="text-muted-foreground">Thang điểm</span>
                  <input
                    type="number"
                    min={1}
                    value={suaKhung.totalPoints}
                    onChange={(e) =>
                      setSuaKhung({ ...suaKhung, totalPoints: e.target.value })
                    }
                    className="mt-1 block w-24 rounded-md border px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs">
                  <span className="text-muted-foreground">
                    Ngưỡng đạt (điểm, không phải %)
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={suaKhung.passPoints}
                    onChange={(e) =>
                      setSuaKhung({ ...suaKhung, passPoints: e.target.value })
                    }
                    className="mt-1 block w-24 rounded-md border px-2 py-1 text-sm"
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={dangChay || khungSaiSo}
                  onClick={() =>
                    chay(
                      () =>
                        suaKhungAction({
                          rubricId: props.rubricId,
                          code: suaKhung.code.trim().toUpperCase(),
                          title: suaKhung.title.trim(),
                          totalPoints: Number(suaKhung.totalPoints),
                          passPoints: Number(suaKhung.passPoints),
                        }),
                      "Đã lưu thông số khung",
                    )
                  }
                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                >
                  Lưu
                </button>
                <button
                  type="button"
                  onClick={() => setSuaKhung(null)}
                  className="rounded-md border px-3 py-1.5 text-xs"
                >
                  Thôi
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() =>
                setSuaKhung({
                  code: props.code,
                  title: props.title,
                  totalPoints: String(props.totalPoints),
                  passPoints: String(props.passPoints),
                })
              }
              className="rounded-md border px-2 py-1 text-xs"
            >
              Sửa thông số khung
            </button>
          )}
        </div>
      ) : null}

      <ol className="space-y-2">
        {props.cacTieuChi.map((t, i) => (
          <li key={t.criterionId} className="rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {i + 1}. {t.label}
              </span>
              <span className="text-xs text-muted-foreground">
                tối đa {diemToiDa(t.levels)} điểm · {t.levels.length} mức
              </span>
            </div>
            {t.description ? (
              <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
            ) : null}
            <ul className="mt-2 space-y-0.5">
              {t.levels.map((m, j) => (
                <li key={j} className="text-xs text-muted-foreground">
                  {m.points} — {m.label}
                  {m.desc ? ` · ${m.desc}` : ""}
                </li>
              ))}
            </ul>

            {!khoa ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSoan({
                      criterionId: t.criterionId,
                      label: t.label,
                      description: t.description ?? "",
                      levels: t.levels.map((m) => ({ ...m })),
                    })
                  }
                  className="rounded-md border px-2 py-1 text-xs"
                >
                  Sửa
                </button>
                <button
                  type="button"
                  disabled={dangChay}
                  onClick={() =>
                    xoaId === t.criterionId
                      ? chay(
                          () => xoaTieuChiAction({ criterionId: t.criterionId }),
                          "Đã xoá tiêu chí",
                        )
                      : setXoaId(t.criterionId)
                  }
                  className="rounded-md border px-2 py-1 text-xs"
                >
                  {xoaId === t.criterionId ? "Bấm lần nữa để xoá" : "Xoá"}
                </button>
                {i > 0 ? (
                  <button
                    type="button"
                    disabled={dangChay}
                    onClick={() => {
                      const moi = [...thuTu];
                      const a = moi.indexOf(t.criterionId);
                      [moi[a - 1], moi[a]] = [moi[a]!, moi[a - 1]!];
                      chay(
                        () =>
                          sapXepTieuChiAction({
                            rubricId: props.rubricId,
                            thuTu: moi,
                          }),
                        "Đã đổi thứ tự",
                      );
                    }}
                    className="rounded-md border px-2 py-1 text-xs"
                  >
                    ↑
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {!khoa && soan === null ? (
        <button
          type="button"
          onClick={() =>
            setSoan({
              criterionId: null,
              label: "",
              description: "",
              levels: MUC_MOI(),
            })
          }
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          Thêm tiêu chí
        </button>
      ) : null}

      {soan !== null ? (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <label className="block text-xs">
            <span className="text-muted-foreground">Tên tiêu chí</span>
            <input
              value={soan.label}
              onChange={(e) => setSoan({ ...soan, label: e.target.value })}
              maxLength={200}
              className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">Mô tả (không bắt buộc)</span>
            <textarea
              value={soan.description}
              onChange={(e) => setSoan({ ...soan, description: e.target.value })}
              rows={2}
              maxLength={2000}
              className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
            />
          </label>

          <p className="text-xs text-muted-foreground">
            Các mức xếp từ THẤP tới CAO — người chấm đọc từ trên xuống.
          </p>
          <ul className="space-y-1">
            {soan.levels.map((m, j) => (
              <li key={j} className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  value={m.points}
                  onChange={(e) => {
                    const levels = [...soan.levels];
                    levels[j] = { ...m, points: Number(e.target.value) };
                    setSoan({ ...soan, levels });
                  }}
                  className="w-20 rounded-md border px-2 py-1 text-sm"
                />
                <input
                  value={m.label}
                  onChange={(e) => {
                    const levels = [...soan.levels];
                    levels[j] = { ...m, label: e.target.value };
                    setSoan({ ...soan, levels });
                  }}
                  maxLength={120}
                  placeholder="Tên mức"
                  className="flex-1 rounded-md border px-2 py-1 text-sm"
                />
                {soan.levels.length > 2 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setSoan({
                        ...soan,
                        levels: soan.levels.filter((_, k) => k !== j),
                      })
                    }
                    className="rounded-md border px-2 py-1 text-xs"
                  >
                    Bỏ
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              setSoan({
                ...soan,
                levels: [
                  ...soan.levels,
                  {
                    label: "",
                    points: diemToiDa(soan.levels) + 10,
                  },
                ],
              })
            }
            className="rounded-md border px-2 py-1 text-xs"
          >
            Thêm mức
          </button>

          {!tangDan ? (
            <p className="text-xs text-red-600">
              Điểm các mức phải tăng dần từ trên xuống.
            </p>
          ) : null}
          {!duMuc ? (
            <p className="text-xs text-red-600">
              Tiêu chí phải có ít nhất hai mức — một mức là điểm cộng vô điều kiện.
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={
                dangChay ||
                !tangDan ||
                !duMuc ||
                soan.label.trim().length < 2 ||
                soan.levels.some((m) => m.label.trim().length === 0)
              }
              onClick={luuSoan}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
            >
              {dangChay ? "Đang lưu…" : "Lưu tiêu chí"}
            </button>
            <button
              type="button"
              onClick={() => setSoan(null)}
              className="rounded-md border px-3 py-1.5 text-xs"
            >
              Thôi
            </button>
          </div>
        </div>
      ) : null}

      {!khoa ? (
        <div className="space-y-2 rounded-md border p-3">
          {props.duocKichHoat ? (
            <>
              <button
                type="button"
                disabled={
                  dangChay ||
                  props.cacTieuChi.length === 0 ||
                  lechThang ||
                  coTieuChiHong
                }
                onClick={() =>
                  chay(
                    () => kichHoatKhungAction({ rubricId: props.rubricId }),
                    "Đã kích hoạt khung",
                  )
                }
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                {dangChay ? "Đang kích hoạt…" : "Kích hoạt khung"}
              </button>
              <p className="text-xs text-muted-foreground">
                Kích hoạt xong là ĐÓNG BĂNG: không sửa, không thêm, không xoá tiêu chí
                nữa. Cần đổi thì tạo khung mới.
              </p>
            </>
          ) : (
            // Nói rõ ai bấm được, thay vì ẩn nút và để người soạn tưởng hệ thống hỏng.
            <p className="text-xs text-muted-foreground">
              Khung đã dựng xong thì nhờ người có quyền xuất bản nội dung kích hoạt.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
