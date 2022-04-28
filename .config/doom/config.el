;;; $DOOMDIR/config.el -*- lexical-binding: t; -*-

;; Place your private configuration here! Remember, you do not need to run 'doom
;; sync' after modifying this file!


;; Some functionality uses this to identify you, e.g. GPG configuration, email
;; clients, file templates and snippets.
(setq user-full-name "Mooyeol Baek"
      user-mail-address "mooyeolb@gmail.com")

;; Doom exposes five (optional) variables for controlling fonts in Doom. Here
;; are the three important ones:
;;
;; + `doom-font'
;; + `doom-variable-pitch-font'
;; + `doom-big-font' -- used for `doom-big-font-mode'; use this for
;;   presentations or streaming.
;;
;; They all accept either a font-spec, font string ("Input Mono-12"), or xlfd
;; font string. You generally only need these two:
;; (setq doom-font (font-spec :family "monospace" :size 12 :weight 'semi-light)
;;       doom-variable-pitch-font (font-spec :family "sans" :size 13))

;; There are two ways to load a theme. Both assume the theme is installed and
;; available. You can either set `doom-theme' or manually load a theme with the
;; `load-theme' function. This is the default:
;; (setq doom-theme 'doom-one)
(setq doom-theme 'doom-tomorrow-night)

;; If you use `org' and don't want your org files in the default location below,
;; change `org-directory'. It must be set before org loads!
(setq org-directory "~/Documents/Org/")

;; This determines the style of line numbers in effect. If set to `nil', line
;; numbers are disabled. For relative line numbers, set this to `relative'.
(setq display-line-numbers-type t)


;; Here are some additional functions/macros that could help you configure Doom:
;;
;; - `load!' for loading external *.el files relative to this one
;; - `use-package!' for configuring packages
;; - `after!' for running code after a package has loaded
;; - `add-load-path!' for adding directories to the `load-path', relative to
;;   this file. Emacs searches the `load-path' when you load packages with
;;   `require' or `use-package'.
;; - `map!' for binding new keys
;;
;; To get information about any of these functions/macros, move the cursor over
;; the highlighted symbol at press 'K' (non-evil users must press 'C-c c k').
;; This will open documentation for it, including demos of how they are used.
;;
;; You can also try 'gd' (or 'C-c c d') to jump to their definition and see how
;; they are implemented.

;; font settings for unicode
(setq doom-unicode-font (font-spec :family "Noto Sans CJK KR"))
(after! unicode-fonts
  (push "Noto Sans Symbol" (cadr (assoc "Miscellaneous Symbols" unicode-fonts-block-font-mapping))))

;; override doom splash banner
(defun doom-dashboard-widget-banner () nil)

(setq-default
  delete-by-moving-to-trash t                   ; Delete files to trash
  tab-width 4                                   ; Set width for tabs
  uniquify-buffer-name-style 'forward           ; Uniquify buffer names
  window-combination-resize t                   ; take new window space from all other windows (not just current)
  )

(setq undo-limit 80000000                       ; Raise undo-limit to
  evil-want-fine-undo t                         ; By default while in insert all changes are one big blob. Be more granular
  auto-save-default t                           ; Nobody likes to loose work, I certainly don't
  inhibit-compacting-font-caches t              ; When there are lots of glyphs, keep them in memory
  truncate-string-ellipsis "…"                  ; Unicode ellispis are nicer than "...", and also save /precious/ space
  )

(display-time-mode 1)                           ; Enable time in the mode-line
(setq display-time-24hr-format 1)               ; 24-hour time format
(global-subword-mode 1)                         ; Iterate through CamelCase

(unless (equal "Battery status not available"
               (battery))
  (display-battery-mode 1))                     ; On laptops it's nice to know how much power you have

(if (eq initial-window-system 'x)               ; if started by emacs command or desktop
    (toggle-frame-maximized)
  (toggle-frame-fullscreen))

(defun doom-modeline-conditional-buffer-encoding ()
  (setq-local doom-modeline-buffer-encoding
              (unless (or (eq buffer-file-coding-system 'utf-8-unix)
                          (eq buffer-file-coding-system 'utf-8)))))
(add-hook 'after-change-major-mode-hook #'doom-modeline-conditional-buffer-encoding)

(setq frame-title-format
  '(""
    (:eval
      (if (s-contains-p org-roam-directory (or buffer-file-name ""))
          (replace-regexp-in-string ".*/[0-9]*-?" "🢔 " buffer-file-name)
        "%b"))
    (:eval
      (let ((project-name (projectile-project-name)))
        (unless (string= "-" project-name)
          (format (if (buffer-modified-p)  " ◉ %s" "  ●  %s") project-name))))))

;; ! Your $HOME is recognized as a project root
;; Emacs will assume $HOME is the root of any project living under $HOME.
(after! projectile (setq projectile-project-root-files-bottom-up
                         (remove ".git" projectile-project-root-files-bottom-up)))

;; Use system clipboard
(setq x-select-enable-clipboard t)
(xclip-mode 1)
