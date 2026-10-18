"""Integration test: xvfb-run -a python3 -m unittest native/test_terminal.py"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import warnings
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ['HISTFILE'] = os.devnull

spec = importlib.util.spec_from_file_location('studio_terminal', Path(__file__).with_name('terminal.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Gtk, GLib, Gst = module.Gtk, module.GLib, module.Gst


def pump(seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        while Gtk.events_pending():
            Gtk.main_iteration_do(False)
        time.sleep(.01)


class NativeTerminalTest(unittest.TestCase):
    def test_full_video_advances_on_eos_and_repeat_one_restarts(self):
        warnings.filterwarnings('ignore', category=DeprecationWarning)
        Gst.init(None)
        with tempfile.TemporaryDirectory() as directory:
            video = Path(directory) / 'short.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                'color=c=black:s=32x32:r=10', '-t', '1.2', '-c:v', 'libx264', str(video)], check=True)
            playback = {'token': 'test:1', 'isPlaying': True, 'durationMode': 'full-video'}
            ended = []

            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *_):
                    pass

                def do_GET(self):
                    data = {'settings': {'profiles': {'defaults': {}}, 'schemes': []},
                            'mediaPath': str(video), 'playlistPlayback': playback.copy()}
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(json.dumps(data).encode())

                def do_POST(self):
                    data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                    if data['token'] == playback['token']:
                        ended.append(data)
                        playback['token'] = 'test:' + str(len(ended) + 1)
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'{"advanced":true}')

            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            window = module.StudioTerminal(argparse.Namespace(server=f'http://127.0.0.1:{server.server_port}',
                status_file=str(Path(directory) / 'status.json')))
            tab = window.current_tab
            pump(.3)
            shell = tab.shell_pid
            try:
                deadline = time.monotonic() + 8
                while len(ended) < 2 and time.monotonic() < deadline:
                    pump(.1)
                self.assertGreaterEqual(len(ended), 2)
                self.assertEqual(ended[0], {'token': 'test:1', 'mediaPath': str(video)})
                self.assertEqual(ended[1]['token'], 'test:2')
                self.assertEqual(tab.shell_pid, shell)
                playback['isPlaying'] = False
                pump(.6)
                count = len(ended)
                pump(1.6)
                self.assertEqual(len(ended), count)
            finally:
                window.destroy()
                server.shutdown()
                server.server_close()
                pump(.2)

    @staticmethod
    def click_close(tab):
        button = tab.close_button
        event_window = button.get_event_window()
        pointer = module.Gdk.Display.get_default().get_default_seat().get_pointer()
        enter = module.Gdk.Event.new(module.Gdk.EventType.ENTER_NOTIFY)
        enter.window = event_window
        enter.set_device(pointer)
        enter.x = enter.y = 5
        enter.mode = module.Gdk.CrossingMode.NORMAL
        enter.detail = module.Gdk.NotifyType.NONLINEAR
        Gtk.main_do_event(enter)
        for event_type in [module.Gdk.EventType.BUTTON_PRESS, module.Gdk.EventType.BUTTON_RELEASE]:
            event = module.Gdk.Event.new(event_type)
            event.window = event_window
            event.set_device(pointer)
            event.x = event.y = 5
            event.button = 1
            event.time = module.Gdk.CURRENT_TIME
            Gtk.main_do_event(event)

    def test_middle_click_closes_target_tab_and_protects_running_jobs(self):
        warnings.filterwarnings('ignore', category=DeprecationWarning)
        Gst.init(None)
        with tempfile.TemporaryDirectory() as directory:
            window = module.StudioTerminal(argparse.Namespace(server='http://127.0.0.1:1',
                status_file=str(Path(directory) / 'status.json')))
            first = window.current_tab
            idle = window.add_tab()
            busy = window.add_tab(command=['/bin/sleep', '30'])

            def middle_click(tab):
                event = module.Gdk.Event.new(module.Gdk.EventType.BUTTON_PRESS)
                event.window = tab.tab_button.get_window()
                event.set_device(module.Gdk.Display.get_default().get_default_seat().get_pointer())
                event.x = event.y = 5
                event.button = 2
                event.time = module.Gdk.CURRENT_TIME
                Gtk.main_do_event(event)
                pump(.1)

            try:
                pump(.4)
                window.select_tab(first)
                # Closing an inactive tab must not select it or disturb the shell.
                middle_click(idle)
                self.assertNotIn(idle, window.tabs)
                self.assertEqual(window.current_tab, first)
                prompts = []
                window.confirm_close = lambda jobs, target: prompts.append((jobs, target)) or False
                middle_click(busy)
                self.assertEqual(prompts, [(['sleep'], 'tab')])
                self.assertIn(busy, window.tabs)
                self.assertEqual(window.current_tab, first)
                window.confirm_close = lambda *_: True
                middle_click(busy)
                self.assertNotIn(busy, window.tabs)
                self.assertEqual(window.current_tab, first)
                middle_click(first)
                self.assertTrue(window.closed)
            finally:
                window.destroy()
                pump(.2)

    def test_close_button_is_independent_and_keeps_busy_job_protection(self):
        warnings.filterwarnings('ignore', category=DeprecationWarning)
        Gst.init(None)
        with tempfile.TemporaryDirectory() as directory:
            window = module.StudioTerminal(argparse.Namespace(server='http://127.0.0.1:1', status_file=str(Path(directory) / 'status.json')))
            first = window.current_tab
            idle = window.add_tab()
            busy = window.add_tab(command=['/bin/sleep', '30'])
            try:
                pump(.4)
                # GTK buttons cannot contain another interactive button: the outer
                # input window used to intercept clicks intended for the close icon.
                ancestor = idle.close_button.get_parent()
                while ancestor is not window.header:
                    self.assertNotIsInstance(ancestor, Gtk.Button)
                    ancestor = ancestor.get_parent()
                self.click_close(idle)
                pump(.2)
                self.assertNotIn(idle, window.tabs)
                self.assertIn(busy, window.tabs)
                prompts = []
                window.confirm_close = lambda jobs, target: prompts.append((jobs, target)) or False
                self.click_close(busy)
                pump(.2)
                self.assertEqual(prompts, [(['sleep'], 'tab')])
                self.assertIn(busy, window.tabs)
                window.confirm_close = lambda *_: True
                self.click_close(busy)
                pump(.2)
                self.assertNotIn(busy, window.tabs)
                self.assertEqual(window.current_tab, first)
                self.assertTrue(first.tab_button.get_active())
            finally:
                window.destroy()
                pump(.2)

    def test_web_generated_styles_change_existing_widgets_with_job_running(self):
        warnings.filterwarnings('ignore', category=DeprecationWarning)
        Gst.init(None)
        original_path = module.APPEARANCE_PATH
        with tempfile.TemporaryDirectory() as directory:
            style_path = Path(directory) / 'appearance.css'
            base = original_path.read_text()
            style_path.write_text(base)
            module.APPEARANCE_PATH = style_path
            window = module.StudioTerminal(argparse.Namespace(server='http://127.0.0.1:1', status_file=str(Path(directory) / 'status.json')))
            tab = window.current_tab
            try:
                pump(.3)
                tab.terminal.feed_child(b'sleep 30 &\n')
                pump(.3)
                original_pid = tab.shell_pid
                old_width = tab.canvas.get_allocated_width()
                # Exercise the production TypeScript renderer against a GTK
                # window that was already created before these settings existed.
                script = "import { renderLiveAppearance } from './lib/live-appearance'; console.log(renderLiveAppearance({ terminalPadding:24, chromeFontSize:18, headerPaddingX:19, headerPaddingY:5, tabPaddingX:15, tabMinimumWidth:240, closeButtonHoverOpacity:55, statusPaddingX:7, statusFontSize:16, windowButtonSize:28 }));"
                result = subprocess.run(['bun', '-e', script], cwd=Path(__file__).resolve().parent.parent,
                                        capture_output=True, text=True, check=True)
                style_path.write_text(base + '\n' + result.stdout)
                window.periodic_report()
                pump(.2)
                window.check_resize()
                self.assertIsNone(window.style_error)
                self.assertEqual(window.header.get_style_context().get_padding(window.header.get_state_flags()).left, 19)
                self.assertEqual(tab.get_style_context().get_padding(tab.get_state_flags()).left, 24)
                self.assertLess(tab.canvas.get_allocated_width(), old_width)
                self.assertEqual(tab.info.get_style_context().get_padding(tab.info.get_state_flags()).left, 7)
                self.assertGreaterEqual(tab.tab_button.get_allocated_width(), 240)
                self.assertEqual(tab.shell_pid, original_pid)
                self.assertIn('sleep', tab.running_jobs())
                # Restore the authored stylesheet on the same window too.
                style_path.write_text(base)
                window.periodic_report()
                self.assertIsNone(window.style_error)
                self.assertEqual(tab.shell_pid, original_pid)
            finally:
                window.destroy()
                module.APPEARANCE_PATH = original_path
                pump(.1)

    def test_live_chrome_settings_and_stylesheet_preserve_running_shell(self):
        warnings.filterwarnings('ignore', category=DeprecationWarning)
        Gst.init(None)
        original_path = module.APPEARANCE_PATH
        original_layout_path = module.APPEARANCE_LAYOUT_PATH
        with tempfile.TemporaryDirectory() as directory:
            style_path = Path(directory) / 'appearance.css'
            style_path.write_text(original_path.read_text())
            module.APPEARANCE_PATH = style_path
            layout_path = Path(directory) / 'appearance.json'
            layout_path.write_text(original_layout_path.read_text())
            module.APPEARANCE_LAYOUT_PATH = layout_path
            window = module.StudioTerminal(argparse.Namespace(server='http://127.0.0.1:1', status_file=str(Path(directory) / 'status.json')))
            tab = window.current_tab
            try:
                pump(.4)
                shell_pid = tab.shell_pid
                tab.terminal.feed_child(b'sleep 30 &\n')
                pump(.2)
                GLib.source_remove(tab.timers.pop(1))  # Keep the shell/frame loop, isolate this fixture from offline polls.
                settings = {'profiles': {'defaults': {'tabCornerRadius': 18, 'headerHeight': 64,
                            'tabSpacing': 10, 'showStatusBar': False}}, 'schemes': []}
                tab.receive_state({'settings': settings, 'mediaPath': None}, None)
                pump(.15)
                self.assertEqual(tab.shell_pid, shell_pid)
                self.assertIn('sleep', tab.running_jobs())
                self.assertFalse(tab.info.get_visible())
                self.assertEqual(window.tab_strip.get_spacing(), 10)
                window.check_resize()
                self.assertGreaterEqual(window.header.get_allocated_height(), 64)
                css = window.chrome_css.to_string()
                self.assertIn('border-top-left-radius: 18px', css)
                # A layout-file edit updates the existing close button, including
                # non-CSS GTK alignment, without replacing its shell or widgets.
                layout = json.loads(layout_path.read_text())
                layout['closeButton'].update(size=30, valign='end')
                layout_path.write_text(json.dumps(layout))
                original_button = tab.close_button
                window.periodic_report()
                pump(.1)
                window.check_resize()
                self.assertIs(tab.close_button, original_button)
                self.assertEqual(tab.close_button.get_valign(), Gtk.Align.END)
                self.assertEqual((tab.close_button.get_allocated_width(), tab.close_button.get_allocated_height()), (30, 30))
                self.assertEqual(tab.shell_pid, shell_pid)
                self.assertIn('sleep', tab.running_jobs())
                layout_path.write_text('{')
                window.periodic_report()
                self.assertIsNotNone(window.style_error)
                self.assertEqual(tab.close_button.get_valign(), Gtk.Align.END)
                layout['closeButton'].update(size=24, valign='center')
                layout_path.write_text(json.dumps(layout))
                window.periodic_report()
                self.assertIsNone(window.style_error)
                settings = json.loads(json.dumps(settings))
                settings['profiles']['defaults'].update(closeButtonSize=32, closeButtonShape='square')
                tab.receive_state({'settings': settings, 'mediaPath': None}, None)
                pump(.1)
                window.check_resize()
                self.assertEqual(tab.close_button.get_valign(), Gtk.Align.CENTER)
                self.assertEqual((tab.close_button.get_allocated_width(), tab.close_button.get_allocated_height()), (32, 32))
                self.assertEqual(window.close_button_appearance['shape'], 'square')
                self.assertIn('border-top-left-radius: 0', window.chrome_css.to_string())
                # Reload only the local stylesheet without reconstructing any widgets.
                style_path.write_text(style_path.read_text().replace('padding: 3px 7px;', 'padding: 3px 11px;'))
                window.periodic_report()
                self.assertIn('11px', window.chrome_css.to_string())
                self.assertEqual(window.current_tab, tab)
                self.assertEqual(tab.shell_pid, shell_pid)
                self.assertIn('sleep', tab.running_jobs())
                working_css = window.chrome_css.to_string()
                style_path.write_text('broken CSS { invalid: !;')
                window.periodic_report()
                self.assertIsNotNone(window.style_error)
                self.assertEqual(window.chrome_css.to_string(), working_css)
                style_path.write_text(original_path.read_text())
                window.periodic_report()
                self.assertIsNone(window.style_error)
                settings = json.loads(json.dumps(settings))
                settings['profiles']['defaults'].update(headerHeight=36, tabCornerRadius=0, tabSpacing=0)
                tab.receive_state({'settings': settings, 'mediaPath': None}, None)
                pump(.15)
                self.assertEqual(window.tab_strip.get_spacing(), 0)
                self.assertIn('border-top-left-radius: 0', window.chrome_css.to_string())
                self.assertEqual(tab.shell_pid, shell_pid)
                self.assertIn('sleep', tab.running_jobs())
                tab.terminal.feed_child(b"printf '\\nLIVE_%s\\n' APPEARANCE_OK\n")
                pump(.2)
                self.assertIn('LIVE_APPEARANCE_OK', tab.terminal.get_text_format(module.Vte.Format.TEXT))
                # Hide normal status text while always surfacing media/shell errors.
                tab.media_error = 'Example error'
                tab.update_info()
                self.assertTrue(tab.info.get_visible())
            finally:
                window.destroy()
                module.APPEARANCE_PATH = original_path
                module.APPEARANCE_LAYOUT_PATH = original_layout_path
                pump(.2)

    def test_tab_rename_dialog_custom_title_and_reset(self):
        Gst.init(None)
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(server='http://127.0.0.1:1', status_file=str(Path(directory) / 'status.json'))
            window = module.StudioTerminal(args, cwd=directory)
            tab = window.current_tab
            try:
                pump(.3)
                def respond(name, response):
                    def callback():
                        dialogs = [d for d in Gtk.Window.list_toplevels()
                                   if isinstance(d, Gtk.Dialog) and d.get_title() == 'Rename Tab']
                        if not dialogs:
                            return True
                        entry = next(w for w in dialogs[0].get_content_area().get_children() if isinstance(w, Gtk.Entry))
                        entry.set_text(name)
                        dialogs[0].response(response)
                        return False
                    GLib.timeout_add(50, callback)
                # Use the actual context-menu action to open the actual dialog.
                self.assertTrue(window.tab_context_menu(tab))
                tab.context_menu.popdown()
                respond('Build server งานหลัก', Gtk.ResponseType.OK)
                tab.context_menu.get_children()[0].activate()
                self.assertEqual(tab.custom_title, 'Build server งานหลัก')
                tab.update_title(tab.terminal)
                self.assertEqual(tab.label.get_text(), tab.custom_title)
                self.assertEqual(tab.label.get_tooltip_text(), tab.custom_title)
                respond('Discard this', Gtk.ResponseType.CANCEL)
                window.rename_tab(tab)
                self.assertEqual(tab.custom_title, 'Build server งานหลัก')
                other = window.add_tab(title='Other')
                pump(.2)
                self.assertFalse(window.notebook.get_show_tabs())
                self.assertLess(window.header.get_allocated_height(), 60)
                self.assertEqual(window.current_tab, other)
                self.assertEqual([t.tab_button.get_active() for t in window.tabs], [False, True])
                tab.tab_button.clicked()
                self.assertEqual(window.current_tab, tab)
                self.assertEqual([t.tab_button.get_active() for t in window.tabs], [True, False])
                # Clicking the already-selected tab must not deselect it.
                tab.tab_button.clicked()
                self.assertTrue(tab.tab_button.get_active())
                self.assertEqual(window.current_tab, tab)
                window.move_tab(other, 0)
                self.assertEqual(window.notebook.get_nth_page(0), other)
                self.assertEqual(window.tab_strip.get_children()[0], other.tab_button)
                self.assertEqual(window.current_tab, tab)
                tab.context_menu.get_children()[1].activate()
                self.assertIsNone(tab.custom_title)
                self.assertEqual(tab.label.get_text(), tab.terminal.get_window_title() or 'Terminal')
                self.assertEqual(other.custom_title, 'Other')
                respond('', Gtk.ResponseType.OK)
                window.rename_tab(other)
                self.assertIsNone(other.custom_title)
            finally:
                window.destroy()
                pump(.2)

    def test_tabs_and_close_protection_for_foreground_background_and_direct_commands(self):
        warnings.filterwarnings('ignore', category=DeprecationWarning)
        Gst.init(None)
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(server='http://127.0.0.1:1', status_file=str(Path(directory) / 'status.json'))
            window = module.StudioTerminal(args, cwd=directory)
            first = window.current_tab
            try:
                pump(.5)
                self.assertEqual(first.current_directory(), directory)
                self.assertEqual(first.running_jobs(), [])
                second = window.add_tab()
                pump(.5)
                self.assertEqual(len(window.tabs), 2)
                self.assertNotEqual(first.shell_pid, second.shell_pid)
                self.assertEqual(second.current_directory(), directory)
                second.terminal.feed_child(b'sleep 30\n')
                pump(.3)
                self.assertIn('sleep', second.running_jobs())
                def cancel_dialog():
                    dialogs = [dialog for dialog in Gtk.Window.list_toplevels() if isinstance(dialog, Gtk.MessageDialog)]
                    if not dialogs:
                        return True
                    dialog = dialogs[0]
                    self.assertEqual(dialog.get_default_widget().get_label(), 'Keep Running')
                    dialog.response(Gtk.ResponseType.CANCEL)
                    return False
                GLib.timeout_add(50, cancel_dialog)
                window.request_close_tab(second)
                self.assertIn(second, window.tabs)
                prompts = []
                window.confirm_close = lambda jobs, target: prompts.append((jobs, target)) or False
                window.request_close_tab(second)
                self.assertIn(second, window.tabs)
                self.assertEqual(prompts[-1][1], 'tab')
                window.on_delete()
                self.assertFalse(window.closed)
                self.assertEqual(prompts[-1][1], 'window')

                window.confirm_close = lambda jobs, target: True
                window.request_close_tab(second)
                pump(.3)
                self.assertTrue(second.closed)
                self.assertEqual(len(window.tabs), 1)
                first.terminal.feed_child(b'sleep 30 &\n')
                pump(.3)
                self.assertIn('sleep', first.running_jobs())
                direct = window.add_tab(command=['/bin/sleep', '30'])
                pump(.3)
                self.assertIn('sleep', direct.running_jobs())
                window.request_close_tab(direct)
                pump(.2)
                self.assertEqual(len(window.tabs), 1)
                replaced = window.add_tab()
                pump(.3)
                replaced.terminal.feed_child(b'exec sleep 30\n')
                pump(.3)
                self.assertIn('sleep', replaced.running_jobs())
                window.request_close_tab(replaced)
                pump(.2)
                # Closing an idle tab must leave the busy tab untouched.
                idle = window.add_tab()
                pump(.3)
                window.confirm_close = lambda *_: self.fail('Idle tab should not prompt')
                window.request_close_tab(idle)
                self.assertIn(first, window.tabs)
            finally:
                window.destroy()
                pump(.2)

    def test_real_shell_video_gif_and_live_settings(self):
        warnings.filterwarnings('ignore', category=DeprecationWarning)
        Gst.init(None)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video, gif = root / 'clip.mp4', root / 'animation.gif'
            for target in [video, gif]:
                subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                                'testsrc2=size=64x48:rate=8', '-t', '1', '-y', str(target)], check=True)
            window = module.StudioTerminal(argparse.Namespace(server='http://127.0.0.1:1', status_file=str(root / 'status.json')))
            tab = window.current_tab
            # Supply state directly while offline, exercising exactly the UI handler.
            settings = {'profiles': {'defaults': {'font': {'face': 'Monospace', 'size': 14, 'weight': 'normal'},
                                                  'opacity': 58, 'colorScheme': 'Test', 'backgroundImageOpacity': 1}},
                        'schemes': [{'name': 'Test', 'foreground': '#ffffff', 'background': '#112233'}]}
            try:
                pump(.5)
                self.assertGreater(tab.shell_pid, 0)
                tab.terminal.feed_child(b"printf '\\nNATIVE_%s\\n' SHELL_OK\n")
                pump(.5)
                text = tab.terminal.get_text_format(module.Vte.Format.TEXT)
                self.assertIn('NATIVE_SHELL_OK', text)
                tab.receive_state({'settings': settings, 'mediaPath': str(video)}, None)
                pump(2.5)  # Longer than the clip: verify EOS looping continues.
                self.assertIsNone(tab.media_error)
                self.assertGreater(tab.frames, 10)
                self.assertIsNotNone(tab.surface)
                flags = tab.pipeline.get_property('flags')
                self.assertFalse(flags & type(flags).AUDIO)
                pipeline = tab.pipeline
                original_pid = tab.shell_pid
                rate_settings = json.loads(json.dumps(settings))
                rate_settings['profiles']['defaults']['backgroundFrameRate'] = 12
                tab.receive_state({'settings': rate_settings, 'mediaPath': str(video)}, None)
                self.assertIs(tab.pipeline, pipeline)
                self.assertEqual(tab.shell_pid, original_pid)
                self.assertEqual(tab.frame_interval, 83)
                self.assertIn('12/1', tab.rate_filter.get_property('caps').to_string())
                # Render actual widgets: glass must retain alpha without fading text/media.
                window.check_resize()
                image = module.cairo.ImageSurface(module.cairo.FORMAT_ARGB32, window.get_allocated_width(), window.get_allocated_height())
                window.draw(module.cairo.Context(image))
                pixels = bytes(image.get_data())
                for x, y in [(200, 20), (400, 20), (30, 250)]:
                    alpha = pixels[y * image.get_stride() + x * 4 + 3]
                    self.assertTrue(0 < alpha < 255, (x, y, alpha))
                artifact_dir = os.environ.get('NATIVE_TEST_ARTIFACT_DIR')
                if artifact_dir:
                    Path(artifact_dir).mkdir(parents=True, exist_ok=True)
                    image = module.cairo.ImageSurface(module.cairo.FORMAT_ARGB32, window.get_allocated_width(), window.get_allocated_height())
                    window.draw(module.cairo.Context(image))
                    image.write_to_png(str(Path(artifact_dir) / 'native-terminal.png'))
                video_frame_count = tab.frames
                tab.receive_state({'settings': settings, 'mediaPath': str(gif)}, None)
                pump(1)
                self.assertIsNone(tab.media_error)
                self.assertGreater(tab.frames, video_frame_count + 2)
                self.assertIsNone(tab.pipeline)
                self.assertIsNotNone(tab.pixbuf)

                settings = json.loads(json.dumps(settings))
                settings['profiles']['defaults']['font']['size'] = 19
                settings['profiles']['defaults']['backgroundImageAlignment'] = 'bottomRight'
                tab.receive_state({'settings': settings, 'mediaPath': str(gif)}, None)
                self.assertEqual(tab.terminal.get_font().get_size(), 19 * module.Pango.SCALE)
                self.assertAlmostEqual(tab.background.blue, 0x33 / 255)
                self.assertEqual(module.placement(200, 100, 50, 50, 'uniform', 'bottomRight'), (100, 0, 2, 2))

                tab.load_media(str(root / 'missing.mp4'))
                self.assertIsNotNone(tab.media_error)
                tab.terminal.feed_child(b"printf '\\nSTILL_%s\\n' ALIVE\n")
                pump(.5)
                text = tab.terminal.get_text_format(module.Vte.Format.TEXT)
                self.assertIn('STILL_ALIVE', text)
                tab.load_media(None)
                self.assertIsNone(tab.media_error)
            finally:
                window.destroy()
                pump(.1)


if __name__ == '__main__':
    unittest.main()
