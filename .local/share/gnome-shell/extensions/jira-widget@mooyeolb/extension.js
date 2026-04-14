import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const REFRESH_INTERVAL_SECONDS = 300; // 5 minutes
const WIDGET_WIDTH = 320;
const WIDGET_MARGIN = 12;

export default class JiraWidget extends Extension {
    enable() {
        this._dragEnabled = false;
        this._motionHandlerId = null;
        this._releaseHandlerId = null;
        this._refreshTimer = null;
        this._countdownTimer = null;
        this._startupCompleteId = null;
        this._overviewShowingId = null;
        this._overviewHiddenId = null;
        this._nextRefreshAt = 0;
        this._spinning = false;
        this._settingsChangedId = null;
        this._settingsChangeTimer = null;
        this._fetchCancellable = null;
        this._startupFallbackId = null;
        this._idleInitId = null;

        this._settings = this.getSettings();
        this._migrateFromJsonConfig();

        // Auto-reload when settings change (debounced 1 s).
        // Connect early so settings changes are never missed.
        this._settingsChangedId = this._settings.connect('changed', () => {
            if (this._settingsChangeTimer)
                GLib.source_remove(this._settingsChangeTimer);
            this._settingsChangeTimer = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, 1, () => {
                    this._settingsChangeTimer = null;
                    this._loadIssues();
                    return GLib.SOURCE_REMOVE;
                }
            );
        });

        if (Main.layoutManager._startingUp) {
            // Defer widget creation until the shell is fully composed.
            this._startupCompleteId = Main.layoutManager.connect(
                'startup-complete', () => {
                    Main.layoutManager.disconnect(this._startupCompleteId);
                    this._startupCompleteId = null;
                    if (this._startupFallbackId) {
                        GLib.source_remove(this._startupFallbackId);
                        this._startupFallbackId = null;
                    }
                    if (!this._widget)
                        this._initWidget();
                }
            );
            // Safety net: some GNOME Shell versions never emit startup-complete.
            this._startupFallbackId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, 5, () => {
                    this._startupFallbackId = null;
                    if (!this._widget)
                        this._initWidget();
                    return GLib.SOURCE_REMOVE;
                }
            );
        } else {
            // Shell already running. Defer one idle tick so any in-progress
            // layout work finishes before we try to insert into the stage.
            this._idleInitId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._idleInitId = null;
                if (!this._widget)
                    this._initWidget();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _initWidget() {
        this._buildWidget();
        this._loadIssues();

        this._overviewShowingId = Main.overview.connect('showing', () => {
            this._widget.hide();
        });
        this._overviewHiddenId = Main.overview.connect('hidden', () => {
            this._widget.show();
        });

        // Sync with current overview state (overview may already be visible
        // if the extension was enabled mid-session with overview open).
        if (Main.overview.visible)
            this._widget.hide();
    }

    disable() {
        if (this._fetchCancellable) {
            this._fetchCancellable.cancel();
            this._fetchCancellable = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._settingsChangeTimer) {
            GLib.source_remove(this._settingsChangeTimer);
            this._settingsChangeTimer = null;
        }
        if (this._idleInitId) {
            GLib.source_remove(this._idleInitId);
            this._idleInitId = null;
        }
        if (this._startupFallbackId) {
            GLib.source_remove(this._startupFallbackId);
            this._startupFallbackId = null;
        }
        if (this._startupCompleteId) {
            Main.layoutManager.disconnect(this._startupCompleteId);
            this._startupCompleteId = null;
        }
        if (this._overviewShowingId) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = null;
        }
        if (this._overviewHiddenId) {
            Main.overview.disconnect(this._overviewHiddenId);
            this._overviewHiddenId = null;
        }
        if (this._refreshTimer) {
            GLib.source_remove(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this._countdownTimer) {
            GLib.source_remove(this._countdownTimer);
            this._countdownTimer = null;
        }
        if (this._motionHandlerId) {
            global.stage.disconnect(this._motionHandlerId);
            this._motionHandlerId = null;
        }
        if (this._releaseHandlerId) {
            global.stage.disconnect(this._releaseHandlerId);
            this._releaseHandlerId = null;
        }
        this._stopSpinner();
        if (this._widget) {
            this._widget.destroy();
            this._widget = null;
        }
        this._settings = null;
    }

    // ── One-time migration from legacy JSON config ───────────────────────────
    _migrateFromJsonConfig() {
        // Only migrate if GSettings has not been configured yet
        if (this._settings.get_string('token') !== '')
            return;

        const configPath = `${GLib.get_home_dir()}/.config/jira-widget/config.json`;
        const file = Gio.File.new_for_path(configPath);
        if (!file.query_exists(null))
            return;

        try {
            const [, bytes] = file.load_contents(null);
            const config = JSON.parse(new TextDecoder().decode(bytes));
            if (config.base_url)    this._settings.set_string('base-url', config.base_url);
            if (config.token)       this._settings.set_string('token', config.token);
            if (config.jql)         this._settings.set_string('jql', config.jql);
            if (config.max_results) this._settings.set_int('max-results', parseInt(config.max_results));
            if (config.verify_ssl !== undefined)
                this._settings.set_boolean('verify-ssl', !!config.verify_ssl);
        } catch (_e) {
            // Migration failed silently; user can configure via the prefs dialog
        }
    }

    _buildWidget() {
        this._widget = new St.BoxLayout({
            style_class: 'jira-widget',
            vertical: true,
            reactive: true,
            width: WIDGET_WIDTH,
        });

        // --- Header (drag handle) ---
        const header = new St.BoxLayout({
            style_class: 'jira-header',
            vertical: false,
            reactive: true,
        });

        const titleBox = new St.BoxLayout({ vertical: true, x_expand: true });
        const title = new St.Label({
            text: 'Jira Tasks',
            style_class: 'jira-title',
        });
        this._lastUpdatedLabel = new St.Label({
            text: '',
            style_class: 'jira-last-updated',
        });
        titleBox.add_child(title);
        titleBox.add_child(this._lastUpdatedLabel);

        this._refreshBtn = new St.Button({
            style_class: 'jira-icon-btn',
            label: '↻',
            reactive: true,
        });
        this._refreshBtn.connect('clicked', () => this._loadIssues());

        header.add_child(titleBox);
        header.add_child(this._refreshBtn);

        // --- Status label ---
        this._statusLabel = new St.Label({
            text: 'Loading…',
            style_class: 'jira-status',
        });

        // --- Scrollable issues list ---
        this._scrollView = new St.ScrollView({
            style_class: 'jira-scroll',
            x_expand: true,
            overlay_scrollbars: true,
        });
        this._issuesList = new St.BoxLayout({
            vertical: true,
            style_class: 'jira-issues-list',
        });
        this._scrollView.set_child(this._issuesList);

        this._widget.add_child(header);
        this._widget.add_child(this._statusLabel);
        this._widget.add_child(this._scrollView);

        // In GNOME Shell 49, backgroundGroup is inside window_group.
        // Add widget to window_group above the background but below windows.
        // If window_group won't render it, fall back to addTopChrome.
        global.window_group.add_child(this._widget);
        const bg = global.window_group.get_first_child();
        if (bg && bg !== this._widget)
            global.window_group.set_child_above_sibling(this._widget, bg);

        this._repositionWidget();
        this._setupDrag(header);
    }

    _repositionWidget() {
        const workArea = Main.layoutManager.getWorkAreaForMonitor(
            Main.layoutManager.primaryIndex
        );
        this._widget.set_position(
            workArea.x + workArea.width - WIDGET_WIDTH - WIDGET_MARGIN,
            workArea.y + WIDGET_MARGIN
        );
    }

    _setupDrag(handle) {
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        handle.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 1) {
                const [ex, ey] = event.get_coords();

                // Don't start drag when clicking the refresh button.
                const target = global.stage.get_actor_at_pos(
                    Clutter.PickMode.REACTIVE, ex, ey
                );
                if (target === this._refreshBtn)
                    return Clutter.EVENT_PROPAGATE;

                this._dragEnabled = true;
                const [wx, wy] = this._widget.get_position();
                dragOffsetX = ex - wx;
                dragOffsetY = ey - wy;
            }
            return Clutter.EVENT_STOP;
        });

        this._motionHandlerId = global.stage.connect('motion-event', (_stage, event) => {
            if (!this._dragEnabled) return Clutter.EVENT_PROPAGATE;
            const [ex, ey] = event.get_coords();
            this._widget.set_position(ex - dragOffsetX, ey - dragOffsetY);
            return Clutter.EVENT_PROPAGATE;
        });

        this._releaseHandlerId = global.stage.connect('button-release-event', () => {
            this._dragEnabled = false;
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _startSpinner() {
        this._spinning = true;
        this._refreshBtn.set_pivot_point(0.5, 0.5);
        this._refreshBtn.rotation_angle_z = 0;
        this._tickSpin();
    }

    _tickSpin() {
        if (!this._spinning) return;
        this._refreshBtn.ease({
            rotation_angle_z: 360,
            duration: 700,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => {
                if (this._spinning) {
                    this._refreshBtn.rotation_angle_z = 0;
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        this._tickSpin();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            },
        });
    }

    _stopSpinner() {
        this._spinning = false;
        if (this._refreshBtn) {
            this._refreshBtn.remove_all_transitions();
            this._refreshBtn.rotation_angle_z = 0;
        }
    }

    _scheduleNextRefresh() {
        if (this._refreshTimer) {
            GLib.source_remove(this._refreshTimer);
        }
        this._refreshTimer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_SECONDS,
            () => {
                this._loadIssues();
                return GLib.SOURCE_REMOVE;
            }
        );
        this._nextRefreshAt = Date.now() + REFRESH_INTERVAL_SECONDS * 1000;
        this._updateCountdownLabel();

        if (this._countdownTimer) {
            GLib.source_remove(this._countdownTimer);
        }
        this._countdownTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._updateCountdownLabel();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _updateCountdownLabel() {
        const secsLeft = Math.max(0, Math.round((this._nextRefreshAt - Date.now()) / 1000));
        const mins = Math.ceil(secsLeft / 60);
        const countdown = secsLeft < 60 ? 'in <1m' : `in ${mins}m`;
        const base = this._lastUpdatedTime ?? '';
        this._lastUpdatedLabel.text = base ? `${base} · ${countdown}` : countdown;
    }

    _loadIssues() {
        if (!this._widget)
            return; // Widget not yet built (waiting for startup-complete)

        const baseUrl = this._settings.get_string('base-url');
        const token   = this._settings.get_string('token');

        if (!baseUrl || !token) {
            this._showError('Open Extensions → Jira Widget → Settings to configure your Jira connection.');
            return;
        }

        // Cancel any in-flight request so there is never more than one running.
        if (this._fetchCancellable) {
            this._fetchCancellable.cancel();
            this._fetchCancellable = null;
        }

        this._refreshBtn.reactive = false;
        this._startSpinner();

        // Only show the status label on initial load (no issues yet).
        // During refresh, the spinner alone indicates activity.
        if (this._issuesList.get_n_children() === 0) {
            this._statusLabel.text = 'Loading…';
            this._statusLabel.show();
        }

        const scriptPath = `${this.path}/jira-fetch.py`;

        // Pass config as JSON on stdin — avoids env-var leakage and works with
        // the original Gio.Subprocess.new() call that is known to be reliable.
        const configJson = JSON.stringify({
            base_url: baseUrl,
            token,
            jql: this._settings.get_string('jql'),
            max_results: this._settings.get_int('max-results'),
            verify_ssl: this._settings.get_boolean('verify-ssl'),
        });

        const cancellable = new Gio.Cancellable();
        this._fetchCancellable = cancellable;

        let proc;
        try {
            proc = Gio.Subprocess.new(
                ['python3', scriptPath],
                Gio.SubprocessFlags.STDIN_PIPE |
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (e) {
            this._fetchCancellable = null;
            this._fetchDone();
            this._showError(`Failed to start fetch script: ${e.message}`);
            return;
        }

        proc.communicate_utf8_async(configJson, cancellable, (p, res) => {
            // If this is still the active request, finalize button/spinner state.
            if (this._fetchCancellable === cancellable) {
                this._fetchCancellable = null;
                this._fetchDone();
            }

            // Ignore results from cancelled (superseded or disabled) requests.
            if (cancellable.is_cancelled())
                return;

            let stdout, stderr;
            try {
                [, stdout, stderr] = p.communicate_utf8_finish(res);
            } catch (e) {
                this._showError(e.message);
                return;
            }

            if (p.get_exit_status() === 0) {
                try {
                    const issues = JSON.parse(stdout.trim());
                    this._displayIssues(issues);
                    const now = new Date();
                    this._lastUpdatedTime =
                        `Updated ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                    this._scheduleNextRefresh();
                } catch (e) {
                    this._showError(e.message);
                }
            } else {
                this._showError(stderr.trim() || 'Unknown error from fetch script');
            }
        });
    }

    // Always safe to call — stops the spinner and re-enables the button even
    // if the widget has been partially destroyed.
    _fetchDone() {
        this._stopSpinner();
        if (this._refreshBtn)
            this._refreshBtn.reactive = true;
    }

    _showError(msg) {
        this._stopSpinner();
        if (this._refreshBtn)
            this._refreshBtn.reactive = true;
        if (this._issuesList)
            this._issuesList.destroy_all_children();
        if (this._statusLabel) {
            this._statusLabel.text = `Error: ${msg}`;
            this._statusLabel.show();
        }
    }

    _displayIssues(issues) {
        this._issuesList.destroy_all_children();

        if (!issues || issues.length === 0) {
            this._statusLabel.text = 'No open issues \u2713';
            return;
        }

        this._statusLabel.hide();

        const baseUrl = this._settings.get_string('base-url').replace(/\/+$/, '');
        for (const issue of issues) {
            const item = this._createIssueItem(issue, baseUrl);
            this._issuesList.add_child(item);
        }
    }

    _createIssueItem(issue, baseUrl) {
        const key = issue.key;
        const summary = issue.fields?.summary ?? '(no summary)';
        const status = issue.fields?.status?.name ?? '';
        const priority = issue.fields?.priority?.name ?? '';
        const issueUrl = `${baseUrl}/browse/${key}`;

        // Status → CSS class mapping
        const statusClass = `status-${status.toLowerCase().replace(/[\s/]+/g, '-')}`;

        const btn = new St.Button({
            style_class: 'jira-issue-item',
            x_expand: true,
            reactive: true,
        });

        const box = new St.BoxLayout({ vertical: true, x_expand: true });

        // Top row: key + status badge
        const topRow = new St.BoxLayout({ vertical: false, x_expand: true });
        const keyLabel = new St.Label({ text: key, style_class: 'jira-issue-key' });
        const filler = new St.Widget({ x_expand: true });
        const statusBadge = new St.Label({
            text: status,
            style_class: `jira-status-badge ${statusClass}`,
        });
        topRow.add_child(keyLabel);
        if (priority) {
            const priorityLabel = new St.Label({
                text: priority,
                style_class: 'jira-priority',
            });
            topRow.add_child(priorityLabel);
        }
        topRow.add_child(filler);
        topRow.add_child(statusBadge);

        // Summary
        const summaryLabel = new St.Label({
            text: summary,
            style_class: 'jira-issue-summary',
            x_expand: true,
        });
        summaryLabel.clutter_text.set_line_wrap(true);
        summaryLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        summaryLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

        box.add_child(topRow);
        box.add_child(summaryLabel);
        btn.set_child(box);

        btn.connect('clicked', () => {
            try {
                Gio.AppInfo.launch_default_for_uri(issueUrl, null);
            } catch (_e) {
                Gio.Subprocess.new(['xdg-open', issueUrl], Gio.SubprocessFlags.NONE);
            }
        });

        return btn;
    }
}
