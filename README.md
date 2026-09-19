# Cart-Pole Diffusion

Interactive, beginner-first diffusion / Diffusion Policy lab for robotics.

**Live:** https://tinmanlab.github.io/cartpole-diffusion/

The first screen is intentionally small: Cart-Pole simulation on the left, action diffusion on the right. Change the state, add noise, compare the trained denoiser with an oracle, generate an action chunk, then execute the first four actions and replan.

## v0.2

v0.2 replaces the teaching-only reverse path with a genuinely trained state-conditioned denoiser.

- condition: `[x, x_dot, theta, theta_dot]`
- target: 16-step continuous-force action chunk
- demonstration teacher: near-upright discrete LQR
- diffusion: cosine schedule, epsilon prediction
- denoiser: `36 -> 64 -> 64 -> 16` SiLU MLP
- training: NumPy only, deterministic seed
- browser inference: int16-quantized weights + vanilla JavaScript
- execution: receding horizon, execute 4 actions then observe/replan

The model is deliberately tiny and educational. It is **not** claimed as a Cart-Pole benchmark or a reproduction of the full manipulation-scale Diffusion Policy system.

## Reproduce the model

```bash
python -m pip install numpy
python -m unittest training.test_core
python -m training.train_denoiser
```

The trainer procedurally creates LQR demonstrations and exports the browser model under `artifacts/`. The training workflow enforces validation thresholds before committing generated weights.

## What the UI shows

- green: LQR teacher action target (evaluation reference)
- red: starting diffusion latent
- blue: reverse-denoised action chunk
- purple: noise guide
- **Learned εθ**: trained network prediction
- **Oracle ε**: true corruption noise, retained only as an ideal reference

For pure-noise generation, the teacher target is shown only for evaluation; it is not given to the learned model.

## Scope

v0.2 covers near-upright state-conditioned balance. Next useful extensions are multimodal action distributions and visual/history conditioning, rather than adding unrelated policy families.

## References

Interaction design is inspired by Polo Club's Transformer Explainer and Diffusion Explainer. Robotics context follows Chi et al., *Diffusion Policy: Visuomotor Policy Learning via Action Diffusion*, RSS 2023. See [NOTICE.md](NOTICE.md).

## License

MIT.
