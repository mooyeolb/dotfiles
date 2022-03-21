# default settings
# ----------------

export TERM=xterm-256color \
       EDITOR='emacs -nw' \
       LESS='-iRFX' \
       XDG_CONFIG_HOME=~/.config \
       XDG_CACHE_HOME=~/.cache \
       XDG_DATA_HOME=~/.share


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
