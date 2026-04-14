# default settings
# ----------------

export TERM=xterm-256color \
       EDITOR='emacs -nw' \
       LESS='-iRFX' \
       XDG_CONFIG_HOME="${HOME}/.config" \
       XDG_CACHE_HOME="${HOME}/.cache" \
       XDG_DATA_HOME="${HOME}/.local/share" \
       XDG_STATE_HOME="${HOME}/.local/state" \
       XDG_DATA_DIRS="/usr/local/share:/usr/share:${HOME}/.local/share" \
       XDG_CONFIG_DIRS="/etc/xdg:${HOME}/.config" \
       DOCKER_CONFIG="${HOME}/.config/docker" \
       KUBECONFIG="${HOME}/.config/kube/config" \
       npm_config_cache="${HOME}/.cache/npm"


# PATH
# ----

if [ -d "$HOME/.local/bin" ] ; then
    export PATH=$HOME/.local/bin${PATH:+:${PATH}}
fi

if [ -d "$HOME/.local/lib" ] ; then
    export LD_LIBRARY_PATH=$HOME/.local/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}
fi

if [ -d "/usr/local/cuda" ]; then
    export PATH=/usr/local/cuda/bin${PATH:+:${PATH}}
    export LD_LIBRARY_PATH=/usr/local/cuda/lib64${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}
fi

if [ -f "/usr/bin/go" ]; then
    export GOPATH=$XDG_DATA_HOME/go
    export PATH=${PATH:+${PATH}:}$GOROOT/bin:$GOPATH/bin
fi

if [ -f "$XDG_DATA_HOME/cargo/bin/cargo" ]; then
    export RUSTUP_HOME="$XDG_DATA_HOME/rustup"
    export CARGO_HOME="$XDG_DATA_HOME/cargo"
    . "$CARGO_HOME/env"
fi
