import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WorktimeWidgetPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'WorkTime Widget',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // ── Company ───────────────────────────────────────────────────────
        const companyGroup = new Adw.PreferencesGroup({
            title: 'Company',
            description: 'Select your company',
        });
        page.add(companyGroup);

        const companies = ['naver', 'line'];
        const companyLabels = new Gtk.StringList();
        companyLabels.append('Naver');
        companyLabels.append('LINE+');

        const companyRow = new Adw.ComboRow({
            title: 'Company',
            model: companyLabels,
        });
        companyRow.set_selected(
            Math.max(0, companies.indexOf(settings.get_string('company')))
        );
        companyRow.connect('notify::selected', () => {
            settings.set_string('company', companies[companyRow.get_selected()]);
        });
        companyGroup.add(companyRow);

        // ── Authentication ────────────────────────────────────────────────
        const authGroup = new Adw.PreferencesGroup({
            title: 'Authentication',
            description: 'SSO login credentials (employee ID & password)',
        });
        page.add(authGroup);

        const usernameRow = new Adw.EntryRow({ title: 'Username (사번)' });
        authGroup.add(usernameRow);

        const passwordRow = new Adw.PasswordEntryRow({ title: 'Password' });
        authGroup.add(passwordRow);

        // ── Workplace ─────────────────────────────────────────────────────
        const workGroup = new Adw.PreferencesGroup({
            title: 'Workplace',
            description: 'Default workplace type for check-in',
        });
        page.add(workGroup);

        const workplaces = ['REMOTE', 'OFFICE'];
        const workLabels = new Gtk.StringList();
        workLabels.append('Remote');
        workLabels.append('Office');

        const workRow = new Adw.ComboRow({
            title: 'Workplace',
            model: workLabels,
        });
        workRow.set_selected(
            Math.max(0, workplaces.indexOf(settings.get_string('workplace')))
        );
        workRow.connect('notify::selected', () => {
            settings.set_string('workplace', workplaces[workRow.get_selected()]);
        });
        workGroup.add(workRow);

        // ── Advanced ──────────────────────────────────────────────────────
        const advGroup = new Adw.PreferencesGroup({
            title: 'Advanced',
        });
        page.add(advGroup);

        const urlRow = new Adw.EntryRow({
            title: 'Base URL Override',
            show_apply_button: true,
        });
        advGroup.add(urlRow);

        // ── Bind to GSettings ─────────────────────────────────────────────
        settings.bind('username',          usernameRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('password',          passwordRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('base-url-override', urlRow,      'text', Gio.SettingsBindFlags.DEFAULT);
    }
}
