# dot

dot is a generic machine-configuration state manager for declaring and reconciling dotfiles and related user-level configuration across supported operating systems.

## Language

**dot**:
The generic state-management tool and its reusable behavior.
_Avoid_: DOT, dotfiles repository, b-relay bootstrapper

**dotfiles repository**:
A user-owned desired-state collection consumed by dot. It may specialize dot's generic capabilities for a particular person or fleet.
_Avoid_: dot, dot repository

**Profile**:
A named layer of desired state that composes with other profiles to describe a machine, such as shared, operating-system, architecture, or host-specific state.
_Avoid_: Environment, complete configuration
