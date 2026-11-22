#!/usr/bin/env bash
# scripts/ci/cho-canh.sh — chó canh NỢ-16, dùng chung cho mọi bước e2e của `ci.yml`.
#
# Cách dùng:  bash scripts/ci/cho-canh.sh <số-phút> <lệnh...>
#   Chạy <lệnh...>, trả về ĐÚNG mã thoát của nó. Nếu sau <số-phút> lệnh vẫn chưa thoát thì
#   in cây tiến trình + các cổng đang nghe (CHỈ ĐỌC — không gửi tín hiệu nào cho bộ test).
#
# ── NỢ-16: CHỤP CÂY TIẾN TRÌNH ĐÚNG LÚC ĐANG TREO ──────────────────────────────────────
# Bốn job dựng `webServer` từng treo SAU khi chạy xong ca cuối rồi bị `timeout-minutes` giết
# — và runner giết sạch luôn mọi chứng cứ. Reporter `line` cho biết ca cuối là ca nào, nhưng
# KHÔNG nói được vì sao tiến trình không thoát.
#
# Chó canh in cây tiến trình ở phút <số-phút> — lúc đó đã biết chắc là treo, mà job còn sống
# nên log vẫn ra được. Nó không làm sai lệch chính thứ đang đo.
#
# Dấu vết đã có: runner phải "Terminate orphan process: (sh)" và "(next-server (v16.2.6))" ở
# bước dọn dẹp ⇒ chuỗi `pnpm start` → sh → next start → next-server để lọt tiến trình cháu.
# Cây tiến trình sẽ cho thấy CHÍNH XÁC cái nào còn sống và cha nó là ai.
#
# ⛔ KHÔNG nâng `timeout-minutes` — trần không phải chỗ hỏng.
#
# (09/10/2026) Trước đây khối này được CHÉP TAY bốn bản trong `ci.yml`; gom về một tệp để
# sửa một chỗ là đủ.

set -u

if [ "$#" -lt 2 ]; then
  echo "cách dùng: $0 <số-phút> <lệnh...>" >&2
  exit 2
fi

PHUT="$1"
shift

(
  # NGỦ THÀNH TỪNG GIÂY, không `sleep 12m` một phát. `trap` chỉ giết được SUBSHELL, còn
  # `sleep` là CON của nó nên sống sót và GIỮ STDOUT đã thừa kế => runner ngồi chờ hết ngần
  # ấy phút dù bộ test xong từ lâu. Đo thật: bản `sleep 5` làm một lệnh 1 giây mất 5 giây.
  # Ngủ từng giây thì mất mát tối đa là MỘT giây.
  for _ in $(seq 1 $((PHUT * 60))); do sleep 1; done
  echo "::warning title=NỢ-16::Đã ${PHUT} phút — bộ test chưa thoát. Chụp cây tiến trình."
  echo "──────── ps -ef --forest ────────"
  ps -ef --forest 2>/dev/null | tail -60 || ps -ef | tail -60
  echo "──────── cổng đang nghe ────────"
  (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | head -20
  echo "────────────────────────────────"
) &
CHO_CANH=$!

# BẮT BUỘC dùng `trap`, không phải một dòng `kill` ở cuối: GitHub chạy bước bằng `bash -e`,
# nên lệnh test ĐỎ là kịch bản thoát NGAY và dòng `kill` phía dưới không bao giờ chạy. Khi đó
# `sleep` còn sống sẽ GIỮ STDOUT MỞ và runner ngồi chờ hết 12/16 phút — biến một job 5 phút
# thành job chạm trần. Tức cái đèn tự gây ra đúng thứ nó sinh ra để soi.
# (Tệp này tự `set -u`, không `-e`, nhưng `trap` vẫn giữ: ai đó thêm `-e` sau này thì lưới
# vẫn đúng.)
trap 'kill "$CHO_CANH" 2>/dev/null || true' EXIT

"$@"
MA=$?
kill "$CHO_CANH" 2>/dev/null || true
exit "$MA"
