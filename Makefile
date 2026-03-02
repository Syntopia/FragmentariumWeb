.PHONY: run build frag-render

# Pass optional flags via ARGS, e.g.:
# make run ARGS="--host 0.0.0.0 --port 5173 --strict-port"
run:
	python3 scripts/start_server.py $(ARGS)

build:
	npm run build

frag-render:
	cargo build --release --manifest-path frag-render/Cargo.toml
