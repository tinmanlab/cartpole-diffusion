"""Train and export the tiny state-conditioned action denoiser using NumPy only."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from training.cartpole_core import (
    COSINE_S,
    DIFFUSION_STEPS,
    HORIZON,
    MAX_FORCE,
    STATE_SCALE,
    TEACHER_GAIN,
    TIMESTEP_EMBED_DIM,
    alpha_bar,
    build_features,
    corrupt_action,
    rollout_action_chunk,
    sample_states,
)

INPUT_DIM = HORIZON + 4 + TIMESTEP_EMBED_DIM
HIDDEN_DIMS = (64, 64)
OUTPUT_DIM = HORIZON


def silu(x: np.ndarray) -> np.ndarray:
    sig = 1.0 / (1.0 + np.exp(-np.clip(x, -30.0, 30.0)))
    return x * sig


def silu_grad(x: np.ndarray) -> np.ndarray:
    sig = 1.0 / (1.0 + np.exp(-np.clip(x, -30.0, 30.0)))
    return sig * (1.0 + x * (1.0 - sig))


class TinyMLP:
    def __init__(self, rng: np.random.Generator) -> None:
        dims = (INPUT_DIM, *HIDDEN_DIMS, OUTPUT_DIM)
        self.weights: list[np.ndarray] = []
        self.biases: list[np.ndarray] = []
        for fan_in, fan_out in zip(dims[:-1], dims[1:]):
            weight = (
                rng.standard_normal((fan_in, fan_out)) * np.sqrt(2.0 / fan_in)
            ).astype(np.float32)
            self.weights.append(weight)
            self.biases.append(np.zeros((fan_out,), dtype=np.float32))

    @property
    def params(self) -> list[np.ndarray]:
        out: list[np.ndarray] = []
        for weight, bias in zip(self.weights, self.biases):
            out.extend([weight, bias])
        return out

    def forward(self, features: np.ndarray, cache: bool = False):
        activations = [features]
        preacts = []
        x = features
        for layer, (weight, bias) in enumerate(zip(self.weights, self.biases)):
            z = x @ weight + bias
            preacts.append(z)
            if layer < len(self.weights) - 1:
                x = silu(z)
            else:
                x = z
            activations.append(x)
        if cache:
            return x, (activations, preacts)
        return x

    def gradients(self, features: np.ndarray, target: np.ndarray):
        pred, (activations, preacts) = self.forward(features, cache=True)
        batch, width = target.shape
        delta = (2.0 * (pred - target) / (batch * width)).astype(np.float32)
        weight_grads = [np.empty_like(weight) for weight in self.weights]
        bias_grads = [np.empty_like(bias) for bias in self.biases]

        for layer in reversed(range(len(self.weights))):
            prev = activations[layer]
            weight_grads[layer] = prev.T @ delta
            bias_grads[layer] = delta.sum(axis=0)
            if layer > 0:
                delta = (delta @ self.weights[layer].T) * silu_grad(preacts[layer - 1])

        grads: list[np.ndarray] = []
        for weight_grad, bias_grad in zip(weight_grads, bias_grads):
            grads.extend([weight_grad, bias_grad])
        loss = float(np.mean((pred - target) ** 2))
        return loss, grads

    def export(self) -> list[dict]:
        return [
            {
                "weight": np.round(weight, 7).tolist(),
                "bias": np.round(bias, 7).tolist(),
            }
            for weight, bias in zip(self.weights, self.biases)
        ]


class Adam:
    def __init__(self, params: list[np.ndarray]) -> None:
        self.m = [np.zeros_like(param) for param in params]
        self.v = [np.zeros_like(param) for param in params]
        self.beta1 = 0.9
        self.beta2 = 0.999
        self.eps = 1e-8

    def step(self, params: list[np.ndarray], grads: list[np.ndarray], lr: float, step: int) -> None:
        for i, (param, grad) in enumerate(zip(params, grads)):
            self.m[i] = self.beta1 * self.m[i] + (1.0 - self.beta1) * grad
            self.v[i] = self.beta2 * self.v[i] + (1.0 - self.beta2) * (grad * grad)
            m_hat = self.m[i] / (1.0 - self.beta1**step)
            v_hat = self.v[i] / (1.0 - self.beta2**step)
            param -= lr * m_hat / (np.sqrt(v_hat) + self.eps)


def make_batch(rng: np.random.Generator, count: int):
    states = sample_states(rng, count)
    clean = rollout_action_chunk(states)
    timestep = rng.integers(1, DIFFUSION_STEPS, size=count, dtype=np.int32)
    noise = rng.standard_normal((count, HORIZON)).astype(np.float32)
    noisy, _ = corrupt_action(clean, timestep, noise)
    features = build_features(noisy, timestep, states)
    return features, noise


def make_validation(seed: int, count: int):
    rng = np.random.default_rng(seed)
    states = sample_states(rng, count)
    clean = rollout_action_chunk(states)
    timestep = rng.integers(1, DIFFUSION_STEPS, size=count, dtype=np.int32)
    noise = rng.standard_normal((count, HORIZON)).astype(np.float32)
    noisy, ab = corrupt_action(clean, timestep, noise)
    features = build_features(noisy, timestep, states)
    return states, clean, timestep, noise, noisy, ab, features


def ddim_recover(
    model: TinyMLP,
    noisy: np.ndarray,
    start_t: int,
    states: np.ndarray,
    stride: int = 5,
) -> np.ndarray:
    latent = np.asarray(noisy, dtype=np.float32).copy()
    current = int(start_t)
    while current > 0:
        previous = max(0, current - stride)
        t = np.full((latent.shape[0],), current, dtype=np.int32)
        pred_noise = model.forward(build_features(latent, t, states))
        ab = alpha_bar(t)[:, None]
        x0 = (latent - np.sqrt(1.0 - ab) * pred_noise) / np.sqrt(ab)
        x0 = np.clip(x0, -1.2, 1.2)
        prev_ab = alpha_bar(np.full_like(t, previous))[:, None]
        latent = np.sqrt(prev_ab) * x0 + np.sqrt(1.0 - prev_ab) * pred_noise
        current = previous
    return latent.astype(np.float32)


def evaluate(model: TinyMLP, validation, seed: int) -> dict:
    states, clean, timestep, noise, noisy, ab, features = validation
    pred = model.forward(features)
    epsilon_mse = float(np.mean((pred - noise) ** 2))
    x0_hat = (noisy - np.sqrt(1.0 - ab) * pred) / np.sqrt(ab)
    x0_hat = np.clip(x0_hat, -1.5, 1.5)
    x0_mae = float(np.mean(np.abs(x0_hat - clean)))

    rng = np.random.default_rng(seed + 99)
    eval_states = sample_states(rng, 1024)
    eval_clean = rollout_action_chunk(eval_states)
    reverse_metrics = {}
    for start_t in (30, 50, 70, 85):
        eps = rng.standard_normal((len(eval_states), HORIZON)).astype(np.float32)
        noisy_t, _ = corrupt_action(
            eval_clean,
            np.full((len(eval_states),), start_t, dtype=np.int32),
            eps,
        )
        recovered = ddim_recover(model, noisy_t, start_t, eval_states)
        reverse_metrics[str(start_t)] = {
            "action_mae": float(np.mean(np.abs(recovered - eval_clean))),
            "first_action_mae": float(np.mean(np.abs(recovered[:, 0] - eval_clean[:, 0]))),
        }

    return {
        "validation_epsilon_mse": epsilon_mse,
        "single_step_x0_mae": x0_mae,
        "ddim_recovery": reverse_metrics,
    }


def learning_rate(step: int, total_steps: int) -> float:
    if step < int(total_steps * 0.5):
        return 3e-3
    if step < int(total_steps * 0.84):
        return 8e-4
    return 3e-4


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--steps", type=int, default=6000)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--validation-size", type=int, default=4096)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=Path, default=Path("artifacts/tiny_denoiser.json"))
    parser.add_argument(
        "--metrics", type=Path, default=Path("artifacts/training_metrics.json")
    )
    args = parser.parse_args()

    train_rng = np.random.default_rng(args.seed)
    model = TinyMLP(np.random.default_rng(args.seed + 1))
    optimizer = Adam(model.params)
    validation = make_validation(args.seed + 1000, args.validation_size)
    history = []
    started = time.time()

    for step in range(1, args.steps + 1):
        features, target_noise = make_batch(train_rng, args.batch_size)
        loss, grads = model.gradients(features, target_noise)
        optimizer.step(model.params, grads, learning_rate(step, args.steps), step)

        if step == 1 or step % 500 == 0 or step == args.steps:
            val_pred = model.forward(validation[-1])
            val_loss = float(np.mean((val_pred - validation[3]) ** 2))
            point = {"step": step, "train_mse": loss, "validation_mse": val_loss}
            history.append(point)
            print(
                f"step={step:5d} train_mse={loss:.6f} "
                f"validation_mse={val_loss:.6f}"
            )

    evaluation = evaluate(model, validation, args.seed)
    elapsed = time.time() - started
    training = {
        "seed": args.seed,
        "steps": args.steps,
        "batch_size": args.batch_size,
        "validation_size": args.validation_size,
        "elapsed_seconds": round(elapsed, 3),
        **evaluation,
    }
    payload = {
        "format": "cartpole-diffusion-tiny-mlp-v1",
        "version": "0.2",
        "architecture": {
            "input_dim": INPUT_DIM,
            "hidden_dims": list(HIDDEN_DIMS),
            "output_dim": OUTPUT_DIM,
            "activation": "silu",
        },
        "normalization": {
            "state_scale": [float(x) for x in STATE_SCALE],
            "action_scale_newtons": MAX_FORCE,
        },
        "diffusion": {
            "timesteps": DIFFUSION_STEPS,
            "schedule": "cosine",
            "cosine_s": COSINE_S,
            "timestep_embedding_dim": TIMESTEP_EMBED_DIM,
        },
        "teacher": {
            "type": "near_upright_discrete_lqr",
            "gain": [float(x) for x in TEACHER_GAIN],
            "horizon": HORIZON,
        },
        "training": training,
        "weights": model.export(),
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.metrics.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    args.metrics.write_text(
        json.dumps({"training": training, "history": history}, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(training, indent=2))
    print(f"wrote {args.out} ({args.out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
