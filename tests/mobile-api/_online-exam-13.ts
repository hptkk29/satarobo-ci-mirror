// @vitest-environment node
import type { CauSoan } from "./_online-exam-fixture";

/**
 * 13 dạng câu hỏi CHÍNH THỨC của E — đầu vào soạn câu hỏi hợp lệ cho `luuCauHoi`, SAO NGUYÊN từ fixture E giao (`docs/elearning/fixtures/online-13-dang.json`, trường `soanDauVao`).
 * Nhúng sẵn (không đọc tệp docs/) vì bản sao CI (gương) không chứa thư mục docs/elearning.
 */
const DANG_13: { type: string; soanDauVao: Record<string, unknown> }[] = [
  {
    "type": "SINGLE_CHOICE",
    "soanDauVao": {
      "stem": "Chọn một",
      "options": [
        {
          "id": "a",
          "text": "A"
        },
        {
          "id": "b",
          "text": "B"
        },
        {
          "id": "c",
          "text": "C"
        }
      ],
      "correct": "a"
    }
  },
  {
    "type": "MULTIPLE_CHOICE",
    "soanDauVao": {
      "stem": "Chọn nhiều",
      "options": [
        {
          "id": "a",
          "text": "A"
        },
        {
          "id": "b",
          "text": "B"
        },
        {
          "id": "c",
          "text": "C"
        }
      ],
      "correct": [
        "a",
        "c"
      ]
    }
  },
  {
    "type": "TRUE_FALSE",
    "soanDauVao": {
      "stem": "Đúng hay sai",
      "correct": true
    }
  },
  {
    "type": "SHORT_TEXT",
    "soanDauVao": {
      "stem": "Thủ đô Việt Nam?",
      "accepted": [
        "Hà Nội",
        "Ha Noi"
      ]
    }
  },
  {
    "type": "ESSAY",
    "soanDauVao": {
      "stem": "Trình bày"
    }
  },
  {
    "type": "FILL_BLANK",
    "soanDauVao": {
      "stem": "Robot đi [[3|ba]] bước rồi [[dừng]].",
      "cauHinh": {
        "distractors": [
          "lùi"
        ]
      }
    }
  },
  {
    "type": "MATCHING",
    "soanDauVao": {
      "stem": "Nối bộ phận",
      "cauHinh": {
        "pairs": [
          {
            "left": "Động cơ",
            "right": "Làm bánh xe quay"
          },
          {
            "left": "Pin",
            "right": "Cấp điện"
          }
        ],
        "distractors": [
          "Phát nhạc"
        ]
      }
    }
  },
  {
    "type": "ORDERING",
    "soanDauVao": {
      "stem": "Xếp bước",
      "cauHinh": {
        "items": [
          "Đo khoảng cách",
          "Rẽ phải",
          "Đi qua cửa"
        ]
      }
    }
  },
  {
    "type": "CLASSIFY",
    "soanDauVao": {
      "stem": "Phân loại thẻ",
      "cauHinh": {
        "groups": [
          {
            "name": "Siêu âm",
            "cards": [
              "Tường"
            ]
          },
          {
            "name": "Màu",
            "cards": [
              "Vạch đen"
            ]
          }
        ]
      }
    }
  },
  {
    "type": "IMAGE_HOTSPOT",
    "soanDauVao": {
      "stem": "Chạm cảm biến",
      "cauHinh": {
        "image": {
          "imageUrl": "https://example.com/robot.png",
          "width": 800,
          "height": 600
        },
        "regions": [
          {
            "shape": "rect",
            "x": 100,
            "y": 100,
            "w": 50,
            "h": 40
          }
        ]
      }
    }
  },
  {
    "type": "NUMERIC",
    "soanDauVao": {
      "stem": "20 cm/s trong 3 s?",
      "cauHinh": {
        "answer": 60,
        "tolerance": 1,
        "unit": "cm"
      }
    }
  },
  {
    "type": "PRODUCT",
    "soanDauVao": {
      "stem": "Quay video robot",
      "cauHinh": {
        "accept": [
          "VIDEO",
          "IMAGE"
        ],
        "maxMb": 100,
        "maxVideoSec": 60
      }
    }
  },
  {
    "type": "BLOCK_SEQUENCE",
    "soanDauVao": {
      "stem": "Đưa xe tới đích",
      "cauHinh": {
        "cols": 4,
        "rows": 3,
        "start": {
          "c": 0,
          "r": 0,
          "dir": "E"
        },
        "goal": {
          "c": 3,
          "r": 0
        },
        "walls": [
          {
            "c": 1,
            "r": 2
          }
        ],
        "blocks": [
          "fwd",
          "right",
          "left",
          "repeat",
          "stop"
        ],
        "maxBlocks": 6
      }
    }
  }
];

export function dang13(): CauSoan[] {
  return DANG_13.map((d) => ({ khoa: d.type, input: { type: d.type, ...d.soanDauVao } }));
}
