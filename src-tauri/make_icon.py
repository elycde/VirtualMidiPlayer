"""Генератор иконки приложения: пишет icons/icon.ico без сторонних зависимостей.

Рисуем клавиши пианино на фиолетово-циановом градиенте. Формат — BMP-based ICO
(несколько размеров), потому что его понимают и Windows, и tauri-build.
"""

import struct
import os

SIZES = [16, 24, 32, 48, 64, 128, 256]

BG_TOP = (124, 92, 255)      # #7c5cff
BG_BOTTOM = (34, 211, 238)   # #22d3ee


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded(x, y, size, radius):
    """True, если точка внутри квадрата со скруглёнными углами."""
    for cx, cy in ((radius, radius), (size - 1 - radius, radius),
                   (radius, size - 1 - radius), (size - 1 - radius, size - 1 - radius)):
        in_x = (x < radius) if cx == radius else (x > size - 1 - radius)
        in_y = (y < radius) if cy == radius else (y > size - 1 - radius)
        if in_x and in_y:
            return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
    return True


def render(size):
    """Возвращает список строк пикселей (BGRA), сверху вниз."""
    radius = max(2, round(size * 0.22))
    rows = []

    # Геометрия клавиатуры: нижние ~46% иконки.
    kb_top = round(size * 0.54)
    kb_bottom = round(size * 0.86)
    kb_left = round(size * 0.16)
    kb_right = size - kb_left
    kb_w = kb_right - kb_left
    white_count = 5
    key_w = kb_w / white_count
    # Чёрные клавиши между 1-2, 2-3 и 4-5 белыми — как в реальной октаве.
    black_slots = [1, 2, 4]
    black_w = max(1, round(key_w * 0.52))
    black_h = round((kb_bottom - kb_top) * 0.6)

    for y in range(size):
        row = bytearray()
        for x in range(size):
            if not rounded(x, y, size, radius):
                row += bytes((0, 0, 0, 0))
                continue

            r, g, b = lerp(BG_TOP, BG_BOTTOM, y / max(1, size - 1))

            if kb_left <= x < kb_right and kb_top <= y < kb_bottom:
                r = g = b = 245  # белая клавиша
                # Разделители между белыми клавишами.
                offset = (x - kb_left) % key_w
                if offset < max(1, size * 0.012):
                    r = g = b = 190

                for slot in black_slots:
                    bx = kb_left + round(key_w * slot) - black_w // 2
                    if bx <= x < bx + black_w and y < kb_top + black_h:
                        r, g, b = 24, 22, 38
                        break

            row += bytes((b, g, r, 255))
        rows.append(bytes(row))
    return rows


def bmp_entry(size):
    """DIB-изображение для ICO: заголовок BITMAPINFOHEADER + пиксели снизу вверх + AND-маска."""
    rows = render(size)
    header = struct.pack(
        "<IiiHHIIiiII",
        40,            # biSize
        size,          # biWidth
        size * 2,      # biHeight (цвет + маска)
        1,             # biPlanes
        32,            # biBitCount
        0, 0, 0, 0, 0, 0,
    )
    pixels = b"".join(reversed(rows))
    # AND-маска: 1 бит на пиксель, строки выровнены по 4 байта. Альфа уже в BGRA,
    # но Windows требует наличия маски.
    mask_row_bytes = ((size + 31) // 32) * 4
    mask = b"\x00" * (mask_row_bytes * size)
    return header + pixels + mask


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "icons")
    os.makedirs(out_dir, exist_ok=True)

    entries = [(s, bmp_entry(s)) for s in SIZES]

    header = struct.pack("<HHH", 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    dir_bytes = b""
    for size, data in entries:
        dim = 0 if size >= 256 else size
        dir_bytes += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)

    path = os.path.join(out_dir, "icon.ico")
    with open(path, "wb") as f:
        f.write(header + dir_bytes + b"".join(d for _, d in entries))

    # Отдельный PNG-подобный размер не нужен, но 256x256 .png пригодится для NSIS.
    print(f"написал {path} ({os.path.getsize(path)} байт, размеры: {SIZES})")


if __name__ == "__main__":
    main()
