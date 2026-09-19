# Cart-Pole Diffusion

Interactive control-loop-first explainer for understanding what a diffusion policy actually does.

**Live:** https://tinmanlab.github.io/cartpole-diffusion/

## v0.6 — control loop first

The default page now starts from control engineering, not diffusion internals:

```text
Plant
  ↓ observe
[x, x_dot, theta, theta_dot]
  ↓
Diffusion Policy
  ↓ generate 16 future forces
[a0 ... a15]
  ↓ execute first 4
Cart-Pole
  ↓
observe again and replan
```

The page answers four concrete questions in order:

1. **What did the policy observe?**  
   The exact 4-state snapshot used when the current plan was generated.

2. **What does diffusion do with that observation?**  
   It starts from 16 random action-space candidates, then repeatedly edits them while conditioned on the observation and diffusion timestep.

3. **What action comes out?**  
   A 16-step force plan. The UI shows the actual Newton values for the first four actions.

4. **What happens next?**  
   Only the first four actions are applied to the plant. Then a new state is observed and a new plan is generated from fresh Gaussian noise.

## Noise and denoise in plain language

In the default visualization:

- **Noise** means 16 random future-force candidates. They are internal values and are **not** sent to the robot.
- **Denoise** means repeatedly modifying those candidates using the observed Cart-Pole state.
- **Final action plan** is the denoised 16-step force sequence. Only this final sequence can be executed.

The page displays three actual snapshots from one real planning cycle:

```text
t=95 random candidates
        ↓
t≈45 partially denoised candidates
        ↓
t=0 final force plan
```

## Relation to the original Diffusion Policy

The official Diffusion Policy low-dimensional interface accepts an observation horizon and predicts an action sequence. The classical single-step observation case is a special case.

This toy deliberately uses:

- observation horizon: 1
- observation dimension: 4
- prediction horizon: 16 force values
- executed action horizon: 4
- replanning: after those 4 actions

That preserves the essential receding-horizon structure while keeping every quantity inspectable.

## Live simulation

- browser Cart-Pole physics: 50 Hz
- learned state-conditioned denoiser
- Gaussian start latent: t=95
- DDIM stride: 5
- prediction horizon: 16
- execute prefix: 4 actions
- controls: Pause/Run, Reset, temporary left/right disturbance

The Cart-Pole drawing remains intentionally minimal: rail, box cart, and pole.

## Architecture

The same separation used in `cartpole-transformer` is retained:

```text
Environment → actual learned policy → explainer reads actual intermediates
```

The explainer never substitutes a separate teaching controller.

## Advanced view

The detailed timestep ladder and `a_t / predicted epsilon / estimated a0 / next latent` inspector remain available under **Advanced** for users who already understand the control loop.

## Validation

CI checks:

- Python dynamics/diffusion core
- model load and inference
- visualization JavaScript syntax
- inline page script syntax
- deterministic 10-second 50 Hz learned-policy rollout

## References

See [NOTICE.md](NOTICE.md).

## License

MIT.
