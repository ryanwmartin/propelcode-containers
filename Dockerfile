FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

RUN apt-get update && apt-get install -y \
    git curl wget build-essential openssl ca-certificates \
    zsh tmux htop unzip zip jq \
    python3 python3-pip python3-venv \
    ruby ruby-dev \
    && rm -rf /var/lib/apt/lists/*

RUN sh -c "$(curl -fsSL https://starship.rs/install.sh)" -- -y

ENV NVM_DIR=/root/.nvm
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash \
    && . $NVM_DIR/nvm.sh \
    && nvm install 22 \
    && nvm alias default 22 \
    && npm install -g yarn pnpm bun

ENV PYTHON_VENV=/root/.python-venv
RUN python3 -m venv $PYTHON_VENV \
    && $PYTHON_VENV/bin/pip install --upgrade pip \
    && $PYTHON_VENV/bin/pip install poetry uv django flask fastapi uvicorn jupyter

RUN gem install bundler rails

ENV ERLANG_VERSION=27
ENV ELIXIR_VERSION=1.17
RUN apt-get update && apt-get install -y erlang elixir && rm -rf /var/lib/apt/lists/* || true

RUN mkdir -p /propel-code

COPY container-server/package.json /opt/propel-agent/package.json
COPY container-server/server.js /opt/propel-agent/server.js

RUN . $NVM_DIR/nvm.sh && cd /opt/propel-agent && npm install

ENV PATH="$NVM_DIR/versions/node/v22.0.0/bin:$PYTHON_VENV/bin:$PATH"

EXPOSE 3100

WORKDIR /propel-code

CMD ["/bin/bash", "-c", ". $NVM_DIR/nvm.sh && node /opt/propel-agent/server.js"]
