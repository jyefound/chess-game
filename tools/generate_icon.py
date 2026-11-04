# -*- coding: utf-8 -*-
"""
generate_icon.py — 悦棋·国际象棋 小游戏图标生成器（纯标准库，无外部依赖）

品牌：墨金棋院（悦己 / Ink & Brass）  调性：深墨底 + 单一黄铜暖强调 + 器物感棋盘
色板（严格对齐 BRAND.md）：
  DARK       #10151B  冷墨蓝（全局底）
  BRASS      #C9A24B  黄铜（唯一暖强调，主体主色）
  BRASS_DEEP #8C6E2F  按下态/描边/浅皮肤文字替代
  IVORY      #EDE6D6  象牙（浅格/高光）
  JADE       #4C625D  青玉（深格）
设计：圆角深墨底 + 极淡棋盘格母题 + 黄铜汉字「棋」剪影 + 1pt 黄铜发丝边
主体：直接解析系统中文字体（STHeiti / Hiragino Sans GB）的 U+68CB 字形轮廓，
      以黄铜色绘制，100% 锁定品牌色，字形清晰专业。
抗锯齿：4x 超采样后盒式降采样。
用法：python3 generate_icon.py [size ...]   默认生成 144 与 512
"""
import zlib, struct, os, sys

# ---------- 品牌色板 ----------
DARK       = (16, 21, 27)    # #10151B
BRASS      = (201, 162, 75)  # #C9A24B
BRASS_DEEP = (140, 110, 47)  # #8C6E2F
IVORY      = (237, 230, 214) # #EDE6D6
JADE       = (76, 98, 93)    # #4C625D

SS = 4  # 超采样倍数


# ---------- 基础缓冲 / 混合 ----------
def new_buffer(w, h):
    return bytearray(w * h * 4)


def blend(buf, w, h, x, y, r, g, b, a):
    if x < 0 or y < 0 or x >= w or y >= h or a <= 0:
        return
    i = (y * w + x) * 4
    ba = buf[i + 3] / 255.0
    sa = a / 255.0
    oa = sa + ba * (1 - sa)
    if oa <= 0:
        return
    for k, sv in enumerate((r, g, b)):
        dv = buf[i + k]
        buf[i + k] = int((sv * sa + dv * ba * (1 - sa)) / oa + 0.5)
    buf[i + 3] = int(oa * 255 + 0.5)


def inside_rr(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    if x0 + r <= x <= x1 - r:
        return True
    if y0 + r <= y <= y1 - r:
        return True
    cx = x0 + r if x < x0 + r else x1 - r
    cy = y0 + r if y < y0 + r else y1 - r
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def fill_rr(buf, w, h, x0, y0, x1, y1, r, color, a):
    for y in range(max(0, int(y0)), min(h, int(y1) + 1)):
        for x in range(max(0, int(x0)), min(w, int(x1) + 1)):
            if inside_rr(x, y, x0, y0, x1, y1, r):
                blend(buf, w, h, x, y, color[0], color[1], color[2], a)


def stroke_rr(buf, w, h, x0, y0, x1, y1, r, color, a, t):
    ix0, iy0, ix1, iy1, ir = x0 + t, y0 + t, x1 - t, y1 - t, max(0, r - t)
    for y in range(max(0, int(y0)), min(h, int(y1) + 1)):
        for x in range(max(0, int(x0)), min(w, int(x1) + 1)):
            if inside_rr(x, y, x0, y0, x1, y1, r) and not inside_rr(x, y, ix0, iy0, ix1, iy1, ir):
                blend(buf, w, h, x, y, color[0], color[1], color[2], a)


def fill_rect(buf, w, h, x0, y0, x1, y1, color, a):
    for y in range(max(0, int(y0)), min(h, int(y1) + 1)):
        for x in range(max(0, int(x0)), min(w, int(x1) + 1)):
            blend(buf, w, h, x, y, color[0], color[1], color[2], a)


def fill_poly(buf, w, h, pts, color, a):
    """偶数奇填充：pts 为像素坐标 (x,y) 列表，多轮廓自动处理孔洞。"""
    ys = [p[1] for p in pts]
    ymin, ymax = int(min(ys)), int(max(ys))
    n = len(pts)
    for y in range(max(0, ymin), min(h, ymax + 1)):
        xint = []
        for i in range(n):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % n]
            if (y1 <= y < y2) or (y2 <= y < y1):
                xint.append(x1 + (y - y1) / (y2 - y1) * (x2 - x1))
        xint.sort()
        for k in range(0, len(xint) - 1, 2):
            xa, xb = int(xint[k] + 0.5), int(xint[k + 1] + 0.5)
            for x in range(max(0, xa), min(w, xb + 1)):
                blend(buf, w, h, x, y, color[0], color[1], color[2], a)


def fill_contours(buf, w, h, contours, color, a):
    """非零缠绕填充（TrueType 标准）：contours 为像素坐标多边形列表，
    每个轮廓独立闭合，跨轮廓不连线；内部同向/反向轮廓自动形成孔洞。"""
    ymin = int(min(p[1] for c in contours for p in c))
    ymax = int(max(p[1] for c in contours for p in c))
    for y in range(max(0, ymin), min(h, ymax + 1)):
        crossings = []
        for c in contours:
            n = len(c)
            for i in range(n):
                x1, y1 = c[i]
                x2, y2 = c[(i + 1) % n]
                if (y1 <= y < y2) or (y2 <= y < y1):
                    t = (y - y1) / (y2 - y1)
                    xi = x1 + t * (x2 - x1)
                    d = 1 if y1 < y2 else -1
                    crossings.append((xi, d))
        if not crossings:
            continue
        crossings.sort(key=lambda e: e[0])
        wind = 0
        start = None
        for xi, d in crossings:
            wind += d
            if wind != 0 and start is None:
                start = xi
            elif wind == 0 and start is not None:
                xa, xb = int(start + 0.5), int(xi + 0.5)
                for x in range(max(0, xa), min(w, xb + 1)):
                    blend(buf, w, h, x, y, color[0], color[1], color[2], a)
                start = None
        if start is not None:
            xa, xb = int(start + 0.5), int(crossings[-1][0] + 0.5)
            for x in range(max(0, xa), min(w, xb + 1)):
                blend(buf, w, h, x, y, color[0], color[1], color[2], a)


# ---------- 字体解析（TrueType / TTC，纯标准库） ----------
def _u16(d, o):
    return struct.unpack(">H", d[o:o + 2])[0]


def _u32(d, o):
    return struct.unpack(">I", d[o:o + 4])[0]


def _i16(d, o):
    return struct.unpack(">h", d[o:o + 2])[0]


def _f2dot14(d, o):
    return _i16(d, o) / 16384.0


def _parse_sfnt(d, base):
    numTables = _u16(d, base + 4)
    tables = {}
    for i in range(numTables):
        rec = base + 12 + 16 * i
        tag = d[rec:rec + 4]
        off = _u32(d, rec + 8)
        ln = _u32(d, rec + 12)
        tables[tag] = (off, ln)
    return tables


def _cmap4(d, o, c):
    segCount = _u16(d, o + 6) // 2
    end = [_u16(d, o + 14 + 2 * i) for i in range(segCount)]
    sro = o + 14 + 2 * segCount + 2
    start = [_u16(d, sro + 2 * i) for i in range(segCount)]
    dro = sro + 2 * segCount
    delta = [_i16(d, dro + 2 * i) for i in range(segCount)]
    iro = dro + 2 * segCount
    idro = [_u16(d, iro + 2 * i) for i in range(segCount)]
    gidStart = iro + 2 * segCount
    for i in range(segCount):
        if start[i] <= c <= end[i]:
            if idro[i] == 0:
                return (c + delta[i]) & 0xFFFF
            idx = i + idro[i] // 2 + (c - start[i])
            return _u16(d, gidStart + 2 * idx)
    return 0


def _cmap12(d, o, c):
    nGroups = _u32(d, o + 12)
    for i in range(nGroups):
        b = o + 16 + 12 * i
        sc = _u32(d, b)
        ec = _u32(d, b + 4)
        sg = _u32(d, b + 8)
        if sc <= c <= ec:
            return sg + (c - sc)
    return 0


def _find_glyph(d, tables, c):
    coff, _ = tables[b"cmap"]
    numSub = _u16(d, coff + 2)
    for i in range(numSub):
        sub = coff + 4 + 8 * i
        off = _u32(d, sub + 4)
        subOff = coff + off
        fmt = _u16(d, subOff)
        if fmt == 4:
            g = _cmap4(d, subOff, c)
            if g:
                return g
        elif fmt == 12:
            g = _cmap12(d, subOff, c)
            if g:
                return g
    return 0


def _get_glyph(d, tables, gi):
    glyf_off, _ = tables[b"glyf"]
    loca_off, _ = tables[b"loca"]
    head_off, _ = tables[b"head"]
    maxp_off, _ = tables[b"maxp"]
    indexToLoc = _u16(d, head_off + 50)
    numGlyphs = _u16(d, maxp_off + 4)
    if indexToLoc == 0:
        loca = [_u16(d, loca_off + 2 * i) * 2 for i in range(numGlyphs + 1)]
    else:
        loca = [_u32(d, loca_off + 4 * i) for i in range(numGlyphs + 1)]

    acc = []

    def walk(gidx):
        g0 = glyf_off + loca[gidx]
        g1 = glyf_off + loca[gidx + 1]
        if g0 >= g1:
            return
        nContours = _i16(d, g0)
        if nContours >= 0:
            endPts = [_u16(d, g0 + 10 + 2 * i) for i in range(nContours)]
            nPoints = endPts[-1] + 1
            insLen = _u16(d, g0 + 10 + 2 * nContours)
            fp = g0 + 10 + 2 * nContours + 2 + insLen
            flags = []
            while len(flags) < nPoints:
                f = d[fp]; fp += 1
                if f & 8:
                    rep = d[fp]; fp += 1
                    flags.append(f)
                    flags.extend([f] * rep)
                else:
                    flags.append(f)
            xs = []; ys = []; x = 0
            for k in range(nPoints):
                f = flags[k]
                if f & 2:
                    b = d[fp]; fp += 1
                    x += (b if f & 16 else -b)
                elif not (f & 16):
                    x += _i16(d, fp); fp += 2
                xs.append(x)
            y = 0
            for k in range(nPoints):
                f = flags[k]
                if f & 4:
                    b = d[fp]; fp += 1
                    y += (b if f & 32 else -b)
                elif not (f & 32):
                    y += _i16(d, fp); fp += 2
                ys.append(y)
            start = 0
            for ci in range(nContours):
                end = endPts[ci]
                acc.append([(xs[j], ys[j], bool(flags[j] & 1)) for j in range(start, end + 1)])
                start = end + 1
        else:
            p = g0 + 10
            while True:
                flags = _u16(d, p); p += 2
                comp = _u16(d, p); p += 2
                a = b = c = d2 = 1.0; e = f = 0.0
                if flags & 0x0001:
                    arg1 = _i16(d, p); arg2 = _i16(d, p + 2); p += 4
                else:
                    arg1 = struct.unpack(">b", d[p:p + 1])[0]
                    arg2 = struct.unpack(">b", d[p + 1:p + 2])[0]
                    p += 2
                if flags & 0x0008:
                    a = d2 = _f2dot14(d, p); p += 2
                elif flags & 0x0040:
                    a = _f2dot14(d, p); d2 = _f2dot14(d, p + 2); p += 4
                elif flags & 0x0080:
                    a = _f2dot14(d, p); b = _f2dot14(d, p + 2)
                    c = _f2dot14(d, p + 4); d2 = _f2dot14(d, p + 6); p += 8
                if flags & 0x0100:
                    insLen = _u16(d, p); p += 2 + insLen
                e = arg1; f = arg2
                comp_contours = []
                walk2(comp, comp_contours)
                for cntr in comp_contours:
                    acc.append([(a * x + c * y + e, b * x + d2 * y + f, on) for (x, y, on) in cntr])
                if not (flags & 0x0020):
                    break

    def walk2(gidx, out):
        g0 = glyf_off + loca[gidx]
        g1 = glyf_off + loca[gidx + 1]
        if g0 >= g1:
            return
        nContours = _i16(d, g0)
        if nContours >= 0:
            endPts = [_u16(d, g0 + 10 + 2 * i) for i in range(nContours)]
            nPoints = endPts[-1] + 1
            insLen = _u16(d, g0 + 10 + 2 * nContours)
            fp = g0 + 10 + 2 * nContours + 2 + insLen
            flags = []
            while len(flags) < nPoints:
                f = d[fp]; fp += 1
                if f & 8:
                    rep = d[fp]; fp += 1
                    flags.append(f)
                    flags.extend([f] * rep)
                else:
                    flags.append(f)
            xs = []; ys = []; x = 0
            for k in range(nPoints):
                f = flags[k]
                if f & 2:
                    bb = d[fp]; fp += 1
                    x += (bb if f & 16 else -bb)
                elif not (f & 16):
                    x += _i16(d, fp); fp += 2
                xs.append(x)
            y = 0
            for k in range(nPoints):
                f = flags[k]
                if f & 4:
                    bb = d[fp]; fp += 1
                    y += (bb if f & 32 else -bb)
                elif not (f & 32):
                    y += _i16(d, fp); fp += 2
                ys.append(y)
            start = 0
            for ci in range(nContours):
                end = endPts[ci]
                out.append([(xs[j], ys[j], bool(flags[j] & 1)) for j in range(start, end + 1)])
                start = end + 1
        else:
            p = g0 + 10
            while True:
                flags = _u16(d, p); p += 2
                comp = _u16(d, p); p += 2
                a = b = c = d2 = 1.0; e = f = 0.0
                if flags & 0x0001:
                    arg1 = _i16(d, p); arg2 = _i16(d, p + 2); p += 4
                else:
                    arg1 = struct.unpack(">b", d[p:p + 1])[0]
                    arg2 = struct.unpack(">b", d[p + 1:p + 2])[0]
                    p += 2
                if flags & 0x0008:
                    a = d2 = _f2dot14(d, p); p += 2
                elif flags & 0x0040:
                    a = _f2dot14(d, p); d2 = _f2dot14(d, p + 2); p += 4
                elif flags & 0x0080:
                    a = _f2dot14(d, p); b = _f2dot14(d, p + 2)
                    c = _f2dot14(d, p + 4); d2 = _f2dot14(d, p + 6); p += 8
                if flags & 0x0100:
                    insLen = _u16(d, p); p += 2 + insLen
                e = arg1; f = arg2
                sub = []
                walk2(comp, sub)
                for cntr in sub:
                    out.append([(a * x + c * y + e, b * x + d2 * y + f, on) for (x, y, on) in cntr])
                if not (flags & 0x0020):
                    break

    walk(gi)
    return acc


def load_glyph(fonts, codepoint):
    """返回字形轮廓（字体单位，Y 向上）列表；找不到返回 None。"""
    for fp in fonts:
        try:
            d = open(fp, "rb").read()
        except OSError:
            continue
        if d[:4] == b"ttcf":
            numF = _u32(d, 8)
            offs = [_u32(d, 12 + 4 * i) for i in range(numF)]
        else:
            offs = [0]
        for base in offs:
            tables = _parse_sfnt(d, base)
            if not all(t in tables for t in (b"glyf", b"cmap", b"loca", b"head", b"maxp")):
                continue
            gi = _find_glyph(d, tables, codepoint)
            if gi == 0:
                continue
            contours = _get_glyph(d, tables, gi)
            if contours:
                return contours
    return None


# 候选中文字体（优先简体黑体，其次冬青黑体）
FONT_CANDIDATES = [
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
]
GLYPH = load_glyph(FONT_CANDIDATES, 0x68CB)  # 「棋」


def draw_glyph(buf, w, h, contours, color, a, fill=0.70):
    """把字体单位轮廓（Y 向上）缩放居中，逐轮廓转换为像素多边形并用非零缠绕填充。"""
    minx = min(p[0] for c in contours for p in c)
    maxx = max(p[0] for c in contours for p in c)
    miny = min(p[1] for c in contours for p in c)
    maxy = max(p[1] for c in contours for p in c)
    gw = maxx - minx
    gh = maxy - miny
    if gw <= 0 or gh <= 0:
        return
    scale = (min(w, h) * fill) / max(gw, gh)
    drawnW = gw * scale
    drawnH = gh * scale
    ox = (w - drawnW) / 2.0
    oy = (h - drawnH) / 2.0

    contours_px = []
    for cntr in contours:
        n = len(cntr)
        if n < 2:
            continue
        # 确保起点为 on-curve
        if not cntr[0][2]:
            k = next(j for j in range(n) if cntr[j][2])
            cntr = cntr[k:] + cntr[:k]
            n = len(cntr)
        out = []
        STEPS = 12
        for i in range(n):
            x0, y0, on0 = cntr[i]
            x1, y1, on1 = cntr[(i + 1) % n]
            if on1:
                out.append((x0, y0))
            else:
                x2, y2, on2 = cntr[(i + 2) % n]
                if not on2:
                    x2 = (x1 + x2) / 2.0
                    y2 = (y1 + y2) / 2.0
                for t in range(1, STEPS + 1):
                    tt = t / STEPS
                    u = 1 - tt
                    bx = u * u * x0 + 2 * u * tt * x1 + tt * tt * x2
                    by = u * u * y0 + 2 * u * tt * y1 + tt * tt * y2
                    out.append((bx, by))
        out_px = [(ox + (fx - minx) * scale, oy + (maxy - fy) * scale) for (fx, fy) in out]
        contours_px.append(out_px)
    if contours_px:
        fill_contours(buf, w, h, contours_px, color, a)


def render(size):
    big = size * SS
    s = big / 144.0
    w = h = big
    R = int(round(size * 0.194 * SS))
    buf = new_buffer(w, h)

    def S(v):
        return v * s

    # 1) 深墨圆角底
    fill_rr(buf, w, h, 0, 0, w - 1, h - 1, R, DARK, 255)
    # 2) 极淡棋盘格母题（象牙浅格，alpha 极低；深格用底色）
    cells = 8
    cs = w / cells
    faint = int(255 * 0.06)
    for gy in range(cells):
        for gx in range(cells):
            if (gx + gy) % 2 == 0:
                fill_rect(buf, w, h, gx * cs, gy * cs, (gx + 1) * cs, (gy + 1) * cs, IVORY, faint)
    # 3) 1pt 黄铜发丝边（器物边）
    stroke_rr(buf, w, h, 0, 0, w - 1, h - 1, R, BRASS, int(255 * 0.22), max(1, int(size * 0.014 * SS)))
    # 4) 主体：黄铜汉字「棋」（来自真实字体轮廓）；解析失败则回退到兵剪影
    if GLYPH:
        draw_glyph(buf, w, h, GLYPH, BRASS, 255, fill=0.70)
    else:
        cx = w / 2.0
        pawn = [
            (S(48), S(116)), (S(54), S(100)), (S(61), S(66)),
            (S(58), S(55)), (S(87), S(55)), (S(90), S(100)), (S(96), S(116))
        ]
        fill_poly(buf, w, h, pawn, BRASS, 255)
        fill_circle(buf, w, h, cx, S(44), S(15), BRASS, 255)
        fill_ellipse(buf, w, h, cx, S(114), S(22), S(4), BRASS, 255)
    # 5) 圆角遮罩：四角透明
    for y in range(h):
        for x in range(w):
            if not inside_rr(x, y, 0, 0, w - 1, h - 1, R):
                i = (y * w + x) * 4
                buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0
    # 6) 4x 盒式降采样到目标尺寸（抗锯齿）
    out = new_buffer(size, size)
    n = SS * SS
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for yy in range(SS):
                for xx in range(SS):
                    i = ((y * SS + yy) * w + (x * SS + xx)) * 4
                    r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; a += buf[i + 3]
            o = (y * size + x) * 4
            out[o] = r // n; out[o + 1] = g // n; out[o + 2] = b // n; out[o + 3] = a // n
    return out


def write_png(path, w, h, buf):
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw.extend(buf[y * w * 4:(y + 1) * w * 4])
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def main():
    sizes = [int(x) for x in sys.argv[1:]] or [144, 512]
    out_dir = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    font_status = "字形已解析(棋)" if GLYPH else "字体解析失败→回退兵剪影"
    for sz in sizes:
        buf = render(sz)
        path = os.path.join(out_dir, "icon-chess-%d.png" % sz)
        write_png(path, sz, sz, buf)
        print("written: %s (%d x %d, %d bytes)  [%s]" % (path, sz, sz, os.path.getsize(path), font_status))


if __name__ == "__main__":
    main()
