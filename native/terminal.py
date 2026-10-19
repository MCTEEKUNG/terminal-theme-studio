#!/usr/bin/env python3
"""Native GTK/VTE shell with animated backgrounds controlled by Theme Studio."""
import argparse
import json
import math
import os
from pathlib import Path
import pwd
import signal
import sys
import threading
import time
import urllib.request

import gi
gi.require_version('Gtk', '3.0')
gi.require_version('Vte', '2.91')
gi.require_version('Gst', '1.0')
from gi.repository import Gtk, Gdk, GdkPixbuf, GLib, Gio, Vte, Pango, Gst
import cairo

APPEARANCE_PATH = Path(__file__).with_name('appearance.css')
APPEARANCE_LAYOUT_PATH = Path(__file__).with_name('appearance.json')

ANSI = ['#0c0c0c', '#c50f1f', '#13a10e', '#c19c00', '#0037da', '#881798', '#3a96dd', '#cccccc',
        '#767676', '#e74856', '#16c60c', '#f9f1a5', '#3b78ff', '#b4009e', '#61d6d6', '#f2f2f2']
COLOR_KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white',
              'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightPurple', 'brightCyan', 'brightWhite']


def rgba(value, fallback='#cccccc'):
    result = Gdk.RGBA()
    if not isinstance(value, str) or not result.parse(value):
        result.parse(fallback)
    return result


def placement(width, height, media_width, media_height, mode, alignment):
    if mode == 'fill':
        sx, sy = width / media_width, height / media_height
    elif mode == 'none':
        sx = sy = 1
    else:
        sx = sy = (max if mode == 'uniformToFill' else min)(width / media_width, height / media_height)
    remaining_x, remaining_y = width - media_width * sx, height - media_height * sy
    alignment = alignment.lower()
    x = 0 if 'left' in alignment else remaining_x if 'right' in alignment else remaining_x / 2
    y = 0 if 'top' in alignment else remaining_y if 'bottom' in alignment else remaining_y / 2
    return x, y, sx, sy


def active_jobs(shell_pid, direct_command=False):
    """Inspect child processes, including background/stopped jobs, without ps parsing."""
    if not shell_pid:
        return []
    processes = {}
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / 'stat').read_text()
            name, fields = stat[stat.index('(') + 1:stat.rindex(')')], stat[stat.rindex(')') + 2:].split()
            if fields[0] not in ('Z', 'X'):
                processes[int(entry.name)] = (int(fields[1]), name)
        except (OSError, ValueError, IndexError):
            continue
    descendants = {shell_pid}
    while True:
        found = {pid for pid, (parent, _) in processes.items() if parent in descendants}
        expanded = descendants | found
        if expanded == descendants:
            break
        descendants = expanded
    jobs = [processes[pid][1] for pid in descendants - {shell_pid} if pid in processes]
    shell_name = Path(pwd.getpwuid(os.getuid()).pw_shell or '/bin/bash').name
    replaced_shell = shell_pid in processes and processes[shell_pid][1].lstrip('-') != shell_name
    if (direct_command or replaced_shell) and shell_pid in processes:
        jobs.insert(0, processes[shell_pid][1])
    return sorted(set(jobs))


class TerminalTab(Gtk.Box):
    def __init__(self, args, window, cwd=None, command=None, title=None, hold=False, env=None):
        super().__init__(orientation=Gtk.Orientation.VERTICAL)
        self.window = window
        self.cwd = cwd or str(Path.home())
        self.command = command
        self.custom_title = title
        self.hold = hold
        self.timers = []
        self.args = args
        self.closed = False
        self.shell_pid = None
        self.frames = 0
        self.media_path = None
        self.media_error = None
        self.connection_error = None
        self.shell_error = None
        self.pipeline = None
        self.rate_filter = None
        self.frame_timer = None
        self.frame_interval = 42
        self.sink = None
        self.animation = self.iterator = self.pixbuf = self.surface = None
        self.defaults = {}
        self.background = rgba('#0c0c0c')
        self.last_settings = None
        self.polling = False
        self.last_report = 0
        self.connect('destroy', self.close_terminal)
        self.connect('map', self.visibility_changed)
        self.connect('unmap', self.visibility_changed)
        layout = self
        overlay = Gtk.Overlay()
        layout.pack_start(overlay, True, True, 0)
        self.canvas = Gtk.DrawingArea()
        self.canvas.connect('draw', self.draw_background)
        overlay.add(self.canvas)
        self.terminal = Vte.Terminal()
        self.terminal.set_scroll_on_keystroke(True)
        self.terminal.set_scrollback_lines(10000)
        self.terminal.set_hexpand(True)
        self.terminal.set_vexpand(True)
        self.terminal.set_clear_background(False)
        self.terminal.connect('child-exited', self.child_exited)
        self.terminal.connect('window-title-changed', self.update_title)
        css = Gtk.CssProvider()
        css.load_from_data(b'vte-terminal { background-color: transparent; padding: 12px; }')
        self.terminal.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        overlay.add_overlay(self.terminal)
        self.info = Gtk.Label(label='Connecting to Theme Studio…', xalign=0)
        self.info.set_name('studio-terminal-footer')
        self.info.set_margin_start(10)
        self.info.set_margin_end(10)
        layout.pack_end(self.info, False, False, 4)
        self.show_all()
        self.terminal.grab_focus()
        self.apply_settings({'profiles': {'defaults': {}}, 'schemes': []})

        shell = pwd.getpwuid(os.getuid()).pw_shell or '/bin/bash'
        env = dict(env or os.environ, TERM='xterm-256color', COLORTERM='truecolor')
        env.pop('DESKTOP_STARTUP_ID', None)
        self.terminal.spawn_async(pty_flags=Vte.PtyFlags.DEFAULT, working_directory=self.cwd, argv=command or [shell],
                                  envv=[f'{k}={v}' for k, v in env.items()], spawn_flags=GLib.SpawnFlags.SEARCH_PATH_FROM_ENVP,
                                  child_setup=None, timeout=-1, cancellable=None, callback=self.shell_started, user_data=None)
        self.frame_timer = GLib.timeout_add(self.frame_interval, self.tick)
        self.timers.append(self.frame_timer)
        self.timers.append(GLib.timeout_add(400, self.poll))
        self.poll()

    def shell_started(self, terminal, pid, error, *_):
        if self.closed:
            if pid > 0:
                try:
                    group = os.getpgid(pid)
                    if group != os.getpgrp():
                        os.killpg(group, signal.SIGHUP)
                except ProcessLookupError:
                    pass
            return
        if error:
            self.shell_error = str(error)
        else:
            self.shell_pid = pid
        self.report()

    def update_title(self, terminal):
        self.window.update_tab_title(self, self.custom_title or terminal.get_window_title() or 'Terminal')

    def child_exited(self, terminal, status):
        self.shell_pid = None
        if self.hold:
            self.info.set_text(f'Command finished (status {status}). Close this tab when ready.')
            self.window.update_tab_title(self, 'Finished')
        else:
            self.window.remove_tab(self)

    def visibility_changed(self, *_):
        if self.pipeline:
            self.pipeline.set_state(Gst.State.PLAYING if self.get_mapped() else Gst.State.PAUSED)

    def running_jobs(self):
        return active_jobs(self.shell_pid, bool(self.command))

    def current_directory(self):
        try:
            directory = os.readlink(f'/proc/{self.shell_pid}/cwd')
            if os.path.isdir(directory):
                return directory
        except OSError:
            pass
        return self.cwd if os.path.isdir(self.cwd) else str(Path.home())

    def poll(self):
        if self.closed:
            return False
        if self.polling:
            return True
        self.polling = True

        def fetch():
            try:
                # Read editor state only. Keyboard input stays inside the native PTY.
                with urllib.request.urlopen(self.args.server + '/api/native/state', timeout=2) as response:
                    data = json.load(response)
                GLib.idle_add(self.receive_state, data, None)
            except Exception as error:
                GLib.idle_add(self.receive_state, None, str(error))
        threading.Thread(target=fetch, daemon=True).start()
        return True

    def receive_state(self, state, error):
        self.polling = False
        if self.closed:
            return False
        self.connection_error = error
        if state:
            settings = state['settings']
            if settings != self.last_settings:
                self.apply_settings(settings)
                self.last_settings = settings
            previous_playback = getattr(self, 'playlist_playback', {})
            self.playlist_playback = state.get('playlistPlayback', {})
            if getattr(self, 'waiting_for_next', False) and self.pipeline:
                if (previous_playback.get('token') != self.playlist_playback.get('token')
                        or not self.playlist_playback.get('isPlaying')
                        or self.playlist_playback.get('durationMode') != 'full-video'):
                    self.waiting_for_next = False
                    self.pipeline.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT, 0)
            media = state.get('mediaPath') or None
            if media != self.media_path:
                self.load_media(media)
        self.update_info()
        return False

    def apply_settings(self, settings):
        self.defaults = settings['profiles']['defaults']
        d = self.defaults
        scheme = next((s for s in settings['schemes'] if s['name'] == d.get('colorScheme')), {})
        fg = rgba(scheme.get('foreground'))
        self.background = rgba(scheme.get('background'), '#0c0c0c')
        transparent = rgba('#000000')
        transparent.alpha = 0
        self.terminal.set_colors(fg, transparent, [rgba(scheme.get(key), ANSI[i]) for i, key in enumerate(COLOR_KEYS)])
        self.terminal.set_color_cursor(rgba(scheme.get('cursorColor'), fg.to_string()))
        self.terminal.set_color_highlight(rgba(scheme['selectionBackground']) if scheme.get('selectionBackground') else None)
        font = d.get('font', {})
        description = Pango.FontDescription()
        description.set_family(font.get('face', 'Monospace') + ',monospace')
        description.set_size(int(float(font.get('size', 12)) * Pango.SCALE))
        weights = {'thin': 100, 'extra-light': 200, 'light': 300, 'semi-light': 350,
                   'normal': 400, 'semi-bold': 600, 'bold': 700, 'extra-bold': 800}
        description.set_weight(weights.get(font.get('weight', 'normal'), 400))
        if self.terminal.get_font() != description:
            self.terminal.set_font(description)
        self.update_frame_rate()
        self.update_info()
        if self.window.current_tab == self:
            self.window.update_chrome(self.background, fg)
        self.canvas.queue_draw()

    def stop_media(self):
        if self.pipeline:
            bus = self.pipeline.get_bus()
            bus.remove_signal_watch()
            self.pipeline.set_state(Gst.State.NULL)
        self.pipeline = self.sink = self.rate_filter = None
        self.animation = self.iterator = self.pixbuf = self.surface = None

    def load_media(self, filename):
        self.stop_media()
        self.waiting_for_next = False
        self.media_path = filename
        self.media_error = None
        if not filename:
            self.canvas.queue_draw()
            return
        try:
            media = Path(filename).resolve(strict=True)
            if media.suffix.lower() in ('.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'):
                self.pipeline = Gst.ElementFactory.make('playbin')
                flags = self.pipeline.get_property('flags')
                self.pipeline.set_property('flags', flags & ~(type(flags).AUDIO | type(flags).TEXT | type(flags).SOFT_VOLUME | type(flags).SOFT_COLORBALANCE))
                video_sink = Gst.parse_bin_from_description(
                    'videorate drop-only=true ! capsfilter name=frame_rate ! videoconvert ! videoscale ! video/x-raw,format=BGRA,width=640,pixel-aspect-ratio=1/1 '
                    '! appsink name=frames max-buffers=1 drop=true sync=true', True)
                self.sink = video_sink.get_by_name('frames')
                self.rate_filter = video_sink.get_by_name('frame_rate')
                self.update_frame_rate()
                self.pipeline.set_property('video-sink', video_sink)
                self.pipeline.set_property('audio-sink', Gst.ElementFactory.make('fakesink'))
                self.pipeline.set_property('uri', media.as_uri())
                bus = self.pipeline.get_bus()
                bus.add_signal_watch()
                bus.connect('message', self.on_media_message)
                if self.pipeline.set_state(Gst.State.PLAYING if self.get_mapped() else Gst.State.PAUSED) == Gst.StateChangeReturn.FAILURE:
                    raise RuntimeError('Video decoder could not start')
            else:
                self.animation = GdkPixbuf.PixbufAnimation.new_from_file(str(media))
                self.iterator = self.animation.get_iter(None)
                self.pixbuf = self.iterator.get_pixbuf()
                self.frames += 1
        except Exception as error:
            self.stop_media()
            self.media_error = str(error)
        self.canvas.queue_draw()
        self.update_info()

    def on_media_message(self, bus, message):
        if message.type == Gst.MessageType.EOS:
            playback = getattr(self, 'playlist_playback', {})
            if self.get_mapped() and playback.get('isPlaying') and playback.get('durationMode') == 'full-video':
                self.waiting_for_next = True
                payload = json.dumps({'token': playback.get('token'), 'mediaPath': self.media_path}).encode()

                def notify():
                    try:
                        request = urllib.request.Request(self.args.server + '/api/playlist/ended', data=payload,
                            headers={'Content-Type': 'application/json', 'X-Theme-Studio': 'native-terminal'})
                        with urllib.request.urlopen(request, timeout=2) as response:
                            response.read()
                    except Exception:
                        # Resume locally after a failed notification; retry at the next EOS.
                        GLib.idle_add(self.retry_media_end)
                threading.Thread(target=notify, daemon=True).start()
                return
            self.pipeline.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT, 0)
        elif message.type == Gst.MessageType.ERROR:
            error, _ = message.parse_error()
            self.media_error = error.message
            self.stop_media()
            self.update_info()

    def retry_media_end(self):
        if not self.closed and self.pipeline and getattr(self, 'waiting_for_next', False):
            self.waiting_for_next = False
            self.pipeline.seek_simple(Gst.Format.TIME, Gst.SeekFlags.FLUSH | Gst.SeekFlags.KEY_UNIT, 0)
        return False

    def update_frame_rate(self):
        value = self.defaults.get('backgroundFrameRate', 24)
        fps = max(12, min(60, int(value))) if isinstance(value, (int, float)) and math.isfinite(value) else 24
        interval = round(1000 / fps)
        if self.rate_filter:
            self.rate_filter.set_property('caps', Gst.Caps.from_string(f'video/x-raw,framerate=(fraction)[1/1,{fps}/1]'))
        if self.frame_timer is not None and self.frame_interval != interval:
            GLib.source_remove(self.frame_timer)
            self.timers.remove(self.frame_timer)
            self.frame_timer = GLib.timeout_add(interval, self.tick)
            self.timers.insert(0, self.frame_timer)
        self.frame_interval = interval

    def queue_media_draw(self):
        # GTK clips both the background and VTE overlay to this dirty rectangle.
        # A narrow portrait clip must not repaint the entire terminal every frame.
        media = self.surface or self.pixbuf
        if media is None:
            return
        width, height = self.canvas.get_allocated_width(), self.canvas.get_allocated_height()
        x, y, sx, sy = placement(width, height, media.get_width(), media.get_height(),
                               self.defaults.get('backgroundImageStretchMode', 'uniform'),
                               self.defaults.get('backgroundImageAlignment', 'center'))
        left, top = max(0, math.floor(x) - 1), max(0, math.floor(y) - 1)
        right = min(width, math.ceil(x + media.get_width() * sx) + 1)
        bottom = min(height, math.ceil(y + media.get_height() * sy) + 1)
        if right > left and bottom > top:
            self.canvas.queue_draw_area(left, top, right - left, bottom - top)

    def tick(self):
        if self.closed:
            return False
        if not self.get_mapped():
            return True
        if self.sink:
            sample = self.sink.emit('try-pull-sample', 0)
            if sample:
                caps = sample.get_caps().get_structure(0)
                width, height = caps.get_value('width'), caps.get_value('height')
                buffer = sample.get_buffer()
                data = bytearray(buffer.extract_dup(0, buffer.get_size()))
                self.surface = cairo.ImageSurface.create_for_data(data, cairo.FORMAT_ARGB32, width, height, width * 4)
                self.frames += 1
                self.queue_media_draw()
        elif self.iterator and self.iterator.advance(None):
            self.pixbuf = self.iterator.get_pixbuf()
            self.frames += 1
            self.queue_media_draw()
        return True

    def draw_background(self, widget, cr):
        width, height = widget.get_allocated_width(), widget.get_allocated_height()
        opacity = self.defaults.get('opacity', 58)
        if not self.window.is_active():
            opacity = self.defaults.get('unfocusedAppearance', {}).get('opacity', opacity)
        alpha = max(0, min(1, opacity / 100))
        cr.set_operator(cairo.OPERATOR_SOURCE)
        # Tint only the glass backing; media and text retain their own alpha.
        cr.set_source_rgba(self.background.red, self.background.green, self.background.blue, alpha)
        cr.paint()
        cr.set_operator(cairo.OPERATOR_OVER)
        if not self.surface and not self.pixbuf:
            return False
        media_width = self.surface.get_width() if self.surface else self.pixbuf.get_width()
        media_height = self.surface.get_height() if self.surface else self.pixbuf.get_height()
        x, y, sx, sy = placement(width, height, media_width, media_height,
                               self.defaults.get('backgroundImageStretchMode', 'uniform'),
                               self.defaults.get('backgroundImageAlignment', 'center'))
        cr.save()
        cr.translate(x, y)
        cr.scale(sx, sy)
        # Keep the actual clip sharp. GNOME blurs the desktop behind the
        # translucent window, independently of these media/text layers.
        if self.surface:
            cr.set_source_surface(self.surface, 0, 0)
        else:
            Gdk.cairo_set_source_pixbuf(cr, self.pixbuf, 0, 0)
        cr.paint_with_alpha(max(0, min(1, self.defaults.get('backgroundImageOpacity', 1))))
        cr.restore()
        return False

    def update_info(self):
        error = self.media_error or self.shell_error or self.connection_error
        prefix = 'Background error: ' if self.media_error else 'Shell error: ' if self.shell_error else 'Studio offline: '
        visible = bool(error) or self.defaults.get('showStatusBar', True)
        text = prefix + error if error else f'{Path(self.media_path).name if self.media_path else "No background"} · Ctrl+Shift+T new tab · Ctrl+Shift+C/V · F11'
        if self.info.get_text() != text or self.info.get_visible() != visible:
            self.info.set_visible(visible)
            self.info.set_text(text)
            self.report()

    def report(self):
        self.window.report()

    def close_terminal(self, *_):
        if self.closed:
            return
        self.closed = True
        for timer in self.timers:
            GLib.source_remove(timer)
        self.stop_media()
        # An approved close hangs up this PTY's session; detached jobs retain
        # their normal nohup/setsid behavior. Never signal the application's group.
        if self.shell_pid:
            try:
                group = os.getpgid(self.shell_pid)
                if group != os.getpgrp():
                    os.killpg(group, signal.SIGHUP)
            except ProcessLookupError:
                pass
        self.terminal.destroy()



def appearance_values(defaults):
    ranges = {'tabCornerRadius': (9, 0, 20), 'headerHeight': (44, 36, 64), 'tabSpacing': (4, 0, 12)}
    result = {}
    for key, (fallback, low, high) in ranges.items():
        value = defaults.get(key, fallback)
        result[key] = max(low, min(high, int(value))) if isinstance(value, (int, float)) and value == value and abs(value) != float('inf') else fallback
    result['showStatusBar'] = defaults.get('showStatusBar', True) is not False
    return result



def close_button_layout(defaults, layout):
    values = dict(layout.get('closeButton', {}))
    values.setdefault('size', 24)
    values.setdefault('shape', 'circle')
    values.setdefault('valign', 'center')
    values.setdefault('halign', 'center')
    for setting, key in [('closeButtonSize', 'size'), ('closeButtonShape', 'shape')]:
        if setting in defaults:
            values[key] = defaults[setting]
    if type(values['size']) is not int or not 18 <= values['size'] <= 36:
        raise ValueError('Close button size must be between 18 and 36')
    if values['shape'] not in ('circle', 'rounded', 'square'):
        raise ValueError('Unknown close button shape')
    for key in ('valign', 'halign'):
        if values[key] not in ('start', 'center', 'end'):
            raise ValueError(f'Invalid close button {key}')
    return values

class TabHeader(Gtk.EventBox):
    """A selectable tab surface, with an independently clickable close button."""
    def __init__(self, activate, close):
        super().__init__()
        self.activate = activate
        self.close_tab = close
        self.set_visible_window(True)
        self.set_above_child(False)
        self.set_can_focus(True)
        self.add_events(Gdk.EventMask.BUTTON_PRESS_MASK)
        self.get_style_context().add_class('terminal-tab')
        # Let GTK's drag source observe presses before consuming title-bar clicks.
        self.connect_after('button-press-event', self.on_press)
        self.connect('key-press-event', self.on_key)

    def on_press(self, widget, event):
        if event.button == 2:
            self.close_tab()
            return True
        if event.button == 1:
            self.clicked()
            return True
        return False

    def on_key(self, widget, event):
        if self.has_focus() and event.keyval in (Gdk.KEY_Return, Gdk.KEY_space):
            self.clicked()
            return True
        return False

    def clicked(self):
        self.activate()

    def set_active(self, active):
        if active:
            self.set_state_flags(Gtk.StateFlags.CHECKED, False)
        else:
            self.unset_state_flags(Gtk.StateFlags.CHECKED)

    def get_active(self):
        return bool(self.get_state_flags() & Gtk.StateFlags.CHECKED)

class StudioTerminal(Gtk.ApplicationWindow):
    def __init__(self, args, application=None, cwd=None, command=None, title=None, hold=False, env=None):
        super().__init__(application=application, title='Terminal — Ubuntu')
        self.args = args
        self.tabs = []
        self.closed = False
        self.switching_tabs = False
        self.set_default_size(1100, 740)
        self.set_icon_name('org.gnome.Ptyxis')
        self.set_wmclass('studio-terminal', 'StudioTerminal')
        self.set_app_paintable(True)
        self.set_name(f'studio-terminal-window-{id(self)}')
        visual = self.get_screen().get_rgba_visual()
        if visual:
            self.set_visual(visual)
        self.header = Gtk.HeaderBar()
        self.header.set_custom_title(Gtk.Box())
        self.header.set_name('studio-terminal-header')
        self.header.set_show_close_button(True)
        self.set_titlebar(self.header)
        add = Gtk.Button.new_from_icon_name('tab-new-symbolic', Gtk.IconSize.BUTTON)
        add.set_tooltip_text('New tab (Ctrl+Shift+T)')
        add.connect('clicked', lambda *_: self.add_tab())
        self.tab_strip = Gtk.Box(spacing=4)
        self.tab_strip.set_name('studio-terminal-tab-strip')
        self.tab_strip.pack_start(add, False, False, 0)
        self.tab_scroll = Gtk.ScrolledWindow()
        self.tab_scroll.set_policy(Gtk.PolicyType.EXTERNAL, Gtk.PolicyType.NEVER)
        self.tab_scroll.set_hexpand(True)
        self.tab_scroll.set_size_request(140, -1)
        self.tab_scroll.add(self.tab_strip)
        self.tab_scroll.connect('scroll-event', self.scroll_tabs)
        self.header.pack_start(self.tab_scroll)
        settings = Gtk.Button.new_from_icon_name('preferences-system-symbolic', Gtk.IconSize.BUTTON)
        settings.set_tooltip_text('Open Theme Studio settings')
        settings.connect('clicked', lambda *_: Gtk.show_uri_on_window(self, args.server, Gdk.CURRENT_TIME))
        self.header.pack_end(settings)
        self.notebook = Gtk.Notebook()
        self.notebook.set_name('studio-terminal-tabs')
        self.chrome_background = rgba('#0c0c0c')
        self.chrome_css = Gtk.CssProvider()
        self.style_stamp = None
        self.style_error = None
        self.chrome_css_data = None
        for widget in (self, self.header, self.notebook):
            widget.get_style_context().add_provider(self.chrome_css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        Gtk.StyleContext.add_provider_for_screen(self.get_screen(), self.chrome_css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.update_chrome(self.chrome_background, rgba('#cccccc'))
        self.notebook.set_show_tabs(False)
        self.notebook.set_show_border(False)
        self.notebook.connect('switch-page', self.switched_tab)
        self.add(self.notebook)
        self.connect('delete-event', self.on_delete)
        self.connect('draw', self.draw_window_base)
        self.connect('destroy', self.on_destroy)
        self.connect('key-press-event', self.on_key)
        self.connect('focus-in-event', self.redraw)
        self.connect('focus-out-event', self.redraw)
        self.report_timer = GLib.timeout_add(1000, self.periodic_report)
        self.add_tab(cwd=cwd, command=command, title=title, hold=hold, env=env)
        self.show_all()

    @property
    def current_tab(self):
        return self.notebook.get_nth_page(self.notebook.get_current_page())

    def add_tab(self, cwd=None, command=None, title=None, hold=False, env=None):
        if cwd is None and self.current_tab:
            cwd = self.current_tab.current_directory()
        tab = TerminalTab(self.args, self, cwd, command, title, hold, env)
        self.tabs.append(tab)
        label_box = Gtk.Box(spacing=6)
        tab.label = Gtk.Label(label=title or Path(tab.cwd).name or 'Terminal')
        tab.label.set_ellipsize(Pango.EllipsizeMode.END)
        tab.label.set_max_width_chars(22)
        tab.label.set_width_chars(16)
        label_box.pack_start(tab.label, True, True, 0)
        close = Gtk.Button.new_from_icon_name('window-close-symbolic', Gtk.IconSize.MENU)
        tab.close_button = close
        close.set_relief(Gtk.ReliefStyle.NONE)
        close.set_tooltip_text('Close tab (Ctrl+Shift+W or middle-click tab)')
        close.connect('clicked', lambda *_: self.request_close_tab(tab))
        label_box.pack_end(close, False, False, 0)
        tab.label_event = TabHeader(lambda: self.select_tab(tab), lambda: self.request_close_tab(tab))
        tab.label_event.set_can_focus(True)
        tab.label_event.add_events(Gdk.EventMask.BUTTON_PRESS_MASK)
        tab.label_event.add(label_box)
        tab.label_event.connect('button-press-event', lambda widget, event: self.tab_context_menu(tab, event))
        tab.label_event.connect('popup-menu', lambda *_: self.tab_context_menu(tab))
        tab.label_event.show_all()
        tab.tab_button = tab.label_event
        targets = [Gtk.TargetEntry.new('application/x-studio-terminal-tab', Gtk.TargetFlags.SAME_APP, 0)]
        tab.tab_button.drag_source_set(Gdk.ModifierType.BUTTON1_MASK, targets, Gdk.DragAction.MOVE)
        tab.tab_button.drag_dest_set(Gtk.DestDefaults.ALL, targets, Gdk.DragAction.MOVE)
        tab.tab_button.connect('drag-data-get', lambda widget, context, data, info, time: data.set_text(str(id(tab)), -1))
        tab.tab_button.connect('drag-data-received', self.drop_tab, tab)
        self.tab_strip.pack_start(tab.tab_button, False, False, 0)
        self.tab_strip.reorder_child(tab.tab_button, len(self.tabs) - 1)
        tab.tab_button.show_all()
        page = self.notebook.append_page(tab, None)
        self.notebook.set_current_page(page)
        tab.show_all()
        tab.terminal.grab_focus()
        self.report()
        return tab

    def drop_tab(self, widget, context, x, y, data, info, time, target):
        source = next((tab for tab in self.tabs if str(id(tab)) == data.get_text()), None)
        if source is not None:
            self.move_tab(source, self.tabs.index(target))
        Gtk.drag_finish(context, source is not None, False, time)

    def move_tab(self, tab, index):
        self.tabs.remove(tab)
        self.tabs.insert(index, tab)
        self.notebook.reorder_child(tab, index)
        self.tab_strip.reorder_child(tab.tab_button, index)

    def select_tab(self, tab):
        page = self.notebook.page_num(tab)
        if page >= 0:
            self.notebook.set_current_page(page)
            tab.tab_button.set_active(True)
            tab.terminal.grab_focus()

    def scroll_tabs(self, widget, event):
        adjustment = self.tab_scroll.get_hadjustment()
        direction = event.direction
        delta = event.get_scroll_deltas()[2] if direction == Gdk.ScrollDirection.SMOOTH else (
            -1 if direction in (Gdk.ScrollDirection.UP, Gdk.ScrollDirection.LEFT) else 1)
        adjustment.set_value(max(adjustment.get_lower(), min(
            adjustment.get_upper() - adjustment.get_page_size(), adjustment.get_value() + delta * 90)))
        return True

    def reveal_tab(self, tab):
        if self.closed or tab not in self.tabs or not hasattr(tab, 'tab_button'):
            return False
        allocation = tab.tab_button.get_allocation()
        adjustment = self.tab_scroll.get_hadjustment()
        if allocation.x < adjustment.get_value():
            adjustment.set_value(allocation.x)
        elif allocation.x + allocation.width > adjustment.get_value() + adjustment.get_page_size():
            adjustment.set_value(allocation.x + allocation.width - adjustment.get_page_size())
        return False

    def tab_context_menu(self, tab, event=None):
        if event is not None and event.button != 3:
            return False
        if not hasattr(tab, 'context_menu'):
            menu = Gtk.Menu()
            menu.attach_to_widget(tab.label_event, None)
            for label, action in [('Rename Tab…', lambda *_: self.rename_tab(tab)),
                                  ('Use Automatic Name', lambda *_: self.set_tab_name(tab, '')),
                                  ('Close Tab', lambda *_: self.request_close_tab(tab))]:
                item = Gtk.MenuItem(label=label)
                item.connect('activate', action)
                menu.append(item)
            menu.show_all()
            tab.context_menu = menu
        if event is not None:
            tab.context_menu.popup_at_pointer(event)
        else:
            tab.context_menu.popup_at_widget(tab.label_event, Gdk.Gravity.SOUTH_WEST, Gdk.Gravity.NORTH_WEST, None)
        return True

    def set_tab_name(self, tab, name):
        # Empty names return to the current shell title. OSC titles cannot replace custom names.
        tab.custom_title = ''.join(char for char in name.strip() if char.isprintable())[:80] or None
        tab.update_title(tab.terminal)

    def rename_tab(self, tab):
        dialog = Gtk.Dialog(title='Rename Tab', transient_for=self, modal=True)
        dialog.add_buttons('Cancel', Gtk.ResponseType.CANCEL, 'Save', Gtk.ResponseType.OK)
        dialog.set_default_response(Gtk.ResponseType.OK)
        content = dialog.get_content_area()
        content.set_border_width(18)
        content.set_spacing(10)
        label = Gtk.Label(label='Tab name (leave empty for automatic)', xalign=0)
        entry = Gtk.Entry()
        entry.set_max_length(80)
        entry.set_text(tab.custom_title or tab.label.get_text())
        entry.set_activates_default(True)
        entry.get_accessible().set_name('Tab name')
        content.pack_start(label, False, False, 0)
        content.pack_start(entry, False, False, 0)
        dialog.show_all()
        entry.grab_focus()
        entry.select_region(0, -1)
        if dialog.run() == Gtk.ResponseType.OK and tab in self.tabs:
            self.set_tab_name(tab, entry.get_text())
        dialog.destroy()

    def update_tab_title(self, tab, title):
        title = tab.custom_title or title
        if hasattr(tab, 'label'):
            tab.label.set_text(title)
            tab.label.set_tooltip_text(title)
        if self.current_tab == tab:
            self.set_title(f'{title} — Terminal')

    def switched_tab(self, notebook, tab, index):
        self.switching_tabs = True
        for candidate in self.tabs:
            if hasattr(candidate, 'tab_button'):
                candidate.tab_button.set_active(candidate == tab)
        self.switching_tabs = False
        GLib.idle_add(self.reveal_tab, tab)
        if hasattr(tab, 'terminal'):
            tab.terminal.grab_focus()
        if hasattr(tab, 'label'):
            self.set_title(f'{tab.label.get_text()} — Terminal')
        if hasattr(tab, 'background'):
            scheme = (tab.last_settings or {}).get('schemes', [])
            active = next((s for s in scheme if s['name'] == tab.defaults.get('colorScheme')), {})
            self.update_chrome(tab.background, rgba(active.get('foreground')))

    def update_chrome(self, background, foreground):
        tab = self.current_tab
        defaults = tab.defaults if tab else {}
        opacity = defaults.get('opacity', 58)
        if not self.is_active():
            opacity = defaults.get('unfocusedAppearance', {}).get('opacity', opacity)
        alpha = max(0, min(1, opacity / 100))
        background = Gdk.RGBA(red=background.red, green=background.green, blue=background.blue, alpha=alpha)
        self.chrome_background, self.chrome_foreground = background, foreground
        bg, fg = background.to_string(), foreground.to_string()
        scope = '#' + self.get_name()
        self.tab_strip.set_spacing(appearance_values(defaults)['tabSpacing'])
        style_path = APPEARANCE_PATH
        try:
            self.style_stamp = (style_path.stat().st_mtime_ns, APPEARANCE_LAYOUT_PATH.stat().st_mtime_ns)
            layout = json.loads(APPEARANCE_LAYOUT_PATH.read_text())
            if not isinstance(layout, dict):
                raise ValueError('Appearance layout must be an object')
            button = close_button_layout(defaults, layout)
            css = style_path.read_text()
            values = appearance_values(defaults)
            tokens = {'__WINDOW__': scope, '__BACKGROUND__': bg, '__FOREGROUND__': fg,
                      '__HEADER_MIN__': str(values['headerHeight'] - 5),
                      '__TAB_RADIUS__': str(values['tabCornerRadius']),
                      '__CLOSE_SIZE__': str(button['size']),
                      '__CLOSE_RADIUS__': str(button['size'] / 2 if button['shape'] == 'circle' else 6 if button['shape'] == 'rounded' else 0)}
            for token, value in tokens.items():
                css = css.replace(token, value)
            # Check the complete new stylesheet before replacing the working one.
            if css != self.chrome_css_data:
                candidate = Gtk.CssProvider()
                candidate.load_from_data(css.encode())
                self.chrome_css.load_from_data(css.encode())
                self.chrome_css_data = css
            # Layout belongs to the same live update as CSS, never just construction.
            alignments = {'start': Gtk.Align.START, 'center': Gtk.Align.CENTER, 'end': Gtk.Align.END}
            for current in self.tabs:
                if hasattr(current, 'close_button'):
                    current.close_button.set_valign(alignments[button['valign']])
                    current.close_button.set_halign(alignments[button['halign']])
            self.close_button_appearance = button
            self.style_error = None
        except (OSError, GLib.Error, ValueError, TypeError) as error:
            self.style_error = f'Appearance update failed: {error}'
        self.queue_draw()

    def draw_window_base(self, widget, cr):
        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        cr.set_operator(cairo.OPERATOR_OVER)
        return False

    def redraw(self, *_):
        self.update_chrome(self.chrome_background, self.chrome_foreground)
        for tab in self.tabs:
            tab.canvas.queue_draw()

    def confirm_close(self, jobs, target):
        dialog = Gtk.MessageDialog(transient_for=self, modal=True, message_type=Gtk.MessageType.WARNING,
                                   buttons=Gtk.ButtonsType.NONE, text=f'Close {target} with running work?')
        dialog.format_secondary_text('Active processes: ' + ', '.join(sorted(set(jobs))) +
                                     '\nClosing may interrupt this work and lose unsaved changes.')
        dialog.add_button('Keep Running', Gtk.ResponseType.CANCEL)
        dialog.add_button(f'Close {target.title()}', Gtk.ResponseType.ACCEPT)
        dialog.set_default_response(Gtk.ResponseType.CANCEL)
        response = dialog.run()
        dialog.destroy()
        return response == Gtk.ResponseType.ACCEPT

    def request_close_tab(self, tab):
        if tab not in self.tabs:
            return
        jobs = tab.running_jobs()
        if jobs and not self.confirm_close(jobs, 'tab'):
            return
        self.remove_tab(tab)

    def remove_tab(self, tab):
        if tab not in self.tabs:
            return
        self.tabs.remove(tab)
        page = self.notebook.page_num(tab)
        if page >= 0:
            self.notebook.remove_page(page)
            tab.tab_button.destroy()
        tab.destroy()
        if not self.tabs:
            self.destroy()
        else:
            self.report()

    def on_delete(self, *_):
        jobs = [name for tab in self.tabs for name in tab.running_jobs()]
        if not jobs or self.confirm_close(jobs, 'window'):
            self.destroy()
        return True

    def on_destroy(self, *_):
        if self.closed:
            return
        self.closed = True
        Gtk.StyleContext.remove_provider_for_screen(self.get_screen(), self.chrome_css)
        GLib.source_remove(self.report_timer)
        for tab in list(self.tabs):
            tab.destroy()
        self.tabs.clear()
        self.report()

    def on_key(self, widget, event):
        tab = self.current_tab
        if not tab:
            return False
        modifiers = event.state & Gtk.accelerator_get_default_mod_mask()
        if modifiers == (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.SHIFT_MASK):
            key = Gdk.keyval_to_lower(event.keyval)
            shortcuts = (Gdk.KEY_t, Gdk.KEY_w, Gdk.KEY_c, Gdk.KEY_v)
            if key not in shortcuts and event.hardware_keycode:
                # Non-Latin layouts change keyval (e.g. Shift+C becomes ฉ in
                # Thai). Resolve the same physical key through the available
                # layout groups, preserving translated Latin shortcuts first.
                keymap = Gdk.Keymap.get_for_display(self.get_display())
                found, _, values = keymap.get_entries_for_keycode(event.hardware_keycode)
                if found:
                    key = next((Gdk.keyval_to_lower(value) for value in values
                                if Gdk.keyval_to_lower(value) in shortcuts), key)
            if key == Gdk.KEY_t:
                self.add_tab()
            elif key == Gdk.KEY_w:
                self.request_close_tab(tab)
            elif key == Gdk.KEY_c:
                tab.terminal.copy_clipboard_format(Vte.Format.TEXT)
            elif key == Gdk.KEY_v:
                tab.terminal.paste_clipboard()
            else:
                return False
            return True
        if modifiers == Gdk.ModifierType.CONTROL_MASK and event.keyval in (Gdk.KEY_Page_Up, Gdk.KEY_Page_Down):
            delta = -1 if event.keyval == Gdk.KEY_Page_Up else 1
            self.notebook.set_current_page((self.notebook.get_current_page() + delta) % len(self.tabs))
            return True
        if modifiers == Gdk.ModifierType.MOD1_MASK and Gdk.KEY_1 <= event.keyval <= Gdk.KEY_9:
            self.notebook.set_current_page(min(event.keyval - Gdk.KEY_1, len(self.tabs) - 1))
            return True
        if event.keyval == Gdk.KEY_F11:
            if self.get_window().get_state() & Gdk.WindowState.FULLSCREEN:
                self.unfullscreen()
            else:
                self.fullscreen()
            return True
        return False

    def periodic_report(self):
        try:
            if (APPEARANCE_PATH.stat().st_mtime_ns, APPEARANCE_LAYOUT_PATH.stat().st_mtime_ns) != self.style_stamp:
                self.update_chrome(self.chrome_background, self.chrome_foreground)
        except OSError as error:
            self.style_error = f'Appearance update failed: {error}'
        self.report()
        return not self.closed

    def report(self):
        application = self.get_application()
        windows = application.get_windows() if application else [self]
        windows = [window for window in windows if isinstance(window, StudioTerminal) and not window.closed]
        tabs = [tab for window in windows for tab in window.tabs if not tab.closed]
        active = self.current_tab if not self.closed else (tabs[0] if tabs else None)
        status = {'state': 'running' if windows else 'stopped', 'pid': os.getpid(),
                  'appearanceLive': True, 'performanceLive': True, 'layoutLive': True, 'playlistEndEvents': True,
                  'closeButtonAppearance': getattr(self, 'close_button_appearance', None), 'appearance': appearance_values(active.defaults) if active else None,
                  'styleError': self.style_error,
                  'shellPid': active.shell_pid if active else None, 'windowCount': len(windows), 'tabCount': len(tabs),
                  'mediaPath': active.media_path if active else None, 'frames': sum(tab.frames for tab in tabs),
                  'error': (active.media_error or active.shell_error or active.connection_error or self.style_error) if active else self.style_error, 'updatedAt': time.time(),
                  'tabs': [{'shellPid': tab.shell_pid, 'cwd': tab.current_directory(), 'mediaPath': tab.media_path} for tab in tabs]}
        target = Path(self.args.status_file)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.tmp')
        temporary.write_text(json.dumps(status))
        temporary.replace(target)


class TerminalApplication(Gtk.Application):
    def __init__(self):
        super().__init__(application_id='com.themestudio.Terminal',
                         flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE | Gio.ApplicationFlags.SEND_ENVIRONMENT)
        for name, short, arg in [('working-directory', 'd', GLib.OptionArg.STRING), ('title', 'T', GLib.OptionArg.STRING),
                                 ('server', '', GLib.OptionArg.STRING), ('status-file', '', GLib.OptionArg.STRING),
                                 ('new-window', '', GLib.OptionArg.NONE), ('present', '', GLib.OptionArg.NONE),
                                 ('hold', '', GLib.OptionArg.NONE)]:
            self.add_main_option(name, ord(short) if short else 0, GLib.OptionFlags.NONE, arg, name, None)

    def do_command_line(self, command_line):
        options = command_line.get_options_dict()
        def option(name, default=None):
            value = options.lookup_value(name, None)
            return value.unpack() if value is not None else default
        argv = command_line.get_arguments()[1:]
        if argv and argv[0] == '--':
            argv = argv[1:]
        cwd = option('working-directory') or command_line.get_cwd() or str(Path.home())
        if not os.path.isabs(cwd):
            cwd = os.path.join(command_line.get_cwd(), cwd)
        if not Path(cwd).is_dir():
            command_line.printerr(f'Working directory does not exist: {cwd}\n')
            return 1
        args = argparse.Namespace(server=option('server', 'http://127.0.0.1:5555'),
                                  status_file=option('status-file', str(Path(__file__).resolve().parent.parent / '.native-runtime/status.json')))
        window = self.get_active_window()
        env = dict(entry.split('=', 1) for entry in command_line.get_environ() if '=' in entry)
        if window and option('present', False):
            window.present()
            return 0
        if window and not option('new-window', False):
            window.add_tab(cwd=cwd, command=argv or None, title=option('title'), hold=option('hold', False), env=env)
        else:
            window = StudioTerminal(args, self, cwd, argv or None, option('title'), option('hold', False), env)
        window.present()
        return 0


def main():
    GLib.set_prgname('com.themestudio.Terminal')
    Gst.init(None)
    return TerminalApplication().run(sys.argv)


if __name__ == '__main__':
    sys.exit(main())
