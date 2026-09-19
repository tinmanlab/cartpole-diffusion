# Training contract

The training code is intentionally framework-light so the educational model can be regenerated with NumPy alone.

One sample is:

```text
condition c = [x, x_dot, theta, theta_dot]
clean target a0 = 16 normalized LQR forces
t ~ Uniform{1..99}
epsilon ~ N(0,I)
a_t = sqrt(alpha_bar_t) a0 + sqrt(1-alpha_bar_t) epsilon
target = epsilon
```

The MLP receives `a_t(16) + normalized c(4) + sinusoidal t embedding(16)` and predicts 16 noise values.

Acceptance checks in `train_denoiser.py` reject an exported model when validation epsilon MSE exceeds 0.06 or t=70 DDIM action MAE exceeds 0.09.

Generated weight files are int16 per-tensor quantized for a small GitHub Pages payload. Training/evaluation remain float32.
