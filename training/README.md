# v0.2 training

This directory owns the reproducible teaching model used by the browser lab.

## Contract

- Condition: current state `[x, x_dot, theta, theta_dot]`
- Target: 16-step continuous-force action chunk
- Demonstration teacher: near-upright discrete LQR, clipped to +/-10 N
- Diffusion objective: predict Gaussian noise `epsilon`
- Denoiser: NumPy MLP `36 -> 64 -> 64 -> 16` with SiLU
- Browser runtime: exported JSON weights + `app/tiny_denoiser.js`

The model is intentionally small. It is not presented as a benchmark or a state-of-the-art controller. Its purpose is to make a genuinely trained conditional diffusion denoiser inspectable in a browser.

## Train

No deep-learning framework is required.

```bash
python3 -m training.train_denoiser
```

The command writes:

- `artifacts/tiny_denoiser.json`
- `artifacts/training_metrics.json`

## Optional explicit dataset

Training samples are normally generated procedurally so the repository does not need to store a large binary dataset. To inspect a fixed demonstration set:

```bash
python3 -m training.generate_dataset --count 30000
```

This writes `data/cartpole_upright_demonstrations.npz`. Generated datasets are not required for GitHub Pages.

## Tests

```bash
python3 -m unittest training.test_core
```
