# history
# -------

export HISTSIZE=200000 \
       SAVEHIST=100000 \
       HISTFILE=$XDG_CACHE_HOME/zsh/history \
       LESSHISTFILE=$XDG_CACHE_HOME/less/history \
       APPEND_HISTORY \
       SHARE_HISTORY \
       HIST_EXPIRE_DUPS_FIRST \
       EXTENDED_HISTORY


# bindkey
# -------

bindkey  "^[[H"   beginning-of-line
bindkey  "^[[F"   end-of-line
bindkey  "^[[3~"  delete-char
bindkey  "^[[A"   history-substring-search-up
bindkey  "^[[B"   history-substring-search-down
bindkey -M emacs "^P" history-substring-search-up
bindkey -M emacs "^N" history-substring-search-down


# aliases
# -------

alias config='/usr/bin/git --git-dir=$XDG_DATA_HOME/git-dotfiles/ --work-tree=$HOME'
alias reload="exec $SHELL -l -i"  grep="command grep --colour=auto --binary-files=without-match --directories=skip"
alias ls="exa -bh --color=auto"
alias l="ls"      l.='ls -d .*'   la='ls -a'   ll='ls -lbt created'  rm='command rm -i'
alias df='df -h'  du='du -h'      cp='cp -v'   mv='mv -v'      plast="last -20"
alias ec='emacsclient -c -n -a ""'
alias e='emacs -nw'
Ec() { emacsclient -c -n -a emacs "/sudo::$*" }
E() { emacs -nw "/sudo::$*" }


# custom installations
# --------------------

# >>> conda initialize >>>
# !! Contents within this block are managed by 'conda init' !!
__conda_setup="$('/home/mooyeolb/.share/mambaforge/bin/conda' 'shell.zsh' 'hook' 2> /dev/null)"
if [ $? -eq 0 ]; then
    eval "$__conda_setup"
else
    if [ -f "/home/mooyeolb/.share/mambaforge/etc/profile.d/conda.sh" ]; then
        . "/home/mooyeolb/.share/mambaforge/etc/profile.d/conda.sh"
    else
        export PATH="/home/mooyeolb/.share/mambaforge/bin:$PATH"
    fi
fi
unset __conda_setup
# <<< conda initialize <<<

# nvm
export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh"  ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# fzf
[ -f "${XDG_CONFIG_HOME:-$HOME/.config}"/fzf/fzf.zsh ] && source "${XDG_CONFIG_HOME:-$HOME/.config}"/fzf/fzf.zsh


# sheldon
# -------

eval "$(sheldon source)"
