# Cart-Pole Diffusion

Interactive beginner-first diffusion explainer using a live Cart-Pole only as a compact conditioning example.

**Live:** https://tinmanlab.github.io/cartpole-diffusion/

## v0.5 — distribution-first view

The main page is intentionally reduced to three visual questions:

1. **Same state, many noise seeds:** what empirical action distribution do different diffusion samples produce?
2. **One sample path:** how does one selected action value change through reverse denoising?
3. **Final action chunk:** what 16-step force sequence is actually sent to the controller?

Hovering or tapping one final-action bar selects the same action index in the distribution and denoising-path plots.

The older full denoising ladder and `a_t / epsilon / a0_hat / next` inspector are still available under **Advanced**, but are no longer the default view.

## Important probability boundary

The distribution plot is an **empirical sample distribution** across multiple noise seeds at the same Cart-Pole condition. It is not presented as calibrated epistemic uncertainty, confidence, or a learned variance output.

## Simplified Cart-Pole view

The left simulation removes wheel decoration and on-canvas policy/disturbance arrows. Its visual language is informed by the official MuJoCo Playground CartpoleBalance asset:

- rail
- box cart
- capsule-like pole

The browser does **not** embed MuJoCo, MJX, or the Playground XML. Existing browser dynamics and the learned diffusion policy remain unchanged.

## Live control

- physics: 50 Hz
- learned state-conditioned diffusion denoiser
- Gaussian start latent at t=95
- DDIM stride 5
- horizon: 16 actions
- execute first 4 actions, then observe and replan
- pause/run, reset, and temporary left/right disturbance

## Architecture

The same rule used in `cartpole-transformer` is retained:

```text
Environment → actual learned model → explainer reads actual intermediates
```

The explainer does not implement a separate teaching controller.

## Validation

CI checks:

- Python Cart-Pole / diffusion core
- browser model load and inference
- inline page script syntax
- visualization module syntax
- 10-second deterministic 50 Hz learned-policy rollout

## References

See [NOTICE.md](NOTICE.md).

## License

MIT.
