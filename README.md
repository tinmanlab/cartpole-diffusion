# Cart-Pole Diffusion

Interactive, beginner-first diffusion lab for robotics.

**Live:** https://tinmanlab.github.io/cartpole-diffusion/

The project now focuses on one question:

> How does a diffusion model turn a noisy action sequence into a usable action sequence?

Cart-Pole is only the conditioning context. The main visualization is the diffusion process itself.

## v0.3 — diffusion-focused explainer

The first screen now shows:

- Cart-Pole state as the condition `c`
- a simple `clean → add noise → noisy → predict epsilon → DDIM → action` flow
- a five-stage denoising ladder
- action-vector heatmaps for representative timesteps
- linked hover across the same action index at every timestep
- an inspector for:
  - current `a_t`
  - predicted noise `epsilon_theta`
  - estimated clean action `a_0_hat`
  - next latent `a_{t-delta}`

The linked-hover and progressive-inspection interaction patterns are adapted conceptually from Polo Club Transformer Explainer's `MatrixSvg`, `Sankey`, and `AttentionMatrix` components. Transformer-specific Q/K/V concepts are not used.

## The one idea to learn

A diffusion policy does not directly output the final action in one shot.

```text
noisy action
    ↓
predict what looks like noise
    ↓
remove a little noise
    ↓
repeat
    ↓
action
```

The learned model is still the real v0.2 trained denoiser:

- condition: `[x, x_dot, theta, theta_dot]`
- action horizon: 16
- denoiser: `36 -> 64 -> 64 -> 16` SiLU MLP
- objective: epsilon prediction
- browser inference: int16 quantized weights + vanilla JavaScript

## Reproduce

```bash
python -m pip install numpy
python -m unittest training.test_core
python -m training.train_denoiser
```

## Scope

This remains a near-upright Cart-Pole teaching model. The goal is understanding diffusion, not Cart-Pole benchmark performance and not full manipulation-scale Diffusion Policy reproduction.

## References

- Polo Club Transformer Explainer
- Polo Club Diffusion Explainer
- Chi et al., *Diffusion Policy: Visuomotor Policy Learning via Action Diffusion*, RSS 2023

See [NOTICE.md](NOTICE.md).

## License

MIT.
