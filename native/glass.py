"""Apply only compositor backdrop blur; never filter terminal text or media."""
import sys
from gi.repository import Gio, GLib


def apply(schema_dir, amount):
    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    info = bus.call_sync('org.gnome.Shell', '/org/gnome/Shell',
                         'org.gnome.Shell.Extensions', 'GetExtensionInfo',
                         GLib.Variant('(s)', ('blur-my-shell@aunetx',)),
                         GLib.VariantType.new('(a{sv})'), Gio.DBusCallFlags.NONE, 3000, None).unpack()[0]
    if info.get('state') != 1:
        raise RuntimeError('Enable Blur my Shell in GNOME Extensions to use glass blur')
    source = Gio.SettingsSchemaSource.new_from_directory(
        schema_dir, Gio.SettingsSchemaSource.get_default(), False)
    schema = source.lookup('org.gnome.shell.extensions.blur-my-shell.applications', False)
    if schema is None:
        raise RuntimeError('Blur my Shell application settings are unavailable')
    settings = Gio.Settings.new_full(schema, None, None)
    settings.delay()
    # The compositor must not fade the app's video/text or disable blur on focus.
    for key, value in [('blur', amount > 0), ('customize', True), ('static-blur', False),
                       ('dynamic-opacity', False), ('enable-all', False)]:
        if not settings.set_boolean(key, value):
            raise RuntimeError(f'Cannot set {key}')
    if not settings.set_int('sigma', amount) or not settings.set_int('opacity', 255):
        raise RuntimeError('Cannot set glass blur strength')
    targets = settings.get_strv('whitelist')
    for target in ['com.themestudio.Terminal', 'StudioTerminal', 'studio-terminal', 'terminal.py']:
        if target not in targets:
            targets.append(target)
    if not settings.set_strv('whitelist', targets):
        raise RuntimeError('Cannot target Terminal for glass blur')
    settings.apply()
    Gio.Settings.sync()
    if settings.get_int('sigma') != amount:
        raise RuntimeError('GNOME did not accept glass blur strength')


if __name__ == '__main__':
    amount = int(sys.argv[2])
    if not 0 <= amount <= 60:
        raise ValueError('Glass blur must be between 0 and 60')
    apply(sys.argv[1], amount)
