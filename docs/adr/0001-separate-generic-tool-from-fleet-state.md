# Separate generic dot behavior from fleet-specific state

dot is a generic desired-state manager for macOS and Linux on both x86-64 and ARM64. User- and fleet-specific choices—including agent configuration, plugin marketplace registrations, and machine-specific selections—belong in dotfiles repositories consumed by dot, not in the dot tool repository. This preserves a reusable state engine while allowing the b-relay dotfiles repository to optimize for its Mac fleet.
