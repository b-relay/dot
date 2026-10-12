# Make the CLI deterministic and automation-first

dot's normal interface is noninteractive, deterministic, and usable equally by humans and automation. Every required choice must be expressible through versioned configuration, arguments, or standard input; mutations require explicit invocation; and machine-readable output must be available without a TTY. Optional prompts may wrap the same interface for convenience but cannot define unique behavior. `dot doctor` performs deterministic offline diagnosis, while any future AI-assisted analysis remains a separate opt-in capability.
