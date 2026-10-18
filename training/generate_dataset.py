"""Generate reproducible state/action-chunk demonstrations for inspection or alternate trainers."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

from cartpole_core import HORIZON, STATE_SCALE, rollout_action_chunk, sample_states


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=30000)
    parser.add_argument("--seed", type=int, default=123)
    parser.add_argument(
        "--out", type=Path, default=Path("data/cartpole_upright_demonstrations.npz")
    )
    args = parser.parse_args()

    rng = np.random.default_rng(args.seed)
    states = sample_states(rng, args.count)
    action_chunks = rollout_action_chunk(states)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.out,
        states=states,
        action_chunks=action_chunks,
        state_scale=STATE_SCALE,
    )
    print(
        f"wrote {args.out}: samples={args.count}, "
        f"state_dim={states.shape[1]}, horizon={HORIZON}"
    )


if __name__ == "__main__":
    main()
