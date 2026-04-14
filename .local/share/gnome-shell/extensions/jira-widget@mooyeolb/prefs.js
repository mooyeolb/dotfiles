import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class JiraWidgetPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Jira Widget',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // ── Connection ────────────────────────────────────────────────────────
        const connectionGroup = new Adw.PreferencesGroup({
            title: 'Connection',
            description: 'Jira instance URL and authentication',
        });
        page.add(connectionGroup);

        const baseUrlRow = new Adw.EntryRow({ title: 'Base URL' });
        connectionGroup.add(baseUrlRow);

        const tokenRow = new Adw.PasswordEntryRow({ title: 'Personal Access Token' });
        connectionGroup.add(tokenRow);

        const sslRow = new Adw.SwitchRow({
            title: 'Verify SSL Certificate',
            subtitle: 'Disable only when using self-signed certificates',
        });
        connectionGroup.add(sslRow);

        // ── Query ─────────────────────────────────────────────────────────────
        const queryGroup = new Adw.PreferencesGroup({
            title: 'Query',
            description: 'Which issues to display',
        });
        page.add(queryGroup);

        const jqlRow = new Adw.EntryRow({ title: 'JQL Filter' });
        queryGroup.add(jqlRow);

        const maxResultsRow = new Adw.SpinRow({
            title: 'Max Results',
            subtitle: 'Maximum number of issues fetched per refresh',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 100,
                step_increment: 1,
            }),
        });
        queryGroup.add(maxResultsRow);

        // ── Bind to GSettings ─────────────────────────────────────────────────
        settings.bind('base-url',     baseUrlRow,    'text',   Gio.SettingsBindFlags.DEFAULT);
        settings.bind('token',        tokenRow,      'text',   Gio.SettingsBindFlags.DEFAULT);
        settings.bind('verify-ssl',   sslRow,        'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('jql',          jqlRow,        'text',   Gio.SettingsBindFlags.DEFAULT);
        settings.bind('max-results',  maxResultsRow, 'value',  Gio.SettingsBindFlags.DEFAULT);
    }
}
