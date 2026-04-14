import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Cairo from 'gi://cairo';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const REFRESH_INTERVAL_SECONDS = 600;
const ELAPSED_TICK_SECONDS = 60;
const WIDGET_WIDTH = 320;
const WIDGET_MARGIN = 12;
const WIDGET_TOP_OFFSET = 524;

const SPARKLINE_HEIGHT = 72;

export default class WorktimeWidget extends Extension {
    enable() {
        this._dragEnabled = false;
        this._motionHandlerId = null;
        this._releaseHandlerId = null;
        this._refreshTimer = null;
        this._countdownTimer = null;
        this._elapsedTimer = null;
        this._startupCompleteId = null;
        this._startupFallbackId = null;
        this._idleInitId = null;
        this._overviewShowingId = null;
        this._overviewHiddenId = null;
        this._monitorsChangedId = null;
        this._nextRefreshAt = 0;
        this._spinning = false;
        this._settingsChangedId = null;
        this._settingsChangeTimer = null;
        this._fetchCancellable = null;
        this._checkinMinutes = null;
        this._baseUrl = null;
        this._lastUpdatedTime = null;
        this._staHm = null;
        this._checkinIsOvertime = false;
        this._checkoutIsUrgent = false;
        this._historyData = [];
        this._overMonthlyLimit = false;
        this._bssWorkHours = 0;
        this._bssMaxHours = 0;
        this._hasData = false;

        this._settings = this.getSettings();

        this._settingsChangedId = this._settings.connect('changed', () => {
            if (this._settingsChangeTimer)
                GLib.source_remove(this._settingsChangeTimer);
            this._settingsChangeTimer = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, 1, () => {
                    this._settingsChangeTimer = null;
                    this._loadData();
                    return GLib.SOURCE_REMOVE;
                }
            );
        });

        if (Main.layoutManager._startingUp) {
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
            this._startupFallbackId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, 5, () => {
                    this._startupFallbackId = null;
                    if (!this._widget)
                        this._initWidget();
                    return GLib.SOURCE_REMOVE;
                }
            );
        } else {
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
        this._loadData();

        this._overviewShowingId = Main.overview.connect('showing', () => {
            this._widget.hide();
        });
        this._overviewHiddenId = Main.overview.connect('hidden', () => {
            this._widget.show();
        });

        this._monitorsChangedId = global.display.connect('workareas-changed', () => {
            this._repositionWidget();
        });

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
        if (this._monitorsChangedId) {
            global.display.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }
        if (this._refreshTimer) {
            GLib.source_remove(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this._countdownTimer) {
            GLib.source_remove(this._countdownTimer);
            this._countdownTimer = null;
        }
        if (this._elapsedTimer) {
            GLib.source_remove(this._elapsedTimer);
            this._elapsedTimer = null;
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

    // ── Widget construction ─────────────────────────────────────────────

    _buildWidget() {
        this._widget = new St.BoxLayout({
            style_class: 'wt-widget',
            vertical: true,
            reactive: true,
            width: WIDGET_WIDTH,
        });

        // Header
        const header = new St.BoxLayout({
            style_class: 'wt-header',
            vertical: false,
            reactive: true,
        });
        const titleBox = new St.BoxLayout({ vertical: true, x_expand: true });
        const title = new St.Label({
            text: '근무시간',
            style_class: 'wt-title',
        });
        this._lastUpdatedLabel = new St.Label({
            text: '',
            style_class: 'wt-last-updated',
        });
        titleBox.add_child(title);
        titleBox.add_child(this._lastUpdatedLabel);

        this._openBtn = new St.Button({
            style_class: 'icon-button wt-icon-btn',
            child: new St.Icon({ icon_name: 'go-home-symbolic', icon_size: 14 }),
            reactive: true,
        });
        this._openBtn.connect('clicked', () => {
            const base = this._baseUrl || 'https://nhrlove.navercorp.com';
            const url = `${base}/user/connect/odm/worktimeRegInfo`;
            try {
                Gio.AppInfo.launch_default_for_uri(url, null);
            } catch (_e) {
                Gio.Subprocess.new(['xdg-open', url], Gio.SubprocessFlags.NONE);
            }
        });

        this._refreshBtn = new St.Button({
            style_class: 'icon-button wt-icon-btn',
            child: new St.Icon({ icon_name: 'view-refresh-symbolic', icon_size: 14 }),
            reactive: true,
        });
        this._refreshBtn.connect('clicked', () => this._loadData());

        header.add_child(titleBox);
        header.add_child(this._openBtn);
        header.add_child(this._refreshBtn);

        // Status
        this._statusLabel = new St.Label({
            text: 'Loading…',
            style_class: 'wt-status',
        });

        // Summary line: 09:30 → 6:45 경과 (+0:45)
        this._summaryLine = new St.BoxLayout({
            style_class: 'wt-summary-line',
            vertical: false,
        });
        this._checkinTimeLabel = new St.Label({ text: '--:--', style_class: 'wt-summary-checkin' });
        this._summaryLine.add_child(this._checkinTimeLabel);
        this._summaryLine.add_child(new St.Label({ text: ' → ', style_class: 'wt-summary-arrow' }));
        this._elapsedLabel = new St.Label({ text: '--:--', style_class: 'wt-summary-elapsed' });
        this._summaryLine.add_child(this._elapsedLabel);
        this._summaryLine.add_child(new St.Widget({ x_expand: true }));
        this._summaryDiff = new St.Label({ text: '', style_class: 'wt-summary-diff' });
        this._summaryLine.add_child(this._summaryDiff);

        // Compact stats: 2×2 grid in a box
        const statsBox = new St.BoxLayout({
            style_class: 'wt-stats-box',
            vertical: true,
        });
        const statsRow1 = new St.BoxLayout({ style_class: 'wt-stats-row', vertical: false });
        const statsRow2 = new St.BoxLayout({ style_class: 'wt-stats-row', vertical: false });

        this._cumLabel = new St.Label({ text: '-', style_class: 'wt-stat-val' });
        this._remainLabel = new St.Label({ text: '-', style_class: 'wt-stat-val' });
        this._avgLabel = new St.Label({ text: '-', style_class: 'wt-stat-val' });
        this._todayRecLabel = new St.Label({ text: '-', style_class: 'wt-stat-val' });

        statsRow1.add_child(new St.Label({ text: '누적', style_class: 'wt-stat-key' }));
        statsRow1.add_child(this._cumLabel);
        statsRow1.add_child(new St.Widget({ x_expand: true }));
        statsRow1.add_child(new St.Label({ text: '잔여', style_class: 'wt-stat-key' }));
        statsRow1.add_child(this._remainLabel);

        statsRow2.add_child(new St.Label({ text: '평균', style_class: 'wt-stat-key' }));
        statsRow2.add_child(this._avgLabel);
        statsRow2.add_child(new St.Widget({ x_expand: true }));
        statsRow2.add_child(new St.Label({ text: '오늘', style_class: 'wt-stat-key' }));
        statsRow2.add_child(this._todayRecLabel);

        statsBox.add_child(statsRow1);
        statsBox.add_child(statsRow2);
        this._statsBox = statsBox;
        statsBox.hide();

        // Action buttons (출근 / 퇴근 / 외출)
        this._actionBox = new St.BoxLayout({
            style_class: 'wt-actions',
            vertical: false,
        });

        this._checkinBtn = new St.Button({
            style_class: 'wt-action-btn wt-action-checkin',
            label: '출근',
            x_expand: true,
            reactive: true,
        });
        this._checkinBtn.connect('clicked', () => this._performAction('checkin'));

        this._checkoutBtn = new St.Button({
            style_class: 'wt-action-btn wt-action-checkout',
            label: '퇴근',
            x_expand: true,
            reactive: true,
        });
        this._checkoutBtn.connect('clicked', () => this._performAction('checkout'));

        this._pauseBtn = new St.Button({
            style_class: 'wt-action-btn wt-action-pause',
            label: '외출',
            x_expand: true,
            reactive: true,
        });
        this._pauseBtn.connect('clicked', () => this._performAction('pause'));

        this._actionBox.add_child(this._checkinBtn);
        this._actionBox.add_child(this._checkoutBtn);
        this._actionBox.add_child(this._pauseBtn);

        // Sparkline
        this._sparklineBox = new St.BoxLayout({
            style_class: 'wt-sparkline-box',
            vertical: true,
        });
        this._sparklineLabel = new St.Label({
            text: '월간 근무시간',
            style_class: 'wt-sparkline-label',
        });
        this._sparklineArea = new St.DrawingArea({
            style_class: 'wt-sparkline',
            height: SPARKLINE_HEIGHT,
        });
        this._sparklineArea.connect('repaint', (area) => this._drawSparkline(area));
        this._sparklineBox.add_child(this._sparklineLabel);
        this._sparklineBox.add_child(this._sparklineArea);
        this._sparklineBox.hide();

        // Assemble
        this._widget.add_child(header);
        this._widget.add_child(this._statusLabel);
        this._widget.add_child(this._summaryLine);
        this._widget.add_child(statsBox);
        this._widget.add_child(this._sparklineBox);
        this._widget.add_child(this._actionBox);

        // Z-order: inside backgroundGroup (above wallpaper, below windows)
        const bgGroup = global.window_group.get_first_child();
        bgGroup.add_child(this._widget);

        this._repositionWidget();
        this._setupDrag(header);
    }

    _repositionWidget() {
        const workArea = Main.layoutManager.getWorkAreaForMonitor(
            Main.layoutManager.primaryIndex
        );
        this._widget.set_position(
            workArea.x + workArea.width - WIDGET_WIDTH - WIDGET_MARGIN,
            workArea.y + WIDGET_TOP_OFFSET
        );
    }

    // ── Drag ────────────────────────────────────────────────────────────

    _setupDrag(handle) {
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        handle.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 1) {
                const [ex, ey] = event.get_coords();
                const target = global.stage.get_actor_at_pos(
                    Clutter.PickMode.REACTIVE, ex, ey
                );
                if (this._refreshBtn.contains(target) || this._openBtn.contains(target))
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

    // ── Spinner ─────────────────────────────────────────────────────────

    _startSpinner() {
        this._spinning = true;
        const icon = this._refreshBtn.get_first_child();
        if (icon) {
            icon.set_pivot_point(0.5, 0.5);
            icon.rotation_angle_z = 0;
        }
        this._tickSpin();
    }

    _tickSpin() {
        if (!this._spinning) return;
        const icon = this._refreshBtn.get_first_child();
        if (!icon) return;
        icon.ease({
            rotation_angle_z: 360,
            duration: 700,
            mode: Clutter.AnimationMode.LINEAR,
            onComplete: () => {
                if (this._spinning) {
                    icon.rotation_angle_z = 0;
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
            const icon = this._refreshBtn.get_first_child();
            if (icon) {
                icon.remove_all_transitions();
                icon.rotation_angle_z = 0;
            }
        }
    }

    // ── Data fetching ───────────────────────────────────────────────────

    _buildConfig(extra) {
        const config = {
            company: this._settings.get_string('company'),
            username: this._settings.get_string('username'),
            password: this._settings.get_string('password'),
            workplace: this._settings.get_string('workplace'),
            base_url_override: this._settings.get_string('base-url-override'),
        };
        return JSON.stringify(Object.assign(config, extra || {}));
    }

    _loadData() {
        if (!this._widget)
            return;

        const username = this._settings.get_string('username');
        const password = this._settings.get_string('password');
        if (!username || !password) {
            this._showError('Extensions → WorkTime Widget → Settings에서 ID/비밀번호를 설정하세요.');
            return;
        }

        if (this._fetchCancellable) {
            this._fetchCancellable.cancel();
            this._fetchCancellable = null;
        }

        this._refreshBtn.reactive = false;
        this._startSpinner();

        if (!this._statsBox.visible) {
            this._statusLabel.text = 'Loading…';
            this._statusLabel.show();
        }

        const configJson = this._buildConfig();
        const scriptPath = `${this.path}/worktime-fetch.py`;
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
            this._showError(`Failed to start fetch: ${e.message}`);
            return;
        }

        proc.communicate_utf8_async(configJson, cancellable, (p, res) => {
            if (this._fetchCancellable === cancellable) {
                this._fetchCancellable = null;
                this._fetchDone();
            }
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
                    const data = JSON.parse(stdout.trim());
                    this._displayData(data);
                    const now = new Date();
                    this._lastUpdatedTime =
                        `Updated ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                    this._scheduleNextRefresh();
                } catch (e) {
                    this._showError(e.message);
                }
            } else {
                const isNetworkError = p.get_exit_status() === 2;
                const msg = stderr.trim() || 'Unknown error';
                if (isNetworkError && this._hasData) {
                    this._lastUpdatedLabel.text =
                        `${this._lastUpdatedTime ?? ''} · ${msg}`.trim();
                } else {
                    this._showError(msg);
                    this._lastUpdatedLabel.text = msg;
                }
                this._scheduleNextRefresh();
            }
        });
    }

    _fetchDone() {
        this._stopSpinner();
        if (this._refreshBtn)
            this._refreshBtn.reactive = true;
    }

    _showError(msg) {
        this._stopSpinner();
        if (this._refreshBtn)
            this._refreshBtn.reactive = true;
        if (this._statusLabel) {
            this._statusLabel.text = `Error: ${msg}`;
            this._statusLabel.show();
        }
    }

    // ── Display data ────────────────────────────────────────────────────

    _displayData(data) {
        this._statusLabel.hide();
        this._hasData = true;
        this._baseUrl = data.base_url;

        // Summary line
        const checkin = data.checkin || {};
        if (checkin.sta_hm) {
            const hm = checkin.sta_hm;
            this._checkinTimeLabel.text = `${hm.slice(0, 2)}:${hm.slice(2)}`;
            this._checkinMinutes = parseInt(hm.slice(0, 2)) * 60 + parseInt(hm.slice(2));
            if (checkin.end_hm) {
                const ehm = checkin.end_hm;
                this._elapsedLabel.text = `${ehm.slice(0, 2)}:${ehm.slice(2)} 퇴근`;
                this._checkinMinutes = null;
            } else {
                this._updateElapsed();
                this._startElapsedTimer();
            }
        } else {
            this._checkinTimeLabel.text = '--:--';
            this._elapsedLabel.text = '--:--';
            this._summaryDiff.text = '';
            this._checkinMinutes = null;
        }

        // Summary stats
        const s = data.summary || {};
        const history = data.history || [];
        if (s.totWorkHm !== undefined) {
            this._updateSummary(s, history);
            this._statsBox.show();
        }

        // Fall back to history for today's check-in status if page scraping failed
        if (!checkin.sta_hm) {
            const now = new Date();
            const fmtDate = d => `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}`;
            const todayStr = fmtDate(now);
            // Before 6AM, also check yesterday (overnight work)
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = fmtDate(yesterday);
            const checkDates = now.getHours() < 6 ? [todayStr, yesterdayStr] : [todayStr];
            for (const dateStr of checkDates) {
                for (const h of history) {
                    if (h.work_ymd === dateStr && h.sta_hm && !h.end_hm) {
                        checkin.sta_hm = h.sta_hm;
                        checkin.end_hm = null;
                        break;
                    }
                }
                if (checkin.sta_hm) break;
            }
            // Re-apply summary line with fallback data
            if (checkin.sta_hm) {
                const hm = checkin.sta_hm;
                this._checkinTimeLabel.text = `${hm.slice(0, 2)}:${hm.slice(2)}`;
                this._checkinMinutes = parseInt(hm.slice(0, 2)) * 60 + parseInt(hm.slice(2));
                if (checkin.end_hm) {
                    const ehm = checkin.end_hm;
                    this._elapsedLabel.text = `${ehm.slice(0, 2)}:${ehm.slice(2)} 퇴근`;
                    this._checkinMinutes = null;
                } else {
                    this._updateElapsed();
                    this._startElapsedTimer();
                }
            }
        }

        // Compute whether monthly cap is exceeded for checkout warning
        this._overMonthlyLimit = false;
        if (checkin.sta_hm && !checkin.end_hm) {
            const toMins = hm => {
                if (!hm) return 0;
                const parts = hm.split(':');
                return parseInt(parts[0]) * 60 + parseInt(parts[1]);
            };
            const bssWorkMins = toMins(s.bssWorkHm);
            const totWorkMins = toMins(s.totWorkHm);
            const todayElapsed = this._getUnrecognizedToday(history) || 0;
            this._overMonthlyLimit = bssWorkMins > 0 && (totWorkMins + todayElapsed) >= bssWorkMins;
        }

        // Store monthly caps for sparkline
        const toMinsGraph = hm => {
            if (!hm) return 0;
            const parts = hm.split(':');
            return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        };
        this._bssWorkHours = toMinsGraph(s.bssWorkHm) / 60;
        this._bssMaxHours = (toMinsGraph(s.bssWorkHm) + toMinsGraph(s.bssOverHm)) / 60;

        // Sparkline
        this._historyData = history;
        if (history.length > 0) {
            this._sparklineBox.show();
            this._sparklineArea.queue_repaint();
        }

        // Store check-in time for checkout action
        this._staHm = checkin.sta_hm || null;

        // Update action button states
        this._updateActionButtons(checkin);
    }

    _updateActionButtons(checkin) {
        const hasCheckedIn = !!checkin.sta_hm;
        const hasCheckedOut = !!checkin.end_hm;
        const now = new Date();
        const hour = now.getHours();
        const isNightTime = hour >= 22 || hour < 6;

        // During night time (22:00-06:00), show overtime button instead of 출근
        this._checkinBtn.remove_style_class_name('wt-action-disabled');
        this._checkinBtn.remove_style_class_name('wt-action-active');
        this._checkinBtn.remove_style_class_name('wt-action-checkin');
        this._checkinBtn.remove_style_class_name('wt-action-overtime');

        if (isNightTime && !hasCheckedIn) {
            this._checkinIsOvertime = true;
            this._checkinBtn.label = '근무결과리포트';
            this._checkinBtn.add_style_class_name('wt-action-overtime');
            this._checkinBtn.reactive = true;
        } else {
            this._checkinIsOvertime = false;
            this._checkinBtn.label = '출근';
            this._checkinBtn.add_style_class_name('wt-action-checkin');
            const canCheckin = !hasCheckedIn && !isNightTime;
            this._checkinBtn.reactive = canCheckin;
            if (hasCheckedIn) {
                this._checkinBtn.add_style_class_name('wt-action-active');
            }
        }

        // 퇴근: check if over work time limit
        this._checkoutBtn.reactive = hasCheckedIn && !hasCheckedOut;
        this._checkoutBtn.remove_style_class_name('wt-action-disabled');
        this._checkoutBtn.remove_style_class_name('wt-action-active');
        this._checkoutBtn.remove_style_class_name('wt-action-checkout');
        this._checkoutBtn.remove_style_class_name('wt-action-checkout-urgent');

        if (hasCheckedIn && !hasCheckedOut && this._isOverWorkTimeLimit(checkin)) {
            this._checkoutIsUrgent = true;
            this._checkoutBtn.add_style_class_name('wt-action-checkout-urgent');
            this._checkoutBtn.label = '퇴근하세요!';
        } else {
            this._checkoutIsUrgent = false;
            this._checkoutBtn.add_style_class_name('wt-action-checkout');
            this._checkoutBtn.label = '퇴근';
            if (!hasCheckedIn || hasCheckedOut) {
                this._checkoutBtn.add_style_class_name('wt-action-disabled');
            }
            if (hasCheckedOut) {
                this._checkoutBtn.add_style_class_name('wt-action-active');
            }
        }

        // 외출: enabled only if checked in and not checked out and not urgent
        const pauseEnabled = hasCheckedIn && !hasCheckedOut && !this._checkoutIsUrgent;
        this._pauseBtn.reactive = pauseEnabled;
        this._pauseBtn.remove_style_class_name('wt-action-disabled');
        if (!pauseEnabled) {
            this._pauseBtn.add_style_class_name('wt-action-disabled');
        }
    }

    _isOverWorkTimeLimit(checkin) {
        if (!checkin.sta_hm || checkin.end_hm) return false;
        const hour = new Date().getHours();
        return this._overMonthlyLimit || hour >= 22 || hour < 6;
    }

    _updateSummary(s, history) {
        const toMins = hm => {
            if (!hm) return 0;
            const parts = hm.split(':');
            return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        };

        const totMins = toMins(s.totWorkHm) + (this._getUnrecognizedToday(history) || 0);
        const remMins = Math.max(0, toMins(s.remWorkHm) - (this._getUnrecognizedToday(history) || 0));

        const fmtHM = mins => {
            const neg = mins < 0;
            const abs = Math.abs(Math.round(mins));
            return `${neg ? '-' : ''}${Math.floor(abs / 60)}:${(abs % 60).toString().padStart(2, '0')}`;
        };

        const today = new Date();
        const todayStr = `${today.getFullYear()}${(today.getMonth() + 1).toString().padStart(2, '0')}${today.getDate().toString().padStart(2, '0')}`;
        let elapsedWorkDays = 0;
        let totalWorkDays = 0;
        for (const h of history) {
            if (h.day_type_cd !== 'HDAY' && h.dayw_nm !== '토') {
                totalWorkDays++;
                if (h.work_ymd <= todayStr)
                    elapsedWorkDays++;
            }
        }

        const diff = totMins - elapsedWorkDays * 480;
        const diffStr = `${diff >= 0 ? '+' : ''}${fmtHM(diff)}`;
        this._summaryDiff.text = diffStr;
        this._summaryDiff.style_class = diff >= 0 ? 'wt-summary-diff-pos' : 'wt-summary-diff-neg';

        this._cumLabel.text = fmtHM(totMins);
        this._remainLabel.text = fmtHM(remMins);

        if (elapsedWorkDays > 0) {
            this._avgLabel.text = fmtHM(totMins / elapsedWorkDays);
        }

        const remainDays = totalWorkDays - elapsedWorkDays + 1;
        if (remainDays > 0) {
            const todayMins = this._getUnrecognizedToday(history) || 0;
            const recMins = remMins / remainDays;
            this._todayRecLabel.text = `${fmtHM(todayMins)}/${fmtHM(recMins)}`;
        }
    }

    _getUnrecognizedToday(history) {
        const now = new Date();
        const todayStr = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
        for (const h of history) {
            if (h.work_ymd === todayStr && h.sta_hm && (!h.end_hm || h.end_hm === '')) {
                const startMins = parseInt(h.sta_hm.slice(0, -2)) * 60 + parseInt(h.sta_hm.slice(-2));
                const nowMins = now.getHours() * 60 + now.getMinutes();
                const restMins = h.rest_hm
                    ? parseInt(h.rest_hm.slice(0, -2)) * 60 + parseInt(h.rest_hm.slice(-2))
                    : 0;
                return Math.max(0, nowMins - startMins - restMins);
            }
        }
        return 0;
    }

    // ── Sparkline ───────────────────────────────────────────────────────

    _drawSparkline(area) {
        const cr = area.get_context();
        const [areaWidth, areaHeight] = area.get_surface_size();
        const padL = 6, padR = 6, padT = 4, padB = 4;
        const graphW = areaWidth - padL - padR;
        const graphH = areaHeight - padT - padB;

        const today = new Date();
        const todayStr = `${today.getFullYear()}${(today.getMonth() + 1).toString().padStart(2, '0')}${today.getDate().toString().padStart(2, '0')}`;

        // All days sorted (including holidays — holiday work counts toward actual)
        const days = this._historyData
            .slice()
            .sort((a, b) => a.work_ymd.localeCompare(b.work_ymd));

        if (days.length === 0) {
            cr.$dispose();
            return;
        }

        const n = days.length;
        const bssWork = this._bssWorkHours || 0;
        const bssMax = this._bssMaxHours || 0;
        const overtimeBuffer = bssMax - bssWork;  // overtime allowance above base

        // Count total workdays (non-holiday, non-Saturday) for expected pace
        const totalWorkDays = days.filter(
            h => h.day_type_cd !== 'HDAY' && h.dayw_nm !== '토'
        ).length;

        // Build deviation array: cumulative_actual - cumulative_expected(bssWork pace)
        // Expected pace only advances on workdays; holiday work adds to actual only
        const devHours = [];
        let cumTotal = 0;
        let workdaysSoFar = 0;
        for (let i = 0; i < n; i++) {
            const d = days[i];
            const isWorkday = d.day_type_cd !== 'HDAY' && d.dayw_nm !== '토';
            if (isWorkday) workdaysSoFar++;

            let workMins = 0;
            if (d.tot_work_hm) {
                const h = parseInt(d.tot_work_hm.slice(0, -2)) || 0;
                const m = parseInt(d.tot_work_hm.slice(-2)) || 0;
                workMins = h * 60 + m;
            } else if (d.work_ymd === todayStr && d.sta_hm && !d.end_hm) {
                const startMins = parseInt(d.sta_hm.slice(0, -2)) * 60 + parseInt(d.sta_hm.slice(-2));
                const nowMins = today.getHours() * 60 + today.getMinutes();
                const restMins = d.rest_hm
                    ? parseInt(d.rest_hm.slice(0, -2)) * 60 + parseInt(d.rest_hm.slice(-2))
                    : 0;
                workMins = Math.max(0, nowMins - startMins - restMins);
            }
            cumTotal += workMins / 60;
            const expectedAtDay = totalWorkDays > 0 && bssWork > 0
                ? bssWork * (workdaysSoFar / totalWorkDays)
                : workdaysSoFar * 8;
            devHours.push(cumTotal - expectedAtDay);
        }

        // Y-axis range: center on 0, symmetric enough to show overtime ref
        const minDev = Math.min(0, ...devHours);
        const maxDev = Math.max(overtimeBuffer || 8, ...devHours);
        const rangeY = Math.max(Math.abs(minDev), Math.abs(maxDev)) * 1.15;

        const xAt = i => padL + (i / (n - 1 || 1)) * graphW;
        const yAt = d => padT + graphH / 2 - (d / rangeY) * (graphH / 2);

        // Zero line (on pace) — white dashed
        const zeroY = yAt(0);
        cr.setSourceRGBA(1, 1, 1, 0.15);
        cr.setLineWidth(1);
        const dashLen = 4, gapLen = 3;
        for (let x = padL; x < padL + graphW; x += dashLen + gapLen) {
            cr.moveTo(x, zeroY);
            cr.lineTo(Math.min(x + dashLen, padL + graphW), zeroY);
        }
        cr.stroke();

        // Overtime buffer ref line (bssOverHm above pace) — red dashed
        if (overtimeBuffer > 0) {
            const otY = yAt(overtimeBuffer);
            cr.setSourceRGBA(0.94, 0.44, 0.47, 0.3);
            cr.setLineWidth(1);
            for (let x = padL; x < padL + graphW; x += dashLen + gapLen) {
                cr.moveTo(x, otY);
                cr.lineTo(Math.min(x + dashLen, padL + graphW), otY);
            }
            cr.stroke();
        }

        // Filled area between deviation line and zero
        const todayIdx = days.findIndex(d => d.work_ymd === todayStr);
        const lastIdx = todayIdx >= 0 ? todayIdx : n - 1;

        cr.newPath();
        cr.moveTo(xAt(0), zeroY);
        for (let i = 0; i <= lastIdx; i++)
            cr.lineTo(xAt(i), yAt(devHours[i]));
        cr.lineTo(xAt(lastIdx), zeroY);
        cr.closePath();

        if (devHours[lastIdx] >= 0) {
            cr.setSourceRGBA(0.43, 0.85, 0.6, 0.15);
        } else {
            cr.setSourceRGBA(0.94, 0.44, 0.47, 0.15);
        }
        cr.fill();

        // Deviation line
        cr.setLineWidth(2);
        cr.setSourceRGBA(0.47, 0.68, 0.93, 0.9);
        cr.newPath();
        for (let i = 0; i <= lastIdx; i++) {
            if (i === 0)
                cr.moveTo(xAt(i), yAt(devHours[i]));
            else
                cr.lineTo(xAt(i), yAt(devHours[i]));
        }
        cr.stroke();

        // Today dot
        if (todayIdx >= 0) {
            cr.setSourceRGBA(0.47, 0.68, 0.93, 1);
            cr.arc(xAt(todayIdx), yAt(devHours[todayIdx]), 3, 0, 2 * Math.PI);
            cr.fill();
        }

        cr.$dispose();
    }

    // ── Action handling ─────────────────────────────────────────────────

    _performAction(actionType) {
        // Overtime button → open overtime approval draft page
        if (actionType === 'checkin' && this._checkinIsOvertime) {
            const url = 'https://apms.navercorp.com/aprvDoc/draft/H051';
            try {
                Gio.AppInfo.launch_default_for_uri(url, null);
            } catch (_e) {
                Gio.Subprocess.new(['xdg-open', url], Gio.SubprocessFlags.NONE);
            }
            return;
        }

        // Over limit → open worktime history popup instead of API checkout
        if (actionType === 'checkout' && this._checkoutIsUrgent) {
            const base = this._baseUrl || 'https://nhrlove.navercorp.com';
            const url = `${base}/user/hrms/odm/worktime/worktimeHistoryPopup.nhn`;
            try {
                Gio.AppInfo.launch_default_for_uri(url, null);
            } catch (_e) {
                Gio.Subprocess.new(['xdg-open', url], Gio.SubprocessFlags.NONE);
            }
            return;
        }

        const username = this._settings.get_string('username');
        const password = this._settings.get_string('password');
        if (!username || !password) {
            this._showError('Settings에서 ID/비밀번호를 설정하세요.');
            return;
        }

        this._setActionButtonsEnabled(false);
        this._startSpinner();

        const extra = { action: actionType };
        if (actionType === 'checkout' && this._staHm)
            extra.sta_hm = this._staHm;
        const configJson = this._buildConfig(extra);
        const scriptPath = `${this.path}/worktime-fetch.py`;

        let proc;
        try {
            proc = Gio.Subprocess.new(
                ['python3', scriptPath],
                Gio.SubprocessFlags.STDIN_PIPE |
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (e) {
            this._stopSpinner();
            this._setActionButtonsEnabled(true);
            this._showError(`Failed: ${e.message}`);
            return;
        }

        proc.communicate_utf8_async(configJson, null, (p, res) => {
            this._stopSpinner();

            let stdout, stderr;
            try {
                [, stdout, stderr] = p.communicate_utf8_finish(res);
            } catch (e) {
                this._setActionButtonsEnabled(true);
                this._showError(e.message);
                return;
            }

            if (p.get_exit_status() === 0) {
                // Action succeeded — refresh to update UI state
                this._loadData();
            } else {
                this._setActionButtonsEnabled(true);
                this._showError(stderr.trim() || 'Action failed');
            }
        });
    }

    _setActionButtonsEnabled(enabled) {
        if (this._checkinBtn) this._checkinBtn.reactive = enabled;
        if (this._checkoutBtn) this._checkoutBtn.reactive = enabled;
        if (this._pauseBtn) this._pauseBtn.reactive = enabled;
    }

    // ── Elapsed timer ───────────────────────────────────────────────────

    _updateElapsed() {
        if (this._checkinMinutes == null) return;
        const now = new Date();
        const nowMins = now.getHours() * 60 + now.getMinutes();
        let elapsed = nowMins - this._checkinMinutes;
        // Overnight: check-in was yesterday
        if (elapsed < 0)
            elapsed += 1440;
        // Deduct lunch break (12:00-13:00) if applicable
        if ((this._checkinMinutes < 720 && nowMins >= 780) ||
            (this._checkinMinutes < 720 && elapsed >= 1440 - this._checkinMinutes + 780))
            elapsed -= 60;
        elapsed = Math.max(0, elapsed);
        const h = Math.floor(elapsed / 60);
        const m = elapsed % 60;
        this._elapsedLabel.text = `${h}:${m.toString().padStart(2, '0')} 경과`;
    }

    _startElapsedTimer() {
        if (this._elapsedTimer) return;
        this._elapsedTimer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, ELAPSED_TICK_SECONDS, () => {
                this._updateElapsed();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    // ── Refresh scheduling ──────────────────────────────────────────────

    _scheduleNextRefresh() {
        if (this._refreshTimer)
            GLib.source_remove(this._refreshTimer);
        this._refreshTimer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_SECONDS, () => {
                this._loadData();
                return GLib.SOURCE_REMOVE;
            }
        );
        this._nextRefreshAt = Date.now() + REFRESH_INTERVAL_SECONDS * 1000;
        this._updateCountdownLabel();

        if (this._countdownTimer)
            GLib.source_remove(this._countdownTimer);
        this._countdownTimer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, 30, () => {
                this._updateCountdownLabel();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _updateCountdownLabel() {
        const secsLeft = Math.max(0, Math.round((this._nextRefreshAt - Date.now()) / 1000));
        const mins = Math.ceil(secsLeft / 60);
        const countdown = secsLeft < 60 ? 'in <1m' : `in ${mins}m`;
        const base = this._lastUpdatedTime ?? '';
        this._lastUpdatedLabel.text = base ? `${base} · ${countdown}` : countdown;
    }
}
