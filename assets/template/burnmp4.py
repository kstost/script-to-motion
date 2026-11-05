#!/usr/bin/env python3
"""burnmp4.py — script-to-motion 영상 프로젝트를 MP4로 굽는다. 프레임 단위로 렌더하므로 프레임 드랍이 생기지 않는다.
파일 하나로 어디에 두어도 된다: 프로젝트 폴더(index.html이 있는 곳)를 인자로 준다. 인자가 없으면 지금 폴더, 그다음
이 파일이 있는 폴더에서 index.html을 찾는다(새 프로젝트에는 new_project.mjs가 이 파일을 넣어 준다).

    python3 burnmp4.py ~/videos/my-video                  영상 전체 → ~/videos/my-video/movie.mp4 (60fps, 무대 크기 그대로)
    python3 burnmp4.py ~/videos/my-video/index.html       index.html을 줘도 같음
    python3 burnmp4.py                                    지금 폴더(또는 이 파일의 폴더)가 프로젝트일 때
    python3 burnmp4.py <폴더> --from 0 --to 40             0–40초만 (시험용; 그 구간의 내레이션과 자막도 들어감)
    python3 burnmp4.py <폴더> --quality max --png          최상 화질 (느림)
    python3 burnmp4.py <폴더> --res 4k                     4K (무대의 두 배 — 16:9면 3840×2160, HEVC)
    python3 burnmp4.py <폴더> --res 720p                   720p (무대의 2/3 — 16:9면 1280×720, 더 빠르고 파일이 작음)
    python3 burnmp4.py <폴더> --res 480p                   480p (무대의 4/9 — 16:9면 854×480, 미리보기·공유용)
    python3 burnmp4.py <폴더> --screenshot --gapframe 5    MP4 대신 콘택트 시트: 5프레임마다 한 칸, 480p 칸 여러 개를 이미지 한 장에
    python3 burnmp4.py <폴더> --out ~/Desktop/영상.mp4      다른 곳에 저장
    (자막은 기본으로 영상에 입힘 — 빼려면 --no-captions)

How it works: a local web server serves this folder, a headless Chrome opens index.html?render (the player hides its UI,
see references/player-api.md §6), and for every frame n the page is moved to t = n / fps and waited for until everything
has drawn that t (Video.renderBusy(), fed by ctx.busy(fn)) — then the frame is captured and piped into ffmpeg. Nothing
plays in real time, so a slow moment only takes longer. The video is cut into chunks (--chunk seconds), each in a fresh
browser; --jobs renders several at once; a finished chunk is kept and skipped when the script is run again (an
interrupted run picks up where it stopped, unless the project's files changed). The stage size is read from index.html
(#stage data-width / data-height), so 9:16, 1:1 and other aspects come out at their own size.

On a Mac it uses the graphics chip: Chrome draws with Metal (installed Google Chrome first, then Playwright's Chromium),
and ffmpeg encodes with VideoToolbox. Elsewhere, or with --no-gpu / --encoder software, it draws with software WebGL and
encodes with x264 / x265.

Everything it needs lives in a virtual environment of its own, ~/.cache/burnmp4-venv (BURNMP4_VENV to put it
elsewhere): on the first run it is made (python3 -m venv), Playwright is installed into it and its Chromium downloaded
into it, and the script runs itself again with the environment's Python — nothing is installed into the system Python
or into this project. ffmpeg: the system's (Mac: brew install ffmpeg, which has VideoToolbox) or, when there is none,
the one the imageio-ffmpeg package brings into the environment.
    --no-venv   run with the Python that started the script (Playwright must then be installed there)
Contact sheets (--screenshot): instead of a movie, every --gapframe-th frame of the range is captured at 480p (the same
seek → wait → capture as a movie frame) and laid out in a grid, --cols × --rows tiles per image (landscape 4 × 6, portrait
8 × 3), each tile labelled `frame  m:ss.ff  [cue]` (the time as the player's S key copies it), a header line on top, more
tiles → more sheets: <project>/screenshots/<from>-<to>_g<gap>_<k>.jpg — the folder is emptied on every run, so it holds
only the latest sheets (a folder given with --out loses only earlier sheet files). One sheet is one job (one browser); resume, the
stale-project check, captions, footage frames and the font check work as for a movie; no ffmpeg. The labels use the
project's own @font-face fonts. references/burnmp4.md in the skill has the whole guide.

Sound: the narration of the rendered stretch (when there is voice in it — a silent placeholder is left out), mixed with
the footage's own sound where a clip plays with `audio: true` — at its placement, playback rate and volume envelope, as
the player plays it (clips' masters from js/media-src.js). Footage pictures are filmed from frames cut beforehand by
scripts/stills.mjs (headless Chrome plays no H.264).
"""
import argparse, hashlib, http.server, json, multiprocessing as mp, os, re, shutil, signal, socketserver, subprocess, sys, tempfile, threading, time, traceback, unicodedata
from functools import partial
from pathlib import Path

HERE = Path(__file__).resolve().parent              # where this file is (only a fallback for finding the project)
ROOT = None                                         # the project folder (index.html) — set in main() from the argument
IS_MAC = sys.platform == 'darwin'
# the virtual environment lives outside the project (the project's own check would read its packages as stray media):
# ~/.cache/burnmp4-venv, or wherever BURNMP4_VENV points
VENV = Path(os.environ.get('BURNMP4_VENV') or (Path.home() / '.cache' / 'burnmp4-venv'))
VPY = VENV / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
# Playwright's browsers go into the environment too: `playwright install` tidies the folder it installs into, and in the shared
# cache (~/Library/Caches/ms-playwright, ~/.cache/ms-playwright) that would remove browsers other programs still use
os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', str(VENV / 'ms-playwright'))


def find_project(arg):
    """the project folder: the argument (a folder, or an index.html in it), else the current folder, else this file's folder"""
    if arg:
        p = Path(arg).expanduser().resolve()
        if p.is_file() and p.name.lower().endswith('.html'):
            p = p.parent
        need(p.is_dir(), f'폴더가 없습니다: {arg}')
        need((p / 'index.html').is_file(), f'{p} 에 index.html이 없습니다 — script-to-motion 영상 프로젝트 폴더를 주세요')
        return p
    for p in (Path.cwd().resolve(), HERE):
        if (p / 'index.html').is_file():
            return p
    need(False, '영상 프로젝트 폴더를 알려 주세요 — python3 burnmp4.py <index.html이 있는 폴더>')


# --screenshot without --progress: stdout carries only the finished sheets' full paths, one per line; progress and notes
# are not shown, and only problems (errors, warnings) are written — to stderr
QUIET = False
PROBLEM = re.compile(r'오류|경고|주의|멈췄|다시|실패')


def say(*a):
    if QUIET:
        return
    print(time.strftime('[%H:%M:%S]'), *a, flush=True)


def warn(*a):
    """a problem: on stdout like say() normally, on stderr in quiet mode (stdout keeps only the sheet paths)"""
    print(time.strftime('[%H:%M:%S]'), *a, file=sys.stderr if QUIET else sys.stdout, flush=True)


def need(ok, msg):
    if not ok:
        sys.exit('필요한 것이 없습니다: ' + msg)


# ---------------------------------------------------------------- the virtual environment (outside the project)
def in_venv():
    return Path(sys.prefix).resolve() == VENV.resolve()


def bootstrap():
    """make the environment if needed, put Playwright (+ its Chromium, + ffmpeg when the system has none) in it, then run this
    script again with the environment's Python"""
    if not VPY.exists():
        say(f'가상환경을 만드는 중… ({VENV})')
        subprocess.run([sys.executable, '-m', 'venv', str(VENV)], check=True, stdout=sys.stderr if QUIET else None)
    have = lambda mod: subprocess.run([str(VPY), '-c', f'import {mod}'], capture_output=True).returncode == 0
    pkgs = ([] if have('playwright') else ['playwright']) + ([] if shutil.which('ffmpeg') or have('imageio_ffmpeg') else ['imageio-ffmpeg'])
    if pkgs:
        say('가상환경에 설치하는 중: ' + ', '.join(pkgs))
        subprocess.run([str(VPY), '-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], check=True, stdout=sys.stderr if QUIET else None)
        subprocess.run([str(VPY), '-m', 'pip', 'install', '--quiet'] + pkgs, check=True, stdout=sys.stderr if QUIET else None)
    mark = VENV / '.chromium-installed'
    if not mark.exists():
        say('Chromium 내려받는 중… (처음 한 번)')
        subprocess.run([str(VPY), '-m', 'playwright', 'install', 'chromium'], check=True, stdout=sys.stderr if QUIET else None)
        mark.write_text(time.strftime('%Y-%m-%d %H:%M:%S\n'))
    os.execv(str(VPY), [str(VPY), str(Path(__file__).resolve())] + sys.argv[1:])


def ffmpeg_bin():
    f = shutil.which('ffmpeg')
    if f:
        return f
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


FFMPEG = ffmpeg_bin() or 'ffmpeg'


# ---------------------------------------------------------------- the video's data (js/cues.js)
def video_data():
    src = (ROOT / 'js' / 'cues.js').read_text(encoding='utf-8')
    return json.loads(src[src.index('{'):src.rindex('}') + 1])


# what the frames are drawn from: a change to any of these makes chunks of an earlier run stale — every folder of the
# project except sound, subtitles and tool folders (and hidden ones), plus index.html / glyphs.json at the top
NOT_FRAMES = {'audio', 'dub', 'subs', 'node_modules', '__pycache__'}


def project_stamp():
    h = hashlib.sha1()
    files = [ROOT / n for n in ('index.html', 'glyphs.json') if (ROOT / n).is_file()]
    for e in sorted(ROOT.iterdir()):
        if e.is_dir() and not e.is_symlink() and e.name not in NOT_FRAMES and not e.name.startswith('.'):
            for d, dirs, names in os.walk(e):
                dirs[:] = sorted(x for x in dirs if not x.startswith('.') and x not in NOT_FRAMES)
                files += [Path(d) / n for n in sorted(names) if not n.startswith('.')]
    for f in files:
        try:
            st = f.stat()
        except OSError:
            continue
        h.update(f'{f.relative_to(ROOT)}\0{st.st_size}\0{st.st_mtime_ns}\n'.encode())
    return h.hexdigest()


def stage_size():
    """the stage's logical size from index.html (#stage data-width / data-height; 1920×1080 if not given)"""
    html = (ROOT / 'index.html').read_text(encoding='utf-8', errors='replace')
    tag = re.search(r'<[^>]*\bid=["\']stage["\'][^>]*>', html)
    w = re.search(r'data-width=["\'](\d+)', tag.group(0)) if tag else None
    h = re.search(r'data-height=["\'](\d+)', tag.group(0)) if tag else None
    return (int(w.group(1)) if w else 1920), (int(h.group(1)) if h else 1080)


def footage_clips():
    """how many footage clips js/media-src.js declares (0 when the project has none)"""
    f = ROOT / 'js' / 'media-src.js'
    if not f.exists():
        return 0
    src = re.sub(r'/\*.*?\*/|(?<![:\'"])//[^\n]*', '', f.read_text(encoding='utf-8', errors='replace'), flags=re.S)
    return len(re.findall(r'\bfile\s*:', src))


# ---------------------------------------------------------------- a static server over this folder
class Quiet(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'                      # keep-alive: a browser reuses a few connections instead of one per file
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript',
                      '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.json': 'application/json'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    request_queue_size = 512                           # the default 5 overflowed with two browsers loading at once (macOS
                                                       # refuses the extra connections: scripts went missing)

    def handle_error(self, request, client_address):   # a download the browser stopped (e.g. the narration): not an error
        pass


def serve():
    httpd = Server(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f'http://127.0.0.1:{httpd.server_address[1]}'


# ---------------------------------------------------------------- the browser
SOFT = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
GPU_MAC = ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-zero-copy']
COMMON = ['--disable-gpu-vsync', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required']


def headless_shell():
    """Playwright's headless shell already on this machine (any revision) — a fallback when the Python package's own
    browser is not installed"""
    for base in [VENV / 'ms-playwright', Path.home() / '.cache' / 'ms-playwright', Path.home() / 'Library' / 'Caches' / 'ms-playwright']:
        if not base.exists():
            continue
        for d in sorted(base.glob('chromium_headless_shell-*'), reverse=True):
            for exe in d.glob('chrome-headless-shell*/chrome-headless-shell'):
                return str(exe)
    return None


GL_PROBE = '''() => { const g = document.createElement('canvas').getContext('webgl2');
  if (!g) return '';
  const x = g.getExtension('WEBGL_debug_renderer_info');
  return String(x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)); }'''


def gl_name(gl):
    """'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)' → 'GPU · Metal · Apple M2 Pro'"""
    low = gl.lower()
    if 'swiftshader' in low:
        return '소프트웨어 그리기 (SwiftShader)'
    if 'metal renderer:' in low:
        return 'GPU · Metal · ' + gl[low.index('metal renderer:') + 15:].split(',')[0].strip()
    return 'GPU · ' + gl[:60]


def launch(pw, gpu):
    """the first browser that starts AND draws WebGL2 (the demos need it): returns (browser, options, renderer name)"""
    tries = []
    if gpu and IS_MAC:
        tries += [dict(channel='chrome', args=GPU_MAC + COMMON), dict(channel='chromium', args=GPU_MAC + COMMON)]
    tries += [dict(args=SOFT + COMMON)]
    shell = headless_shell()
    if shell:
        tries += [dict(executable_path=shell, args=SOFT + COMMON)]
    last = None
    for opt in tries:
        try:
            browser = pw.chromium.launch(headless=True, **opt)
        except Exception as e:      # that browser is not installed: the next one
            last = e; continue
        try:
            p = browser.new_page(); gl = p.evaluate(GL_PROBE); p.close()
        except Exception as e:
            gl = ''; last = e
        if gl:
            return browser, opt, gl
        last = last or 'WebGL2를 쓸 수 없음'
        browser.close()
    raise RuntimeError(f'WebGL2로 그릴 수 있는 Chrome을 띄우지 못했습니다 ({last}). 가상환경을 쓰면 {VENV / ".chromium-installed"} 를 지우고 '
                       '다시 실행해 Chromium을 새로 받으세요 (--no-venv면 python3 -m playwright install chromium).')


# ---------------------------------------------------------------- the font check (no glyph may come from a system font)
# Every canvas text is recorded with the font it was drawn in (a canvas is opaque to the DOM check); the DOM's visible
# text is asked, through Chrome's DevTools protocol, which font files actually drew it — a "platform" font is a system font.
CANVAS_REC = '''(() => {
  const seen = new Map(); window.__canvasText = seen;
  for (const C of [window.CanvasRenderingContext2D, window.OffscreenCanvasRenderingContext2D]) {
    if (!C) continue;
    for (const m of ['fillText', 'strokeText']) {
      const orig = C.prototype[m];
      C.prototype[m] = function (text, ...rest) {
        const f = String(this.font), k = f + '\\u0000' + text;
        if (seen.size < 20000 && !seen.has(k)) seen.set(k, { font: f, text: String(text) });
        return orig.call(this, text, ...rest);
      };
    }
  }
})();'''
CANVAS_BAD = '''() => {
  const GEN = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|emoji|math|fangsong)$/i;
  const faces = new Set([...document.fonts].map((f) => f.family.replace(/^["']|["']$/g, '').toLowerCase()));
  const out = [], done = new Set();
  for (const { font, text } of (window.__canvasText ? window.__canvasText.values() : [])) {
    if (!text.trim() || done.has(font)) continue;
    const m = font.match(/\\d+(?:\\.\\d+)?px(?:\\s*\\/\\s*[\\d.]+\\w*)?\\s+(.+)$/);
    const fams = (m ? m[1] : font).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    const first = fams.find((x) => !GEN.test(x));
    if (!first || !faces.has(first.toLowerCase())) { done.add(font); out.push({ font, text: text.slice(0, 30) }); }
  }
  return out.slice(0, 5);
}'''
OWN_TEXT = '''() => [...document.querySelectorAll('#stage *')].map((el, i) => {
  const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  if (!own) return -1;
  return (el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true) ? i : -1;
}).filter((i) => i >= 0)'''


def dom_fonts(page, cdp, t, found):
    """the system ('platform') fonts that drew visible text at this moment → found[family] = [(t, text), …]"""
    root = cdp.send('DOM.getDocument', {'depth': -1})['root']
    ids = cdp.send('DOM.querySelectorAll', {'nodeId': root['nodeId'], 'selector': '#stage *'})['nodeIds']
    for i in page.evaluate(OWN_TEXT):
        if i >= len(ids):
            continue
        try:
            fonts = cdp.send('CSS.getPlatformFontsForNode', {'nodeId': ids[i]}).get('fonts', [])
        except Exception:
            continue
        for f in fonts:
            if not f.get('isCustomFont') and len(found.setdefault(f['familyName'], [])) < 3:
                text = page.evaluate('(j) => (document.querySelectorAll("#stage *")[j] || {}).textContent', i) or ''
                found[f['familyName']].append((t, ' '.join(text.split())[:30]))


class Retry(Exception):
    """a chunk that went wrong for a passing reason (a file that did not arrive): it is made again from the start"""


LOAD_STATE = '''() => {
  const v = window.__video, t = document.querySelector('.vp-start-title');
  return [!!(v && v.renderReady !== false && document.body.classList.contains('vp-ready')),
          t ? t.textContent.trim() : '', !!(t && t.classList.contains('vp-error'))];
}'''
BUSY = '() => { const v = window.__video; return !!(v && v.renderBusy && v.renderBusy()); }'
# the player's own UI never in the picture — also in projects whose player predates ?render (body.vp-render)
HIDE_UI = '.vp-start, .vp-debug, .vp-rate, .vp-fc, .vp-drop { display: none !important; } body { cursor: none !important; }'
STALL = 15 * 60          # no change in the page's own loading text for this long: stop and say where it stood


def open_page(browser, base, a, b, captions, label, scale=1, size=(1920, 1080), extra=''):
    """open the video for one chunk and wait until it is built; the page's own loading text (장면 n / 15, 작품 n / N) goes
    to the status line while it builds, page errors are reported as they happen"""
    page = browser.new_page(viewport={'width': size[0], 'height': size[1]}, device_scale_factor=scale)   # 4K: the same layout, 2× the pixels
    errors, failed = [], []

    def on_failed(r):                                  # a file that did not arrive (a download the page itself stopped,
        why = r.failure or ''                          # ERR_ABORTED — e.g. the narration — is not a failure)
        if 'ERR_ABORTED' not in why:
            failed.append(f'{r.url.split("/", 3)[-1].split("?")[0]} ({why})')
    page.on('requestfailed', on_failed)
    page.add_init_script(CANVAS_REC)                   # (before any script of the page runs)

    def on_error(e):
        errors.append(str(e)[:300])
        if len(errors) <= 3:
            emit('m', f'{label}: 페이지 오류 — {errors[-1]}')
    page.on('pageerror', on_error)
    q = f'render&embed&from={max(0, a - 1):.2f}&to={b + 1:.2f}' + ('&captions' if captions else '') + extra
    t0 = time.time()
    emit('s', f'{label}: 페이지 여는 중')
    page.goto(f'{base}/index.html?{q}', wait_until='domcontentloaded', timeout=300000)
    last, since = None, time.time()
    while True:
        ok, text, err = page.evaluate(LOAD_STATE)
        if err:
            page.wait_for_timeout(300)                  # (failed-file reports still on their way)
        if failed:
            raise Retry(f'파일 {len(failed)}개를 받지 못함 — {failed[0]}')
        if ok:
            break
        if err:
            raise RuntimeError(f'페이지가 오류를 냈습니다: {text}' + (f' / {errors[0]}' if errors else ''))
        if text != last:
            last, since = text, time.time()
            emit('s', f'{label}: {text or "페이지 여는 중"} ({hms(time.time() - t0)})')
        elif time.time() - since > STALL:
            raise RuntimeError(f'{STALL // 60}분 동안 불러오기가 나아가지 않았습니다 — 마지막 상태: {text!r}'
                               + (f' / 페이지 오류: {errors[0]}' if errors else ''))
        page.wait_for_timeout(500)                      # (also lets Playwright deliver the page's events)
    page.wait_for_load_state('load', timeout=300000)
    page.add_style_tag(content=HIDE_UI)
    page.evaluate('() => document.fonts ? document.fonts.ready.then(() => true) : true')
    if failed:
        raise Retry(f'파일 {len(failed)}개를 받지 못함 — {failed[0]}')
    return page, errors, failed, time.time() - t0


def seek_drawn(page, t):
    """move to t and wait until every demo (and the agent's pages) has drawn it; then two animation frames"""
    page.evaluate('(x) => window.__video.seek(x)', t)
    waited = False
    for _ in range(6000):                               # up to 2 minutes for one frame
        if not page.evaluate(BUSY):
            break
        waited = True
        time.sleep(0.02)
    else:
        emit('m', f'경고: {t:.3f}초 장면이 2분을 기다려도 다 그려지지 않아 그 상태로 찍었습니다')
    if waited:
        page.evaluate('(x) => window.__video.seek(x)', t)
    page.evaluate('() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')


def shot(page, png, fast, size=(1920, 1080)):
    kw = dict(type='png') if png else dict(type='jpeg', quality=95)
    one = lambda: page.screenshot(clip={'x': 0, 'y': 0, 'width': size[0], 'height': size[1]}, animations='disabled', caret='hide', timeout=0, **kw)
    prev = one()
    if fast:
        return prev
    for _ in range(4):                                   # raster can lag a big change: until two captures agree
        cur = one()
        if cur == prev:
            return cur
        prev = cur
        page.evaluate('() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
    return prev


# ---------------------------------------------------------------- the encoder
def encoders():
    try:
        return subprocess.run([FFMPEG, '-hide_banner', '-encoders'], capture_output=True, text=True).stdout
    except Exception:
        return ''


def pick_encoder(choice, codec):
    """'videotoolbox' (the Mac's hardware encoder) or 'software' (libx264 / libx265)"""
    if choice == 'auto':
        return 'videotoolbox' if IS_MAC and f'{codec}_videotoolbox' in encoders() else 'software'
    return 'software' if choice in ('software', 'x264') else choice


ENC_NAME = {('videotoolbox', 'h264'): 'h264_videotoolbox', ('videotoolbox', 'hevc'): 'hevc_videotoolbox',
            ('software', 'h264'): 'libx264', ('software', 'hevc'): 'libx265'}
# hardware bitrates for 1920×1080 at 60 fps (Mbit/s, high · max); other sizes scale with the pixel count^0.75 (4K ≈ ×2.8,
# within YouTube's 4K60 range), ×0.6 at 40 fps or less; HEVC carries the same picture in about two thirds
VT_MBPS = {'h264': (30, 60), 'hevc': (20, 40)}


def ff_args(encoder, codec, pixels, quality, fps, png, out, size=None):
    a = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', str(fps), '-c:v', 'png' if png else 'mjpeg', '-i', '-',
         # the movie's exact size (even: yuv420p needs it) — at 480p the capture is 853⅓ px wide and lands on 853 or 854
         '-vf', (f'scale={size[0]}:{size[1]}:flags=lanczos:' if size else 'scale=trunc(iw/2)*2:trunc(ih/2)*2:') +
         'out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', ENC_NAME[encoder, codec]]
    if encoder == 'videotoolbox':
        mbps = VT_MBPS[codec][quality == 'max'] * (pixels / (1920 * 1080)) ** 0.75 * (1 if fps > 40 else 0.6)
        a += ['-profile:v', 'high' if codec == 'h264' else 'main', '-b:v', f'{mbps:.0f}M', '-maxrate', f'{mbps * 1.5:.0f}M', '-bufsize', f'{mbps * 2:.0f}M']
    elif codec == 'h264':
        a += ['-profile:v', 'high'] + {'high': ['-preset', 'medium', '-crf', '16'], 'max': ['-preset', 'slow', '-crf', '12']}[quality]
    else:
        a += ['-profile:v', 'main', '-x265-params', 'log-level=error'] + {'high': ['-preset', 'medium', '-crf', '18'], 'max': ['-preset', 'slow', '-crf', '14']}[quality]
    if codec == 'hevc':
        a += ['-tag:v', 'hvc1']                         # the tag Apple's players (QuickTime, iPhone) need for HEVC in MP4
    # the colour description is also written into the stream itself (VideoToolbox leaves primaries and transfer out:
    # players then guess) — BT.709, limited range
    return a + ['-r', str(fps), '-g', str(fps * 2), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
                '-bsf:v', f'{codec}_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0', out]


# ---------------------------------------------------------------- progress: one live status line for the whole render
# Workers (or the main process, with one job) send ('f', 1) per frame and ('m', text) for news through one queue; the
# main process keeps the totals and redraws a single line every half second: frames done / all, %, elapsed, frames per
# second and the time left (measured from the first rendered frame, so browser start-up does not skew it). News lines
# are printed above it. When the output is not a terminal (a log file), the status is a plain line every 15 seconds.
Q = None


def _init_worker(q):
    global Q
    Q = q
    signal.signal(signal.SIGINT, signal.SIG_IGN)       # Ctrl+C is handled once, by the main process
    parent = os.getppid()

    def orphan_watch():                                 # the main process was killed outright (no Ctrl+C): don't go on alone
        while os.getppid() == parent:
            time.sleep(2)
        os._exit(1)
    threading.Thread(target=orphan_watch, daemon=True).start()


def emit(kind, v):
    if Q is not None:
        Q.put((kind, v))
    elif kind == 'm':
        (warn if PROBLEM.search(v) else say)(v)


def hms(sec):
    sec = int(max(0, sec))
    return f'{sec // 3600}:{sec // 60 % 60:02d}:{sec % 60:02d}' if sec >= 3600 else f'{sec // 60}:{sec % 60:02d}'


def cells(c):
    return 2 if unicodedata.east_asian_width(c) in 'WFA' else 1      # ambiguous (·, …) counted wide: never wrap


def fit(s, cols):
    if sum(map(cells, s)) <= cols:
        return s
    w = 2
    for i, c in enumerate(s):
        w += cells(c)
        if w > cols:
            return s[:i] + '…'
    return s


class Progress(threading.Thread):
    def __init__(self, q, total, done0):
        super().__init__(daemon=True)
        self.q, self.total, self.done, self.new, self.status = q, total, done0, 0, ''
        self.t0, self.first, self.stop, self.tty = time.time(), None, threading.Event(), sys.stdout.isatty()
        self.last_plain = 0

    def line(self):
        el = time.time() - self.t0
        pct = f'{100 * self.done / self.total:.1f}%'
        if not self.new:
            return f'진행 {pct} · {self.status or "준비 중"} · {self.done:,}/{self.total:,} 프레임 · 경과 {hms(el)}'
        rate = self.new / max(1e-6, time.time() - self.first)
        left = (self.total - self.done) / max(1e-6, rate)
        return f'진행 {pct} · 남은 약 {hms(left)} · {self.done:,}/{self.total:,} 프레임 · 경과 {hms(el)} · 초당 {rate:.2f}장'

    def draw(self, force=False):
        if QUIET:
            return
        if self.tty:
            cols = shutil.get_terminal_size((80, 24)).columns
            sys.stdout.write('\r\033[K' + fit(self.line(), cols - 1)); sys.stdout.flush()
        elif force or time.time() - self.last_plain >= 15:
            print(time.strftime('[%H:%M:%S]'), self.line(), flush=True); self.last_plain = time.time()

    def take(self, kind, v):
        if kind == 'f':
            self.done += v; self.new += v
            if self.first is None:
                self.first = time.time() - 0.001
        elif kind == 's':
            self.status = v
            if QUIET:
                return
            if not self.new and not self.tty:           # a log file: each loading step on its own line until frames flow
                print(time.strftime('[%H:%M:%S]'), self.line(), flush=True); self.last_plain = time.time()
        elif kind == 'm':
            if QUIET:
                if PROBLEM.search(v):
                    warn(v)
                return
            if self.tty:
                sys.stdout.write('\r\033[K')
            print(time.strftime('[%H:%M:%S]'), v, flush=True)

    def run(self):
        import queue as _q
        while not self.stop.is_set():
            try:
                self.take(*self.q.get(timeout=0.5))
            except _q.Empty:
                pass
            self.draw()

    def finish(self, drain=True):
        import queue as _q
        self.stop.set(); self.join(timeout=2)
        while drain:                                    # reports still on their way (not after Ctrl+C: a killed worker
            try:                                        # may have left half a message in the pipe)
                self.take(*self.q.get(timeout=0.3))
            except _q.Empty:
                break
        self.draw(force=True)
        if self.tty and not QUIET:
            print(flush=True)


# ---------------------------------------------------------------- one chunk (a worker process: its own browser and ffmpeg)
def render_chunk(job):
    label = job[5]
    for attempt in range(1, 4):
        try:
            return chunk_once(job)
        except Retry as e:
            if attempt == 3:
                raise RuntimeError(f'{label}: 세 번 해도 안 됨 — {e}')
            emit('m', f'{label}: {e} — 처음부터 다시 ({attempt + 1}/3)')
            time.sleep(2)


def chunk_once(job):
    from playwright.sync_api import sync_playwright
    n0, n1, out, o, base, label = job
    tmp = out + '.part.mp4'
    t_start = time.time()
    sent, ff, flog = 0, None, None
    with sync_playwright() as pw:
        emit('s', f'{label}: 브라우저 띄우는 중')
        browser, how, gl = launch(pw, o['gpu'])
        try:
            emit('m', f'{label}: 브라우저 — {gl_name(gl)} · {how.get("channel") or "chromium"} · 영상 불러오는 중 (프레임 {n0}–{n1 - 1})')
            page, errors, failed, took = open_page(browser, base, n0 / o['fps'], n1 / o['fps'], o['captions'], label, o['scale'], o['size'], o['extra'])
            emit('m', f'{label}: 불러오기 끝 ({hms(took)}) — 그리기 시작')
            sounds = page.evaluate('() => (window.__media && window.__media.audio ? window.__media.audio() : [])')
            if sounds:                                  # the clips that play their own sound (mixed in at the end)
                cj = os.path.join(os.path.dirname(out), 'clips.json')
                with open(cj + '.tmp', 'w', encoding='utf-8') as fh:
                    json.dump(sounds, fh)
                os.replace(cj + '.tmp', cj)
            emit('s', '')
            # ffmpeg in a process group of its own (Ctrl+C in the terminal is the main process's to handle; when this worker
            # is stopped, ffmpeg sees its input end and quits), its messages kept and shown only if it fails
            flog = open(out + '.log', 'w+b')
            ff = subprocess.Popen(ff_args(o['encoder'], o['codec'], o['pixels'], o['quality'], o['fps'], o['png'], tmp, o['out_size']), stdin=subprocess.PIPE,
                                  stderr=flog, start_new_session=True)
            t0 = time.time()
            cdp, system = None, {}
            if o['fontcheck']:
                try:
                    cdp = page.context.new_cdp_session(page); cdp.send('DOM.enable'); cdp.send('CSS.enable')
                except Exception:
                    cdp = None
            every = max(1, int(o['fps'] * 5))
            for n in range(n0, n1):
                seek_drawn(page, n / o['fps'])
                if cdp and (n - n0) % every == 0:
                    try:
                        dom_fonts(page, cdp, n / o['fps'], system)
                    except Exception:
                        pass
                if failed:                              # a file the scene asked for while drawing did not arrive
                    raise Retry(f'그리는 중 파일 {len(failed)}개를 받지 못함 — {failed[0]}')
                ff.stdin.write(shot(page, o['png'], o['fast'], o['size']))
                emit('f', 1); sent += 1
            ff.stdin.close()
            if ff.wait() != 0:
                flog.seek(0)
                raise RuntimeError('ffmpeg 오류: ' + flog.read().decode('utf-8', 'replace').strip()[-800:])
            ff = None
            flog.close(); os.remove(out + '.log')
            os.replace(tmp, out)
            emit('m', f'{label}: 완료 ({hms(time.time() - t0)})' + (f' · 페이지 오류 {len(errors)}건 — 첫 번째: {errors[0]}' if errors else ''))
            if o['fontcheck']:
                for fam, seen in system.items():
                    emit('m', f'{label}: 글꼴 경고 — 시스템 글꼴 "{fam}"이 그린 글자: ' + ' · '.join(f't={t:.1f} "{x}"' for t, x in seen))
                for c in page.evaluate(CANVAS_BAD):
                    emit('m', f'{label}: 글꼴 경고 — 캔버스 글자 "{c["text"]}"를 설치되지 않은 글꼴로 그림 ({c["font"]}) — 시스템 글꼴로 나옵니다')
        except Retry:
            if sent:
                emit('f', -sent)                        # those frames are made again
            raise
        finally:
            if ff is not None and ff.poll() is None:
                ff.kill(); ff.wait()
            browser.close()
    return time.time() - t_start


# ---------------------------------------------------------------- --screenshot: contact sheets instead of a movie
def fmt_t(t):
    return f'{int(t // 60)}:{t % 60:05.2f}'


def face_css(base):
    """the project's own @font-face rules (its installed OFL fonts), pointed at the local server — the sheet's labels use them"""
    out = []
    for css in sorted((ROOT / 'css').glob('*.css')):
        for blk in re.findall(r'@font-face\s*{[^}]*}', css.read_text(encoding='utf-8', errors='replace')):
            out.append(re.sub(r"url\((['\"]?)\.\./", lambda m: f'url({m.group(1)}{base}/', blk))
    return '\n'.join(out)


def compose_sheet(browser, faces, shots, items, header, o):
    """lay the captured frames out on one image: a header line, then the frames in rows, each with frame · time · cue"""
    import base64
    tw, th = o['out_size']
    cols = o['cols']
    rows = (len(shots) + cols - 1) // cols
    pad, lab, head = 16, 34, 58
    SW, SH = pad + cols * (tw + pad), head + rows * (th + lab + pad) + pad // 2
    mime = 'image/png' if o['png'] else 'image/jpeg'
    cells = []
    for k, (img, (n, t, cue)) in enumerate(zip(shots, items)):
        x, y = pad + (k % cols) * (tw + pad), head + (k // cols) * (th + lab + pad)
        cells.append(f'<div class="c" style="left:{x}px;top:{y}px"><img src="data:{mime};base64,{base64.b64encode(img).decode()}">'
                     f'<div class="l"><b>{n}</b> &nbsp;{fmt_t(t)} &nbsp;{cue}</div></div>')
    page = browser.new_page(viewport={'width': SW, 'height': SH}, device_scale_factor=1)
    try:
        page.set_content(f"""<!doctype html><html><head><meta charset="utf-8"><style>{faces}
html, body {{ margin: 0; background: #2a2a2e; }}
.h {{ position: absolute; left: {pad}px; top: 16px; font: 600 26px/1 'Pretendard', sans-serif; color: #e9e6df; white-space: nowrap; }}
.c {{ position: absolute; width: {tw}px; }}
.c img {{ display: block; width: {tw}px; height: {th}px; outline: 1px solid #5a5a62; }}
.c .l {{ height: {lab}px; font: 400 19px/{lab}px 'D2Coding', 'Pretendard', monospace; color: #b9b5ad; white-space: nowrap; overflow: hidden; }}
.c .l b {{ color: #e9e6df; font-weight: 700; }}
</style></head><body><div class="h">{header}</div>{''.join(cells)}</body></html>""", wait_until='load')
        page.evaluate('async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); }')
        kw = dict(type='png') if o['png'] else dict(type='jpeg', quality=90)
        return page.screenshot(clip={'x': 0, 'y': 0, 'width': SW, 'height': SH}, timeout=0, **kw)
    finally:
        page.close()


def render_sheet(job):
    for attempt in range(1, 4):
        try:
            return sheet_once(job)
        except Retry as e:
            if attempt == 3:
                raise RuntimeError(f'{job["label"]}: 세 번 해도 안 됨 — {e}')
            emit('m', f'{job["label"]}: {e} — 처음부터 다시 ({attempt + 1}/3)')
            time.sleep(2)


def sheet_once(job):
    from playwright.sync_api import sync_playwright
    o, base, label, out, items = job['o'], job['base'], job['label'], job['out'], job['items']
    sent, shots = 0, []
    with sync_playwright() as pw:
        emit('s', f'{label}: 브라우저 띄우는 중')
        browser, how, gl = launch(pw, o['gpu'])
        try:
            emit('m', f'{label}: 브라우저 — {gl_name(gl)} · {how.get("channel") or "chromium"} · 영상 불러오는 중 '
                      f'({fmt_t(items[0][1])}–{fmt_t(items[-1][1])}, {len(items)}칸)')
            page, errors, failed, took = open_page(browser, base, items[0][1], items[-1][1] + 1 / o['fps'], o['captions'], label,
                                                   o['scale'], o['size'], o['extra'])
            emit('s', '')
            cdp, system = None, {}
            if o['fontcheck']:
                try:
                    cdp = page.context.new_cdp_session(page); cdp.send('DOM.enable'); cdp.send('CSS.enable')
                except Exception:
                    cdp = None
            for k, (n, t, cue) in enumerate(items):
                seek_drawn(page, t)
                if cdp and k % 12 == 0:
                    try:
                        dom_fonts(page, cdp, t, system)
                    except Exception:
                        pass
                if failed:
                    raise Retry(f'그리는 중 파일 {len(failed)}개를 받지 못함 — {failed[0]}')
                shots.append(shot(page, o['png'], o['fast'], o['size']))
                emit('f', 1); sent += 1
            img = compose_sheet(browser, job['faces'], shots, items, job['header'], o)
            with open(out + '.part', 'wb') as fh:
                fh.write(img)
            os.replace(out + '.part', out)
            emit('m', f'{label}: 완료' + (f' · 페이지 오류 {len(errors)}건 — 첫 번째: {errors[0]}' if errors else ''))
            if o['fontcheck']:
                for fam, seen in system.items():
                    emit('m', f'{label}: 글꼴 경고 — 시스템 글꼴 "{fam}"이 그린 글자: ' + ' · '.join(f't={t:.1f} "{x}"' for t, x in seen))
                for c in page.evaluate(CANVAS_BAD):
                    emit('m', f'{label}: 글꼴 경고 — 캔버스 글자 "{c["text"]}"를 설치되지 않은 글꼴로 그림 ({c["font"]}) — 시스템 글꼴로 나옵니다')
        except Retry:
            if sent:
                emit('f', -sent)
            raise
        finally:
            browser.close()


SR_MIX = 48000


def to_stereo(file):
    """the filter that makes a source stereo the way a browser plays it: mono is copied to both sides at full level
    (ffmpeg's own upmix lowers each side by 3 dB); stereo stays; more channels are mixed down"""
    err = subprocess.run([FFMPEG, '-hide_banner', '-i', str(file)], capture_output=True, text=True).stderr
    m = re.search(r'Audio:[^\n]*?, (mono|stereo),', err)
    return 'pan=stereo|c0=c0|c1=c0' if m and m.group(1) == 'mono' else 'aformat=channel_layouts=stereo'


def vol_at(v, lt):
    """a clip's volume at its local time: a number, or an envelope [[lt, v], …] (linear between points) — as js/media.js"""
    if isinstance(v, (int, float)):
        return float(v)
    if lt <= v[0][0]:
        return v[0][1]
    for (t0, a), (t1, b) in zip(v, v[1:]):
        if lt <= t1:
            return a + (b - a) * (lt - t0) / max(1e-6, t1 - t0)
    return v[-1][1]


def clip_sound(c, a0, a1, path):
    """the part of a clip's sound inside [a0, a1) of the video, as the player plays it (from `in` at `rate`, volume envelope ×
    level match, capped at 1 like <video>.volume), written as raw 48 kHz stereo float; returns (seconds after a0, path)"""
    lt0, lt1 = max(0.0, a0 - c['start']), min(c['dur'], a1 - c['start'])
    if lt1 <= lt0:
        return None
    rate = c.get('rate') or 1
    tempo, r = [], rate                                 # atempo takes 0.5–2 per step: chain for other rates
    while r > 2.0 + 1e-9:
        tempo.append('atempo=2.0'); r /= 2.0
    while r < 0.5 - 1e-9:
        tempo.append('atempo=0.5'); r /= 0.5
    if abs(r - 1) > 1e-6:
        tempo.append(f'atempo={r:.6f}')
    args = [FFMPEG, '-v', 'error', '-ss', f'{c.get("in", 0) + lt0 * rate:.6f}', '-t', f'{(lt1 - lt0) * rate:.6f}', '-i', str(ROOT / c['file'])]
    args += ['-af', ','.join(tempo + [f'aresample={SR_MIX}', to_stereo(ROOT / c['file'])])]
    raw = subprocess.run(args + ['-f', 'f32le', '-'], capture_output=True).stdout
    from array import array
    pcm = array('f'); pcm.frombytes(raw[:len(raw) // 8 * 8])
    n = int(round((lt1 - lt0) * SR_MIX))
    if len(pcm) < 2 * n:
        pcm.extend([0.0] * (2 * n - len(pcm)))
    del pcm[2 * n:]
    vol, B = c.get('vol', 1), 240                      # gain per 5 ms block (smooth enough for an envelope)
    for b0 in range(0, n, B):
        g = min(1.0, max(0.0, vol_at(vol, lt0 + (b0 + B / 2) / SR_MIX)))
        if g != 1.0:
            for i in range(2 * b0, 2 * min(n, b0 + B)):
                pcm[i] *= g
    with open(path, 'wb') as fh:
        pcm.tofile(fh)
    return max(0.0, c['start'] - a0), path


def has_voice(audio, start, span):
    """is anything audible in that stretch of the narration? (the placeholder is digital silence)"""
    r = subprocess.run([FFMPEG, '-hide_banner', '-nostats', '-ss', f'{start:.6f}', '-t', f'{span:.6f}', '-i', str(audio),
                        '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True)
    m = re.search(r'max_volume:\s*(-?[\d.]+|-inf)', r.stderr)
    return bool(m) and m.group(1) != '-inf' and float(m.group(1)) > -60


# ---------------------------------------------------------------- main
SHEET_NAME = re.compile(r'^\d+m\d\d\.\d\ds-\d+m\d\d\.\d\ds_g\d+_\d+\.(?:jpg|png)$')   # what --screenshot writes


def clear_sheets(outdir, own):
    """empty the sheet folder before this run's sheets go in: all of it when it is the project's own screenshots/
    (the tool's folder), only earlier sheets (by their file names) in a folder given with --out — returns how many"""
    if not outdir.is_dir():
        return 0
    gone = 0
    for p in outdir.iterdir():
        if own or (p.is_file() and SHEET_NAME.match(p.name)):
            shutil.rmtree(p) if p.is_dir() and not p.is_symlink() else p.unlink()
            gone += 1
    return gone


def screenshots(o, data, opts, f0, f1, jobs, size, outdir, own_dir=True):
    """--screenshot: every gapframe-th frame of [f0, f1), 480p, laid out cols × rows to a sheet; sheets in outdir"""
    fps, gap = opts['fps'], opts['gap']
    cues = sorted(data.get('cues', []), key=lambda c: c['start'])
    def cue_at(t):
        c = None
        for x in cues:
            if x['start'] <= t + 1e-6:
                c = x
            else:
                break
        return f"[{c['id']}]" if c else ''
    frames = [(n, n / fps, cue_at(n / fps)) for n in range(f0, f1, gap)]
    per = opts['cols'] * opts['rows']
    sheets = [frames[i:i + per] for i in range(0, len(frames), per)]
    ext = 'png' if opts['png'] else 'jpg'
    tag = f'{int(f0 / fps // 60)}m{f0 / fps % 60:05.2f}s-{int(f1 / fps // 60)}m{f1 / fps % 60:05.2f}s_g{gap}'
    wid = max(2, len(str(len(sheets))))
    # the same work-folder rules as a movie: a stopped run goes on, a changed project starts again
    key = hashlib.sha1(json.dumps([str(ROOT), data['duration'], opts, f0, f1], sort_keys=True).encode()).hexdigest()[:12]
    work = Path(tempfile.gettempdir()) / f'burnmp4-sheets-{key}'
    work.mkdir(parents=True, exist_ok=True)
    stamp = project_stamp(); sf = work / 'stamp.txt'
    old = [p for p in work.iterdir() if p.is_file() and p.name != 'stamp.txt']
    if old and (not sf.exists() or sf.read_text() != stamp):
        for p in old:
            p.unlink()
        say('프로젝트 파일이 바뀌어, 전에 만들어 둔 시트를 버리고 새로 만듭니다')
    sf.write_text(stamp)
    httpd, base = serve()
    faces = face_css(base)                              # (read here: the workers don't know the project folder)
    say(f'프로젝트: {ROOT}')
    say(f'스크린샷: {fmt_t(f0 / fps)}–{fmt_t(f1 / fps)} · {gap}프레임마다({gap / fps:.3g}초) · {len(frames)}칸 · 칸 {size} · '
        f'{opts["cols"]}×{opts["rows"]}칸씩 시트 {len(sheets)}장 · 동시 {jobs} · 자막 {"있음" if opts["captions"] else "없음"}')
    todo, done0, made = [], 0, []
    for k, items in enumerate(sheets):
        f = str(work / f'sheet{k:05d}.{ext}')
        made.append(f)
        header = (f'{ROOT.name} · {fmt_t(items[0][1])}–{fmt_t(items[-1][1])} · {gap}프레임마다 ({gap / fps:.3g}초) · '
                  f'시트 {k + 1}/{len(sheets)}')
        if os.path.exists(f):
            done0 += len(items)
        else:
            todo.append(dict(items=items, out=f, o=opts, base=base, faces=faces, label=f'시트 {k + 1}/{len(sheets)}', header=header))
    t0 = time.time()
    ctx = mp.get_context('spawn')
    q = ctx.Queue()
    prog = Progress(q, len(frames), done0)
    prog.start()
    stop = None
    try:
        if todo:
            with ctx.Pool(min(jobs, len(todo)), initializer=_init_worker, initargs=(q,), maxtasksperchild=1) as pool:
                for _ in pool.imap_unordered(render_sheet, todo):
                    pass
    except KeyboardInterrupt:
        stop = '멈췄습니다'
    except Exception:
        stop = '오류로 멈췄습니다'
        tb = traceback.format_exc()
    finally:
        if not stop:
            time.sleep(0.6)
        prog.finish(drain=not stop)
        httpd.shutdown()
    if stop:
        if stop != '멈췄습니다':
            print(tb, file=sys.stderr, flush=True)
        warn(f'{stop}. 끝난 시트 {sum(os.path.exists(f) for f in made)}/{len(made)}장은 남겨 두었습니다 — 같은 명령으로 다시 실행하면 이어서 만듭니다.')
        sys.exit(130 if stop == '멈췄습니다' else 1)
    # only this run's sheets are left in the folder (cleared here, after they are made: a stopped or failed run keeps the
    # earlier ones)
    gone = clear_sheets(outdir, own_dir)
    if gone:
        say(f'{outdir.name}/ 비움 — 전에 있던 {gone}개를 지우고 이번 시트만 넣습니다')
    outdir.mkdir(parents=True, exist_ok=True)
    names = []
    for k, f in enumerate(made):
        dst = outdir / f'{tag}_{k + 1:0{wid}d}.{ext}'
        shutil.copyfile(f, dst); names.append(dst.name)
    shutil.rmtree(work, ignore_errors=True)
    if QUIET:                                           # the whole output: each sheet's full path, one per line
        for n in names:
            print(str((outdir / n).resolve()), flush=True)
        return
    say(f'완성: {outdir} — {names[0]}' + (f' … {names[-1]}' if len(names) > 1 else '') +
        f' ({len(names)}장, {len(frames)}칸) · 걸린 시간 {(time.time() - t0) / 60:.1f}분')


# ---------------------------------------------------------------- contact sheets of a video file (mp4, mov, …)
VIDEO_EXT = ('.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi')


def is_video_file(arg):
    return bool(arg) and Path(arg).expanduser().is_file() and Path(arg).suffix.lower() in VIDEO_EXT


def probe(src):
    """duration, frame rate and display size of a video file, read from ffmpeg's own report (no ffprobe needed)"""
    r = subprocess.run([FFMPEG, '-hide_banner', '-i', str(src)], capture_output=True, text=True, errors='replace')
    err = r.stderr
    m = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', err)
    need(m, f'{src.name}: 길이를 읽지 못했습니다 — 영상 파일이 맞는지 확인해 주세요')
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    # the picture: a video stream that is not a cover image — the default one when there are several (an mkv may carry
    # a cover as a one-frame video stream)
    vids = [l for l in err.splitlines() if re.search(r'Stream #\d+:\d+.*Video:', l) and 'attached pic' not in l]
    need(vids, f'{src.name}: 영상 스트림이 없습니다')
    vline = next((l for l in vids if '(default)' in l), vids[0])
    sid = re.search(r'Stream #(\d+:\d+)', vline).group(1)
    sz = re.search(r'\b(\d{2,5})x(\d{2,5})\b', vline)
    fr = re.search(r'(\d+(?:\.\d+)?)\s*fps', vline) or re.search(r'(\d+(?:\.\d+)?)\s*tbr', vline)
    need(sz and fr, f'{src.name}: 화면 크기나 프레임 속도를 읽지 못했습니다')
    w, h = int(sz.group(1)), int(sz.group(2))
    rot = re.search(r'rotation of (-?\d+(?:\.\d+)?) degrees', err) or re.search(r'rotate\s*:\s*(-?\d+)', err)
    if rot and round(abs(float(rot.group(1)))) % 180 == 90:   # a phone video stored sideways: ffmpeg turns it upright
        w, h = h, w
    return dur, float(fr.group(1)), w, h, sid


def font_root(src):
    """a project whose installed OFL fonts the sheet's labels can use: the one the video sits in, else this file's own"""
    for p in [src.parent, *src.parent.parents]:
        if (p / 'index.html').is_file() and (p / 'css').is_dir():
            return p
    return HERE if (HERE / 'index.html').is_file() and (HERE / 'css').is_dir() else None


def video_sheets(o, src):
    """--screenshot of a video file: every gapframe-th frame of the file's own frames, laid out like a project's sheets
    (a header, then frame number · time under each tile). Frames are cut with ffmpeg, so no project is needed."""
    global ROOT
    need(ffmpeg_bin(), 'ffmpeg — 맥에서는 brew install ffmpeg (없으면 가상환경에 imageio-ffmpeg를 넣어 씁니다)')
    dur, vfps, VW, VH, sid = probe(src)
    fps = o.fps if o.fps is not None else vfps          # frame numbers count in the file's own frames (unless --fps)
    need(fps > 0, '--fps 는 0보다 커야 합니다')
    need(o.gapframe > 0, '--gapframe 은 1 이상이어야 합니다')
    f0 = max(0, round((o.a or 0) * fps))
    f1 = min(int(dur * fps + 1e-6), round(o.b * fps)) if o.b is not None else int(dur * fps + 1e-6)
    need(f1 > f0, f'범위가 비었습니다 (영상 길이 {dur:.2f}초)')
    gap = o.gapframe
    th = 480                                            # tiles 480 px high like a project's sheets, the file's own shape
    tw = max(2, int(round(th * VW / VH / 2)) * 2)
    cols = o.cols or (4 if VW >= VH else 8)
    rows = o.rows or (6 if VW >= VH else 3)
    items = [(n, n / fps, '') for n in range(f0, f1, gap)]
    ext = 'png' if o.png else 'jpg'
    say(f'영상 파일: {src}')
    say(f'스크린샷: {fmt_t(f0 / fps)}–{fmt_t(f1 / fps)} · {gap}프레임마다({gap / fps:.3g}초, {fps:.3g}fps) · {len(items)}칸 · '
        f'칸 {tw}×{th} · {cols}×{rows}칸씩')
    t0 = time.time()
    work = Path(tempfile.mkdtemp(prefix='burnmp4-video-'))
    try:
        # one pass: seek to the first frame, keep every gap-th decoded frame, scale it to the tile. With --fps the frames
        # are first counted at that rate (fps filter), so the numbers and times under the tiles stay true. The stream is
        # the one probe() chose (not a cover image)
        sel = (f'fps={fps},' if o.fps is not None else '') + f"select='not(mod(n\\,{gap}))',scale={tw}:{th}"
        base_cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-ss', f'{f0 / fps:.6f}', '-i', str(src), '-map', sid,
                    '-vf', sel, '-frames:v', str(len(items))]
        q = ['-q:v', '2'] if ext == 'jpg' else []
        r = subprocess.run(base_cmd + ['-fps_mode', 'vfr'] + q + [str(work / f'f%06d.{ext}')], capture_output=True, text=True)
        if r.returncode != 0:                           # an older ffmpeg: -vsync instead of -fps_mode
            r = subprocess.run(base_cmd + ['-vsync', 'vfr'] + q + [str(work / f'f%06d.{ext}')], capture_output=True, text=True)
        need(r.returncode == 0, f'ffmpeg가 프레임을 뽑지 못했습니다: {r.stderr.strip()[-400:]}')
        files = sorted(work.glob(f'f*.{ext}'))
        need(files, '뽑은 프레임이 없습니다')
        items = items[:len(files)]
        shots = [f.read_bytes() for f in files]
        say(f'프레임 {len(files)}장 뽑음 — 시트로 모으는 중')
        # labels in the installed OFL fonts of a project nearby (served locally); without one, the browser's own
        ROOT = font_root(src)
        httpd, faces = None, ''
        if ROOT:
            httpd, base = serve()
            faces = face_css(base)
        per = cols * rows
        sheets = [list(range(i, min(i + per, len(items)))) for i in range(0, len(items), per)]
        outdir = Path(o.out).resolve() if o.out else src.parent / 'screenshots'
        stem = re.sub(r'[^\w.-]+', '_', src.stem)
        tag = f'{stem}_{int(f0 / fps // 60)}m{f0 / fps % 60:05.2f}s-{int(f1 / fps // 60)}m{f1 / fps % 60:05.2f}s_g{gap}'
        wid = max(2, len(str(len(sheets))))
        own = re.compile(rf'^{re.escape(stem)}_\d+m\d\d\.\d\ds-\d+m\d\d\.\d\ds_g\d+_\d+\.(?:jpg|png)$')
        made = []
        from playwright.sync_api import sync_playwright
        try:
            with sync_playwright() as pw:
                browser, _how, _gl = launch(pw, o.gpu)
                try:
                    opts = dict(out_size=(tw, th), cols=cols, png=o.png)
                    for k, idx in enumerate(sheets):
                        its = [items[i] for i in idx]
                        header = (f'{src.name} · {fmt_t(its[0][1])}–{fmt_t(its[-1][1])} · {gap}프레임마다 ({gap / fps:.3g}초) · '
                                  f'시트 {k + 1}/{len(sheets)}')
                        made.append(compose_sheet(browser, faces, [shots[i] for i in idx], its, header, opts))
                        say(f'시트 {k + 1}/{len(sheets)}: 완료')
                finally:
                    browser.close()
        finally:
            if httpd:
                httpd.shutdown()
        # earlier sheets of this video only (by their file names) give way to this run's
        gone = 0
        if outdir.is_dir():
            for p in outdir.iterdir():
                if p.is_file() and own.match(p.name):
                    p.unlink(); gone += 1
        if gone:
            say(f'{outdir.name}/ — 이 영상의 전에 있던 시트 {gone}개를 지우고 이번 시트만 넣습니다')
        outdir.mkdir(parents=True, exist_ok=True)
        paths = []
        for k, img in enumerate(made):
            dst = outdir / f'{tag}_{k + 1:0{wid}d}.{ext}'
            dst.write_bytes(img); paths.append(dst)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    if QUIET:                                           # the whole output: each sheet's full path, one per line
        for p in paths:
            print(str(p.resolve()), flush=True)
        return
    say(f'완성: {outdir} — {paths[0].name}' + (f' … {paths[-1].name}' if len(paths) > 1 else '') +
        f' ({len(paths)}장, {len(items)}칸) · 걸린 시간 {(time.time() - t0) / 60:.1f}분')


def main():
    ap = argparse.ArgumentParser(
        prog='python3 burnmp4.py', formatter_class=argparse.RawTextHelpFormatter, add_help=False,
        usage='%(prog)s [PROJECT] [options]     (PROJECT: 영상 프로젝트 폴더 또는 그 index.html — --screenshot이면 mp4·mov 영상 파일도)',
        description='script-to-motion 영상을 MP4로 굽습니다. 재생하지 않고 프레임마다 그 시각의 장면을 다 그린 뒤 찍으므로\n'
                    '컴퓨터가 느려도 프레임이 빠지지 않습니다(느리면 시간만 더 걸립니다). 처음 실행하면 ~/.cache/burnmp4-venv에\n'
                    '가상환경을 만들고 Playwright·Chromium을 설치한 뒤 시작합니다. 필요한 것: Python 3, ffmpeg(맥: brew install ffmpeg).',
        epilog="""예:
  python3 burnmp4.py ~/videos/my-video                    전체 → ~/videos/my-video/movie.mp4 (60fps, 자막·내레이션 포함)
  python3 burnmp4.py ~/videos/my-video/index.html         index.html을 줘도 같음
  python3 burnmp4.py                                      프로젝트 폴더 안에서는 인자 없이
  python3 burnmp4.py ~/videos/my-video --to 40            앞 40초만 — 먼저 이것으로 속도·화질 확인
  python3 burnmp4.py ~/videos/my-video --from 60 --to 90  1:00–1:30만
  python3 burnmp4.py ~/videos/my-video --res 4k           4K (HEVC)
  python3 burnmp4.py ~/videos/my-video --res 720p         720p — 더 빠르고 파일이 작음
  python3 burnmp4.py ~/videos/my-video --res 480p         480p — 미리보기·공유용
  python3 burnmp4.py ~/videos/my-video --fast --jobs 3    더 빠르게 (한 번만 찍기 + 브라우저 3개)
  python3 burnmp4.py ~/videos/my-video --out ~/Desktop/my-video.mp4
  python3 burnmp4.py ~/videos/my-video --screenshot --from 8 --to 15 --gapframe 5   8–15초를 5프레임마다 한 칸, 시트 이미지로
  python3 burnmp4.py ~/videos/my-video --screenshot --gapframe 300                  5초마다 한 칸 — 영상 전체 훑어보기
  python3 burnmp4.py ~/Movies/clip.mov --screenshot --from 2 --to 6                 영상 파일(mp4·mov 등)도 같은 시트로

진행: 한 줄이 계속 갱신됩니다(진행 % · 남은 시간 · 프레임 · 경과 · 초당 장 수). Ctrl+C로 멈추고 같은 명령을 다시 실행하면
끝난 조각은 건너뛰고 이어서 만듭니다(그사이 프로젝트 파일이 바뀌었으면 처음부터). 영상 클립이 있는 영상은 먼저
스킬의 scripts/stills.mjs로 렌더용 프레임을 잘라 둡니다 — 없으면 이 스크립트가 명령을 알려 주고 멈춥니다.

스크린샷(--screenshot): 재생 중 A 키가 그 순간 앞뒤 1초의 명령을 복사합니다(영상 폴더에서 이 명령 뒤에 붙여 넣기).
출력은 만든 시트 이미지의 전체 경로뿐입니다(한 줄에 하나) — 진행 상황은 --progress로 봅니다.
screenshots/는 실행할 때마다 비웁니다. 자세한 사용법: 스킬의 docs/screenshot.md""")
    g = ap.add_argument_group('무엇을 · 어디에')
    g.add_argument('project', nargs='?', default=None, metavar='PROJECT',
                   help='영상 프로젝트 폴더(index.html이 있는 곳) 또는 그 index.html.\n없으면 지금 폴더, 그다음 이 파일이 있는 폴더.\n'
                        '--screenshot이면 영상 파일(mp4 · mov · m4v · mkv · webm · avi)도 됩니다 —\n그 파일의 프레임으로 같은 모양의 시트를 만듭니다\n'
                        '(프레임 번호는 그 파일의 fps 기준, 시트는 파일 옆 screenshots/)')
    g.add_argument('--from', dest='a', type=float, default=None, metavar='SEC', help='시작 시각, 초 (기본: 0)')
    g.add_argument('--to', dest='b', type=float, default=None, metavar='SEC', help='끝 시각, 초 (기본: 영상 끝)')
    g.add_argument('--out', default=None, metavar='FILE', help='만들 파일 (기본: 프로젝트 폴더의 movie.mp4;\n직접 주면 지금 폴더 기준) — --screenshot이면 폴더\n(기본: 프로젝트 폴더의 screenshots/ — 실행할 때마다 비우고 이번 시트만 남김)')
    g.add_argument('--no-captions', dest='captions', action='store_false', help='자막 없이 (기본: 자막을 영상에 입힘)')
    g.add_argument('--captions', dest='captions', action='store_true', help=argparse.SUPPRESS)   # (the default now; kept so old commands work)
    g.add_argument('--no-audio', dest='audio', action='store_false', help='소리 없이 (기본: 그 구간의 내레이션 + 소리를 켠 영상 클립)')
    g = ap.add_argument_group('스크린샷 (MP4 대신 콘택트 시트)')
    g.add_argument('--screenshot', action='store_true',
                   help='MP4 대신 이미지: 480p로 찍은 프레임 여러 칸을 한 장에 모읍니다\n(칸마다 프레임 번호 · 시각 · cue, 넘치면 여러 장)')
    g.add_argument('--gapframe', type=int, default=30, metavar='N', help='N프레임마다 한 칸 (기본: 30 = 60fps에서 0.5초)')
    g.add_argument('--cols', type=int, default=None, metavar='N', help='한 줄의 칸 수 (기본: 가로 영상 4, 세로 영상 8)')
    g.add_argument('--rows', type=int, default=None, metavar='N', help='한 장의 줄 수 (기본: 가로 영상 6, 세로 영상 3)')
    g.add_argument('--progress', action='store_true',
                   help='진행 상황을 보여 줌 (기본: --screenshot은 다 만든 시트 이미지의\n전체 경로만 한 줄에 하나씩 출력 — 오류·경고는 stderr로)')
    g = ap.add_argument_group('화질')
    g.add_argument('--res', choices=['480p', '720p', '1080p', '4k'], default='1080p',
                   help='480p: 무대의 4/9(16:9면 854×480)\n720p: 무대의 2/3(16:9면 1280×720)\n1080p: 무대 크기 그대로(16:9면 1920×1080)\n4k: 두 배(16:9면 3840×2160)   (기본: 1080p)')
    g.add_argument('--fps', type=int, default=None, metavar='N', help='초당 프레임 수 (기본: 60 — 영상 파일의 시트는 그 파일의 fps)')
    g.add_argument('--quality', choices=['high', 'max'], default='high', help='high: 충분히 좋음 · max: 최상, 파일이 큼 (기본: high)')
    g.add_argument('--codec', choices=['auto', 'h264', 'hevc'], default='auto', help='auto: 1080p는 H.264, 4k는 HEVC(H.265) (기본: auto)')
    g.add_argument('--png', action='store_true', help='무손실 캡처 — 느림 (기본: JPEG 95)')
    g = ap.add_argument_group('속도')
    g.add_argument('--fast', action='store_true', help='프레임마다 한 번만 찍기 — 빠르지만 장면이 크게 바뀌는 순간\n한 프레임이 늦게 찍힐 수 있음 (기본: 두 번 찍어 같을 때까지)')
    g.add_argument('--jobs', type=int, default=None, metavar='N', help='동시에 렌더할 조각 수 = 브라우저 수 (기본: 맥 2, 그 밖 1)')
    g.add_argument('--chunk', type=float, default=20, metavar='SEC', help='조각 길이, 초 — 멈췄다 이어 할 때의 단위 (기본: 20)')
    g = ap.add_argument_group('그 밖')
    g.add_argument('--encoder', choices=['auto', 'videotoolbox', 'software', 'x264'], default='auto',
                   help='auto: 맥이면 하드웨어(VideoToolbox), 아니면 소프트웨어(x264/x265)\n(기본: auto)')
    g.add_argument('--no-gpu', dest='gpu', action='store_false', help='그래픽 칩을 쓰지 않고 소프트웨어로 그리기 — 화면이 깨질 때')
    g.add_argument('--footage', default='media/render-stills', metavar='DIR', help='영상 클립의 렌더용 프레임 폴더 (기본: media/render-stills)')
    g.add_argument('--no-font-check', dest='fontcheck', action='store_false',
                   help='렌더하면서 하는 글꼴 검사를 끔 (기본: 화면 글자는 5초마다, 캔버스 글자는 전부 —\n시스템 글꼴이 그린 글자가 있으면 경고)')
    g.add_argument('--no-venv', dest='venv', action='store_false', help='가상환경 없이 지금 파이썬으로 실행 (Playwright가 설치되어 있어야 함)')
    g.add_argument('-h', '--help', action='help', help='이 도움말')
    o = ap.parse_args()
    global QUIET
    QUIET = o.screenshot and not o.progress
    signal.signal(signal.SIGTERM, signal.default_int_handler)   # `kill` stops it like Ctrl+C (chunks kept, workers stopped)
    global ROOT
    if is_video_file(o.project):                       # a video file: sheets of its own frames (no project needed)
        need(o.screenshot, '영상 파일은 --screenshot(시트 만들기)으로만 쓸 수 있습니다')
        if o.venv and not in_venv():
            bootstrap()
        try:
            import playwright  # noqa: F401
        except ImportError:
            need(False, 'Playwright — 가상환경으로 실행하거나(--no-venv 없이) python3 -m pip install playwright')
        return video_sheets(o, Path(o.project).expanduser().resolve())
    ROOT = find_project(o.project)                     # (before the environment, so a wrong path is said at once)
    if o.venv and not in_venv():
        bootstrap()                                    # does not return: runs this script again inside the environment

    need((ROOT / 'js' / 'cues.js').is_file(), f'{ROOT / "js" / "cues.js"} 가 없습니다 — 스킬의 tts.mjs로 대사 시간표를 먼저 만들어 주세요')
    if o.screenshot:
        o.res = '480p'                                 # sheets are always made of 480p frames
    need(o.screenshot or ffmpeg_bin(), 'ffmpeg — 맥에서는 brew install ffmpeg (없으면 가상환경에 imageio-ffmpeg를 넣어 씁니다)')
    try:
        import playwright  # noqa: F401
    except ImportError:
        need(False, 'Playwright — 가상환경으로 실행하거나(--no-venv 없이) python3 -m pip install playwright')

    data = video_data()
    dur, fps = data['duration'], (o.fps if o.fps is not None else 60)
    need(fps > 0 and o.chunk > 0, '--fps 와 --chunk 는 0보다 커야 합니다')
    f0 = max(0, round((o.a or 0) * fps))
    f1 = min(round(dur * fps), round(o.b * fps)) if o.b is not None else round(dur * fps)
    need(f1 > f0, f'범위가 비었습니다 (영상 길이 {dur:.2f}초)')
    codec = o.codec if o.codec != 'auto' else ('hevc' if o.res == '4k' else 'h264')
    encoder = pick_encoder(o.encoder, codec) if not o.screenshot else 'software'
    need(o.screenshot or ENC_NAME[encoder, codec] in encoders(), f'ffmpeg에 {ENC_NAME[encoder, codec]} 인코더가 없습니다 (--codec h264 또는 --encoder 를 바꿔 보세요)')
    scale = {'480p': 4 / 9, '720p': 2 / 3, '1080p': 1, '4k': 2}[o.res]   # the same layout, drawn with fewer or more pixels
    W, H = stage_size()
    OW, OH = int(round(W * scale / 2)) * 2, int(round(H * scale / 2)) * 2   # the movie's pixel size (nearest even: 854×480)
    size = f'{OW}×{OH}'
    # footage is filmed from frames cut beforehand (headless Chrome plays no H.264): at the render's fps, full size
    clips, extra = footage_clips(), ''
    if clips:
        frames = ROOT / o.footage
        need(frames.is_dir() and any(frames.iterdir()),
             f'영상 클립 {clips}개의 렌더용 프레임 — 먼저 스킬의 stills.mjs로 만들어 주세요:\n'
             f'    node <스킬 폴더>/scripts/stills.mjs . --out {o.footage} --fps {fps} --scale {scale:.4g}')
        extra = f'&frames={o.footage}&mfps={fps}'
    jobs = o.jobs or (2 if IS_MAC else 1)
    opts = dict(fps=fps, encoder=encoder, codec=codec, res=o.res, scale=scale, size=(W, H), pixels=OW * OH, out_size=(OW, OH), extra=extra, fontcheck=o.fontcheck,
                quality=o.quality, png=o.png, fast=o.fast, gpu=o.gpu, captions=o.captions)
    out = Path(o.out).resolve() if o.out else ROOT / 'movie.mp4'
    if o.screenshot:
        need(o.gapframe > 0, '--gapframe 은 1 이상이어야 합니다')
        o.cols = o.cols or (4 if W >= H else 8)
        o.rows = o.rows or (6 if W >= H else 3)
        opts.update(mode='sheet', gap=o.gapframe, cols=o.cols, rows=o.rows)
        return screenshots(o, data, opts, f0, f1, jobs, size, Path(o.out).resolve() if o.out else ROOT / 'screenshots', own_dir=not o.out)

    # chunks live in a temp folder of their own (kept until the movie is made, so a stopped run can go on)
    key = hashlib.sha1(json.dumps([str(ROOT), dur, opts], sort_keys=True).encode()).hexdigest()[:12]
    work = Path(tempfile.gettempdir()) / f'burnmp4-{key}'
    work.mkdir(parents=True, exist_ok=True)
    # chunks made from an older state of the project must not be reused: the files the frames are drawn from are stamped
    stamp = project_stamp(); sf = work / 'stamp.txt'
    old = [p for p in work.iterdir() if p.is_file() and p.name != 'stamp.txt']
    if old and (not sf.exists() or sf.read_text() != stamp):
        n = sum(1 for p in old if p.name[:1].isdigit() and p.name.endswith('.mp4') and '.part' not in p.name)
        for p in old:
            p.unlink()
        say(f'프로젝트 파일이 바뀌어, 전에 만들어 둔 조각 {n}개를 버리고 새로 만듭니다')
    sf.write_text(stamp)
    step = max(1, round(o.chunk * fps))
    parts = [(n, min(f1, n + step)) for n in range(f0, f1, step)]
    httpd, base = serve()
    say(f'프로젝트: {ROOT}')
    say(f'{(f1 - f0) / fps:.1f}초 ({f1 - f0}프레임, {fps}fps, {size}) · 조각 {len(parts)}개 · 동시 {jobs} · '
        f'{"H.264" if codec == "h264" else "HEVC"} · 인코더 {"VideoToolbox(하드웨어)" if encoder == "videotoolbox" else ENC_NAME[encoder, codec]} · '
        f'화질 {o.quality} · 캡처 {"PNG" if o.png else "JPEG 95"} · '
        f'자막 {"있음" if o.captions else "없음"}')
    todo, files, done0 = [], [], 0
    for k, (n0, n1) in enumerate(parts):
        f = str(work / f'{n0:07d}-{n1:07d}.mp4')
        files.append(f)
        if os.path.exists(f):
            say(f'조각 {k + 1}/{len(parts)}: 이미 있음 — 건너뜀'); done0 += n1 - n0
        else:
            todo.append((n0, n1, f, opts, base, f'조각 {k + 1}/{len(parts)}'))
    t0 = time.time()
    # every chunk runs in a fresh worker process (its own browser; memory goes back when it ends), also with one job,
    # so Ctrl+C is handled in one place: here
    ctx = mp.get_context('spawn')
    q = ctx.Queue()
    prog = Progress(q, f1 - f0, done0)
    prog.start()
    stop = None
    try:
        if todo:
            with ctx.Pool(min(jobs, len(todo)), initializer=_init_worker, initargs=(q,), maxtasksperchild=1) as pool:
                for _ in pool.imap_unordered(render_chunk, todo):
                    pass
    except KeyboardInterrupt:
        stop = '멈췄습니다'
    except Exception:
        stop = '오류로 멈췄습니다'
        tb = traceback.format_exc()
    finally:
        if not stop:
            time.sleep(0.6)                              # let the last reports arrive
        prog.finish(drain=not stop)
        httpd.shutdown()
    if stop:
        if stop != '멈췄습니다':
            print(tb, file=sys.stderr, flush=True)
        kept = sum(os.path.exists(f) for f in files)
        warn(f'{stop}. 끝난 조각 {kept}/{len(files)}개는 남겨 두었습니다 — 같은 명령으로 다시 실행하면 이어서 만듭니다.')
        sys.exit(130 if stop == '멈췄습니다' else 1)
    if project_stamp() != stamp:
        say('주의: 렌더하는 동안 프로젝트 파일이 바뀌었습니다 — 조각마다 다른 상태가 찍혔을 수 있습니다')

    # join the chunks; add the narration of the same stretch (t = the video's t) when there is voice in it — a range
    # render gets its own part of the track; a stretch that is still the silent placeholder is left without sound
    lst = work / 'list.txt'
    lst.write_text(''.join(f"file '{f}'\n" for f in files), encoding='utf-8')
    audio = ROOT / data.get('audio', 'audio/narration.mp3')
    a0, span = f0 / fps, (f1 - f0) / fps
    joined = str(work / 'joined.mp4')
    TAG = ['-tag:v', 'hvc1'] if codec == 'hevc' else []
    subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst), '-c', 'copy', joined], check=True)
    # the clips that play their own sound (written by the chunks' pages), mixed with the narration as the player plays them
    cj, clipped = work / 'clips.json', []
    if o.audio and cj.exists():
        for k, c in enumerate(json.loads(cj.read_text(encoding='utf-8'))):
            if not 0.0625 <= (c.get('rate') or 1) <= 16:  # the player scrubs such clips silently
                continue
            if not (ROOT / c['file']).exists():
                say(f'주의: 클립 소리의 원본이 없어 뺍니다 — {c["file"]}'); continue
            r = clip_sound(c, a0, a0 + span, str(work / f'clip{k}.f32'))
            if r:
                clipped.append(r)
    elif o.audio and footage_clips():
        say('주의: 영상 클립의 소리 정보가 없습니다(이번에 그린 조각이 없음) — 클립 소리가 필요하면 조각을 지우고 다시 실행하세요')
    voiced = o.audio and audio.exists() and has_voice(audio, a0, span)
    if voiced or clipped:
        ins, pre, mix, k = ['-i', joined], [], [], 0     # input 0: the picture
        if voiced:
            ins += ['-ss', f'{a0:.6f}', '-t', f'{span:.6f}', '-i', str(audio)]; k += 1
            pre.append(f'[{k}:a]aresample={SR_MIX},{to_stereo(audio)}[n]'); mix.append('[n]')
        for at, raw in clipped:
            ins += ['-f', 'f32le', '-ar', str(SR_MIX), '-ac', '2', '-i', raw]; k += 1
            ms = int(round(at * 1000))
            pre.append(f'[{k}:a]adelay={ms}|{ms}[c{k}]'); mix.append(f'[c{k}]')
        graph = ';'.join(pre + [''.join(mix) + (f'amix=inputs={len(mix)}:normalize=0:dropout_transition=0,' if len(mix) > 1 else '') + 'apad[a]'])
        subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y'] + ins + ['-filter_complex', graph, '-map', '0:v', '-map', '[a]', '-shortest',
                        '-c:v', 'copy'] + TAG + ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', str(out)], check=True)
        sound = '소리: ' + ' + '.join((['내레이션'] if voiced else []) + ([f'클립 소리 {len(clipped)}개'] if clipped else [])) + \
            (' (내레이션은 이 구간 밖이 아직 임시 무음)' if voiced and data.get('placeholder') else '')
    else:
        subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', '-i', joined, '-c', 'copy'] + TAG + ['-movflags', '+faststart', str(out)], check=True)
        sound = '소리 없음' + (' (이 구간의 내레이션은 아직 임시 무음)' if o.audio and data.get('placeholder') else '')
    shutil.rmtree(work, ignore_errors=True)
    say(f'완성: {out} · {(f1 - f0) / fps:.1f}초 · {size} · {sound} · 걸린 시간 {(time.time() - t0) / 60:.1f}분')


if __name__ == '__main__':
    main()
