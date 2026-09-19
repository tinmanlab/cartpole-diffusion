# Cart-Pole Diffusion

Interactive diffusion explainer using a live Cart-Pole only as the conditioning context.

**Live:** https://tinmanlab.github.io/cartpole-diffusion/

## v0.4 layout

The page now follows the successful structure used in `tinmanlab/cartpole-transformer`:

```text
Environment (live) → Model (actual learned inference) → Explainer (actual intermediates)
```

On wide/landscape screens the live Cart-Pole is intentionally narrow and the Diffusion explainer gets most of the width. In portrait or narrow screens the two panels stack vertically. On very small screens the denoising ladder changes from horizontal stages to a vertical stage sequence.

## Live simulation

- physics: 50 Hz
- policy: trained state-conditioned diffusion denoiser
- generation start: Gaussian latent at t=95
- reverse step: DDIM stride 5
- action horizon: 16
- receding horizon: execute first 4 actions, then observe and replan
- interaction: pause/run, reset, hold left/right disturbance

The explainer always visualizes values produced by the same model used by the live simulation. It does not reimplement a separate teaching controller.

## What the right side shows

A compact flow:

```text
Gaussian → epsilon_theta → DDIM step → repeat → 16 actions
```

Then a representative denoising ladder and a selected-step inspector:

- current latent `a_t`
- predicted noise `epsilon_theta`
- estimated clean action `a_0_hat`
- next latent

Hovering one action cell highlights the same action index through all shown timesteps, adapting the linked-highlight interaction pattern used by Polo Club Transformer Explainer.

## Why the Transformer repo was useful

`cartpole-transformer` separates three responsibilities:

1. the Cart-Pole environment advances independently at 50 Hz,
2. the learned Transformer consumes the current sequence and exposes real intermediate tensors,
3. the explainer reads those tensors and links them back to the simulation.

This repo now uses the same separation, replacing token history with a diffusion action plan and denoising history.

## Scope

This is a small near-upright educational policy. The goal is to make iterative diffusion visible, not to claim Cart-Pole SOTA or reproduce manipulation-scale Diffusion Policy benchmarks.

## References

See [NOTICE.md](NOTICE.md).

## License

MIT.
